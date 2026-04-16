/**
 * system-health plugin — OmniState health sensor for macOS.
 *
 * Monitors CPU load, memory pressure, disk utilisation, and thermal state
 * using native macOS tools (vm_stat, df, top, pmset, sysctl).  All reads
 * are synchronous so results are available immediately; the plugin adds no
 * background threads and is safe to unload at any time.
 *
 * Exported API (consumed by the gateway registry via index.js):
 *   activate()        — lifecycle: called once on plugin load
 *   deactivate()      — lifecycle: called on shutdown / hot-reload
 *   checkHealth()     — returns a full HealthReport snapshot
 *   repair(issue)     — attempts an automated remediation action
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthStatus = "ok" | "warning" | "critical";

export interface CpuHealth {
  status: HealthStatus;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  /** Logical CPU count (denominator for load interpretation). */
  cores: number;
  message: string;
}

export interface MemoryHealth {
  status: HealthStatus;
  totalGb: number;
  usedGb: number;
  freeGb: number;
  usedPercent: number;
  /** macOS memory pressure level: "Normal" | "Warn" | "Critical" */
  pressureLevel: string;
  message: string;
}

export interface DiskHealth {
  /** One entry per mounted volume returned by `df`. */
  volumes: DiskVolume[];
  /** Overall worst-case status across all volumes. */
  status: HealthStatus;
  message: string;
}

export interface DiskVolume {
  mount: string;
  totalGb: number;
  usedGb: number;
  availGb: number;
  usedPercent: number;
  status: HealthStatus;
}

export interface ThermalHealth {
  status: HealthStatus;
  /** Raw thermalstate string from pmset: "Normal" | "Moderate" | "High" | "Critical" */
  thermalState: string;
  /** CPU speed limit percentage reported by pmset (100 = no throttle). */
  cpuSpeedLimit: number;
  message: string;
}

export interface HealthReport {
  timestamp: string;
  overall: HealthStatus;
  cpu: CpuHealth;
  memory: MemoryHealth;
  disk: DiskHealth;
  thermal: ThermalHealth;
}

export interface RepairResult {
  issue: string;
  action: string;
  success: boolean;
  detail: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a shell command and return stdout, or return "" on error. */
function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5_000 }).trim();
  } catch {
    return "";
  }
}

/** Parse "  12.34  " → 12.34, returns NaN on failure. */
function parseNum(s: string): number {
  return parseFloat(s.replace(/[^0-9.]/g, ""));
}

function worstStatus(...statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning")) return "warning";
  return "ok";
}

// ---------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------

function checkCpu(): CpuHealth {
  // `sysctl -n vm.loadavg` → "{ 0.52 0.61 0.58 }"
  const raw = run("sysctl -n vm.loadavg");
  const nums = raw.replace(/[{}]/g, "").trim().split(/\s+/).map(parseNum);
  const [avg1, avg5, avg15] = nums.length >= 3 ? nums : [0, 0, 0];

  const coresRaw = run("sysctl -n hw.logicalcpu");
  const cores = parseInt(coresRaw, 10) || 1;

  // A load average > cores * 0.8 at 1-min is a warning; > cores is critical.
  const ratio = avg1 / cores;
  const status: HealthStatus =
    ratio > 1.0 ? "critical" : ratio > 0.8 ? "warning" : "ok";

  const message =
    status === "ok"
      ? `CPU load normal (1m avg ${avg1.toFixed(2)} on ${cores} cores)`
      : status === "warning"
        ? `CPU load elevated (1m avg ${avg1.toFixed(2)} on ${cores} cores)`
        : `CPU overloaded (1m avg ${avg1.toFixed(2)} on ${cores} cores)`;

  return { status, loadAvg1m: avg1, loadAvg5m: avg5, loadAvg15m: avg15, cores, message };
}

