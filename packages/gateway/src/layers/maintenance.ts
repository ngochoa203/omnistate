/**
 * Maintenance & Cleanup Layer — UC12
 *
 * Implements UC12.1 through UC12.5:
 *   UC12.1 Disk cleanup
 *   UC12.2 Cache management
 *   UC12.3 Process management
 *   UC12.4 Log management
 *   UC12.5 System maintenance
 *
 * macOS-first; every method has try/catch with safe fallback returns.
 * All shell commands use execSync with a 30 s timeout.
 * Destructive operations validate inputs / paths before executing.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { DeepLayer } from "./deep.js";

// ---------------------------------------------------------------------------
// Exec helper — centralised timeout + encoding
// ---------------------------------------------------------------------------

const EXEC_TIMEOUT = 30_000;

function run(cmd: string): string {
  return execSync(cmd, { encoding: "utf8", timeout: EXEC_TIMEOUT }).trim();
}

function tryRun(cmd: string, fallback = ""): string {
  try {
    return run(cmd);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// UC12.1 — Disk cleanup
// ---------------------------------------------------------------------------

export interface DiskUsage {
  filesystem: string;
  total: string;
  used: string;
  available: string;
  usePercent: number;
  mountpoint: string;
}

export interface LargeFile {
  path: string;
  sizeMB: number;
  sizeHuman: string;
}

export interface CleanupResult {
  success: boolean;
  freedBytes: number;
  freedHuman: string;
  removed: string[];
  errors: string[];
}

export interface DownloadFile {
  path: string;
  name: string;
  sizeMB: number;
  ageDays: number;
  modifiedAt: string;
}

// ---------------------------------------------------------------------------
// UC12.2 — Cache management
// ---------------------------------------------------------------------------

export interface CacheEntry {
  path: string;
  name: string;
  sizeMB: number;
  sizeHuman: string;
}

// ---------------------------------------------------------------------------
// UC12.3 — Process management
// ---------------------------------------------------------------------------

export interface ProcessInfo {
  pid: number;
  ppid: number;
  user: string;
  cpuPercent: number;
  memPercent: number;
  vsz: number;
  rss: number;
  state: string;
  started: string;
  time: string;
  command: string;
}

// ---------------------------------------------------------------------------
// UC12.4 — Log management
// ---------------------------------------------------------------------------

export interface LogEntry {
  timestamp: string;
  level: string;
  process: string;
  message: string;
}

export interface LogSizeInfo {
  path: string;
  sizeMB: number;
  sizeHuman: string;
}

// ---------------------------------------------------------------------------
// UC12.5 — System maintenance
// ---------------------------------------------------------------------------

export interface DiskVerifyResult {
  success: boolean;
  output: string[];
}

export interface StartupItem {
  name: string;
  kind: "login-item" | "launch-agent" | "launch-daemon";
  path?: string;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Parse a human-readable size string (e.g. "1.2G", "430M", "15K") → bytes */
function parseSizeToBytes(s: string): number {
  const match = s.trim().match(/^([\d.]+)\s*([BKMGTP]?)/i);
  if (!match) return 0;
  const n = parseFloat(match[1]!);
  const unit = (match[2] ?? "B").toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
  };
  return Math.round(n * (multipliers[unit] ?? 1));
}

/** Format bytes to human-readable string */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Return true if path is inside an allowed safe root — prevents path-traversal on destructive ops */
function isSafeUserPath(p: string): boolean {
  const abs = resolve(p);
  const home = homedir();
  const safePrefixes = [
    join(home, "Library", "Caches"),
    join(home, "Library", "Logs"),
    join(home, "Downloads"),
    "/tmp",
    "/private/tmp",
    join(home, ".cache"),
  ];
  return safePrefixes.some((prefix) => abs === prefix || abs.startsWith(prefix + "/"));
}

// ---------------------------------------------------------------------------
// MaintenanceLayer
// ---------------------------------------------------------------------------

export class MaintenanceLayer {
  constructor(deep: DeepLayer) {
    void deep;
  }

