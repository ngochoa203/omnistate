/**
 * Deep System Layer — Display (UC-B25), Printer (UC-B27), Backup (UC-B28), Monitoring.
 *
 * macOS-first; Linux fallbacks where reasonable.
 */

import { platform } from "node:os";

import type { DeepLayer } from "./deep.js";
import type {
  DisplayInfo,
  PrinterInfo,
  PrintJob,
  TimeMachineStatus,
  RsyncOptions,
} from "./deep-system-types.js";
import { execAsync } from "./deep-system-types.js";

abstract class DeepSystemDisplayCore {
  constructor(protected readonly deep: DeepLayer) {}

  protected get os(): "macos" | "windows" | "linux" {
    switch (platform()) {
      case "darwin":
        return "macos";
      case "win32":
        return "windows";
      default:
        return "linux";
    }
  }

  protected async run(cmd: string, timeoutMs = 30_000): Promise<string> {
    try {
      const { stdout } = await execAsync(cmd, {
        timeout: timeoutMs,
        encoding: "utf-8",
      });
      return stdout.trim();
    } catch {
      return "";
    }
  }
}

export class DeepSystemDisplayLayer extends DeepSystemDisplayCore {
  // =========================================================================
  // UC-B25 — Display Management
  // =========================================================================

  /**
   * Get information about connected displays.
   * macOS: `system_profiler SPDisplaysDataType`; Linux: `xrandr`.
   */
  async getDisplays(): Promise<DisplayInfo[]> {
    try {
      if (this.os === "macos") {
        const out = await this.run(
          "system_profiler SPDisplaysDataType 2>/dev/null"
        );
        const displays: DisplayInfo[] = [];
        const sections = out.split("\n\n");
        for (const section of sections) {
          const nameMatch = section.match(/^\s{4}(\S.+):$/m);
          const resMatch = section.match(/Resolution:\s*(.+)/);
          const rateMatch = section.match(/UI Looks like:\s*(.+)/);
          if (nameMatch) {
            displays.push({
              id: String(displays.length),
              name: nameMatch[1].trim(),
              resolution: resMatch?.[1]?.trim(),
              refreshRate: rateMatch?.[1]?.trim(),
              raw: section.substring(0, 200),
            });
          }
        }
        return displays;
      }
      const out = await this.run("xrandr 2>/dev/null | grep ' connected'");
      return out
        .split("\n")
        .filter(Boolean)
        .map((l, i) => {
          const m = l.match(/^(\S+)\s+connected.*?(\d+x\d+)\+/);
          return {
            id: String(i),
            name: m?.[1] ?? `display-${i}`,
            resolution: m?.[2],
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Attempt to set a display resolution (macOS: requires `displayplacer` or `cscreen` CLI).
   */
  async setResolution(displayId: string, w: number, h: number): Promise<boolean> {
    try {
      if (this.os === "macos") {
        // Try displayplacer first
        const dp = await this.run("which displayplacer 2>/dev/null");
        if (dp) {
          await execAsync(
            `displayplacer "id:${displayId} res:${w}x${h}"`,
            { timeout: 10_000 }
          );
          return true;
        }
        // Fall back to cscreen
        const cs = await this.run("which cscreen 2>/dev/null");
        if (cs) {
          await execAsync(`cscreen -w ${w} -h ${h}`, { timeout: 10_000 });
          return true;
        }
      } else {
        await execAsync(`xrandr --output "${displayId}" --mode "${w}x${h}"`, {
          timeout: 10_000,
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get the current display arrangement (macOS: `displayplacer list`).
   */
  async getDisplayArrangement(): Promise<string> {
    try {
      if (this.os !== "macos") return "";
      return await this.run("displayplacer list 2>/dev/null");
    } catch {
      return "";
    }
  }

  /**
   * Enable or disable Night Shift (macOS only).
   * Requires the `nightlight` or `nightshift` CLI, or falls back to AppleScript.
   */
  async setNightShift(enabled: boolean): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      const nl = await this.run("which nightlight 2>/dev/null");
      if (nl) {
        await execAsync(`nightlight ${enabled ? "on" : "off"}`, { timeout: 5_000 });
        return true;
      }
      // AppleScript toggle via System Preferences (macOS 12 and earlier)
      const onOff = enabled ? "true" : "false";
      const script = `
tell application "System Preferences"
  reveal pane id "com.apple.preference.displays"
end tell
tell application "System Events"
  tell process "System Preferences"
    click button "Night Shift…" of tab group 1 of window 1
    set value of checkbox "Turn On Until Tomorrow" of sheet 1 of window 1 to ${onOff}
    click button "Done" of sheet 1 of window 1
  end tell
end tell`;
      await this.deep.runAppleScript(script, 10_000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check whether Night Shift is currently enabled (macOS only).
   */
  async getNightShiftStatus(): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      const nl = await this.run("which nightlight 2>/dev/null");
      if (nl) {
        const out = await this.run("nightlight status 2>/dev/null");
        return out.toLowerCase().includes("on");
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get the refresh rate of a display by ID.
   */
  async getRefreshRate(displayId: string): Promise<string> {
    try {
      if (this.os === "macos") {
        const out = await this.run(
          "system_profiler SPDisplaysDataType 2>/dev/null"
        );
        const match = out.match(/(\d+ Hz)/);
        return match?.[1] ?? "";
      }
      const out = await this.run(
        `xrandr 2>/dev/null | grep -A1 "${displayId}.*connected" | grep -o '[0-9.]\\+\\*'`
      );
      return out.replace("*", "").trim() + (out ? " Hz" : "");
    } catch {
      return "";
    }
  }

  // =========================================================================
  // UC-B27 — Printer / Scanner
  // =========================================================================

  /**
   * List printers available to CUPS (`lpstat -a`).
   */
  async listPrinters(): Promise<PrinterInfo[]> {
    try {
      const [allOut, defaultOut] = await Promise.all([
        this.run("lpstat -a 2>/dev/null"),
        this.run("lpstat -d 2>/dev/null"),
      ]);
      const defaultName = defaultOut.replace("system default destination:", "").trim();
      return allOut
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const name = l.split(/\s+/)[0] ?? l;
          return { name, isDefault: name === defaultName };
        });
    } catch {
      return [];
    }
  }

  /**
   * Get the default CUPS printer name.
   */
  async getDefaultPrinter(): Promise<string> {
    try {
      const out = await this.run("lpstat -d 2>/dev/null");
      return out.replace("system default destination:", "").trim();
    } catch {
      return "";
    }
  }

  /**
   * Set the default CUPS printer (`lpoptions -d`).
   */
  async setDefaultPrinter(name: string): Promise<boolean> {
    try {
      await execAsync(`lpoptions -d "${name}"`, { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Print a file using `lpr`.
   *
   * @param filePath Path to the file to print.
   * @param printer  Printer name (uses default if omitted).
   */
  async printFile(filePath: string, printer?: string): Promise<boolean> {
    try {
      const printerFlag = printer ? `-P "${printer}"` : "";
      await execAsync(`lpr ${printerFlag} "${filePath}"`, { timeout: 15_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the print queue for a printer (`lpq`).
   */
  async getPrintQueue(printer?: string): Promise<PrintJob[]> {
    try {
      const printerFlag = printer ? `-P "${printer}"` : "";
      const out = await this.run(`lpq ${printerFlag} 2>/dev/null`);
      const lines = out.split("\n").filter(Boolean).slice(1); // skip header
      return lines.map((l) => {
        const parts = l.trim().split(/\s+/);
        return {
          jobId: parts[0] ?? "",
          printer: printer ?? "default",
          user: parts[1],
          file: parts.slice(3).join(" "),
          status: parts[2],
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Cancel a print job by job ID (`cancel <jobId>`).
   */
  async cancelPrintJob(jobId: string): Promise<boolean> {
    try {
      await execAsync(`cancel "${jobId}"`, { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  // =========================================================================
  // UC-B28 — Backup / Restore
  // =========================================================================

  /**
   * Get the current Time Machine backup status (`tmutil status`).
   */
  async getTimeMachineStatus(): Promise<TimeMachineStatus> {
    const raw = await this.run("tmutil status 2>/dev/null");
    try {
      const running = raw.includes("Running = 1");
      const phaseMatch = raw.match(/BackupPhase\s*=\s*"?([^";]+)"?/);
      return { running, phase: phaseMatch?.[1]?.trim(), raw };
    } catch {
      return { running: false, raw };
    }
  }

  /**
   * Start a Time Machine backup immediately (`tmutil startbackup`).
   */
  async startTimeMachineBackup(): Promise<boolean> {
    try {
      await execAsync("tmutil startbackup 2>/dev/null", { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List Time Machine backup snapshots (`tmutil listbackups`).
   */
  async listTimeMachineBackups(): Promise<string[]> {
    try {
      const out = await this.run("tmutil listbackups 2>/dev/null");
      return out.split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Run an rsync operation from `source` to `dest`.
   *
   * @param source  Source path.
   * @param dest    Destination path.
   * @param opts    Rsync options.
   */
  async rsync(source: string, dest: string, opts: RsyncOptions = {}): Promise<boolean> {
    try {
      const flags: string[] = [];
      if (opts.archive ?? true) flags.push("-a");
      if (opts.verbose) flags.push("-v");
      if (opts.delete) flags.push("--delete");
      if (opts.dryRun) flags.push("--dry-run");
      if (opts.exclude) {
        for (const ex of opts.exclude) flags.push(`--exclude="${ex}"`);
      }
      await execAsync(
        `rsync ${flags.join(" ")} "${source}" "${dest}"`,
        { timeout: 300_000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the path to the latest Time Machine backup (`tmutil latestbackup`).
   */
  async getLastBackupDate(): Promise<string> {
    try {
      const out = await this.run("tmutil latestbackup 2>/dev/null");
      if (!out) return "";
      // Extract date from backup path, e.g. /Volumes/TM/Backups.backupdb/Mac/2024-01-01-120000
      const m = out.match(/(\d{4}-\d{2}-\d{2}-\d{6})/);
      return m?.[1] ?? out;
    } catch {
      return "";
    }
  }

  // ---------------------------------------------------------------------------
  // Real-time system monitoring
  // ---------------------------------------------------------------------------

  /** Get current CPU usage percentages (user / system / idle / total). */
  async getCpuUsage(): Promise<{
    user: number;
    system: number;
    idle: number;
    total: number;
  }> {
    const out = await this.run("top -l 1 -n 0 | grep 'CPU usage'");
    // Format: "CPU usage: 12.34% user, 5.67% sys, 81.99% idle"
    const match = out.match(
      /(\d+(?:\.\d+)?)%\s+user.*?(\d+(?:\.\d+)?)%\s+sys.*?(\d+(?:\.\d+)?)%\s+idle/i
    );
    if (match) {
      const user = parseFloat(match[1]);
      const system = parseFloat(match[2]);
      const idle = parseFloat(match[3]);
      return { user, system, idle, total: user + system };
    }
    // Fallback: sysctl loadavg
    const loadOut = await this.run("sysctl -n vm.loadavg");
    const parts = loadOut.trim().replace(/[{}]/g, "").trim().split(/\s+/);
    const total = parseFloat(parts[0] ?? "0") * 100;
    return { user: total * 0.7, system: total * 0.3, idle: Math.max(0, 100 - total), total };
  }

  /** Get detailed memory usage in bytes. */
  async getMemoryUsage(): Promise<{
    total: number;
    used: number;
    free: number;
    wired: number;
    compressed: number;
    cached: number;
    percentUsed: number;
  }> {
    const [vmStatOut, pagesizeOut, totalOut] = await Promise.all([
      this.run("vm_stat"),
      this.run("sysctl -n hw.pagesize"),
      this.run("sysctl -n hw.memsize"),
    ]);

    const pageSize = parseInt(pagesizeOut.trim(), 10) || 16384;
    const total = parseInt(totalOut.trim(), 10) || 0;

    const getPages = (key: string): number => {
      const m = vmStatOut.match(new RegExp(`${key}[^:]*:\\s+(\\d+)`));
      return m ? (parseInt(m[1], 10) || 0) * pageSize : 0;
    };

    const free = getPages("Pages free");
    const active = getPages("Pages active");
    const inactive = getPages("Pages inactive");
    const wired = getPages("Pages wired down");
    const compressed = getPages("Pages occupied by compressor");
    const cached = inactive;
    const used = active + wired + compressed;
    const percentUsed = total > 0 ? (used / total) * 100 : 0;

    return { total, used, free, wired, compressed, cached, percentUsed };
  }

  /** Get network I/O statistics per interface (from `netstat -ib`). */
  async getNetworkStats(): Promise<
    {
      interface: string;
      bytesIn: number;
      bytesOut: number;
      packetsIn: number;
      packetsOut: number;
    }[]
  > {
    const out = await this.run("netstat -ib");
    const results: {
      interface: string;
      bytesIn: number;
      bytesOut: number;
      packetsIn: number;
      packetsOut: number;
    }[] = [];
    const seen = new Set<string>();

    for (const line of out.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 11) continue;
      const iface = cols[0];
      if (seen.has(iface) || iface === "Name") continue;
      seen.add(iface);
      // netstat -ib columns: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
      const packetsIn = parseInt(cols[4] ?? "", 10) || 0;
      const bytesIn = parseInt(cols[6] ?? "", 10) || 0;
      const packetsOut = parseInt(cols[7] ?? "", 10) || 0;
      const bytesOut = parseInt(cols[9] ?? "", 10) || 0;
      results.push({ interface: iface, bytesIn, bytesOut, packetsIn, packetsOut });
    }
    return results;
  }

  /** Get thermal state — CPU temperature (°C) and thermal pressure level. */
  async getThermalState(): Promise<{
    cpuTemp?: number;
    thermalPressure: "nominal" | "moderate" | "heavy" | "critical" | "unknown";
  }> {
    const therm = await this.run("pmset -g therm");
    let thermalPressure: "nominal" | "moderate" | "heavy" | "critical" | "unknown" = "unknown";
    const pressureMatch = therm.match(/CPU_Scheduler_Limit\s*=\s*(\d+)/i);
    if (pressureMatch) {
      const limit = parseInt(pressureMatch[1], 10) || 0;
      if (limit >= 90) thermalPressure = "nominal";
      else if (limit >= 70) thermalPressure = "moderate";
      else if (limit >= 50) thermalPressure = "heavy";
      else thermalPressure = "critical";
    } else if (therm.toLowerCase().includes("no thermal")) {
      thermalPressure = "nominal";
    }

    // powermetrics requires sudo — silently skipped when unavailable
    const tempOut = await this.run(
      "sudo powermetrics --samplers smc -n 1 -i 1 2>/dev/null | grep 'CPU die temperature'"
    );
    const tempMatch = tempOut.match(/(\d+(?:\.\d+)?)\s*C/i);
    const cpuTemp = tempMatch ? parseFloat(tempMatch[1]) : undefined;

    return { cpuTemp, thermalPressure };
  }

  /** Get system uptime and load averages. */
  async getSystemUptime(): Promise<{
    uptime: string;
    uptimeSeconds: number;
    loadAverage: { one: number; five: number; fifteen: number };
  }> {
    const out = await this.run("uptime");
    const loadMatch = out.match(/load averages?:\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
    const one = loadMatch ? parseFloat(loadMatch[1]) : 0;
    const five = loadMatch ? parseFloat(loadMatch[2]) : 0;
    const fifteen = loadMatch ? parseFloat(loadMatch[3]) : 0;

    const uptimeMatch = out.match(/up\s+([^,]+(?:,\s*\d+:\d+)?)/i);
    const uptimeStr = uptimeMatch ? uptimeMatch[1].trim() : out.trim();

    let uptimeSeconds = 0;
    const daysMatch = uptimeStr.match(/(\d+)\s+day/i);
    const hhmm = uptimeStr.match(/(\d+):(\d+)/);
    const minsMatch = uptimeStr.match(/(\d+)\s+min/i);
    if (daysMatch) uptimeSeconds += (parseInt(daysMatch[1], 10) || 0) * 86400;
    if (hhmm) uptimeSeconds += (parseInt(hhmm[1], 10) || 0) * 3600 + (parseInt(hhmm[2], 10) || 0) * 60;
    if (minsMatch && !hhmm) uptimeSeconds += (parseInt(minsMatch[1], 10) || 0) * 60;

    return { uptime: uptimeStr, uptimeSeconds, loadAverage: { one, five, fifteen } };
  }

  /** Get disk I/O rates — second sample delta from `iostat -d -c 2`. */
  async getDiskIO(): Promise<{
    readsPerSec: number;
    writesPerSec: number;
    readBytesPerSec: number;
    writeBytesPerSec: number;
  }> {
    const out = await this.run("iostat -d -c 2", 10_000);
    const lines = out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // Skip header lines containing "KB/t" or "disk"; use last remaining line
    const dataLines = lines.filter((l) => !/KB\/t|disk/.test(l));
    const lastLine = dataLines[dataLines.length - 1] ?? "";
    const cols = lastLine.split(/\s+/);

    // macOS iostat -d columns per disk: KB/t  tps  MB/s  (repeated)
    let readsPerSec = 0;
    let readBytesPerSec = 0;
    for (let i = 0; i + 2 < cols.length; i += 3) {
      readsPerSec += parseFloat(cols[i + 1]) || 0;
      readBytesPerSec += (parseFloat(cols[i + 2]) || 0) * 1024 * 1024;
    }

    return { readsPerSec, writesPerSec: 0, readBytesPerSec, writeBytesPerSec: 0 };
  }

  /** Get open file descriptor counts, optionally for a specific PID. */
  async getOpenFiles(pid?: number): Promise<{
    total: number;
    limit: number;
    files?: { fd: number; type: string; name: string }[];
  }> {
    const limitOut = await this.run("ulimit -n");
    const limit = parseInt(limitOut.trim(), 10) || 0;

    if (pid !== undefined) {
      const out = await this.run(`lsof -p ${pid} 2>/dev/null | head -200`);
      const lines = out.split("\n").slice(1).filter(Boolean);
      const files = lines.map((l) => {
        const cols = l.split(/\s+/);
        return { fd: parseInt(cols[3] ?? "", 10) || 0, type: cols[4] ?? "", name: cols[cols.length - 1] ?? "" };
      });
      return { total: files.length, limit, files };
    }

    const out = await this.run("lsof 2>/dev/null | wc -l");
    const total = Math.max(0, (parseInt(out.trim(), 10) || 1) - 1);
    return { total, limit };
  }

  /** Check CPU, memory, and disk usage against thresholds and return alerts. */
  async checkResourceAlerts(thresholds?: {
    cpuPercent?: number;
    memoryPercent?: number;
    diskPercent?: number;
  }): Promise<{
    alerts: Array<{
      type: "cpu" | "memory" | "disk";
      current: number;
      threshold: number;
      message: string;
    }>;
  }> {
    const cpuThreshold = thresholds?.cpuPercent ?? 90;
    const memThreshold = thresholds?.memoryPercent ?? 85;
    const diskThreshold = thresholds?.diskPercent ?? 90;

    const [cpu, mem, diskOut] = await Promise.all([
      this.getCpuUsage(),
      this.getMemoryUsage(),
      this.run("df -k / 2>/dev/null | tail -1"),
    ]);

    const alerts: Array<{
      type: "cpu" | "memory" | "disk";
      current: number;
      threshold: number;
      message: string;
    }> = [];

    if (cpu.total >= cpuThreshold) {
      alerts.push({
        type: "cpu",
        current: cpu.total,
        threshold: cpuThreshold,
        message: `CPU usage is ${cpu.total.toFixed(1)}% (threshold: ${cpuThreshold}%)`,
      });
    }

    if (mem.percentUsed >= memThreshold) {
      alerts.push({
        type: "memory",
        current: mem.percentUsed,
        threshold: memThreshold,
        message: `Memory usage is ${mem.percentUsed.toFixed(1)}% (threshold: ${memThreshold}%)`,
      });
    }

    // df output: Filesystem 512-blocks Used Available Capacity Mounted
    const dfCols = diskOut.trim().split(/\s+/);
    const capacityStr = dfCols.find((c) => c.endsWith("%")) ?? "0%";
    const diskPercent = parseInt(capacityStr, 10) || 0;
    if (diskPercent >= diskThreshold) {
      alerts.push({
        type: "disk",
        current: diskPercent,
        threshold: diskThreshold,
        message: `Disk usage is ${diskPercent}% (threshold: ${diskThreshold}%)`,
      });
    }

    return { alerts };
  }
}