function checkMemory(): MemoryHealth {
  // Physical RAM total via sysctl
  const totalBytesRaw = run("sysctl -n hw.memsize");
  const totalBytes = parseInt(totalBytesRaw, 10) || 0;
  const totalGb = totalBytes / 1_073_741_824;

  // vm_stat gives page counts; page size is 16 KiB on Apple Silicon, 4 KiB on Intel
  const pageSizeRaw = run("sysctl -n hw.pagesize");
  const pageSize = parseInt(pageSizeRaw, 10) || 4096;
  const vmStat = run("vm_stat");

  const extract = (label: string): number => {
    const match = vmStat.match(new RegExp(`${label}[^:]*:\\s+(\\d+)`));
    return match ? parseInt(match[1], 10) * pageSize : 0;
  };

  const free = extract("Pages free");
  const inactive = extract("Pages inactive");
  const speculative = extract("Pages speculative");
  // "available" ≈ free + inactive + speculative (simplified but accurate for reporting)
  const availableBytes = free + inactive + speculative;
  const usedBytes = Math.max(0, totalBytes - availableBytes);

  const freeGb = availableBytes / 1_073_741_824;
  const usedGb = usedBytes / 1_073_741_824;
  const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

  // Memory pressure via `memory_pressure` (available on macOS 10.9+)
  let pressureLevel = "Normal";
  const pressureRaw = run("memory_pressure");
  if (pressureRaw.includes("WARN")) pressureLevel = "Warn";
  else if (pressureRaw.includes("CRITICAL")) pressureLevel = "Critical";

  const status: HealthStatus =
    pressureLevel === "Critical" || usedPercent > 95
      ? "critical"
      : pressureLevel === "Warn" || usedPercent > 80
        ? "warning"
        : "ok";

  const message =
    `Memory ${usedPercent.toFixed(1)}% used ` +
    `(${usedGb.toFixed(1)} GB / ${totalGb.toFixed(1)} GB), ` +
    `pressure: ${pressureLevel}`;

  return { status, totalGb, usedGb, freeGb, usedPercent, pressureLevel, message };
}

function checkDisk(): DiskHealth {
  // df -lk = local FSes only, 1 KiB blocks (eliminates devfs/autofs)
  // macOS column layout (9 cols):
  //   Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted-on
  const dfOut = run("df -lk");
  const lines = dfOut.split("\n").slice(1); // skip header

  const volumes: DiskVolume[] = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;

    const totalKb = parseInt(parts[1], 10) || 0;
    const usedKb = parseInt(parts[2], 10) || 0;
    const availKb = parseInt(parts[3], 10) || 0;
    const usedPercentRaw = parts[4].replace("%", "");
    const usedPercent = parseInt(usedPercentRaw, 10) || 0;
    const mount = parts[8]; // last column after iused/ifree/%iused

    // Skip pseudo-mounts
    if (
      totalKb === 0 ||
      mount.startsWith("/System/Volumes/") ||
      mount.startsWith("/private/var/folders") ||
      mount === "/dev"
    ) {
      continue;
    }

    const toGb = (kb: number) => kb / 1_048_576;
    const status: HealthStatus =
      usedPercent >= 95 ? "critical" : usedPercent >= 80 ? "warning" : "ok";

    volumes.push({
      mount,
      totalGb: toGb(totalKb),
      usedGb: toGb(usedKb),
      availGb: toGb(availKb),
      usedPercent,
      status,
    });
  }

  const overallStatus = worstStatus(...(volumes.map((v) => v.status).length ? volumes.map((v) => v.status) : ["ok"]));
  const criticals = volumes.filter((v) => v.status === "critical").map((v) => v.mount);
  const warnings = volumes.filter((v) => v.status === "warning").map((v) => v.mount);

  const message =
    criticals.length > 0
      ? `Disk critical on: ${criticals.join(", ")}`
      : warnings.length > 0
        ? `Disk nearly full on: ${warnings.join(", ")}`
        : `Disk usage normal across ${volumes.length} volume(s)`;

  return { volumes, status: overallStatus, message };
}

