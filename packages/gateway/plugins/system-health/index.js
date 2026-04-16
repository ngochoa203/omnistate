/**
 * system-health plugin — OmniState health sensor for macOS.
 * Runtime entry point (ESM JS, loaded via dynamic import by the plugin registry).
 *
 * This file is the source of truth for what runs; index.ts is the typed
 * counterpart for IDE support and type-checking.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a shell command, return stdout, or "" on any error. */
function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5_000 }).trim();
  } catch {
    return "";
  }
}

function worstStatus(...statuses) {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning")) return "warning";
  return "ok";
}

// ---------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------

function checkCpu() {
  // "{ 0.52 0.61 0.58 }"
  const raw = run("sysctl -n vm.loadavg");
  const nums = raw.replace(/[{}]/g, "").trim().split(/\s+/).map(parseFloat);
  const [avg1 = 0, avg5 = 0, avg15 = 0] = nums;

  const cores = parseInt(run("sysctl -n hw.logicalcpu"), 10) || 1;
  const ratio = avg1 / cores;

  const status =
    ratio > 1.0 ? "critical" : ratio > 0.8 ? "warning" : "ok";

  const message =
    status === "ok"
      ? `CPU load normal (1m avg ${avg1.toFixed(2)} on ${cores} cores)`
      : status === "warning"
        ? `CPU load elevated (1m avg ${avg1.toFixed(2)} on ${cores} cores)`
        : `CPU overloaded (1m avg ${avg1.toFixed(2)} on ${cores} cores)`;

  return { status, loadAvg1m: avg1, loadAvg5m: avg5, loadAvg15m: avg15, cores, message };
}

function checkMemory() {
  const totalBytes = parseInt(run("sysctl -n hw.memsize"), 10) || 0;
  const totalGb = totalBytes / 1_073_741_824;

  const pageSize = parseInt(run("sysctl -n hw.pagesize"), 10) || 4096;
  const vmStat = run("vm_stat");

  const extractPages = (label) => {
    const match = vmStat.match(new RegExp(`${label}[^:]*:\\s+(\\d+)`));
    return match ? parseInt(match[1], 10) * pageSize : 0;
  };

  const free = extractPages("Pages free");
  const inactive = extractPages("Pages inactive");
  const speculative = extractPages("Pages speculative");
  const availableBytes = free + inactive + speculative;
  const usedBytes = Math.max(0, totalBytes - availableBytes);

  const freeGb = availableBytes / 1_073_741_824;
  const usedGb = usedBytes / 1_073_741_824;
  const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

  // memory_pressure tool: available on macOS 10.9+
  let pressureLevel = "Normal";
  const pressureRaw = run("memory_pressure");
  if (pressureRaw.includes("WARN")) pressureLevel = "Warn";
  else if (pressureRaw.includes("CRITICAL")) pressureLevel = "Critical";

  const status =
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

function checkDisk() {
  // df -lk = local FSes only, 1 KiB blocks (eliminates devfs/autofs)
  // macOS column layout (9 cols):
  //   Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted-on
  const dfOut = run("df -lk");
  const lines = dfOut.split("\n").slice(1);
  const volumes = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;

    const totalKb = parseInt(parts[1], 10) || 0;
    const usedKb = parseInt(parts[2], 10) || 0;
    const availKb = parseInt(parts[3], 10) || 0;
    const usedPercent = parseInt(parts[4].replace("%", ""), 10) || 0;
    const mount = parts[8]; // last column after iused/ifree/%iused

    // Filter out sub-mounts and virtual FS
    if (
      totalKb === 0 ||
      mount.startsWith("/System/Volumes/") ||
      mount.startsWith("/private/var/folders") ||
      mount === "/dev"
    ) {
      continue;
    }

    const toGb = (kb) => kb / 1_048_576;
    const status =
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

  const allStatuses = volumes.length > 0 ? volumes.map((v) => v.status) : ["ok"];
  const overallStatus = worstStatus(...allStatuses);

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

function checkThermal() {
  const pmOut = run("pmset -g therm");

  let thermalState = "Normal";
  let cpuSpeedLimit = 100;

  const speedMatch = pmOut.match(/CPU_Scheduler_Limit\s*=\s*(\d+)/i);
  if (speedMatch) cpuSpeedLimit = parseInt(speedMatch[1], 10);

  const stateMatch = pmOut.match(/thermalState\s*=\s*(\w+)/i);
  if (stateMatch) thermalState = stateMatch[1];

  // Apple Silicon: machdep.xcpm.cpu_thermal_level (0 = none, higher = hotter)
  const sysctlTherm = run("sysctl -n machdep.xcpm.cpu_thermal_level 2>/dev/null || true");
  if (sysctlTherm) {
    const level = parseInt(sysctlTherm, 10);
    if (!isNaN(level) && level >= 4) thermalState = "High";
    else if (!isNaN(level) && level >= 2) thermalState = "Moderate";
  }

  const status =
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

/**
 * Returns a point-in-time health snapshot.
 * @returns {object} HealthReport
 */
export function checkHealth() {
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
 * Attempt automated remediation for a known issue type.
 *
 * @param {string} issue  One of: "high-cpu" | "memory-pressure" | "disk-full" | "thermal"
 * @returns {Promise<{issue: string, action: string, success: boolean, detail: string}>}
 */
export async function repair(issue) {
  switch (issue) {
    case "high-cpu": {
      // Non-destructive: identify top CPU consumers
      const top = run("ps -Arco pid,pcpu,comm | head -6");
      return {
        issue,
        action: "Identified top CPU consumers (read-only diagnostic)",
        success: true,
        detail: top || "Unable to retrieve process list",
      };
    }

    case "memory-pressure": {
      // `purge` evicts disk-backed inactive pages without requiring sudo
      run("purge");
      const after = checkMemory();
      return {
        issue,
        action: "Ran `purge` to evict disk-backed cached pages",
        success: true,
        detail: `Memory after purge: ${after.usedPercent.toFixed(1)}% used, pressure: ${after.pressureLevel}`,
      };
    }

    case "disk-full": {
      let detail = "";

      const trashPath = `${process.env.HOME}/.Trash`;
      if (existsSync(trashPath)) {
        run(`rm -rf "${trashPath}"/*`);
        detail += "Emptied Trash. ";
      }

      // Xcode DerivedData is a common multi-GB disk hog
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
      // Cannot force low-power mode without sudo; surface top contributors instead
      const heavyProcs = run("ps -Arco pid,pcpu,pmem,comm | head -8");
      return {
        issue,
        action: "Listed heavy processes contributing to thermal load (read-only)",
        success: true,
        detail:
          "Cannot force low-power mode without elevated privileges.\n" +
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
// Plugin lifecycle — called by PluginRegistry.loadAll()
// ---------------------------------------------------------------------------

let _activated = false;

export async function activate() {
  if (_activated) return;
  _activated = true;

  if (process.platform !== "darwin") {
    console.warn(
      `[system-health] Plugin requires macOS (darwin), running on ${process.platform}. ` +
        "Health checks may return partial data."
    );
  }

  if (!run("sysctl -n vm.loadavg")) {
    console.warn("[system-health] Could not read vm.loadavg — some metrics may be unavailable.");
  }

  console.log("[system-health] Plugin activated.");
}

export async function deactivate() {
  if (!_activated) return;
  _activated = false;
  console.log("[system-health] Plugin deactivated.");
}
