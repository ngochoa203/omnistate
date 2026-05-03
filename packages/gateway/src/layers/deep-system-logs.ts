/**
 * Deep System Layer — Log Collection & Rotation (UC-B17).
 *
 * macOS-first; Linux fallbacks where reasonable.
 */

import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import type { DeepLayer } from "./deep.js";
import type { LogSizeInfo } from "./deep-system-types.js";
import { execAsync } from "./deep-system-types.js";

abstract class DeepSystemLogsCore {
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

export class DeepSystemLogsLayer extends DeepSystemLogsCore {
  /**
   * Collect recent system log entries.
   * macOS: `log show --last 1h --style compact`; Linux: `journalctl -n <lines>`.
   *
   * @param lines  Number of lines / entries to return.
   * @param filter Optional grep filter string.
   */
  async getSystemLogs(lines = 100, filter?: string): Promise<string[]> {
    try {
      let cmd: string;
      if (this.os === "macos") {
        cmd = `log show --last 1h --style compact 2>/dev/null | tail -n ${lines}`;
      } else {
        cmd = `journalctl -n ${lines} --no-pager 2>/dev/null`;
      }
      if (filter) {
        // Sanitize filter: remove shell-special characters to prevent injection
        const safeFilter = filter.replace(/["\\`$!]/g, "");
        cmd += ` | grep -i "${safeFilter}"`;
      }
      const out = await this.run(cmd, 20_000);
      return out.split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Read log lines for a named application.
   * macOS: `~/Library/Logs/<appName>/` or `/var/log/<appName>`;
   * Linux: `/var/log/<appName>`.
   */
  async getAppLogs(appName: string, lines = 100): Promise<string[]> {
    try {
      const candidates =
        this.os === "macos"
          ? [
              join(homedir(), "Library", "Logs", appName),
              join("/Library", "Logs", appName),
              `/var/log/${appName}`,
            ]
          : [`/var/log/${appName}`, `/var/log/${appName}.log`];

      for (const dir of candidates) {
        if (!existsSync(dir)) continue;
        const stat = statSync(dir);
        if (stat.isDirectory()) {
          // Find newest log file in the directory
          const files = readdirSync(dir)
            .map((f) => ({ f, mt: statSync(join(dir, f)).mtimeMs }))
            .sort((a, b) => b.mt - a.mt);
          if (files.length === 0) continue;
          const newest = join(dir, files[0].f);
          const out = await this.run(`tail -n ${lines} "${newest}"`);
          return out.split("\n").filter(Boolean);
        } else {
          const out = await this.run(`tail -n ${lines} "${dir}"`);
          return out.split("\n").filter(Boolean);
        }
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Search log files for a query string since a given timestamp.
   *
   * @param query  Text to search for.
   * @param since  ISO date string (e.g. "2024-01-01") or human duration ("1h", "2d").
   */
  async searchLogs(query: string, since?: string): Promise<string[]> {
    try {
      // Sanitize user-supplied strings to prevent shell injection
      const safeQuery = query.replace(/["\\`$!]/g, "");
      const safeSince = since ? since.replace(/["\\`$!]/g, "") : undefined;

      let cmd: string;
      if (this.os === "macos") {
        const sinceFlag = safeSince ? `--start "${safeSince}"` : "--last 24h";
        cmd = `log show ${sinceFlag} --style compact 2>/dev/null | grep -i "${safeQuery}" | head -200`;
      } else {
        const sinceFlag = safeSince ? `--since "${safeSince}"` : "--since -24h";
        cmd = `journalctl ${sinceFlag} --no-pager 2>/dev/null | grep -i "${safeQuery}" | head -200`;
      }
      const out = await this.run(cmd, 30_000);
      return out.split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Calculate sizes of common log directories.
   */
  async getLogSize(): Promise<LogSizeInfo[]> {
    try {
      const dirs =
        this.os === "macos"
          ? ["/var/log", join(homedir(), "Library", "Logs")]
          : ["/var/log", "/var/lib/journal"];

      const results: LogSizeInfo[] = [];
      for (const dir of dirs) {
        if (!existsSync(dir)) continue;
        const out = await this.run(`du -sb "${dir}" 2>/dev/null`);
        const bytes = parseInt(out.split(/\s+/)[0] ?? "0", 10) || 0;
        results.push({
          directory: dir,
          sizeBytes: bytes,
          sizeMB: Math.round(bytes / 1024 / 1024),
        });
      }
      return results;
    } catch {
      return [];
    }
  }

  /**
   * Remove log files older than `days` days from common log directories.
   * Returns the number of files deleted.
   */
  async cleanOldLogs(days = 30): Promise<number> {
    try {
      const dirs =
        this.os === "macos"
          ? ["/var/log", join(homedir(), "Library", "Logs")]
          : ["/var/log"];

      let removed = 0;
      for (const dir of dirs) {
        if (!existsSync(dir)) continue;
        const out = await this.run(
          `find "${dir}" -type f -name "*.log" -mtime +${days} 2>/dev/null`
        );
        const files = out.split("\n").filter(Boolean);
        for (const f of files) {
          try {
            unlinkSync(f);
            removed++;
          } catch {
            // skip permission-denied files
          }
        }
      }
      return removed;
    } catch {
      return 0;
    }
  }
}