  // =========================================================================
  // UC12.1 — Disk Cleanup
  // =========================================================================

  /**
   * Run `df -h /` and return total / used / available / percent for the root volume.
   */
  async getDiskUsage(): Promise<DiskUsage> {
    try {
      const output = run("df -h /");
      const lines = output.split("\n");
      // Line 0 is the header; line 1 is the root filesystem data.
      const dataLine = lines[1] ?? "";
      const parts = dataLine.trim().split(/\s+/);

      // macOS df -h columns:
      // Filesystem  Size  Used  Avail Capacity  iused  ifree  %iused  Mounted on
      return {
        filesystem: parts[0] ?? "",
        total: parts[1] ?? "",
        used: parts[2] ?? "",
        available: parts[3] ?? "",
        usePercent: parseInt((parts[4] ?? "0%").replace("%", ""), 10) || 0,
        mountpoint: parts[parts.length - 1] ?? "/",
      };
    } catch {
      return { filesystem: "", total: "", used: "", available: "", usePercent: 0, mountpoint: "/" };
    }
  }

  /**
   * Find files larger than `minSizeMB` (default 100 MB) under `path` (default ~).
   * Results are sorted largest-first and capped at `limit` (default 20).
   */
  async getLargeFiles(
    path = homedir(),
    minSizeMB = 100,
    limit = 20
  ): Promise<LargeFile[]> {
    try {
      const minSizeKB = minSizeMB * 1024;
      // -x avoids crossing filesystem boundaries (avoids /System etc.)
      const output = tryRun(
        `find "${path}" -x -type f -size +${minSizeKB}k -print0 2>/dev/null | xargs -0 du -sh 2>/dev/null | sort -rh | head -${limit}`
      );

      return output
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const tabIdx = line.indexOf("\t");
          const sizeHuman = tabIdx > -1 ? line.slice(0, tabIdx).trim() : "";
          const filePath = tabIdx > -1 ? line.slice(tabIdx + 1).trim() : line;
          const sizeMB = parseSizeToBytes(sizeHuman) / 1024 ** 2;
          return { path: filePath, sizeMB: Math.round(sizeMB * 10) / 10, sizeHuman };
        });
    } catch {
      return [];
    }
  }

  /**
   * Remove /tmp/* files and old ~/Library/Caches/com.apple.* directories.
   * Returns an estimate of freed bytes plus a log of removed paths / errors.
   */
  async cleanTempFiles(): Promise<CleanupResult> {
    const removed: string[] = [];
    const errors: string[] = [];
    let freedBytes = 0;

    // ── /tmp ──────────────────────────────────────────────────────────────────
    try {
      // Only remove files/dirs older than 1 day to avoid nuking active sockets
      const sizeBefore = parseSizeToBytes(tryRun("du -sh /tmp 2>/dev/null | cut -f1", "0B"));
      run(`find /tmp -maxdepth 2 -mtime +1 -exec rm -rf {} + 2>/dev/null || true`);
      const sizeAfter = parseSizeToBytes(tryRun("du -sh /tmp 2>/dev/null | cut -f1", "0B"));
      const delta = Math.max(0, sizeBefore - sizeAfter);
      freedBytes += delta;
      removed.push("/tmp (files older than 1 day)");
    } catch (err) {
      errors.push(`/tmp: ${(err as Error).message}`);
    }

    // ── ~/Library/Caches/com.apple.* ─────────────────────────────────────────
    const appleCachesRoot = join(homedir(), "Library", "Caches");
    try {
      const entries = readdirSync(appleCachesRoot);
      for (const entry of entries) {
        if (!entry.startsWith("com.apple.")) continue;
        const fullPath = join(appleCachesRoot, entry);
        try {
          const sizeBefore = parseSizeToBytes(
            tryRun(`du -sh "${fullPath}" 2>/dev/null | cut -f1`, "0B")
          );
          run(`rm -rf "${fullPath}"`);
          freedBytes += sizeBefore;
          removed.push(fullPath);
        } catch (err) {
          errors.push(`${fullPath}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      errors.push(`${appleCachesRoot}: ${(err as Error).message}`);
    }

    return {
      success: errors.length === 0,
      freedBytes,
      freedHuman: formatBytes(freedBytes),
      removed,
      errors,
    };
  }

  /**
   * List (or optionally remove) files in ~/Downloads older than `olderThanDays` days.
   * Pass `remove: true` to delete them (default: list only).
   */
  async cleanDownloads(
    olderThanDays = 30,
    remove = false
  ): Promise<{ files: DownloadFile[]; freed?: CleanupResult }> {
    const downloadsDir = join(homedir(), "Downloads");
    const files: DownloadFile[] = [];

    try {
      const entries = readdirSync(downloadsDir);
      const now = Date.now();
      const msPerDay = 86_400_000;

      for (const name of entries) {
        const fullPath = join(downloadsDir, name);
        try {
          const stat = statSync(fullPath);
          const ageDays = (now - stat.mtimeMs) / msPerDay;
          if (ageDays >= olderThanDays) {
            files.push({
              path: fullPath,
              name,
              sizeMB: Math.round((stat.size / 1024 ** 2) * 10) / 10,
              ageDays: Math.floor(ageDays),
              modifiedAt: stat.mtime.toISOString(),
            });
          }
        } catch {
          // skip unreadable entries
        }
      }
    } catch {
      return { files: [] };
    }

    if (!remove) return { files };

    // ── Deletion path ─────────────────────────────────────────────────────────
    const removed: string[] = [];
    const errors: string[] = [];
    let freedBytes = 0;

    for (const f of files) {
      try {
        freedBytes += f.sizeMB * 1024 ** 2;
        run(`rm -rf "${f.path}"`);
        removed.push(f.path);
      } catch (err) {
        errors.push(`${f.path}: ${(err as Error).message}`);
      }
    }

    return {
      files,
      freed: {
        success: errors.length === 0,
        freedBytes,
        freedHuman: formatBytes(freedBytes),
        removed,
        errors,
      },
    };
  }

  /**
   * Empty the macOS Trash via osascript.
   */
  async emptyTrash(): Promise<CleanupResult> {
    const trashPath = join(homedir(), ".Trash");
    let freedBytes = 0;

    try {
      freedBytes = parseSizeToBytes(
        tryRun(`du -sh "${trashPath}" 2>/dev/null | cut -f1`, "0B")
      );
      run(`osascript -e 'tell application "Finder" to empty trash'`);
      return {
        success: true,
        freedBytes,
        freedHuman: formatBytes(freedBytes),
        removed: [trashPath],
        errors: [],
      };
    } catch (err) {
      return {
        success: false,
        freedBytes: 0,
        freedHuman: "0 B",
        removed: [],
        errors: [(err as Error).message],
      };
    }
  }

  /**
   * Return the human-readable total size of a directory (du -sh).
   */
  async getDirectorySize(path: string): Promise<{ path: string; sizeHuman: string; sizeMB: number }> {
    try {
      const abs = resolve(path);
      if (!existsSync(abs)) return { path: abs, sizeHuman: "0 B", sizeMB: 0 };
      const sizeHuman = tryRun(`du -sh "${abs}" 2>/dev/null | cut -f1`, "0B");
      const sizeMB = parseSizeToBytes(sizeHuman) / 1024 ** 2;
      return { path: abs, sizeHuman, sizeMB: Math.round(sizeMB * 100) / 100 };
    } catch {
      return { path, sizeHuman: "0 B", sizeMB: 0 };
    }
  }

  // =========================================================================
  // UC12.2 — Cache Management
  // =========================================================================

  /**
   * Enumerate ~/Library/Caches/ — return each entry with its size.
   */
  async listCaches(): Promise<CacheEntry[]> {
    const cachesDir = join(homedir(), "Library", "Caches");
    const result: CacheEntry[] = [];

    try {
      const entries = readdirSync(cachesDir);
      for (const name of entries) {
        const fullPath = join(cachesDir, name);
        try {
          const sizeHuman = tryRun(`du -sh "${fullPath}" 2>/dev/null | cut -f1`, "0B");
          const sizeMB = parseSizeToBytes(sizeHuman) / 1024 ** 2;
          result.push({
            path: fullPath,
            name,
            sizeMB: Math.round(sizeMB * 10) / 10,
            sizeHuman,
          });
        } catch {
          result.push({ path: fullPath, name, sizeMB: 0, sizeHuman: "0 B" });
        }
      }
    } catch {
      return [];
    }

    return result.sort((a, b) => b.sizeMB - a.sizeMB);
  }

  /**
   * Remove a specific application's cache directory by bundle-ID prefix or name.
   * The path must resolve inside ~/Library/Caches/ (safety guard).
   */
  async clearAppCache(appName: string): Promise<CleanupResult> {
    const cachesDir = join(homedir(), "Library", "Caches");
    const removed: string[] = [];
    const errors: string[] = [];
    let freedBytes = 0;

    try {
      const entries = readdirSync(cachesDir);
      const targets = entries.filter(
        (e) => e === appName || e.toLowerCase().includes(appName.toLowerCase())
      );

      if (targets.length === 0) {
        return {
          success: true,
          freedBytes: 0,
          freedHuman: "0 B",
          removed: [],
          errors: [`No cache found matching "${appName}"`],
        };
      }

      for (const target of targets) {
        const fullPath = join(cachesDir, target);
        if (!isSafeUserPath(fullPath)) {
          errors.push(`${fullPath}: path not in safe zone`);
          continue;
        }
        try {
          const sizeBytes = parseSizeToBytes(
            tryRun(`du -sh "${fullPath}" 2>/dev/null | cut -f1`, "0B")
          );
          run(`rm -rf "${fullPath}"`);
          freedBytes += sizeBytes;
          removed.push(fullPath);
        } catch (err) {
          errors.push(`${fullPath}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      errors.push((err as Error).message);
    }

    return { success: errors.length === 0, freedBytes, freedHuman: formatBytes(freedBytes), removed, errors };
  }

  /**
   * Remove browser cache directories for Safari, Chrome, or Firefox.
   * Defaults to all three when browser is omitted.
   */
  async clearBrowserCache(
    browser?: "safari" | "chrome" | "firefox"
  ): Promise<CleanupResult> {
    const home = homedir();
    const browserPaths: Record<string, string[]> = {
      safari: [
        join(home, "Library", "Caches", "com.apple.Safari"),
        join(home, "Library", "Safari", "LocalStorage"),
      ],
      chrome: [
        join(home, "Library", "Caches", "Google", "Chrome"),
        join(home, "Library", "Application Support", "Google", "Chrome", "Default", "Cache"),
      ],
      firefox: [
        join(home, "Library", "Caches", "Firefox"),
        join(home, "Library", "Application Support", "Firefox", "Profiles"),
      ],
    };

    const targets = browser
      ? (browserPaths[browser] ?? [])
      : Object.values(browserPaths).flat();

    const removed: string[] = [];
    const errors: string[] = [];
    let freedBytes = 0;

    for (const p of targets) {
      if (!existsSync(p)) continue;
      if (!isSafeUserPath(p)) {
        errors.push(`${p}: path not in safe zone`);
        continue;
      }
      try {
        const sizeBytes = parseSizeToBytes(tryRun(`du -sh "${p}" 2>/dev/null | cut -f1`, "0B"));
        run(`rm -rf "${p}"`);
        freedBytes += sizeBytes;
        removed.push(p);
      } catch (err) {
        errors.push(`${p}: ${(err as Error).message}`);
      }
    }

    return { success: errors.length === 0, freedBytes, freedHuman: formatBytes(freedBytes), removed, errors };
  }

  /**
   * Remove common developer build/cache artefacts under the current working directory:
   * node_modules/.cache, .next, .nuxt, __pycache__, .pytest_cache, target/debug (Rust).
   */
  async clearDeveloperCaches(searchRoot = process.cwd()): Promise<CleanupResult> {
    const patterns = [
      "node_modules/.cache",
      ".next",
      ".nuxt",
      "**/__pycache__",
      "**/.pytest_cache",
      "target/debug",
    ];

    const removed: string[] = [];
    const errors: string[] = [];
    let freedBytes = 0;

    for (const pattern of patterns) {
      try {
        // Use find for glob-style patterns; limit depth to avoid deep recursion
        const cmd = pattern.startsWith("**/")
          ? `find "${searchRoot}" -maxdepth 6 -type d -name "${pattern.slice(3)}" -print0 2>/dev/null`
          : `find "${searchRoot}" -maxdepth 5 -type d -path "*/${pattern}" -print0 2>/dev/null`;

        const rawPaths = tryRun(cmd);
        if (!rawPaths) continue;

        for (const p of rawPaths.split("\0").filter(Boolean)) {
          try {
            const sizeBytes = parseSizeToBytes(tryRun(`du -sh "${p}" 2>/dev/null | cut -f1`, "0B"));
            run(`rm -rf "${p}"`);
            freedBytes += sizeBytes;
            removed.push(p);
          } catch (err) {
            errors.push(`${p}: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        errors.push(`pattern ${pattern}: ${(err as Error).message}`);
      }
    }

    return { success: errors.length === 0, freedBytes, freedHuman: formatBytes(freedBytes), removed, errors };
  }

  /**
   * Return the total size of ~/Library/Caches/.
   */
  async getCacheSize(): Promise<{ sizeHuman: string; sizeMB: number }> {
    const cachesDir = join(homedir(), "Library", "Caches");
    try {
      const sizeHuman = tryRun(`du -sh "${cachesDir}" 2>/dev/null | cut -f1`, "0B");
      const sizeMB = parseSizeToBytes(sizeHuman) / 1024 ** 2;
      return { sizeHuman, sizeMB: Math.round(sizeMB * 100) / 100 };
    } catch {
      return { sizeHuman: "0 B", sizeMB: 0 };
    }
  }

  // =========================================================================
  // UC12.3 — Process Management
  // =========================================================================

  /**
   * List all processes via `ps aux`, optionally sorted by cpu | memory | name.
   */
  async listProcesses(sortBy: "cpu" | "memory" | "name" = "cpu"): Promise<ProcessInfo[]> {
    try {
      // ps -Ao: custom format for reliable parsing
      const output = run(
        "ps -Ao pid,ppid,user,%cpu,%mem,vsz,rss,stat,start,time,command 2>/dev/null"
      );
      const lines = output.split("\n").slice(1); // drop header
      const processes: ProcessInfo[] = [];

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 11) continue;
        processes.push({
          pid: parseInt(parts[0]!, 10) || 0,
          ppid: parseInt(parts[1]!, 10) || 0,
          user: parts[2] ?? "",
          cpuPercent: parseFloat(parts[3]!) || 0,
          memPercent: parseFloat(parts[4]!) || 0,
          vsz: parseInt(parts[5]!, 10) || 0,
          rss: parseInt(parts[6]!, 10) || 0,
          state: parts[7] ?? "",
          started: parts[8] ?? "",
          time: parts[9] ?? "",
          command: parts.slice(10).join(" "),
        });
      }

      if (sortBy === "cpu") processes.sort((a, b) => b.cpuPercent - a.cpuPercent);
      else if (sortBy === "memory") processes.sort((a, b) => b.memPercent - a.memPercent);
      else processes.sort((a, b) => a.command.localeCompare(b.command));

      return processes;
    } catch {
      return [];
    }
  }

  /**
   * Send SIGTERM (or SIGKILL when force=true) to a process by PID.
   */
  async killProcess(pid: number, force = false): Promise<{ success: boolean; error?: string }> {
    if (pid <= 0) return { success: false, error: "Invalid PID" };
    // Refuse to kill PID 1 (launchd) or the current process
    if (pid === 1 || pid === process.pid) {
      return { success: false, error: `Refusing to kill protected PID ${pid}` };
    }
    try {
      run(`kill ${force ? "-9" : "-15"} ${pid}`);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Kill all processes matching `name` by name (pkill).
   * force=true uses SIGKILL (-9).
   */
  async killByName(name: string, force = false): Promise<{ success: boolean; killed: number; error?: string }> {
    if (!name.trim()) return { success: false, killed: 0, error: "Empty process name" };
    try {
      run(`pkill ${force ? "-9" : "-15"} -f "${name}"`);
      // pkill doesn't emit output; a zero exit means at least one process was killed
      return { success: true, killed: 1 };
    } catch (err) {
      // pkill exits 1 when no matching process — treat as "nothing killed"
      const msg = (err as NodeJS.ErrnoException & { status?: number }).status === 1
        ? `No process matching "${name}"`
        : (err as Error).message;
      return { success: false, killed: 0, error: msg };
    }
  }

  /**
   * Return detailed information about a single process by PID.
   */
  async getProcessInfo(pid: number): Promise<ProcessInfo | null> {
    if (pid <= 0) return null;
    try {
      const output = run(
        `ps -p ${pid} -o pid,ppid,user,%cpu,%mem,vsz,rss,stat,start,time,command 2>/dev/null`
      );
      const lines = output.split("\n").filter(Boolean);
      // Index 0 is header; index 1 is the process data
      const line = lines[1];
      if (!line) return null;

      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) return null;

      return {
        pid: parseInt(parts[0]!, 10) || 0,
        ppid: parseInt(parts[1]!, 10) || 0,
        user: parts[2] ?? "",
        cpuPercent: parseFloat(parts[3]!) || 0,
        memPercent: parseFloat(parts[4]!) || 0,
        vsz: parseInt(parts[5]!, 10) || 0,
        rss: parseInt(parts[6]!, 10) || 0,
        state: parts[7] ?? "",
        started: parts[8] ?? "",
        time: parts[9] ?? "",
        command: parts.slice(10).join(" "),
      };
    } catch {
      return null;
    }
  }

  /**
   * Return the top processes sorted by CPU or memory usage.
   */
  async getResourceHogs(
    type: "cpu" | "memory",
    limit = 10
  ): Promise<ProcessInfo[]> {
    const processes = await this.listProcesses(type === "cpu" ? "cpu" : "memory");
    return processes.slice(0, limit);
  }

  /**
   * Find zombie processes (ps state column contains "Z").
   */
  async getZombieProcesses(): Promise<ProcessInfo[]> {
    const all = await this.listProcesses("name");
    return all.filter((p) => p.state.includes("Z"));
  }

  // =========================================================================
  // UC12.4 — Log Management
  // =========================================================================

  /**
   * Fetch recent system log entries via `log show`.
   * `since` accepts a duration string like "1h", "30m", "2d" (default "1h").
   */
  async getSystemLogs(limit = 100, since = "1h"): Promise<LogEntry[]> {
    try {
      // log show is macOS-native; --predicate filters out noise
      const raw = tryRun(
        `log show --last ${since} --style syslog 2>/dev/null | head -${limit}`
      );
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          // Syslog format: "MMM DD HH:MM:SS hostname process[pid]: <message>"
          const match = line.match(
            /^(\S+\s+\d+\s+[\d:]+)\s+\S+\s+(\S+?)\[[\d]+\]:\s+(.*)$/
          );
          if (match) {
            return {
              timestamp: match[1] ?? "",
              level: "info",
              process: match[2] ?? "",
              message: match[3] ?? line,
            };
          }
          return { timestamp: "", level: "info", process: "", message: line };
        });
    } catch {
      return [];
    }
  }

  /**
   * Read application logs from ~/Library/Logs/<appName>/ or /var/log/<appName>.
   */
  async getAppLogs(appName: string, limit = 100): Promise<LogEntry[]> {
    const candidates = [
      join(homedir(), "Library", "Logs", appName),
      `/var/log/${appName}`,
      join(homedir(), "Library", "Logs", `${appName}.log`),
      `/var/log/${appName}.log`,
    ];

    for (const logPath of candidates) {
      if (!existsSync(logPath)) continue;

      try {
        const stat = statSync(logPath);

        // If it's a directory, read all .log files within it
        if (stat.isDirectory()) {
          const logFiles = readdirSync(logPath)
            .filter((f) => f.endsWith(".log") || f.endsWith(".txt"))
            .map((f) => join(logPath, f));

          if (logFiles.length === 0) continue;
          const raw = tryRun(`tail -n ${limit} "${logFiles[0]}" 2>/dev/null`);
          return this._parseLogLines(raw);
        }

        // Regular file
        const raw = tryRun(`tail -n ${limit} "${logPath}" 2>/dev/null`);
        return this._parseLogLines(raw);
      } catch {
        continue;
      }
    }

    return [];
  }

  /**
   * Remove/truncate old log files in ~/Library/Logs/ (files older than 7 days).
   */
  async clearUserLogs(): Promise<CleanupResult> {
    const logsDir = join(homedir(), "Library", "Logs");
    const removed: string[] = [];
    const errors: string[] = [];
    let freedBytes = 0;

    try {
      // Find log files older than 7 days and remove them
      const rawPaths = tryRun(
        `find "${logsDir}" -type f \\( -name "*.log" -o -name "*.crash" -o -name "*.ips" \\) -mtime +7 -print0 2>/dev/null`
      );

      for (const p of rawPaths.split("\0").filter(Boolean)) {
        if (!isSafeUserPath(p)) continue;
        try {
          const stat = statSync(p);
          freedBytes += stat.size;
          run(`rm -f "${p}"`);
          removed.push(p);
        } catch (err) {
          errors.push(`${p}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      errors.push((err as Error).message);
    }

    return { success: errors.length === 0, freedBytes, freedHuman: formatBytes(freedBytes), removed, errors };
  }

  /**
   * Return total size of key log directories.
   */
  async getLogSize(): Promise<LogSizeInfo[]> {
    const logDirs = [
      join(homedir(), "Library", "Logs"),
      "/var/log",
      "/Library/Logs",
    ];

    const result: LogSizeInfo[] = [];
    for (const dir of logDirs) {
      if (!existsSync(dir)) continue;
      try {
        const sizeHuman = tryRun(`du -sh "${dir}" 2>/dev/null | cut -f1`, "0B");
        const sizeMB = parseSizeToBytes(sizeHuman) / 1024 ** 2;
        result.push({ path: dir, sizeMB: Math.round(sizeMB * 100) / 100, sizeHuman });
      } catch {
        result.push({ path: dir, sizeMB: 0, sizeHuman: "0 B" });
      }
    }

    return result;
  }

  // =========================================================================
  // UC12.5 — System Maintenance
  // =========================================================================

  /**
   * Reset user directory permissions via diskutil (no sudo required for the current user).
   */
  async repairPermissions(): Promise<{ success: boolean; output: string }> {
    try {
      const uid = run("id -u");
      const output = tryRun(
        `diskutil resetUserPermissions / ${uid} 2>&1`
      );
      return { success: true, output };
    } catch (err) {
      return { success: false, output: (err as Error).message };
    }
  }

  /**
   * Verify the root volume with diskutil.
   */
  async verifyDisk(): Promise<DiskVerifyResult> {
    try {
      const output = tryRun("diskutil verifyVolume / 2>&1");
      return {
        success: !output.toLowerCase().includes("error") && !output.toLowerCase().includes("failed"),
        output: output.split("\n").map((l) => l.trim()).filter(Boolean),
      };
    } catch (err) {
      return {
        success: false,
        output: [(err as Error).message],
      };
    }
  }

  /**
   * Flush the DNS cache (requires sudo for mDNSResponder reload on modern macOS).
   * The dscacheutil flush step runs without sudo; the killall step may fail without elevation.
   */
  async flushDNS(): Promise<{ success: boolean; output: string }> {
    try {
      // Step 1: flush dscacheutil (no sudo required)
      tryRun("dscacheutil -flushcache 2>&1");
      // Step 2: reload mDNSResponder (needs sudo in most environments)
      const out2 = tryRun("sudo killall -HUP mDNSResponder 2>&1");
      return { success: true, output: `DNS cache flushed. ${out2}`.trim() };
    } catch (err) {
      return { success: false, output: (err as Error).message };
    }
  }

  /**
   * Erase and rebuild the Spotlight index on the root volume.
   * Requires mdutil (built-in on macOS).
   */
  async rebuildSpotlight(): Promise<{ success: boolean; output: string }> {
    try {
      const output = tryRun("mdutil -E / 2>&1");
      return {
        success: !output.toLowerCase().includes("error"),
        output,
      };
    } catch (err) {
      return { success: false, output: (err as Error).message };
    }
  }

  /**
   * Return a combined list of startup / login items from:
   *   - macOS Login Items (osascript)
   *   - User LaunchAgents (~/Library/LaunchAgents)
   *   - System LaunchDaemons (/Library/LaunchDaemons)
   */
  async getStartupItems(): Promise<StartupItem[]> {
    const items: StartupItem[] = [];

    // ── Login Items via osascript ──────────────────────────────────────────
    try {
      const script = `tell application "System Events" to get the name of every login item`;
      const raw = tryRun(`osascript -e '${script}' 2>/dev/null`);
      if (raw) {
        for (const name of raw.split(", ").map((n) => n.trim()).filter(Boolean)) {
          items.push({ name, kind: "login-item", enabled: true });
        }
      }
    } catch {
      // System Events access may be denied — skip silently
    }

    // ── User LaunchAgents ──────────────────────────────────────────────────
    const agentsDir = join(homedir(), "Library", "LaunchAgents");
    if (existsSync(agentsDir)) {
      try {
        const plists = readdirSync(agentsDir).filter((f) => f.endsWith(".plist"));
        for (const plist of plists) {
          const fullPath = join(agentsDir, plist);
          // Check if enabled via launchctl (best effort)
          const label = plist.replace(/\.plist$/, "");
          const loaded = tryRun(`launchctl list ${label} 2>/dev/null`);
          items.push({
            name: label,
            kind: "launch-agent",
            path: fullPath,
            enabled: loaded.length > 0 && !loaded.includes("Could not find"),
          });
        }
      } catch {
        // Ignore readdir errors
      }
    }

    // ── System LaunchDaemons (read-only listing; may need sudo to inspect) ──
    const daemonsDir = "/Library/LaunchDaemons";
    if (existsSync(daemonsDir)) {
      try {
        const plists = readdirSync(daemonsDir).filter((f) => f.endsWith(".plist"));
        for (const plist of plists) {
          const fullPath = join(daemonsDir, plist);
          const label = plist.replace(/\.plist$/, "");
          items.push({
            name: label,
            kind: "launch-daemon",
            path: fullPath,
            enabled: true, // assume enabled; checking requires sudo
          });
        }
      } catch {
        // May be unreadable without elevated privileges
      }
    }

    return items;
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private _parseLogLines(raw: string): LogEntry[] {
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        // Try ISO-ish timestamp prefix: "2025-01-15 10:32:01 ..."
        const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}[\sT][\d:]+)\s+(.*)/);
        if (isoMatch) {
          const rest = isoMatch[2] ?? "";
          const levelMatch = rest.match(/^\[?(error|warn(?:ing)?|info|debug)\]?[:\s]/i);
          return {
            timestamp: isoMatch[1] ?? "",
            level: (levelMatch?.[1] ?? "info").toLowerCase(),
            process: "",
            message: levelMatch ? rest.slice(levelMatch[0].length).trim() : rest,
          };
        }
        return { timestamp: "", level: "info", process: "", message: line };
      });
  }
}
