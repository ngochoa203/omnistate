/**
 * Deep System Layer — Extended OS-level system operations.
 *
 * Implements UC-B16 through UC-B30:
 *   B16 Shell/Terminal Profile   B17 Log Collection & Rotation
 *   B18 Clipboard Management     B19 Font, Locale & Layout
 *   B20 Startup/Boot Flow        B21 Power/Energy
 *   B22 Certificate/Key Mgmt     B23 Advanced Firewall
 *   B24 Container/VM Lifecycle   B25 Display Management
 *   B26 Audio Management         B27 Printer/Scanner
 *   B28 Backup/Restore           B29 OS Update
 *   B30 Swap/Memory Pressure
 *
 * macOS-first; Linux fallbacks where reasonable.
 * Every method has try/catch with safe fallback returns.
 */

import { exec } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { promisify } from "node:util";
import { homedir, platform } from "node:os";
import { join, basename } from "node:path";

import type { DeepLayer } from "./deep.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// UC-B16 — Shell / Terminal Profile
// ---------------------------------------------------------------------------

export interface ShellInfo {
  type: "zsh" | "bash" | "fish" | "unknown";
  path: string;
  rcFile: string;
}

export interface AliasEntry {
  name: string;
  command: string;
}

// ---------------------------------------------------------------------------
// UC-B17 — Log Collection & Rotation
// ---------------------------------------------------------------------------

export interface LogSizeInfo {
  directory: string;
  sizeBytes: number;
  sizeMB: number;
}

// ---------------------------------------------------------------------------
// UC-B18 — Clipboard Management
// ---------------------------------------------------------------------------

export interface ClipboardEntry {
  content: string;
  timestamp: string;
}

export interface ClipboardHistoryEntry {
  text: string;
  timestamp: number;
  type: "text" | "image" | "file" | "rtf";
}

// ---------------------------------------------------------------------------
// UC-B19 — Font, Locale & Layout
// ---------------------------------------------------------------------------

export interface FontInfo {
  name: string;
  path?: string;
  family?: string;
}

export interface KeyboardLayout {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// UC-B20 — Startup / Boot Flow
// ---------------------------------------------------------------------------

export interface StartupItem {
  name: string;
  path?: string;
  enabled?: boolean;
}

export interface StartupItemConfig {
  name: string;
  path: string;
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// UC-B21 — Power / Energy
// ---------------------------------------------------------------------------

export interface BatteryInfo {
  present: boolean;
  percentage: number | null;
  charging: boolean;
  timeRemaining: string | null;
  raw: string;
}

// ---------------------------------------------------------------------------
// UC-B22 — Certificate / Key Management
// ---------------------------------------------------------------------------

export interface CertificateInfo {
  name: string;
  keychain: string;
  raw?: string;
}

export interface SSHKeyInfo {
  file: string;
  type: string;
  comment?: string;
}

export interface GPGKeyInfo {
  keyId: string;
  uid: string;
  expiry?: string;
}

// ---------------------------------------------------------------------------
// UC-B23 — Advanced Firewall
// ---------------------------------------------------------------------------

export interface FirewallRule {
  id: string;
  raw: string;
}

// ---------------------------------------------------------------------------
// UC-B24 — Container / VM Lifecycle
// ---------------------------------------------------------------------------

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
}

export interface ImageInfo {
  repository: string;
  tag: string;
  id: string;
  size: string;
  created: string;
}

export interface VMInfo {
  name: string;
  state: string;
  uuid?: string;
}

// ---------------------------------------------------------------------------
// UC-B25 — Display Management
// ---------------------------------------------------------------------------

export interface DisplayInfo {
  id: string;
  name: string;
  resolution?: string;
  refreshRate?: string;
  raw?: string;
}

// ---------------------------------------------------------------------------
// UC-B26 — Audio Management
// ---------------------------------------------------------------------------

export interface AudioSource {
  name: string;
  type: "input" | "output" | "unknown";
  isDefault?: boolean;
}

// ---------------------------------------------------------------------------
// UC-B27 — Printer / Scanner
// ---------------------------------------------------------------------------

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
  status?: string;
}

