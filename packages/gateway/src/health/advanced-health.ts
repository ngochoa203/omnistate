/**
 * Advanced Health Monitor — Self-Healing capabilities.
 * Implements UC-C02 through UC-C20.
 */

import { promisify } from "node:util";
import { exec } from "node:child_process";
import { existsSync, readdirSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, platform, totalmem, freemem, cpus } from "node:os";
import { join, basename } from "node:path";

const execAsync = promisify(exec);

// ─── Helper ──────────────────────────────────────────────────────────────────

function getPlatform(): "macos" | "windows" | "linux" {
  switch (platform()) {
    case "darwin": return "macos";
    case "win32": return "windows";
    default: return "linux";
  }
}

async function run(cmd: string, timeoutMs = 30000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: timeoutMs, encoding: "utf-8" });
    return stdout.trim();
  } catch {
    return "";
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** UC-C02: Notification result */
export interface NotificationResult {
  channel: "native" | "telegram" | "discord" | "webhook";
  success: boolean;
  error?: string;
}

/** UC-C02: Notification options */
export interface NotificationOptions {
  title: string;
  message: string;
  subtitle?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  discordWebhookUrl?: string;
  webhookUrl?: string;
}

/** UC-C04: Process info */
export interface ProcessInfo {
  pid: number;
  name: string;
  status: "running" | "crashed" | "unknown";
  restartCount: number;
  lastRestartAt?: Date;
}

/** UC-C04: Crash detection result */
export interface CrashDetectionResult {
  processName: string;
  isRunning: boolean;
  crashLogs: string[];
  restarted: boolean;
  restartCount: number;
  error?: string;
}

/** UC-C05: Disk usage entry */
export interface DiskUsageEntry {
  path: string;
  sizeBytes: number;
  sizeHuman: string;
}

/** UC-C05: Disk rescue result */
export interface DiskRescueResult {
  freedBytes: number;
  freedHuman: string;
  cleanedPaths: string[];
  largeFiles: DiskUsageEntry[];
  errors: string[];
}

/** UC-C06: Network status */
export interface NetworkStatus {
  wifiConnected: boolean;
  ssid?: string;
  gatewayReachable: boolean;
  dnsWorking: boolean;
  httpConnectivity: boolean;
  healingAttempted: boolean;
  healingActions: string[];
  errors: string[];
}

/** UC-C07: Security scan result */
export interface SecurityScanResult {
  suspiciousConnections: SuspiciousConnection[];
  unusualProcesses: UnusualProcess[];
  riskScore: number;
  recommendations: string[];
}

/** UC-C07: Suspicious network connection */
export interface SuspiciousConnection {
  pid: number;
  process: string;
  localAddress: string;
  remoteAddress: string;
  protocol: string;
  reason: string;
}

/** UC-C07: Unusual process */
export interface UnusualProcess {
  pid: number;
  command: string;
  user: string;
  cpuPercent: number;
  memPercent: number;
  reason: string;
}

/** UC-C08: Watchdog heartbeat */
export interface WatchdogHeartbeat {
  service: string;
  lastBeat: Date;
  intervalMs: number;
  missedBeats: number;
  alive: boolean;
}

/** UC-C08: Watchdog registration */
export interface WatchdogOptions {
  service: string;
  intervalMs: number;
  maxMissedBeats?: number;
  onDead?: (service: string) => void | Promise<void>;
}

/** UC-C09: Process memory snapshot */
export interface ProcessMemorySnapshot {
  pid: number;
  name: string;
  rssKb: number;
  timestampMs: number;
}

/** UC-C09: Memory leak detection result */
export interface MemoryLeakResult {
  pid: number;
  processName: string;
  suspectedLeak: boolean;
  growthRateKbPerMin: number;
  snapshots: ProcessMemorySnapshot[];
  recommendation?: string;
}

/** UC-C10: Thermal status */
export interface ThermalStatus {
  cpuTempCelsius?: number;
  thermalPressure: "nominal" | "moderate" | "heavy" | "critical" | "unknown";
  throttling: boolean;
  fanSpeedRpm?: number;
  recommendation?: string;
}

/** UC-C11: Battery info */
export interface BatteryInfo {
  present: boolean;
  charging: boolean;
  chargePercent: number;
  cycleCount?: number;
  designCapacityMah?: number;
  currentCapacityMah?: number;
  health?: "good" | "fair" | "poor" | "unknown";
  timeToEmptyMinutes?: number;
  timeToFullMinutes?: number;
  temperature?: number;
  recommendation?: string;
}

/** UC-C12: Filesystem integrity result */
export interface FilesystemIntegrityResult {
  volume: string;
  healthy: boolean;
  issues: string[];
  repairAttempted: boolean;
  repairSucceeded?: boolean;
  output: string;
}

/** UC-C14: Certificate expiry info */
export interface CertExpiryInfo {
  host: string;
  port: number;
  subject?: string;
  issuer?: string;
  expiresAt?: Date;
  daysUntilExpiry?: number;
  expired: boolean;
  warning: boolean;
  warningThresholdDays: number;
  error?: string;
}

/** UC-C15: Service dependency status */
export interface ServiceDependencyStatus {
  name: string;
  type: "launchctl" | "port" | "http";
  running: boolean;
  pid?: number;
  port?: number;
  error?: string;
}

/** UC-C16: Log anomaly result */
export interface LogAnomalyResult {
  source: string;
  timeWindowMinutes: number;
  errorCount: number;
  warningCount: number;
  patterns: LogPattern[];
  anomalous: boolean;
}

/** UC-C16: Log pattern match */
export interface LogPattern {
  pattern: string;
  count: number;
  severity: "error" | "warning" | "info";
  samples: string[];
}

/** UC-C17: Permission drift result */
export interface PermissionDriftResult {
  path: string;
  expectedMode: string;
  actualMode: string;
  drifted: boolean;
  owner: string;
  group: string;
  fixed: boolean;
  error?: string;
}

/** UC-C18: SMART disk health */
export interface SmartDiskHealth {
  device: string;
  available: boolean;
  healthy?: boolean;
  overallStatus?: string;
  reallocatedSectors?: number;
  pendingSectors?: number;
  uncorrectableErrors?: number;
  temperature?: number;
  powerOnHours?: number;
  attributes: SmartAttribute[];
  error?: string;
}

/** UC-C18: SMART attribute */
export interface SmartAttribute {
  id: number;
  name: string;
  value: number;
  worst: number;
  threshold: number;
  failed: boolean;
}

/** UC-C19: Regression check result */
export interface RegressionCheckResult {
  checkName: string;
  osVersion: string;
  baseline?: Record<string, unknown>;
  current: Record<string, unknown>;
  regressions: RegressionItem[];
  passed: boolean;
}

/** UC-C19: Individual regression item */
export interface RegressionItem {
  key: string;
  baselineValue: unknown;
  currentValue: unknown;
  severity: "info" | "warning" | "critical";
  description: string;
}

/** UC-C20: Port exhaustion result */
export interface PortExhaustionResult {
  totalConnections: number;
  establishedCount: number;
  timeWaitCount: number;
  closeWaitCount: number;
  listenCount: number;
  exhaustionRisk: "low" | "medium" | "high" | "critical";
  topConsumers: PortConsumer[];
  recommendation?: string;
}

/** UC-C20: Top port consumer */
export interface PortConsumer {
  process: string;
  pid: number;
  connectionCount: number;
  timeWaitCount: number;
}

// ─── Restart tracking store ───────────────────────────────────────────────────

const _restartCounts = new Map<string, { count: number; lastAt: Date }>();

// ─── Class ───────────────────────────────────────────────────────────────────

export class AdvancedHealthMonitor {
  private readonly _watchdogs = new Map<
    string,
    { heartbeat: WatchdogHeartbeat; timer: ReturnType<typeof setInterval> }
  >();
  private readonly _memSnapshots = new Map<number, ProcessMemorySnapshot[]>();

  // ── UC-C02: Notifications ─────────────────────────────────────────────────

  /**
   * Send a system notification via native macOS dialog and/or external channels.
   * Supports Telegram, Discord webhooks, and arbitrary HTTP webhooks.
   */
  async sendNotification(opts: NotificationOptions): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    // Native macOS notification via osascript
    if (getPlatform() === "macos") {
      try {
        const subtitle = opts.subtitle ? `, subtitle:"${opts.subtitle.replace(/"/g, '\\"')}"` : "";
        const cmd = `osascript -e 'display notification "${opts.message.replace(/"/g, '\\"')}" with title "${opts.title.replace(/"/g, '\\"')}"${subtitle}'`;
        await run(cmd, 5000);
        results.push({ channel: "native", success: true });
      } catch (err) {
        results.push({ channel: "native", success: false, error: String(err) });
      }
    }

    // Telegram
    if (opts.telegramBotToken && opts.telegramChatId) {
      try {
        const text = encodeURIComponent(`*${opts.title}*\n${opts.message}`);
        const url = `https://api.telegram.org/bot${opts.telegramBotToken}/sendMessage?chat_id=${opts.telegramChatId}&text=${text}&parse_mode=Markdown`;
        const out = await run(`curl -s -X POST "${url}"`, 10000);
        const parsed = JSON.parse(out || "{}");
        results.push({ channel: "telegram", success: parsed.ok === true });
      } catch (err) {
        results.push({ channel: "telegram", success: false, error: String(err) });
      }
    }

    // Discord webhook
    if (opts.discordWebhookUrl) {
      try {
        const payload = JSON.stringify({ content: `**${opts.title}**\n${opts.message}` });
        const out = await run(
          `curl -s -X POST -H "Content-Type: application/json" -d '${payload.replace(/'/g, "'\\''")}' "${opts.discordWebhookUrl}"`,
          10000,
        );
        results.push({ channel: "discord", success: out !== undefined });
      } catch (err) {
        results.push({ channel: "discord", success: false, error: String(err) });
      }
    }

    // Generic webhook
    if (opts.webhookUrl) {
      try {
        const payload = JSON.stringify({ title: opts.title, message: opts.message, timestamp: new Date().toISOString() });
        await run(
          `curl -s -X POST -H "Content-Type: application/json" -d '${payload.replace(/'/g, "'\\''")}' "${opts.webhookUrl}"`,
          10000,
        );
        results.push({ channel: "webhook", success: true });
      } catch (err) {
        results.push({ channel: "webhook", success: false, error: String(err) });
      }
    }

    return results;
  }

  // ── UC-C04: Crash Detection ───────────────────────────────────────────────

  /**
   * Check whether a named process is running and read recent crash logs.
   * Attempts exponential-backoff restart via `open -a` or direct process name.
   */
  async detectAndHealCrash(
    processName: string,
    restartCmd?: string,
    maxRestarts = 3,
  ): Promise<CrashDetectionResult> {
    const result: CrashDetectionResult = {
      processName,
      isRunning: false,
      crashLogs: [],
      restarted: false,
      restartCount: 0,
    };

    try {
      const pgrepOut = await run(`pgrep -x "${processName}"`, 5000);
      result.isRunning = pgrepOut.trim().length > 0;

      // Read CrashReporter logs
      const crashDirs = [
        join(homedir(), "Library", "Logs", "DiagnosticReports"),
        "/Library/Logs/DiagnosticReports",
      ];
      for (const dir of crashDirs) {
        if (!existsSync(dir)) continue;
        try {
          const files = readdirSync(dir)
            .filter((f) => f.toLowerCase().includes(processName.toLowerCase()) && f.endsWith(".crash"))
            .sort()
            .slice(-3);
          for (const f of files) {
            result.crashLogs.push(join(dir, f));
          }
        } catch { /* skip */ }
      }

      if (!result.isRunning) {
        const store = _restartCounts.get(processName) ?? { count: 0, lastAt: new Date(0) };
        if (store.count < maxRestarts) {
          // Exponential backoff
          const backoffMs = Math.pow(2, store.count) * 1000;
          await new Promise((r) => setTimeout(r, Math.min(backoffMs, 30000)));

          const cmd = restartCmd ?? (getPlatform() === "macos" ? `open -a "${processName}"` : `${processName} &`);
          await run(cmd, 15000);

          store.count += 1;
          store.lastAt = new Date();
          _restartCounts.set(processName, store);

          result.restarted = true;
          result.restartCount = store.count;
        } else {
          result.error = `Max restarts (${maxRestarts}) reached for ${processName}`;
        }
      }
    } catch (err) {
      result.error = String(err);
    }

    return result;
  }

  // ── UC-C05: Disk Rescue ───────────────────────────────────────────────────

  /**
   * Free disk space by cleaning caches, temp files, and log directories.
   * Also identifies the largest files in a given search root.
   */
  async diskRescue(searchRoot?: string, dryRun = false): Promise<DiskRescueResult> {
    const result: DiskRescueResult = {
      freedBytes: 0,
      freedHuman: "0 B",
      cleanedPaths: [],
      largeFiles: [],
      errors: [],
    };

    const cleanTargets: string[] = [];

    if (getPlatform() === "macos") {
      cleanTargets.push(
        join(homedir(), "Library", "Caches"),
        "/tmp",
        "/private/tmp",
        "/private/var/log",
      );
    } else {
      cleanTargets.push("/tmp", "/var/log", "/var/cache");
    }

    for (const target of cleanTargets) {
      if (!existsSync(target)) continue;
      try {
        const beforeOut = await run(`du -sk "${target}"`, 10000);
        const beforeKb = parseInt(beforeOut.split("\t")[0] ?? "0", 10);

        if (!dryRun) {
          await run(`find "${target}" -type f -mtime +7 -delete 2>/dev/null || true`, 15000);
        }

        const afterOut = await run(`du -sk "${target}"`, 10000);
        const afterKb = parseInt(afterOut.split("\t")[0] ?? "0", 10);
        const freedKb = Math.max(0, beforeKb - afterKb);
        result.freedBytes += freedKb * 1024;
        if (freedKb > 0) result.cleanedPaths.push(target);
      } catch (err) {
        result.errors.push(`${target}: ${String(err)}`);
      }
    }

    // Find large files
    const root = searchRoot ?? homedir();
    try {
      const findOut = await run(
        `find "${root}" -type f -size +100M -exec du -sh {} \\; 2>/dev/null | sort -rh | head -20`,
        30000,
      );
      for (const line of findOut.split("\n").filter(Boolean)) {
        const parts = line.split("\t");
        if (parts.length >= 2) {
          result.largeFiles.push({
            path: parts[1]!,
            sizeHuman: parts[0]!,
            sizeBytes: 0, // approximate only
          });
        }
      }
    } catch (err) {
      result.errors.push(`large-file-scan: ${String(err)}`);
    }

    result.freedHuman = formatBytes(result.freedBytes);
    return result;
  }

  // ── UC-C06: Network Healing ───────────────────────────────────────────────

  /**
   * Diagnose and attempt to heal network connectivity issues:
   * WiFi status, gateway ping, DNS, HTTP reachability.
   */
  async diagnoseAndHealNetwork(
    testUrl = "https://www.google.com",
    autoHeal = true,
  ): Promise<NetworkStatus> {
    const status: NetworkStatus = {
      wifiConnected: false,
      gatewayReachable: false,
      dnsWorking: false,
      httpConnectivity: false,
      healingAttempted: false,
      healingActions: [],
      errors: [],
    };

    try {
      // WiFi status (macOS)
      if (getPlatform() === "macos") {
        const wifiOut = await run("networksetup -getairportnetwork en0", 5000);
        status.wifiConnected = wifiOut.includes("Current Wi-Fi Network:");
        if (status.wifiConnected) {
          status.ssid = wifiOut.replace("Current Wi-Fi Network:", "").trim();
        }
      } else {
        const iwOut = await run("iwconfig 2>/dev/null || nmcli -t -f active,ssid dev wifi 2>/dev/null | head -1", 5000);
        status.wifiConnected = iwOut.includes("ESSID") || iwOut.startsWith("yes:");
      }
    } catch (err) {
      status.errors.push(`wifi-check: ${String(err)}`);
    }

    try {
      // Gateway ping
      const gwOut = await run("netstat -rn 2>/dev/null | grep default | awk '{print $2}' | head -1", 5000);
      const gateway = gwOut.trim() || "8.8.8.8";
      const pingOut = await run(`ping -c 2 -W 2 "${gateway}"`, 8000);
      status.gatewayReachable = pingOut.includes("bytes from");
    } catch (err) {
      status.errors.push(`gateway-ping: ${String(err)}`);
    }

    try {
      // DNS check
      const dnsOut = await run("nslookup google.com 2>/dev/null || dig +short google.com 2>/dev/null", 8000);
      status.dnsWorking = dnsOut.trim().length > 0;
    } catch (err) {
      status.errors.push(`dns-check: ${String(err)}`);
    }

    try {
      // HTTP connectivity
      const httpOut = await run(`curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${testUrl}"`, 15000);
      const code = parseInt(httpOut.trim(), 10);
      status.httpConnectivity = code >= 200 && code < 400;
    } catch (err) {
      status.errors.push(`http-check: ${String(err)}`);
    }

    // Healing
    if (autoHeal && !status.wifiConnected && getPlatform() === "macos") {
      status.healingAttempted = true;
      await run("networksetup -setairportpower en0 off", 5000);
      await new Promise((r) => setTimeout(r, 2000));
      await run("networksetup -setairportpower en0 on", 5000);
      await new Promise((r) => setTimeout(r, 5000));
      status.healingActions.push("Toggled WiFi off/on");
    }

    if (autoHeal && !status.dnsWorking) {
      status.healingAttempted = true;
      if (getPlatform() === "macos") {
        await run("sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder", 8000);
        status.healingActions.push("Flushed DNS cache");
      }
    }

    return status;
  }

  // ── UC-C07: Security Scan ─────────────────────────────────────────────────

  /**
   * Scan for suspicious network connections and unusual processes.
   * Returns a risk score and actionable recommendations.
   */
  async securityScan(): Promise<SecurityScanResult> {
    const result: SecurityScanResult = {
      suspiciousConnections: [],
      unusualProcesses: [],
      riskScore: 0,
      recommendations: [],
    };

    try {
      // lsof -i for open network connections
      const lsofOut = await run("lsof -i -n -P 2>/dev/null | grep -v LISTEN | tail -100", 15000);
      const suspiciousPorts = new Set([4444, 5555, 6666, 7777, 8080, 1337, 31337, 12345, 54321]);

      for (const line of lsofOut.split("\n").filter(Boolean)) {
        const parts = line.split(/\s+/);
        if (parts.length < 9) continue;
        const proc = parts[0] ?? "";
        const pid = parseInt(parts[1] ?? "0", 10);
        const addrPart = parts[8] ?? "";
        const arrow = addrPart.indexOf("->");

        if (arrow !== -1) {
          const remote = addrPart.substring(arrow + 2);
          const remotePort = parseInt((remote.split(":").pop() ?? "0"), 10);

          if (suspiciousPorts.has(remotePort)) {
            result.suspiciousConnections.push({
              pid,
              process: proc,
              localAddress: addrPart.substring(0, arrow),
              remoteAddress: remote,
              protocol: "TCP",
              reason: `Connection to suspicious port ${remotePort}`,
            });
            result.riskScore += 20;
          }
        }
      }
    } catch { /* ignore */ }

    try {
      // ps aux for unusual processes
      const psOut = await run("ps aux --sort=-%cpu 2>/dev/null || ps aux", 10000);
      const lines = psOut.split("\n").slice(1, 51); // skip header, top 50

      const knownSafe = new Set(["kernel_task", "launchd", "WindowServer", "Finder", "Dock", "node", "python", "bash", "zsh", "sh"]);
      const suspiciousPatterns = [/nc\s/, /ncat/, /netcat/, /socat/, /cryptominer/, /miner/, /xmrig/i, /\.sh\s+-[ci]/];

      for (const line of lines.filter(Boolean)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 11) continue;
        const user = parts[0] ?? "";
        const pid = parseInt(parts[1] ?? "0", 10);
        const cpu = parseFloat(parts[2] ?? "0");
        const mem = parseFloat(parts[3] ?? "0");
        const cmd = parts.slice(10).join(" ");
        const cmdBase = basename(parts[10] ?? "");

        const isSuspicious = suspiciousPatterns.some((p) => p.test(cmd));
        const isHighResource = cpu > 80 && !knownSafe.has(cmdBase);

        if (isSuspicious || isHighResource) {
          result.unusualProcesses.push({
            pid,
            command: cmd,
            user,
            cpuPercent: cpu,
            memPercent: mem,
            reason: isSuspicious ? "Matches suspicious pattern" : `High CPU usage: ${cpu}%`,
          });
          result.riskScore += isSuspicious ? 30 : 10;
        }
      }
    } catch { /* ignore */ }

    // Recommendations
    if (result.suspiciousConnections.length > 0) {
      result.recommendations.push("Review and terminate suspicious network connections.");
    }
    if (result.unusualProcesses.length > 0) {
      result.recommendations.push("Investigate high-CPU or pattern-matching processes.");
    }
    if (result.riskScore === 0) {
      result.recommendations.push("No immediate threats detected. Continue routine monitoring.");
    }

    result.riskScore = Math.min(100, result.riskScore);
    return result;
  }

  // ── UC-C08: Watchdog ──────────────────────────────────────────────────────

  /**
   * Register a service with the watchdog. The service must call `beat(service)`
   * periodically or it will be marked as dead and the `onDead` callback fires.
   */
  registerWatchdog(opts: WatchdogOptions): void {
    const maxMissed = opts.maxMissedBeats ?? 3;

    const heartbeat: WatchdogHeartbeat = {
      service: opts.service,
      lastBeat: new Date(),
      intervalMs: opts.intervalMs,
      missedBeats: 0,
      alive: true,
    };

    const timer = setInterval(async () => {
      const elapsed = Date.now() - heartbeat.lastBeat.getTime();
      if (elapsed > opts.intervalMs) {
        heartbeat.missedBeats += 1;
        heartbeat.alive = heartbeat.missedBeats < maxMissed;

        if (!heartbeat.alive && opts.onDead) {
          try {
            await opts.onDead(opts.service);
          } catch { /* ignore callback errors */ }
        }
      } else {
        heartbeat.missedBeats = 0;
        heartbeat.alive = true;
      }
    }, opts.intervalMs);

    // Allow Node to exit even if watchdog is running
    if (typeof timer.unref === "function") timer.unref();

    this._watchdogs.set(opts.service, { heartbeat, timer });
  }

  /**
   * Record a heartbeat for a registered service, resetting its missed-beat counter.
   */
  beat(service: string): boolean {
    const entry = this._watchdogs.get(service);
    if (!entry) return false;
    entry.heartbeat.lastBeat = new Date();
    entry.heartbeat.missedBeats = 0;
    entry.heartbeat.alive = true;
    return true;
  }

  /**
   * Unregister a watchdog service and stop its interval timer.
   */
  unregisterWatchdog(service: string): boolean {
    const entry = this._watchdogs.get(service);
    if (!entry) return false;
    clearInterval(entry.timer);
    this._watchdogs.delete(service);
    return true;
  }

  /**
   * Get current watchdog status for all registered services.
   */
  getWatchdogStatus(): WatchdogHeartbeat[] {
    return Array.from(this._watchdogs.values()).map((e) => ({ ...e.heartbeat }));
  }

  // ── UC-C09: Memory Leak Detection ─────────────────────────────────────────

  /**
   * Take a memory snapshot for the given PID (or process name).
   * Call this repeatedly, then call `analyzeMemoryLeak` to detect growth trends.
   */
  async snapshotMemory(pidOrName: number | string): Promise<ProcessMemorySnapshot | null> {
    try {
      let pid: number;
      let name: string;

      if (typeof pidOrName === "string") {
        const pgrepOut = await run(`pgrep -x "${pidOrName}" | head -1`, 5000);
        pid = parseInt(pgrepOut.trim(), 10);
        name = pidOrName;
      } else {
        pid = pidOrName;
        const psOut = await run(`ps -p ${pid} -o comm=`, 5000);
        name = psOut.trim() || `pid-${pid}`;
      }

      if (!pid || isNaN(pid)) return null;

      const psOut = await run(`ps -p ${pid} -o rss=`, 5000);
      const rssKb = parseInt(psOut.trim(), 10);
      if (isNaN(rssKb)) return null;

      const snap: ProcessMemorySnapshot = { pid, name, rssKb, timestampMs: Date.now() };
      const history = this._memSnapshots.get(pid) ?? [];
      history.push(snap);
      // Keep last 60 snapshots
      if (history.length > 60) history.shift();
      this._memSnapshots.set(pid, history);

      return snap;
    } catch {
      return null;
    }
  }

  /**
   * Analyze memory snapshots for a PID to detect leak patterns.
   * Requires at least 3 snapshots for meaningful analysis.
   */
  analyzeMemoryLeak(pid: number, thresholdKbPerMin = 10000): MemoryLeakResult {
    const snapshots = this._memSnapshots.get(pid) ?? [];

    const result: MemoryLeakResult = {
      pid,
      processName: snapshots[0]?.name ?? `pid-${pid}`,
      suspectedLeak: false,
      growthRateKbPerMin: 0,
      snapshots: [...snapshots],
    };

    if (snapshots.length < 3) {
      result.recommendation = "Not enough snapshots — collect at least 3 data points.";
      return result;
    }

    const first = snapshots[0]!;
    const last = snapshots[snapshots.length - 1]!;
    const elapsedMin = (last.timestampMs - first.timestampMs) / 60000;
    if (elapsedMin <= 0) return result;

    result.growthRateKbPerMin = (last.rssKb - first.rssKb) / elapsedMin;
    result.suspectedLeak = result.growthRateKbPerMin > thresholdKbPerMin;

    if (result.suspectedLeak) {
      result.recommendation = `Process ${result.processName} is growing ~${Math.round(result.growthRateKbPerMin)} KB/min. Consider restarting or profiling.`;
    }

    return result;
  }

  // ── UC-C10: Thermal ───────────────────────────────────────────────────────

  /**
   * Read CPU temperature and thermal pressure on macOS using ioreg/powermetrics/pmset.
   */
  async getThermalStatus(): Promise<ThermalStatus> {
    const status: ThermalStatus = {
      thermalPressure: "unknown",
      throttling: false,
    };

    try {
      if (getPlatform() === "macos") {
        // pmset -g therm for throttling/pressure
        const pmsetOut = await run("pmset -g therm 2>/dev/null", 8000);
        if (pmsetOut.includes("CPU_Speed_Limit")) {
          const match = pmsetOut.match(/CPU_Speed_Limit\s*=\s*(\d+)/);
          if (match) {
            const limit = parseInt(match[1]!, 10);
            status.throttling = limit < 100;
          }
        }
        if (pmsetOut.toLowerCase().includes("heavy")) {
          status.thermalPressure = "heavy";
        } else if (pmsetOut.toLowerCase().includes("moderate")) {
          status.thermalPressure = "moderate";
        } else if (pmsetOut.toLowerCase().includes("nominal")) {
          status.thermalPressure = "nominal";
        }

        // ioreg for CPU temperature sensor
        const ioregOut = await run(
          'ioreg -l | grep -i "CPU die temperature" | head -1',
          10000,
        );
        const tempMatch = ioregOut.match(/=\s*([\d.]+)/);
        if (tempMatch) {
          status.cpuTempCelsius = parseFloat(tempMatch[1]!);
        }

        // Fan speed
        const fanOut = await run('ioreg -l | grep -i "fan speed" | head -1', 10000);
        const fanMatch = fanOut.match(/=\s*(\d+)/);
        if (fanMatch) {
          status.fanSpeedRpm = parseInt(fanMatch[1]!, 10);
        }

        if (status.cpuTempCelsius !== undefined) {
          if (status.cpuTempCelsius > 90) {
            status.thermalPressure = "critical";
            status.recommendation = "CPU critically hot — reduce load immediately.";
          } else if (status.cpuTempCelsius > 75) {
            if (status.thermalPressure === "unknown") status.thermalPressure = "heavy";
            status.recommendation = "CPU temperature elevated — check cooling.";
          }
        }
      } else {
        // Linux fallback
        const tempOut = await run("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null", 5000);
        if (tempOut.trim()) {
          status.cpuTempCelsius = parseInt(tempOut.trim(), 10) / 1000;
        }
        status.thermalPressure = "nominal";
      }
    } catch { /* ignore */ }

    return status;
  }

  // ── UC-C11: Battery ───────────────────────────────────────────────────────

  /**
   * Read detailed battery information from ioreg and pmset on macOS.
   */
  async getBatteryInfo(): Promise<BatteryInfo> {
    const info: BatteryInfo = {
      present: false,
      charging: false,
      chargePercent: 0,
    };

    try {
      if (getPlatform() === "macos") {
        // pmset -g batt for quick overview
        const pmsetOut = await run("pmset -g batt", 5000);
        if (pmsetOut.includes("Battery Power") || pmsetOut.includes("AC Power")) {
          info.present = true;
          info.charging = pmsetOut.includes("AC Power") && pmsetOut.includes("charging");

          const percentMatch = pmsetOut.match(/(\d+)%/);
          if (percentMatch) info.chargePercent = parseInt(percentMatch[1]!, 10);

          const timeMatch = pmsetOut.match(/(\d+:\d+) remaining/);
          if (timeMatch && !info.charging) {
            const [h, m] = timeMatch[1]!.split(":").map(Number);
            info.timeToEmptyMinutes = (h ?? 0) * 60 + (m ?? 0);
          }
        }

        // ioreg -l for detailed battery attributes
        const ioregOut = await run("ioreg -l -n AppleSmartBattery 2>/dev/null | head -80", 15000);

        const extract = (key: string): number | undefined => {
          const m = ioregOut.match(new RegExp(`"${key}"\\s*=\\s*(\\d+)`));
          return m ? parseInt(m[1]!, 10) : undefined;
        };

        info.cycleCount = extract("CycleCount");
        info.designCapacityMah = extract("DesignCapacity");
        info.currentCapacityMah = extract("MaxCapacity") ?? extract("FullChargeCapacity");
        const temp = extract("Temperature");
        if (temp !== undefined) info.temperature = temp / 100; // convert to Celsius

        if (info.designCapacityMah && info.currentCapacityMah) {
          const healthRatio = info.currentCapacityMah / info.designCapacityMah;
          if (healthRatio >= 0.8) info.health = "good";
          else if (healthRatio >= 0.6) info.health = "fair";
          else info.health = "poor";
        }

        if (info.cycleCount !== undefined && info.cycleCount > 1000) {
          info.recommendation = `Battery has ${info.cycleCount} cycles — consider replacement.`;
        }
      } else {
        // Linux upower fallback
        const upowerOut = await run("upower -i $(upower -e | grep battery) 2>/dev/null", 8000);
        if (upowerOut) {
          info.present = true;
          const percentMatch = upowerOut.match(/percentage:\s*([\d.]+)%/i);
          if (percentMatch) info.chargePercent = parseFloat(percentMatch[1]!);
          info.charging = /state:\s*charging/i.test(upowerOut);
        }
      }
    } catch { /* ignore */ }

    return info;
  }

  // ── UC-C12: Filesystem Integrity ──────────────────────────────────────────

  /**
   * Verify filesystem integrity of a volume using diskutil on macOS.
   * Optionally attempts repair if issues are found.
   */
  async checkFilesystemIntegrity(volume = "/", autoRepair = false): Promise<FilesystemIntegrityResult> {
    const result: FilesystemIntegrityResult = {
      volume,
      healthy: false,
      issues: [],
      repairAttempted: false,
      output: "",
    };

    try {
      if (getPlatform() === "macos") {
        const verifyOut = await run(`diskutil verifyVolume "${volume}" 2>&1`, 30000);
        result.output = verifyOut;
        result.healthy =
          verifyOut.toLowerCase().includes("appears to be ok") ||
          verifyOut.toLowerCase().includes("no problems found");

        if (!result.healthy) {
          // Extract issue lines
          for (const line of verifyOut.split("\n")) {
            if (/error|invalid|corrupt|problem|failed/i.test(line)) {
              result.issues.push(line.trim());
            }
          }

          if (autoRepair) {
            result.repairAttempted = true;
            const repairOut = await run(`diskutil repairVolume "${volume}" 2>&1`, 60000);
            result.repairSucceeded =
              repairOut.toLowerCase().includes("repaired successfully") ||
              repairOut.toLowerCase().includes("no problems found");
            result.output += "\n--- REPAIR ---\n" + repairOut;
          }
        }
      } else {
        // Linux: fsck (read-only check)
        const device = await run(`df "${volume}" | tail -1 | awk '{print $1}'`, 5000);
        if (device.trim()) {
          const fsckOut = await run(`fsck -n "${device.trim()}" 2>&1 || true`, 30000);
          result.output = fsckOut;
          result.healthy = !/error|corrupt|bad/i.test(fsckOut);
        }
      }
    } catch (err) {
      result.issues.push(String(err));
    }

    return result;
  }

  // ── UC-C14: Certificate Expiry ────────────────────────────────────────────

  /**
   * Check TLS certificate expiry for a given host and port.
   * Returns days until expiry and a warning flag if below threshold.
   */
  async checkCertExpiry(
    host: string,
    port = 443,
    warningThresholdDays = 30,
  ): Promise<CertExpiryInfo> {
    const info: CertExpiryInfo = {
      host,
      port,
      expired: false,
      warning: false,
      warningThresholdDays,
    };

    try {
      const cmd = `echo | openssl s_client -servername "${host}" -connect "${host}:${port}" 2>/dev/null | openssl x509 -noout -subject -issuer -dates 2>/dev/null`;
      const out = await run(cmd, 20000);

      const subjectMatch = out.match(/subject=(.+)/);
      if (subjectMatch) info.subject = subjectMatch[1]!.trim();

      const issuerMatch = out.match(/issuer=(.+)/);
      if (issuerMatch) info.issuer = issuerMatch[1]!.trim();

      const expiryMatch = out.match(/notAfter=(.+)/);
      if (expiryMatch) {
        info.expiresAt = new Date(expiryMatch[1]!.trim());
        const now = new Date();
        info.daysUntilExpiry = Math.floor(
          (info.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        info.expired = info.daysUntilExpiry < 0;
        info.warning = !info.expired && info.daysUntilExpiry <= warningThresholdDays;
      }
    } catch (err) {
      info.error = String(err);
    }

    return info;
  }

  // ── UC-C15: Service Dependencies ─────────────────────────────────────────

  /**
   * Check whether named launchctl services and TCP ports are up.
   */
  async checkServiceDependencies(
    services: Array<{ name: string; type: "launchctl" | "port" | "http"; port?: number; url?: string }>,
  ): Promise<ServiceDependencyStatus[]> {
    const results: ServiceDependencyStatus[] = [];

    for (const svc of services) {
      const status: ServiceDependencyStatus = {
        name: svc.name,
        type: svc.type,
        running: false,
      };

      try {
        if (svc.type === "launchctl") {
          const out = await run(`launchctl list | grep "${svc.name}" | head -1`, 8000);
          if (out.trim()) {
            const parts = out.split(/\s+/);
            status.running = parts[0] !== "-";
            const pid = parseInt(parts[0] ?? "0", 10);
            if (!isNaN(pid) && pid > 0) status.pid = pid;
          }
        } else if (svc.type === "port" && svc.port !== undefined) {
          status.port = svc.port;
          const portOut = await run(
            `lsof -i TCP:${svc.port} -n -P 2>/dev/null | grep LISTEN | head -1`,
            8000,
          );
          status.running = portOut.trim().length > 0;
          if (status.running) {
            const pidMatch = portOut.match(/\s+(\d+)\s+/);
            if (pidMatch) status.pid = parseInt(pidMatch[1]!, 10);
          }
        } else if (svc.type === "http" && svc.url) {
          const curlOut = await run(
            `curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${svc.url}"`,
            10000,
          );
          const code = parseInt(curlOut.trim(), 10);
          status.running = code >= 200 && code < 500;
        }
      } catch (err) {
        status.error = String(err);
      }

      results.push(status);
    }

    return results;
  }

  // ── UC-C16: Log Anomalies ─────────────────────────────────────────────────

  /**
   * Scan system logs for error/warning patterns within a recent time window.
   */
  async detectLogAnomalies(
    source = "system",
    timeWindowMinutes = 15,
    errorThreshold = 10,
  ): Promise<LogAnomalyResult> {
    const result: LogAnomalyResult = {
      source,
      timeWindowMinutes,
      errorCount: 0,
      warningCount: 0,
      patterns: [],
      anomalous: false,
    };

    const patternDefs = [
      { pattern: "error", severity: "error" as const },
      { pattern: "Error", severity: "error" as const },
      { pattern: "FATAL", severity: "error" as const },
      { pattern: "failed", severity: "error" as const },
      { pattern: "warning", severity: "warning" as const },
      { pattern: "Warning", severity: "warning" as const },
      { pattern: "critical", severity: "error" as const },
    ];

    try {
      if (getPlatform() === "macos") {
        const cmd = `log show --last ${timeWindowMinutes}m --style compact 2>/dev/null | tail -2000`;
        const logOut = await run(cmd, 30000);
        const lines = logOut.split("\n").filter(Boolean);

        const patternCounts = new Map<string, { count: number; severity: "error" | "warning" | "info"; samples: string[] }>();

        for (const line of lines) {
          for (const { pattern, severity } of patternDefs) {
            if (line.includes(pattern)) {
              const existing = patternCounts.get(pattern) ?? { count: 0, severity, samples: [] };
              existing.count += 1;
              if (existing.samples.length < 3) existing.samples.push(line.substring(0, 200));
              patternCounts.set(pattern, existing);

              if (severity === "error") result.errorCount += 1;
              else result.warningCount += 1;
              break; // count each line once
            }
          }
        }

        for (const [pattern, data] of patternCounts) {
          result.patterns.push({ pattern, ...data });
        }
      } else {
        // Linux: journalctl or /var/log/syslog
        const cmd = `journalctl --since "${timeWindowMinutes} minutes ago" -p err 2>/dev/null | tail -500 || grep -i "error\\|warning" /var/log/syslog 2>/dev/null | tail -500`;
        const logOut = await run(cmd, 20000);
        result.errorCount = (logOut.match(/error/gi) ?? []).length;
        result.warningCount = (logOut.match(/warning/gi) ?? []).length;
      }

      result.anomalous = result.errorCount > errorThreshold;
    } catch { /* ignore */ }

    return result;
  }

  // ── UC-C17: Permission Drift ──────────────────────────────────────────────

  /**
   * Check files/directories for permission drift from expected modes.
   * Optionally fixes permissions using chmod.
   */
  async checkPermissionDrift(
    checks: Array<{ path: string; expectedMode: string; fix?: boolean }>,
  ): Promise<PermissionDriftResult[]> {
    const results: PermissionDriftResult[] = [];

    for (const check of checks) {
      const result: PermissionDriftResult = {
        path: check.path,
        expectedMode: check.expectedMode,
        actualMode: "unknown",
        drifted: false,
        owner: "unknown",
        group: "unknown",
        fixed: false,
      };

      try {
        if (!existsSync(check.path)) {
          result.error = "Path does not exist";
          results.push(result);
          continue;
        }

        const statOut = await run(`stat -f "%Lp %Su %Sg" "${check.path}" 2>/dev/null || stat --format "%a %U %G" "${check.path}" 2>/dev/null`, 5000);
        const parts = statOut.trim().split(/\s+/);
        result.actualMode = parts[0] ?? "unknown";
        result.owner = parts[1] ?? "unknown";
        result.group = parts[2] ?? "unknown";

        result.drifted = result.actualMode !== check.expectedMode;

        if (result.drifted && check.fix) {
          await run(`chmod "${check.expectedMode}" "${check.path}"`, 5000);
          const verify = await run(`stat -f "%Lp" "${check.path}" 2>/dev/null || stat --format "%a" "${check.path}" 2>/dev/null`, 5000);
          result.fixed = verify.trim() === check.expectedMode;
        }
      } catch (err) {
        result.error = String(err);
      }

      results.push(result);
    }

    return results;
  }

  // ── UC-C18: SMART Disk Health ─────────────────────────────────────────────

  /**
   * Read SMART disk health using smartctl (if available) or diskutil as fallback.
   */
  async getSmartDiskHealth(device?: string): Promise<SmartDiskHealth[]> {
    const results: SmartDiskHealth[] = [];

    // Detect devices if not specified
    let devices: string[] = [];
    if (device) {
      devices = [device];
    } else {
      try {
        if (getPlatform() === "macos") {
          const diskOut = await run("diskutil list | grep '/dev/disk' | awk '{print $1}'", 8000);
          devices = diskOut.split("\n").filter((d) => /^\/dev\/disk\d+$/.test(d.trim())).map((d) => d.trim());
        } else {
          const lsblkOut = await run("lsblk -d -o NAME -n 2>/dev/null | head -10", 5000);
          devices = lsblkOut.split("\n").filter(Boolean).map((d) => `/dev/${d.trim()}`);
        }
      } catch { /* ignore */ }
    }

    for (const dev of devices.slice(0, 5)) {
      const health: SmartDiskHealth = {
        device: dev,
        available: false,
        attributes: [],
      };

      try {
        // Try smartctl first
        const smartOut = await run(`smartctl -A -H "${dev}" 2>/dev/null`, 15000);
        if (smartOut && !smartOut.includes("Command not found") && !smartOut.includes("not found")) {
          health.available = true;
          health.healthy = /PASSED|OK/i.test(smartOut);
          health.overallStatus = health.healthy ? "PASSED" : "FAILED";

          // Parse attributes
          for (const line of smartOut.split("\n")) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 10 && /^\d+$/.test(parts[0]!)) {
              const id = parseInt(parts[0]!, 10);
              const name = parts[1] ?? "";
              const value = parseInt(parts[3] ?? "0", 10);
              const worst = parseInt(parts[4] ?? "0", 10);
              const threshold = parseInt(parts[5] ?? "0", 10);
              const failed = parts[8] === "FAILING_NOW" || parts[8] === "In_the_past";

              health.attributes.push({ id, name, value, worst, threshold, failed });

              if (id === 5) health.reallocatedSectors = parseInt(parts[9] ?? "0", 10);
              if (id === 197) health.pendingSectors = parseInt(parts[9] ?? "0", 10);
              if (id === 198) health.uncorrectableErrors = parseInt(parts[9] ?? "0", 10);
              if (id === 194) health.temperature = value;
              if (id === 9) health.powerOnHours = parseInt(parts[9] ?? "0", 10);
            }
          }
        } else {
          // Fallback: diskutil info
          if (getPlatform() === "macos") {
            const diskutilOut = await run(`diskutil info "${dev}" 2>/dev/null`, 10000);
            health.available = diskutilOut.length > 0;
            health.overallStatus = /error|failure/i.test(diskutilOut) ? "WARNING" : "OK";
            health.healthy = health.overallStatus === "OK";
          }
        }
      } catch (err) {
        health.error = String(err);
      }

      results.push(health);
    }

    return results;
  }

  // ── UC-C19: Regression Detection ─────────────────────────────────────────

  /**
   * Capture current system state (OS version, installed tools, key files)
   * and compare against a stored baseline to detect regressions.
   */
  async runRegressionCheck(
    checkName: string,
    baselineDir?: string,
  ): Promise<RegressionCheckResult> {
    const stateDir = baselineDir ?? join(homedir(), ".omnistate", "baselines");
    const baselineFile = join(stateDir, `${checkName}.json`);

    const osVersion = await run("sw_vers -productVersion 2>/dev/null || lsb_release -r -s 2>/dev/null || uname -r", 5000);

    // Collect current state
    const current: Record<string, unknown> = {
      osVersion: osVersion.trim(),
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      freeMemMb: Math.round(freemem() / 1024 / 1024),
      totalMemMb: Math.round(totalmem() / 1024 / 1024),
      cpuCount: cpus().length,
    };

    // Collect tool versions
    for (const tool of ["git", "node", "npm", "docker", "python3"]) {
      try {
        const ver = await run(`${tool} --version 2>/dev/null | head -1`, 5000);
        current[`tool:${tool}`] = ver.trim() || "not found";
      } catch {
        current[`tool:${tool}`] = "not found";
      }
    }

    const result: RegressionCheckResult = {
      checkName,
      osVersion: osVersion.trim(),
      current,
      regressions: [],
      passed: true,
    };

    // Load baseline if exists
    if (existsSync(baselineFile)) {
      try {
        const baseline = JSON.parse(readFileSync(baselineFile, "utf-8")) as Record<string, unknown>;
        result.baseline = baseline;

        for (const [key, baseVal] of Object.entries(baseline)) {
          if (key === "timestamp") continue;
          const currVal = current[key];
          if (currVal === undefined) {
            result.regressions.push({
              key,
              baselineValue: baseVal,
              currentValue: undefined,
              severity: "warning",
              description: `Key "${key}" missing from current state`,
            });
          } else if (String(currVal) !== String(baseVal)) {
            const severity =
              key === "osVersion" || key.startsWith("tool:")
                ? "info"
                : key === "nodeVersion"
                ? "warning"
                : "info";
            result.regressions.push({
              key,
              baselineValue: baseVal,
              currentValue: currVal,
              severity,
              description: `"${key}" changed from "${baseVal}" to "${currVal}"`,
            });
          }
        }

        result.passed = !result.regressions.some((r) => r.severity === "critical");
      } catch { /* corrupted baseline — will overwrite */ }
    }

    // Save current as new baseline
    try {
      if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
      writeFileSync(baselineFile, JSON.stringify(current, null, 2), "utf-8");
    } catch { /* ignore write errors */ }

    return result;
  }

  // ── UC-C20: Port Exhaustion ───────────────────────────────────────────────

  /**
   * Analyse network connection counts to detect port exhaustion risk.
   * Reports TIME_WAIT, CLOSE_WAIT, ESTABLISHED counts and top consumers.
   */
  async checkPortExhaustion(): Promise<PortExhaustionResult> {
    const result: PortExhaustionResult = {
      totalConnections: 0,
      establishedCount: 0,
      timeWaitCount: 0,
      closeWaitCount: 0,
      listenCount: 0,
      exhaustionRisk: "low",
      topConsumers: [],
    };

    try {
      // Connection state counts
      const netstatCmd =
        getPlatform() === "macos"
          ? "netstat -an -p tcp 2>/dev/null"
          : "netstat -an --tcp 2>/dev/null || ss -tan 2>/dev/null";
      const netstatOut = await run(netstatCmd, 15000);

      for (const line of netstatOut.split("\n").filter(Boolean)) {
        if (/ESTABLISHED/i.test(line)) result.establishedCount += 1;
        if (/TIME.?WAIT/i.test(line)) result.timeWaitCount += 1;
        if (/CLOSE.?WAIT/i.test(line)) result.closeWaitCount += 1;
        if (/LISTEN/i.test(line)) result.listenCount += 1;
      }
      result.totalConnections =
        result.establishedCount + result.timeWaitCount + result.closeWaitCount + result.listenCount;

      // Top consumers via lsof
      const lsofOut = await run("lsof -i -n -P 2>/dev/null | awk '{print $1, $2}' | sort | uniq -c | sort -rn | head -20", 15000);
      const consumerMap = new Map<string, PortConsumer>();

      for (const line of lsofOut.split("\n").filter(Boolean)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 3) continue;
        const count = parseInt(parts[0]!, 10);
        const proc = parts[1]!;
        const pid = parseInt(parts[2]!, 10);
        if (!isNaN(count) && !isNaN(pid) && proc !== "COMMAND") {
          const key = `${pid}`;
          const existing = consumerMap.get(key) ?? { process: proc, pid, connectionCount: 0, timeWaitCount: 0 };
          existing.connectionCount += count;
          consumerMap.set(key, existing);
        }
      }

      result.topConsumers = Array.from(consumerMap.values())
        .sort((a, b) => b.connectionCount - a.connectionCount)
        .slice(0, 10);

      // Risk assessment
      if (result.totalConnections > 10000 || result.timeWaitCount > 5000) {
        result.exhaustionRisk = "critical";
        result.recommendation = "Port exhaustion imminent — reduce TIME_WAIT with kernel tuning (net.inet.tcp.msl).";
      } else if (result.totalConnections > 5000 || result.timeWaitCount > 2000) {
        result.exhaustionRisk = "high";
        result.recommendation = "High connection count — monitor closely and consider connection pooling.";
      } else if (result.totalConnections > 1000 || result.timeWaitCount > 500) {
        result.exhaustionRisk = "medium";
        result.recommendation = "Moderate connection count — enable TCP keep-alive and connection reuse.";
      }
    } catch { /* ignore */ }

    return result;
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const advancedHealthMonitor = new AdvancedHealthMonitor();