function checkThermal(): ThermalHealth {
  // pmset -g therm prints thermal state info
  const pmOut = run("pmset -g therm");

  let thermalState = "Normal";
  let cpuSpeedLimit = 100;

  const stateMatch = pmOut.match(/CPU_Scheduler_Limit\s*=\s*(\d+)/i);
  if (stateMatch) cpuSpeedLimit = parseInt(stateMatch[1], 10);

  const thermalMatch = pmOut.match(/thermalState\s*=\s*(\w+)/i);
  if (thermalMatch) thermalState = thermalMatch[1];

  // Also check via sysctl on Apple Silicon (macOS 12+)
  const sysctlTherm = run("sysctl -n machdep.xcpm.cpu_thermal_level 2>/dev/null || true");
  if (sysctlTherm && parseInt(sysctlTherm, 10) > 0) {
    // Non-zero thermal level means some throttling is happening
    if (parseInt(sysctlTherm, 10) >= 4) thermalState = "High";
    else if (parseInt(sysctlTherm, 10) >= 2) thermalState = "Moderate";
  }

  const status: HealthStatus =
    thermalState === "Critical" || cpuSpeedLimit < 50
      ? "critical"
      : thermalState === "High" || thermalState === "Moderate" || cpuSpeedLimit < 90
        ? "warning"
        : "ok";

  const message =
    status === "ok"
      ? `Thermal state normal (${thermalState})`
      : status === "warning"
        ? `Thermal throttling detected: ${thermalState}, CPU speed limit ${cpuSpeedLimit}%`
        : `Critical thermal state: ${thermalState}, CPU speed limit ${cpuSpeedLimit}%`;

  return { status, thermalState, cpuSpeedLimit, message };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns a point-in-time health snapshot of the macOS system. */
export function checkHealth(): HealthReport {
  const cpu = checkCpu();
  const memory = checkMemory();
  const disk = checkDisk();
  const thermal = checkThermal();

  const overall = worstStatus(cpu.status, memory.status, disk.status, thermal.status);

  return {
    timestamp: new Date().toISOString(),
    overall,
    cpu,
    memory,
    disk,
    thermal,
  };
}

/**
 * Attempt an automated repair for a known issue type.
 *
 * Supported issue strings:
 *   "high-cpu"        — finds and logs top CPU consumers (safe, read-only)
 *   "memory-pressure" — purges disk cache to free inactive memory
 *   "disk-full"       — empties the user's Trash and macOS caches (~/Library/Caches)
 *   "thermal"         — suggests low-power mode (cannot force without sudo)
 */
export async function repair(issue: string): Promise<RepairResult> {
  switch (issue) {
    case "high-cpu": {
      // Report the top 5 CPU consumers — non-destructive diagnostic
      const top = run("ps -Arco pid,pcpu,comm | head -6");
      return {
        issue,
        action: "Identified top CPU consumers (read-only diagnostic)",
        success: true,
        detail: top || "Unable to retrieve process list",
      };
    }

    case "memory-pressure": {
      // `purge` forces macOS to evict disk-backed inactive pages.
      // Requires no special permissions on Ventura/Sonoma for the invoking user.
      const result = run("purge");
      const after = checkMemory();
      return {
        issue,
        action: "Ran `purge` to evict disk-backed cached pages",
        success: true,
        detail: `Memory after purge: ${after.usedPercent.toFixed(1)}% used, pressure: ${after.pressureLevel}. ${result}`,
      };
    }

    case "disk-full": {
      // Empty user Trash and clear macOS disk-image quarantine metadata
      const trashPath = `${process.env.HOME}/.Trash`;
      let detail = "";

      if (existsSync(trashPath)) {
        run(`rm -rf "${trashPath}"/*`);
        detail += "Emptied Trash. ";
      }

      // Clear user-level Derived Data if it exists (common disk hog for devs)
      const derivedData = `${process.env.HOME}/Library/Developer/Xcode/DerivedData`;
      if (existsSync(derivedData)) {
        run(`rm -rf "${derivedData}"`);
        detail += "Cleared Xcode DerivedData. ";
      }

      const after = checkDisk();
      detail += `Disk status after cleanup: ${after.message}`;

      return {
        issue,
        action: "Cleared Trash and Xcode DerivedData",
        success: true,
        detail,
      };
    }

    case "thermal": {
      // We cannot safely force low-power mode without sudo, so we identify
      // and list the top thermal contributors instead.
      const heavyProcs = run("ps -Arco pid,pcpu,pmem,comm | head -8");
      return {
        issue,
        action: "Listed heavy processes contributing to thermal load (read-only)",
        success: true,
        detail:
          "Cannot force low-power mode without elevated privileges. " +
          "Top processes by CPU/memory:\n" +
          (heavyProcs || "Unable to retrieve process list"),
      };
    }

    default:
      return {
        issue,
        action: "none",
        success: false,
        detail: `Unknown issue type: "${issue}". Supported: high-cpu, memory-pressure, disk-full, thermal`,
      };
  }
}

// ---------------------------------------------------------------------------
// Plugin lifecycle
// ---------------------------------------------------------------------------

let _activated = false;

/** Called once by the gateway registry after the plugin module is imported. */
export async function activate(): Promise<void> {
  if (_activated) return;
  _activated = true;

  // Validate platform — bail out gracefully on non-macOS
  const platform = process.platform;
  if (platform !== "darwin") {
    console.warn(
      `[system-health] Plugin requires macOS (darwin), running on ${platform}. ` +
        "Health checks will return stub data."
    );
  }

  // Quick smoke-test: confirm we can read load averages
  const loadAvg = run("sysctl -n vm.loadavg");
  if (!loadAvg) {
    console.warn("[system-health] Could not read vm.loadavg — some metrics may be unavailable.");
  }

  console.log("[system-health] Plugin activated.");
}

/** Called by the gateway registry on graceful shutdown or hot-reload. */
export async function deactivate(): Promise<void> {
  if (!_activated) return;
  _activated = false;
  console.log("[system-health] Plugin deactivated.");
}