export interface PrintJob {
  jobId: string;
  printer: string;
  user?: string;
  file?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// UC-B28 — Backup / Restore
// ---------------------------------------------------------------------------

export interface TimeMachineStatus {
  running: boolean;
  phase?: string;
  lastBackup?: string;
  raw: string;
}

export interface RsyncOptions {
  archive?: boolean;
  verbose?: boolean;
  delete?: boolean;
  exclude?: string[];
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// UC-B29 — OS Update
// ---------------------------------------------------------------------------

export interface OSVersion {
  productName: string;
  productVersion: string;
  buildVersion: string;
}

export interface SoftwareUpdate {
  name: string;
  version?: string;
  size?: string;
  recommended?: boolean;
}

// ---------------------------------------------------------------------------
// UC-B30 — Swap / Memory Pressure
// ---------------------------------------------------------------------------

export interface MemoryPressure {
  level: "normal" | "warning" | "critical" | "unknown";
  raw: string;
}

export interface SwapUsage {
  total: string;
  used: string;
  free: string;
  encrypted?: boolean;
  raw: string;
}

export interface MemoryProcessInfo {
  pid: number;
  name: string;
  memPercent: number;
  memRSS: string;
}

export interface VMStats {
  pagesFree: number | null;
  pagesActive: number | null;
  pagesInactive: number | null;
  pagesWiredDown: number | null;
  pageSize: number | null;
  raw: string;
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class DeepSystemLayer {
  /** In-memory clipboard history for UC-B18. */
  private clipboardHistory: ClipboardEntry[] = [];

  /** Path to persistent clipboard history JSON file. */
  private readonly clipboardHistoryPath = join(
    homedir(),
    ".omnistate",
    "clipboard-history.json"
  );

  /** Max entries kept in persistent clipboard history. */
  private static readonly CLIPBOARD_HISTORY_MAX = 500;

  /** Max bytes stored per clipboard history entry (10 KB). */
  private static readonly CLIPBOARD_ENTRY_MAX_BYTES = 10 * 1024;

  constructor(private readonly deep: DeepLayer) {}

  // ── helpers ─────────────────────────────────────────────────────────────

  private get os(): "macos" | "windows" | "linux" {
    switch (platform()) {
      case "darwin":
        return "macos";
      case "win32":
        return "windows";
      default:
        return "linux";
    }
  }

  /** Run a shell command, returning stdout on success or "" on failure. */
  private async run(cmd: string, timeoutMs = 30_000): Promise<string> {
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

  /** Run a shell command synchronously, returning stdout or "" on failure. */
  private runSync(cmd: string, timeoutMs = 10_000): string {
    try {
      return this.deep.exec(cmd, timeoutMs).trim();
    } catch {
      return "";
    }
  }

  // =========================================================================
  // UC-B16 — Shell / Terminal Profile
  // =========================================================================

  /**
   * Detect the current user's login shell.
   * Checks $SHELL env, falls back to /etc/passwd inspection.
   */
  getShellType(): ShellInfo {
    try {
      const shellPath =
        process.env.SHELL ??
        this.runSync(`getent passwd ${process.env.USER ?? "root"} | cut -d: -f7`) ??
        "/bin/zsh";

      const name = basename(shellPath);
      let type: ShellInfo["type"] = "unknown";
      if (name === "zsh") type = "zsh";
      else if (name === "bash") type = "bash";
      else if (name === "fish") type = "fish";

      const home = homedir();
      const rcMap: Record<string, string> = {
        zsh: join(home, ".zshrc"),
        bash: join(home, ".bashrc"),
        fish: join(home, ".config", "fish", "config.fish"),
      };

      return {
        type,
        path: shellPath,
        rcFile: rcMap[type] ?? join(home, ".profile"),
      };
    } catch {
      return { type: "unknown", path: "/bin/sh", rcFile: join(homedir(), ".profile") };
    }
  }

  /**
   * Read the shell RC file contents.
   * Returns empty string if the file does not exist or is unreadable.
   */
  getShellConfig(): string {
    try {
      const { rcFile } = this.getShellType();
      if (!existsSync(rcFile)) return "";
      return readFileSync(rcFile, "utf-8");
    } catch {
      return "";
    }
  }

  /**
   * Append an alias definition to the shell RC file.
   * Idempotent — if an alias with the same name already exists it is replaced.
   */
  addAlias(name: string, command: string): boolean {
    try {
      const { rcFile } = this.getShellType();
      let content = existsSync(rcFile) ? readFileSync(rcFile, "utf-8") : "";
      // Remove existing definition if present
      const pattern = new RegExp(`^alias\\s+${name}=.*$`, "m");
      content = content.replace(pattern, "").trimEnd();
      content += `\nalias ${name}='${command}'\n`;
      writeFileSync(rcFile, content, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove an alias definition from the shell RC file.
   */
  removeAlias(name: string): boolean {
    try {
      const { rcFile } = this.getShellType();
      if (!existsSync(rcFile)) return false;
      let content = readFileSync(rcFile, "utf-8");
      const pattern = new RegExp(`^alias\\s+${name}=.*\\n?`, "m");
      content = content.replace(pattern, "");
      writeFileSync(rcFile, content, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Parse alias definitions from the shell RC file.
   * Returns an array of `{ name, command }` pairs.
   */
  listAliases(): AliasEntry[] {
    try {
      const config = this.getShellConfig();
      const aliases: AliasEntry[] = [];
      const re = /^alias\s+(\S+?)=['"]?(.+?)['"]?\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(config)) !== null) {
        aliases.push({ name: m[1], command: m[2] });
      }
      return aliases;
    } catch {
      return [];
    }
  }

  /**
   * Append a directory to PATH in the shell RC file.
   */
  addToPath(dir: string): boolean {
    try {
      const { rcFile } = this.getShellType();
      let content = existsSync(rcFile) ? readFileSync(rcFile, "utf-8") : "";
      if (content.includes(dir)) return true; // already present
      content += `\nexport PATH="${dir}:$PATH"\n`;
      writeFileSync(rcFile, content, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read the last `limit` lines from the shell history file.
   */
  async getShellHistory(limit = 50): Promise<string[]> {
    try {
      const { type } = this.getShellType();
      const home = homedir();
      const histMap: Record<string, string> = {
        zsh: process.env.HISTFILE ?? join(home, ".zsh_history"),
        bash: process.env.HISTFILE ?? join(home, ".bash_history"),
        fish: join(home, ".local", "share", "fish", "fish_history"),
      };
      const histFile = histMap[type] ?? join(home, ".bash_history");
      if (!existsSync(histFile)) return [];
      const out = await this.run(`tail -n ${limit} "${histFile}"`);
      return out
        .split("\n")
        .map((l) => l.replace(/^:\s*\d+:\d+;/, "").trim()) // zsh extended history
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  // =========================================================================
  // UC-B17 — Log Collection & Rotation
  // =========================================================================

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
      if (filter) cmd += ` | grep -i "${filter}"`;
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
      let cmd: string;
      if (this.os === "macos") {
        const sinceFlag = since ? `--start "${since}"` : "--last 24h";
        cmd = `log show ${sinceFlag} --style compact 2>/dev/null | grep -i "${query}" | head -200`;
      } else {
        const sinceFlag = since ? `--since "${since}"` : "--since -24h";
        cmd = `journalctl ${sinceFlag} --no-pager 2>/dev/null | grep -i "${query}" | head -200`;
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

  // =========================================================================
  // UC-B18 — Clipboard Management
  // =========================================================================

  /**
   * Get current clipboard text content.
   * macOS: `pbpaste`; Linux: `xclip -o` / `xsel -o`.
   */
  async getClipboard(): Promise<string> {
    try {
      if (this.os === "macos") return await this.run("pbpaste");
      return (
        (await this.run("xclip -selection clipboard -o 2>/dev/null")) ||
        (await this.run("xsel --clipboard --output 2>/dev/null"))
      );
    } catch {
      return "";
    }
  }

  /**
   * Set clipboard text content.
   * macOS: `pbcopy`; Linux: `xclip` / `xsel`.
   * Also appends to in-memory history.
   */
  async setClipboard(content: string): Promise<boolean> {
    try {
      if (this.os === "macos") {
        const { exec: cp } = await import("node:child_process");
        await new Promise<void>((resolve, reject) => {
          const proc = cp("pbcopy", (err) => (err ? reject(err) : resolve()));
          proc.stdin?.end(content);
        });
      } else {
        const { exec: cp } = await import("node:child_process");
        const tool = (await this.run("which xclip 2>/dev/null"))
          ? "xclip -selection clipboard"
          : "xsel --clipboard --input";
        await new Promise<void>((resolve, reject) => {
          const proc = cp(tool, (err) => (err ? reject(err) : resolve()));
          proc.stdin?.end(content);
        });
      }
      this.clipboardHistory.push({
        content,
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return the in-memory clipboard history (most recent last).
   */
  getClipboardHistory(): ClipboardEntry[] {
    return [...this.clipboardHistory];
  }

  /**
   * Clear the system clipboard and in-memory history.
   */
  async clearClipboard(): Promise<boolean> {
    try {
      await this.setClipboard("");
      this.clipboardHistory = [];
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List the data types currently on the macOS pasteboard.
   * Returns an array of UTI strings (e.g. "public.utf8-plain-text").
   */
  async getClipboardFormats(): Promise<string[]> {
    try {
      if (this.os !== "macos") return ["text/plain"];
      const out = await this.run(
        `osascript -e 'clipboard info' 2>/dev/null`
      );
      return out.split(",").map((s) => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Save the current clipboard image to a file (macOS only).
   * Tries `pngpaste` first, then falls back to an inline osascript/Swift snippet.
   * Returns null when the clipboard contains no image data.
   */
  async getClipboardImage(
    outputPath: string
  ): Promise<{ saved: boolean; path: string; format: string; size: number } | null> {
    if (this.os !== "macos") return null;
    try {
      // Check whether clipboard has image data
      const formats = await this.getClipboardFormats();
      const hasImage = formats.some(
        (f) =>
          f.includes("TIFF") ||
          f.includes("PNG") ||
          f.includes("JPEG") ||
          f.includes("GIF") ||
          f.includes("BMP")
      );
      if (!hasImage) return null;

      // Try pngpaste (brew install pngpaste)
      const hasPngpaste = await this.run("which pngpaste 2>/dev/null");
      if (hasPngpaste) {
        const result = await this.run(`pngpaste "${outputPath}" 2>/dev/null`);
        if (existsSync(outputPath)) {
          const { size } = statSync(outputPath);
          return { saved: true, path: outputPath, format: "png", size };
        }
        void result;
      }

      // Fallback: osascript write PNG data
      const script = [
        `set imgData to the clipboard as «class PNGf»`,
        `set f to open for access POSIX file "${outputPath}" with write permission`,
        `write imgData to f`,
        `close access f`,
      ].join("\n");
      await this.run(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
      if (existsSync(outputPath)) {
        const { size } = statSync(outputPath);
        return { saved: true, path: outputPath, format: "png", size };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Copy a file reference to the macOS clipboard (sets it as a file-URL pasteboard item).
   * macOS only — uses `osascript`.
   */
  async copyFileToClipboard(filePath: string): Promise<boolean> {
    if (this.os !== "macos") return false;
    try {
      const escaped = filePath.replace(/"/g, '\\"');
      await this.run(
        `osascript -e 'set the clipboard to POSIX file "${escaped}"'`
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get clipboard content as RTF (macOS only).
   * Returns null when no RTF data is on the pasteboard.
   */
  async getClipboardRTF(): Promise<string | null> {
    if (this.os !== "macos") return null;
    try {
      const out = await this.run(
        `osascript -e 'the clipboard as «class RTF »' 2>/dev/null`
      );
      if (!out) return null;
      // osascript returns hex-encoded data «data RTF …» — decode it
      const hex = out.replace(/^«data RTF\s+/, "").replace(/»$/, "");
      if (hex) {
        return Buffer.from(hex, "hex").toString("utf-8");
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Set clipboard to RTF content (macOS only).
   * Writes RTF to a temp file then loads it via osascript.
   */
  async setClipboardRTF(rtfContent: string): Promise<boolean> {
    if (this.os !== "macos") return false;
    try {
      const { tmpdir } = await import("node:os");
      const tmpFile = join(tmpdir(), `omnistate-rtf-${Date.now()}.rtf`);
      writeFileSync(tmpFile, rtfContent, "utf-8");
      const escaped = tmpFile.replace(/"/g, '\\"');
      const script = [
        `set f to open for access POSIX file "${escaped}"`,
        `set rtfData to read f as «class RTF »`,
        `close access f`,
        `set the clipboard to rtfData`,
      ].join("\n");
      await this.run(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
      try {
        unlinkSync(tmpFile);
      } catch {
        // ignore cleanup error
      }
      return true;
    } catch {
      return false;
    }
  }

  // ── Persistent Clipboard History ─────────────────────────────────────────

  /**
   * Read the persistent clipboard history from disk.
   */
  private readPersistentHistory(): ClipboardHistoryEntry[] {
    try {
      if (!existsSync(this.clipboardHistoryPath)) return [];
      const raw = readFileSync(this.clipboardHistoryPath, "utf-8");
      return JSON.parse(raw) as ClipboardHistoryEntry[];
    } catch {
      return [];
    }
  }

  /**
   * Write the persistent clipboard history to disk (auto-prunes to max 500).
   */
  private writePersistentHistory(entries: ClipboardHistoryEntry[]): void {
    try {
      const dir = join(homedir(), ".omnistate");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const pruned = entries.slice(
        -DeepSystemLayer.CLIPBOARD_HISTORY_MAX
      );
      writeFileSync(this.clipboardHistoryPath, JSON.stringify(pruned, null, 2), "utf-8");
    } catch {
      // ignore write failures
    }
  }

  /**
   * Snapshot the current clipboard and append it to the persistent history.
   * Detects text, RTF, image, and file types automatically.
   */
  async saveClipboardEntry(): Promise<void> {
    try {
      const formats = await this.getClipboardFormats();
      const hasRTF = formats.some((f) => f.includes("RTF"));
      const hasImage = formats.some(
        (f) => f.includes("TIFF") || f.includes("PNG") || f.includes("JPEG") || f.includes("GIF")
      );
      const hasFile = formats.some((f) => f.includes("furl") || f.includes("file"));

      let type: ClipboardHistoryEntry["type"] = "text";
      let text = "";

      if (hasFile) {
        type = "file";
        text = await this.getClipboard();
      } else if (hasImage) {
        type = "image";
        text = "[image]";
      } else if (hasRTF) {
        type = "rtf";
        const rtf = await this.getClipboardRTF();
        text = rtf ?? "";
      } else {
        type = "text";
        text = await this.getClipboard();
      }

      if (!text && type !== "image") return;

      // Truncate to 10 KB
      const truncated = text.slice(0, DeepSystemLayer.CLIPBOARD_ENTRY_MAX_BYTES);

      const existing = this.readPersistentHistory();

      // Avoid duplicate consecutive entries
      const last = existing[existing.length - 1];
      if (last && last.text === truncated && last.type === type) return;

      existing.push({ text: truncated, timestamp: Date.now(), type });
      this.writePersistentHistory(existing);
    } catch {
      // ignore
    }
  }

  /**
   * Return persistent clipboard history entries (most recent last).
   * @param limit Maximum number of entries to return (default: all).
   */
  async getPersistentClipboardHistory(
    limit?: number
  ): Promise<ClipboardHistoryEntry[]> {
    const entries = this.readPersistentHistory();
    if (limit !== undefined && limit > 0) {
      return entries.slice(-limit);
    }
    return entries;
  }

  /**
   * Clear the persistent clipboard history file and in-memory history.
   */
  async clearClipboardHistory(): Promise<void> {
    try {
      this.clipboardHistory = [];
      if (existsSync(this.clipboardHistoryPath)) {
        writeFileSync(this.clipboardHistoryPath, "[]", "utf-8");
      }
    } catch {
      // ignore
    }
  }

  /**
   * Poll the clipboard at `intervalMs` (default 1 s), save a history entry on change.
   * Returns an object with a `stop()` function to cancel the watcher.
   */
  async startClipboardWatch(
    intervalMs = 1000
  ): Promise<{ stop: () => void }> {
    let lastText = await this.getClipboard();
    let active = true;

    const tick = async () => {
      if (!active) return;
      try {
        const current = await this.getClipboard();
        if (current !== lastText) {
          lastText = current;
          await this.saveClipboardEntry();
        }
      } catch {
        // ignore tick errors
      }
      if (active) {
        setTimeout(tick, intervalMs);
      }
    };

    setTimeout(tick, intervalMs);

    return {
      stop: () => {
        active = false;
      },
    };
  }

  // =========================================================================
  // UC-B19 — Font, Locale & Layout
  // =========================================================================

  /**
   * List installed fonts using `system_profiler` (macOS) or `fc-list` (Linux).
   */
  async listFonts(): Promise<FontInfo[]> {
    try {
      if (this.os === "macos") {
        const out = await this.run(
          "system_profiler SPFontsDataType 2>/dev/null | grep 'Full Name:' | head -200"
        );
        return out
          .split("\n")
          .filter(Boolean)
          .map((l) => ({ name: l.replace("Full Name:", "").trim() }));
      }
      const out = await this.run("fc-list : family 2>/dev/null | head -200");
      return out
        .split("\n")
        .filter(Boolean)
        .map((l) => ({ name: l.trim(), family: l.trim() }));
    } catch {
      return [];
    }
  }

  /**
   * Install a font file by copying it to the user Fonts directory.
   */
  installFont(fontPath: string): boolean {
    try {
      const dest =
        this.os === "macos"
          ? join(homedir(), "Library", "Fonts")
          : join(homedir(), ".local", "share", "fonts");
      if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
      copyFileSync(fontPath, join(dest, basename(fontPath)));
      // Refresh font cache on Linux
      if (this.os === "linux") {
        this.run("fc-cache -f 2>/dev/null").catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current locale string (e.g. "en_US").
   */
  async getLocale(): Promise<string> {
    try {
      if (this.os === "macos") {
        return await this.run(
          "defaults read -globalDomain AppleLocale 2>/dev/null"
        );
      }
      return (
        process.env.LANG?.split(".")[0] ??
        (await this.run("locale | grep LANG= | cut -d= -f2"))
      );
    } catch {
      return "";
    }
  }

  /**
   * Set the system locale (macOS only via `defaults write`).
   */
  async setLocale(locale: string): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      await execAsync(
        `defaults write -globalDomain AppleLocale "${locale}"`,
        { timeout: 5_000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current system timezone (e.g. "America/New_York").
   */
  async getTimezone(): Promise<string> {
    try {
      if (this.os === "macos") {
        return await this.run(
          "readlink /etc/localtime | sed 's|/var/db/timezone/zoneinfo/||'"
        );
      }
      return await this.run(
        "timedatectl show --value -p Timezone 2>/dev/null || cat /etc/timezone 2>/dev/null"
      );
    } catch {
      return "";
    }
  }

  /**
   * Set the system timezone.
   * macOS: `systemsetup -settimezone`; Linux: `timedatectl set-timezone`.
   */
  async setTimezone(tz: string): Promise<boolean> {
    try {
      if (this.os === "macos") {
        await execAsync(`sudo systemsetup -settimezone "${tz}"`, { timeout: 10_000 });
      } else {
        await execAsync(`sudo timedatectl set-timezone "${tz}"`, { timeout: 10_000 });
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List installed keyboard layouts / input sources.
   */
  async getKeyboardLayouts(): Promise<KeyboardLayout[]> {
    try {
      if (this.os === "macos") {
        const out = await this.run(
          `defaults read com.apple.HIToolbox AppleEnabledInputSources 2>/dev/null`
        );
        // Parse simple plist output — extract KeyboardLayout Name values
        const re = /KeyboardLayout Name\s*=\s*"?([^";]+)"?/g;
        const layouts: KeyboardLayout[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(out)) !== null) {
          layouts.push({ id: m[1], name: m[1] });
        }
        return layouts;
      }
      const out = await this.run(
        "localectl list-x11-keymap-layouts 2>/dev/null | head -50"
      );
      return out
        .split("\n")
        .filter(Boolean)
        .map((l) => ({ id: l.trim(), name: l.trim() }));
    } catch {
      return [];
    }
  }

  /**
   * Set the keyboard input source by layout name.
   * Uses AppleScript on macOS.
   */
  async setKeyboardLayout(layout: string): Promise<boolean> {
    try {
      if (this.os === "macos") {
        const script = `
tell application "System Events"
  tell process "SystemUIServer"
    tell menu bar item 1 of menu bar 2
      click
      click menu item "${layout}" of menu 1
    end tell
  end tell
end tell`;
        await this.deep.runAppleScript(script);
        return true;
      }
      await execAsync(`setxkbmap "${layout}" 2>/dev/null`, { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  // =========================================================================
  // UC-B20 — Startup / Boot Flow
  // =========================================================================

  /**
   * List login items registered in macOS via `sfltool` or `osascript`.
   */
  async listStartupItems(): Promise<StartupItem[]> {
    try {
      if (this.os === "macos") {
        const out = await this.run(
          `osascript -e 'tell application "System Events" to get the name of every login item' 2>/dev/null`
        );
        return out
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((name) => ({ name }));
      }
      // Linux — systemd user units
      const out = await this.run(
        "systemctl --user list-unit-files --state=enabled 2>/dev/null | awk '{print $1}' | head -50"
      );
      return out
        .split("\n")
        .filter(Boolean)
        .map((name) => ({ name, enabled: true }));
    } catch {
      return [];
    }
  }

  /**
   * Add a startup/login item (macOS).
   */
  async addStartupItem(config: StartupItemConfig): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      await execAsync(
        `osascript -e 'tell application "System Events" to make login item at end with properties {name:"${config.name}", path:"${config.path}", hidden:false}'`,
        { timeout: 10_000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove a startup/login item by name (macOS).
   */
  async removeStartupItem(name: string): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      await execAsync(
        `osascript -e 'tell application "System Events" to delete login item "${name}"'`,
        { timeout: 10_000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List login items via AppleScript (macOS alias of listStartupItems).
   */
  async listLoginItems(): Promise<StartupItem[]> {
    return this.listStartupItems();
  }

  /**
   * Add a login item given an application bundle path (macOS).
   */
  async addLoginItem(appPath: string): Promise<boolean> {
    try {
      const name = basename(appPath).replace(".app", "");
      return this.addStartupItem({ name, path: appPath });
    } catch {
      return false;
    }
  }

  /**
   * Remove a login item by application name (macOS).
   */
  async removeLoginItem(appName: string): Promise<boolean> {
    return this.removeStartupItem(appName);
  }

  // =========================================================================
  // UC-B21 — Power / Energy
  // =========================================================================

  /**
   * Get battery information via `pmset -g batt` (macOS).
   */
  async getBatteryInfo(): Promise<BatteryInfo> {
    const raw = await this.run("pmset -g batt 2>/dev/null");
    try {
      const percentMatch = raw.match(/(\d+)%/);
      const chargingMatch = raw.match(/;?\s*(charging|discharging|AC Power|charged)/i);
      const timeMatch = raw.match(/(\d+:\d+)\s+remaining/);
      return {
        present: raw.includes("%"),
        percentage: percentMatch ? parseInt(percentMatch[1], 10) : null,
        charging:
          !!chargingMatch &&
          /charging|AC Power|charged/i.test(chargingMatch[0]),
        timeRemaining: timeMatch ? timeMatch[1] : null,
        raw,
      };
    } catch {
      return { present: false, percentage: null, charging: false, timeRemaining: null, raw };
    }
  }

  /**
   * Put the system to sleep immediately (macOS: `pmset sleepnow`).
   */
  async sleep(): Promise<boolean> {
    try {
      if (this.os === "macos") await execAsync("pmset sleepnow", { timeout: 5_000 });
      else await execAsync("systemctl suspend", { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Hibernate the system (macOS: pmset hibernatemode 25 + sleepnow).
   */
  async hibernate(): Promise<boolean> {
    try {
      if (this.os === "macos") {
        await execAsync("sudo pmset -a hibernatemode 25 && pmset sleepnow", {
          timeout: 10_000,
        });
      } else {
        await execAsync("systemctl hibernate", { timeout: 5_000 });
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Schedule a system shutdown after `delay` minutes (0 = immediate).
   */
  async shutdown(delay = 0): Promise<boolean> {
    try {
      if (this.os === "macos" || this.os === "linux") {
        const when = delay === 0 ? "now" : `+${delay}`;
        await execAsync(`sudo shutdown -h ${when}`, { timeout: 5_000 });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Schedule a system restart after `delay` minutes (0 = immediate).
   */
  async restart(delay = 0): Promise<boolean> {
    try {
      const when = delay === 0 ? "now" : `+${delay}`;
      await execAsync(`sudo shutdown -r ${when}`, { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Put the system to sleep after `minutes` minutes (macOS only).
   */
  async scheduleSleep(minutes: number): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      await execAsync(`sleep ${minutes * 60} && pmset sleepnow &`, { timeout: 3_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Schedule a wake event at a specific date/time (macOS: `pmset schedule wake`).
   *
   * @param date  Date string accepted by `pmset`, e.g. "04/10/2024 09:00:00".
   */
  async scheduleWake(date: string): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      await execAsync(`sudo pmset schedule wake "${date}"`, { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cancel all scheduled power events (macOS: `pmset schedule cancelall`).
   */
  async cancelScheduledPower(): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      await execAsync("sudo pmset schedule cancelall", { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the pmset power event log for the last `hours` hours (macOS).
   */
  async getPowerLog(hours = 24): Promise<string[]> {
    try {
      if (this.os !== "macos") return [];
      const out = await this.run(
        `pmset -g log 2>/dev/null | grep -v '^$' | tail -200`
      );
      return out.split("\n").filter(Boolean).slice(-hours * 10);
    } catch {
      return [];
    }
  }

  // =========================================================================
  // UC-B22 — Certificate / Key Management
  // =========================================================================

  /**
   * List certificates in a macOS keychain (default: login).
   */
  async listCertificates(keychain = "login"): Promise<CertificateInfo[]> {
    try {
      if (this.os !== "macos") return [];
      const out = await this.run(
        `security find-certificate -a "${keychain}.keychain-db" 2>/dev/null | grep 'labl' | head -100`
      );
      return out
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const name = l.replace(/.*"labl"<blob>="?/, "").replace(/"?\s*$/, "").trim();
          return { name, keychain };
        });
    } catch {
      return [];
    }
  }

  /**
   * Install a certificate as trusted in a macOS keychain.
   */
  async installCertificate(path: string, keychain = "login"): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      await execAsync(
        `sudo security add-trusted-cert -d -r trustRoot -k "/Library/Keychains/${keychain}.keychain-db" "${path}"`,
        { timeout: 15_000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove a certificate by common name from a macOS keychain.
   */
  async removeCertificate(name: string, keychain = "login"): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      await execAsync(
        `security delete-certificate -c "${name}" "${keychain}.keychain-db" 2>/dev/null`,
        { timeout: 5_000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List SSH public key files from `~/.ssh/`.
   */
  listSSHKeys(): SSHKeyInfo[] {
    try {
      const sshDir = join(homedir(), ".ssh");
      if (!existsSync(sshDir)) return [];
      return readdirSync(sshDir)
        .filter((f) => f.endsWith(".pub"))
        .map((f) => {
          const fullPath = join(sshDir, f);
          const content = readFileSync(fullPath, "utf-8").trim();
          const parts = content.split(/\s+/);
          return {
            file: fullPath,
            type: parts[0] ?? "unknown",
            comment: parts[2],
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Generate a new SSH key pair.
   *
   * @param type    Key type: "ed25519" | "rsa" | "ecdsa" (default "ed25519").
   * @param comment Comment embedded in the public key.
   */
  async generateSSHKey(type = "ed25519", comment = ""): Promise<boolean> {
    try {
      const keyPath = join(homedir(), ".ssh", `id_${type}`);
      await execAsync(
        `ssh-keygen -t ${type} -C "${comment}" -f "${keyPath}" -N "" 2>/dev/null`,
        { timeout: 15_000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List GPG public keys (requires `gpg` in PATH).
   */
  async listGPGKeys(): Promise<GPGKeyInfo[]> {
    try {
      const out = await this.run("gpg --list-keys --with-colons 2>/dev/null");
      const keys: GPGKeyInfo[] = [];
      const lines = out.split("\n");
      let current: Partial<GPGKeyInfo> = {};
      for (const line of lines) {
        const parts = line.split(":");
        if (parts[0] === "pub") {
          current = { keyId: parts[4] ?? "", expiry: parts[6] };
        } else if (parts[0] === "uid" && current.keyId) {
          keys.push({
            keyId: current.keyId,
            uid: parts[9] ?? "",
            expiry: current.expiry,
          });
          current = {};
        }
      }
      return keys;
    } catch {
      return [];
    }
  }

  // =========================================================================
  // UC-B23 — Advanced Firewall (macOS pf)
  // =========================================================================

  /**
   * Get the active pf firewall rules (`pfctl -sr`).
   */
  async getFirewallRules(): Promise<FirewallRule[]> {
    try {
      if (this.os !== "macos") return [];
      const out = await this.run("sudo pfctl -sr 2>/dev/null");
      return out
        .split("\n")
        .filter(Boolean)
        .map((raw, i) => ({ id: String(i), raw }));
    } catch {
      return [];
    }
  }

  /**
   * Append a pf rule to `/etc/pf.conf` and reload pf (macOS).
   */
  async addFirewallRule(rule: string): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      const pfConf = "/etc/pf.conf";
      const current = existsSync(pfConf) ? readFileSync(pfConf, "utf-8") : "";
      writeFileSync(pfConf, `${current.trimEnd()}\n${rule}\n`, "utf-8");
      await execAsync("sudo pfctl -f /etc/pf.conf", { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove a pf rule by its index (from `getFirewallRules`) and reload.
   */
  async removeFirewallRule(ruleId: string): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      const pfConf = "/etc/pf.conf";
      if (!existsSync(pfConf)) return false;
      const lines = readFileSync(pfConf, "utf-8").split("\n");
      const idx = parseInt(ruleId, 10);
      if (isNaN(idx) || idx < 0 || idx >= lines.length) return false;
      lines.splice(idx, 1);
      writeFileSync(pfConf, lines.join("\n"), "utf-8");
      await execAsync("sudo pfctl -f /etc/pf.conf", { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Block all traffic from a specific IP address.
   */
  async blockIP(ip: string): Promise<boolean> {
    return this.addFirewallRule(`block drop quick from ${ip} to any`);
  }

  /**
   * Remove the block rule for a specific IP address.
   */
  async unblockIP(ip: string): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      const pfConf = "/etc/pf.conf";
      if (!existsSync(pfConf)) return false;
      let content = readFileSync(pfConf, "utf-8");
      content = content.replace(
        new RegExp(`block drop quick from ${ip.replace(/\./g, "\\.")} to any\\n?`, "g"),
        ""
      );
      writeFileSync(pfConf, content, "utf-8");
      await execAsync("sudo pfctl -f /etc/pf.conf", { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Block a port on a given protocol (tcp | udp).
   */
  async blockPort(port: number, protocol: "tcp" | "udp" = "tcp"): Promise<boolean> {
    return this.addFirewallRule(
      `block drop quick proto ${protocol} from any to any port ${port}`
    );
  }

  /**
   * Allow a port on a given protocol (tcp | udp).
   */
  async allowPort(port: number, protocol: "tcp" | "udp" = "tcp"): Promise<boolean> {
    return this.addFirewallRule(
      `pass in quick proto ${protocol} from any to any port ${port}`
    );
  }

  // =========================================================================
  // UC-B24 — Container / VM Lifecycle
  // =========================================================================

  /**
   * Check whether the Docker daemon is running.
   */
  async isDockerRunning(): Promise<boolean> {
    const out = await this.run("docker info 2>&1 | head -5");
    return out.length > 0 && !out.includes("Cannot connect");
  }

  /**
   * List Docker containers.
   *
   * @param all  When true, include stopped containers (`docker ps -a`).
   */
  async listContainers(all = false): Promise<ContainerInfo[]> {
    try {
      const flag = all ? "-a" : "";
      const out = await this.run(
        `docker ps ${flag} --format "{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}" 2>/dev/null`
      );
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [id, name, image, status, ports] = line.split("\t");
          return { id: id ?? "", name: name ?? "", image: image ?? "", status: status ?? "", ports: ports ?? "" };
        });
    } catch {
      return [];
    }
  }

  /** Start a Docker container by ID or name. */
  async startContainer(id: string): Promise<boolean> {
    try {
      await execAsync(`docker start "${id}"`, { timeout: 30_000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Stop a Docker container by ID or name. */
  async stopContainer(id: string): Promise<boolean> {
    try {
      await execAsync(`docker stop "${id}"`, { timeout: 30_000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Remove a Docker container by ID or name. */
  async removeContainer(id: string): Promise<boolean> {
    try {
      await execAsync(`docker rm "${id}"`, { timeout: 15_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch the tail of container logs.
   *
   * @param id    Container ID or name.
   * @param tail  Number of lines to return.
   */
  async getContainerLogs(id: string, tail = 100): Promise<string[]> {
    try {
      const out = await this.run(`docker logs --tail ${tail} "${id}" 2>&1`);
      return out.split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * List Docker images.
   */
  async listImages(): Promise<ImageInfo[]> {
    try {
      const out = await this.run(
        `docker images --format "{{.Repository}}\\t{{.Tag}}\\t{{.ID}}\\t{{.Size}}\\t{{.CreatedAt}}" 2>/dev/null`
      );
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [repository, tag, id, size, created] = line.split("\t");
          return {
            repository: repository ?? "",
            tag: tag ?? "",
            id: id ?? "",
            size: size ?? "",
            created: created ?? "",
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Pull a Docker image by name (e.g. "nginx:latest").
   */
  async pullImage(name: string): Promise<boolean> {
    try {
      await execAsync(`docker pull "${name}"`, { timeout: 120_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List VirtualBox VMs (falls back to listing UTM VMs on macOS if VBoxManage absent).
   */
  async listVMs(): Promise<VMInfo[]> {
    try {
      const vbox = await this.run(
        `VBoxManage list vms 2>/dev/null`
      );
      if (vbox) {
        const running = await this.run("VBoxManage list runningvms 2>/dev/null");
        return vbox
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const m = l.match(/"(.+)"\s+\{(.+)\}/);
            const name = m?.[1] ?? l;
            const uuid = m?.[2];
            return { name, uuid, state: running.includes(name) ? "running" : "stopped" };
          });
      }
      // UTM fallback (macOS)
      if (this.os === "macos") {
        const utmOut = await this.run(
          `osascript -e 'tell application "UTM" to get name of every virtual machine' 2>/dev/null`
        );
        return utmOut
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((name) => ({ name, state: "unknown" }));
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Start a VirtualBox VM by name.
   */
  async startVM(name: string): Promise<boolean> {
    try {
      await execAsync(`VBoxManage startvm "${name}" --type headless`, {
        timeout: 30_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Power off a VirtualBox VM by name.
   */
  async stopVM(name: string): Promise<boolean> {
    try {
      await execAsync(`VBoxManage controlvm "${name}" poweroff`, {
        timeout: 15_000,
      });
      return true;
    } catch {
      return false;
    }
  }

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
  // UC-B26 — Audio Management
  // =========================================================================

  /**
   * List audio input and output devices.
   * macOS: `system_profiler SPAudioDataType`; Linux: `pactl list`.
   */
  async getAudioSources(): Promise<AudioSource[]> {
    try {
      if (this.os === "macos") {
        const out = await this.run(
          "system_profiler SPAudioDataType 2>/dev/null"
        );
        const sources: AudioSource[] = [];
        const re = /^\s{4,8}(\S[^\n:]+):\s*$/gm;
        let m: RegExpExecArray | null;
        while ((m = re.exec(out)) !== null) {
          const name = m[1].trim();
          if (name && !name.startsWith("Apple") && name.length > 2) {
            sources.push({ name, type: "unknown" });
          }
        }
        return sources;
      }
      const out = await this.run(
        "pactl list short sinks 2>/dev/null; pactl list short sources 2>/dev/null"
      );
      return out
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const parts = l.split("\t");
          return { name: parts[1] ?? l, type: "unknown" as const };
        });
    } catch {
      return [];
    }
  }

  /**
   * Set the default audio output device by name (macOS AppleScript).
   */
  async setDefaultAudioOutput(name: string): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      const script = `
tell application "System Preferences"
  reveal pane id "com.apple.preference.sound"
end tell
tell application "System Events"
  tell process "System Preferences"
    click radio button "Output" of tab group 1 of window 1
    select row 1 of table 1 of scroll area 1 of tab group 1 of window 1 whose value of text field 1 is "${name}"
  end tell
end tell`;
      await this.deep.runAppleScript(script, 10_000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Set the default audio input device by name (macOS AppleScript).
   */
  async setDefaultAudioInput(name: string): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      const script = `
tell application "System Preferences"
  reveal pane id "com.apple.preference.sound"
end tell
tell application "System Events"
  tell process "System Preferences"
    click radio button "Input" of tab group 1 of window 1
    select row 1 of table 1 of scroll area 1 of tab group 1 of window 1 whose value of text field 1 is "${name}"
  end tell
end tell`;
      await this.deep.runAppleScript(script, 10_000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get per-application volume levels (requires `SwitchAudioSource` CLI, if available).
   */
  async getPerAppVolume(): Promise<Record<string, number>> {
    try {
      if (this.os !== "macos") return {};
      const sas = await this.run("which SwitchAudioSource 2>/dev/null");
      if (!sas) return {};
      const out = await this.run("SwitchAudioSource -a 2>/dev/null");
      // SwitchAudioSource lists sources; per-app volume isn't standard — return empty map.
      void out;
      return {};
    } catch {
      return {};
    }
  }

  /**
   * Check whether the system output is currently muted (macOS AppleScript).
   */
  async isMuted(): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      const out = await this.run(
        `osascript -e 'output muted of (get volume settings)'`
      );
      return out.trim() === "true";
    } catch {
      return false;
    }
  }

  /**
   * Toggle the system output mute state (macOS AppleScript).
   */
  async toggleMute(): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      const muted = await this.isMuted();
      await execAsync(
        `osascript -e 'set volume output muted ${muted ? "false" : "true"}'`,
        { timeout: 5_000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current input (microphone) volume level 0-100 (macOS AppleScript).
   */
  async getInputVolume(): Promise<number> {
    try {
      if (this.os !== "macos") return 0;
      const out = await this.run(
        `osascript -e 'input volume of (get volume settings)'`
      );
      return parseInt(out.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Set the input (microphone) volume level 0-100 (macOS AppleScript).
   */
  async setInputVolume(level: number): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      const clamped = Math.max(0, Math.min(100, level));
      await execAsync(
        `osascript -e 'set volume input volume ${clamped}'`,
        { timeout: 5_000 }
      );
      return true;
    } catch {
      return false;
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

  // =========================================================================
  // UC-B29 — OS Update
  // =========================================================================

  /**
   * Check for available software updates (`softwareupdate -l`).
   */
  async checkForUpdates(): Promise<SoftwareUpdate[]> {
    try {
      if (this.os !== "macos") {
        const out = await this.run("apt list --upgradable 2>/dev/null | head -50");
        return out
          .split("\n")
          .filter((l) => l.includes("/"))
          .map((l) => ({ name: l.split("/")[0] ?? l }));
      }
      const out = await this.run("softwareupdate -l 2>/dev/null", 60_000);
      const updates: SoftwareUpdate[] = [];
      const re = /\*\s+Label:\s+(.+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(out)) !== null) {
        updates.push({ name: m[1].trim() });
      }
      return updates;
    } catch {
      return [];
    }
  }

  /**
   * Install a specific software update by name (`softwareupdate -i <name>`).
   */
  async installUpdate(name: string): Promise<boolean> {
    try {
      if (this.os !== "macos") {
        await execAsync(`sudo apt-get install -y "${name}" 2>/dev/null`, {
          timeout: 120_000,
        });
        return true;
      }
      await execAsync(`sudo softwareupdate -i "${name}"`, { timeout: 300_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Install all available software updates (`softwareupdate -ia`).
   */
  async installAllUpdates(): Promise<boolean> {
    try {
      if (this.os !== "macos") {
        await execAsync("sudo apt-get upgrade -y 2>/dev/null", { timeout: 600_000 });
        return true;
      }
      await execAsync("sudo softwareupdate -ia", { timeout: 600_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current OS version using `sw_vers` (macOS) or `/etc/os-release` (Linux).
   */
  async getOSVersion(): Promise<OSVersion> {
    try {
      if (this.os === "macos") {
        const [name, version, build] = await Promise.all([
          this.run("sw_vers -productName"),
          this.run("sw_vers -productVersion"),
          this.run("sw_vers -buildVersion"),
        ]);
        return { productName: name, productVersion: version, buildVersion: build };
      }
      const out = await this.run(
        "cat /etc/os-release 2>/dev/null | grep -E '^(NAME|VERSION|ID)='"
      );
      const get = (key: string) =>
        out.match(new RegExp(`^${key}="?([^"\\n]+)"?`, "m"))?.[1]?.trim() ?? "";
      return {
        productName: get("NAME"),
        productVersion: get("VERSION"),
        buildVersion: get("ID"),
      };
    } catch {
      return { productName: "", productVersion: "", buildVersion: "" };
    }
  }

  /**
   * Get the date of the last macOS software update from the install log.
   */
  async getLastUpdateDate(): Promise<string> {
    try {
      if (this.os === "macos") {
        const out = await this.run(
          `grep -i "software update" /var/log/install.log 2>/dev/null | tail -1`
        );
        return out;
      }
      const out = await this.run(
        `grep -i "upgrade\\|install" /var/log/dpkg.log 2>/dev/null | tail -1`
      );
      return out;
    } catch {
      return "";
    }
  }

  // =========================================================================
  // UC-B30 — Swap / Memory Pressure
  // =========================================================================

  /**
   * Get the current memory pressure level (macOS: `memory_pressure`).
   */
  async getMemoryPressure(): Promise<MemoryPressure> {
    const raw = await this.run("memory_pressure 2>/dev/null");
    try {
      const lower = raw.toLowerCase();
      let level: MemoryPressure["level"] = "unknown";
      if (lower.includes("critical")) level = "critical";
      else if (lower.includes("warn")) level = "warning";
      else if (lower.includes("normal")) level = "normal";
      return { level, raw };
    } catch {
      return { level: "unknown", raw };
    }
  }

  /**
   * Get swap usage via `sysctl vm.swapusage` (macOS) or `/proc/meminfo` (Linux).
   */
  async getSwapUsage(): Promise<SwapUsage> {
    const raw =
      this.os === "macos"
        ? await this.run("sysctl vm.swapusage 2>/dev/null")
        : await this.run("free -h 2>/dev/null | grep -i swap");
    try {
      if (this.os === "macos") {
        const total = raw.match(/total\s*=\s*(\S+)/)?.[1] ?? "0";
        const used = raw.match(/used\s*=\s*(\S+)/)?.[1] ?? "0";
        const free = raw.match(/free\s*=\s*(\S+)/)?.[1] ?? "0";
        const encrypted = raw.includes("encrypted");
        return { total, used, free, encrypted, raw };
      }
      const parts = raw.trim().split(/\s+/);
      return {
        total: parts[1] ?? "0",
        used: parts[2] ?? "0",
        free: parts[3] ?? "0",
        raw,
      };
    } catch {
      return { total: "0", used: "0", free: "0", raw };
    }
  }

  /**
   * Get the top `count` memory-consuming processes.
   */
  async getTopMemoryProcesses(count = 10): Promise<MemoryProcessInfo[]> {
    try {
      const out = await this.run(
        `ps -eo pid,pmem,rss,comm --sort=-pmem 2>/dev/null | head -n ${count + 1}`
      );
      return out
        .split("\n")
        .slice(1)
        .filter(Boolean)
        .slice(0, count)
        .map((l) => {
          const parts = l.trim().split(/\s+/);
          return {
            pid: parseInt(parts[0] ?? "0", 10),
            memPercent: parseFloat(parts[1] ?? "0"),
            memRSS: parts[2] ?? "0",
            name: parts.slice(3).join(" "),
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Purge disk cache and free up inactive memory (macOS: `purge`, requires sudo).
   */
  async purgeMemory(): Promise<boolean> {
    try {
      if (this.os === "macos") {
        await execAsync("sudo purge", { timeout: 30_000 });
        return true;
      }
      await execAsync(
        "sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'",
        { timeout: 10_000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get virtual memory statistics (`vm_stat` on macOS, `/proc/vmstat` on Linux).
   */
  async getVMStats(): Promise<VMStats> {
    const raw =
      this.os === "macos"
        ? await this.run("vm_stat 2>/dev/null")
        : await this.run("vmstat -s 2>/dev/null | head -20");
    try {
      const getNum = (key: string): number | null => {
        const m = raw.match(new RegExp(`${key}[:\\s]+([\\d,]+)`));
        return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
      };
      return {
        pagesFree: getNum("Pages free"),
        pagesActive: getNum("Pages active"),
        pagesInactive: getNum("Pages inactive"),
        pagesWiredDown: getNum("Pages wired down"),
        pageSize: getNum("page size of"),
        raw,
      };
    } catch {
      return {
        pagesFree: null,
        pagesActive: null,
        pagesInactive: null,
        pagesWiredDown: null,
        pageSize: null,
        raw,
      };
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
    const out = await this.run("top -l 1 -n 0 | grep \'CPU usage\'");
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

    const pageSize = parseInt(pagesizeOut.trim()) || 16384;
    const total = parseInt(totalOut.trim()) || 0;

    const getPages = (key: string): number => {
      const m = vmStatOut.match(new RegExp(`${key}[^:]*:\\s+(\\d+)`));
      return m ? parseInt(m[1]) * pageSize : 0;
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
      const packetsIn = parseInt(cols[4]) || 0;
      const bytesIn = parseInt(cols[6]) || 0;
      const packetsOut = parseInt(cols[7]) || 0;
      const bytesOut = parseInt(cols[9]) || 0;
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
      const limit = parseInt(pressureMatch[1]);
      if (limit >= 90) thermalPressure = "nominal";
      else if (limit >= 70) thermalPressure = "moderate";
      else if (limit >= 50) thermalPressure = "heavy";
      else thermalPressure = "critical";
    } else if (therm.toLowerCase().includes("no thermal")) {
      thermalPressure = "nominal";
    }

    // powermetrics requires sudo — silently skipped when unavailable
    const tempOut = await this.run(
      "sudo powermetrics --samplers smc -n 1 -i 1 2>/dev/null | grep \'CPU die temperature\'"
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
    if (daysMatch) uptimeSeconds += parseInt(daysMatch[1]) * 86400;
    if (hhmm) uptimeSeconds += parseInt(hhmm[1]) * 3600 + parseInt(hhmm[2]) * 60;
    if (minsMatch && !hhmm) uptimeSeconds += parseInt(minsMatch[1]) * 60;

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
    const limit = parseInt(limitOut.trim()) || 0;

    if (pid !== undefined) {
      const out = await this.run(`lsof -p ${pid} 2>/dev/null | head -200`);
      const lines = out.split("\n").slice(1).filter(Boolean);
      const files = lines.map((l) => {
        const cols = l.split(/\s+/);
        return { fd: parseInt(cols[3]) || 0, type: cols[4] ?? "", name: cols[cols.length - 1] ?? "" };
      });
      return { total: files.length, limit, files };
    }

    const out = await this.run("lsof 2>/dev/null | wc -l");
    const total = Math.max(0, (parseInt(out.trim()) || 1) - 1);
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
    const diskPercent = parseInt(capacityStr) || 0;
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
