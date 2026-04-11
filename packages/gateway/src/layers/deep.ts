/**
 * Deep Layer — OS-level operations via shell commands and Rust N-API.
 *
 * Fast, programmatic, invisible to the user.
 * Handles: file I/O, process management, shell commands, app launching,
 * system info, network config.
 */

import { exec, execSync, spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  readdirSync,
} from "node:fs";
import { promisify } from "node:util";
import { hostname, platform, arch, cpus, totalmem, freemem } from "node:os";

const execAsync = promisify(exec);

export class DeepLayer {
  private static buildBrowserUrl(target: string): string {
    const trimmed = target.trim();
    if (!trimmed) return "https://www.google.com";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(trimmed)) return `https://${trimmed}`;
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  }

  // ------------------------------------------------------------------
  // Shell execution
  // ------------------------------------------------------------------

  /** Execute a shell command synchronously and return stdout. */
  exec(command: string, timeoutMs: number = 30000): string {
    return execSync(command, {
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  /** Execute a shell command asynchronously. */
  async execAsync(
    command: string,
    timeoutMs: number = 30000
  ): Promise<{ stdout: string; stderr: string }> {
    return execAsync(command, {
      timeout: timeoutMs,
      encoding: "utf-8",
    });
  }

  // ------------------------------------------------------------------
  // File operations
  // ------------------------------------------------------------------

  /** Read a file as UTF-8 text. */
  readFile(path: string): string {
    return readFileSync(path, "utf-8");
  }

  /** Read a file as binary Buffer. */
  readFileBinary(path: string): Buffer {
    return readFileSync(path);
  }

  /** Write text content to a file. */
  writeFile(path: string, content: string): void {
    writeFileSync(path, content);
  }

  /** Check if a file or directory exists. */
  fileExists(path: string): boolean {
    return existsSync(path);
  }

  /** Get file metadata. */
  fileStat(path: string): FileInfo | null {
    if (!existsSync(path)) return null;
    const stat = statSync(path);
    return {
      path,
      size: stat.size,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
      modifiedAt: stat.mtime.toISOString(),
      createdAt: stat.birthtime.toISOString(),
    };
  }

  /** List files in a directory. */
  listDir(path: string): string[] {
    return readdirSync(path);
  }

  // ------------------------------------------------------------------
  // Application management (macOS)
  // ------------------------------------------------------------------

  /**
   * Launch an application by name.
   *
   * On macOS, uses `open -a`. On Linux, searches PATH.
   * Returns true if launch command succeeded.
   */
  async launchApp(name: string): Promise<boolean> {
    try {
      switch (this.platform) {
        case "macos":
          await execAsync(`open -a "${name}"`);
          break;
        case "linux":
          // Try common launch methods
          spawn(name, { detached: true, stdio: "ignore" }).unref();
          break;
        case "windows":
          await execAsync(`start "" "${name}"`);
          break;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Open URL or query in the system default browser. */
  async openDefaultBrowser(target: string): Promise<boolean> {
    try {
      const url = DeepLayer.buildBrowserUrl(target);
      switch (this.platform) {
        case "macos":
          await execAsync(`open ${JSON.stringify(url)}`);
          return true;
        case "linux":
          spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
          return true;
        case "windows":
          await execAsync(`start "" ${JSON.stringify(url)}`);
          return true;
      }
    } catch {
      return false;
    }
  }

  /** Activate (bring to front) an already-running application. */
  async activateApp(name: string): Promise<boolean> {
    try {
      if (this.platform === "macos") {
        await execAsync(
          `osascript -e 'tell application "${name}" to activate'`
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Quit an application gracefully. */
  async quitApp(name: string): Promise<boolean> {
    try {
      if (this.platform === "macos") {
        await execAsync(
          `osascript -e 'tell application "${name}" to quit'`
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Execute an AppleScript and return stdout.
   * Used for app-level automation: controlling tabs, windows, media, etc.
   */
  async runAppleScript(script: string, timeoutMs: number = 5000): Promise<string> {
    try {
      // osascript needs each line as a separate -e flag for multiline scripts
      const lines = script.split("\n").filter(l => l.trim());
      const args = lines.map(l => `-e ${JSON.stringify(l)}`).join(" ");
      const { stdout } = await execAsync(
        `osascript ${args}`,
        { timeout: timeoutMs, encoding: "utf-8" }
      );
      return stdout.trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Detect common macOS permission issues
      if (msg.includes("not allowed") || msg.includes("-1743") || msg.includes("timed out") || msg.includes("ETIMEDOUT")) {
        throw new Error(
          `AppleScript blocked by macOS. Grant permission: System Settings → Privacy & Security → Automation → Terminal → enable the target app.`
        );
      }
      throw new Error(`AppleScript failed: ${msg}`);
    }
  }

  // ------------------------------------------------------------------
  // Process management
  // ------------------------------------------------------------------

  /** Get list of running processes. */
  async getProcessList(): Promise<ProcessInfo[]> {
    try {
      const { stdout } = await execAsync(
        "ps -eo pid,pcpu,pmem,comm --sort=-pcpu 2>/dev/null || ps -eo pid,pcpu,pmem,comm"
      );
      const lines = stdout.trim().split("\n").slice(1); // Skip header
      return lines.slice(0, 50).map((line) => {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[0], 10);
        const cpu = parseFloat(parts[1]);
        const mem = parseFloat(parts[2]);
        const name = parts.slice(3).join(" ");
        return { pid, name, cpu, memory: mem };
      });
    } catch {
      return [];
    }
  }

  /** Check if a process is running by name. */
  isProcessRunning(name: string): boolean {
    try {
      const result = this.exec(`pgrep -x "${name}"`);
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  /** Kill a process by PID (graceful SIGTERM). */
  async killProcess(pid: number, force: boolean = false): Promise<boolean> {
    try {
      const signal = force ? "-9" : "-15";
      await execAsync(`kill ${signal} ${pid}`);
      return true;
    } catch {
      return false;
    }
  }

  /** Kill a process by name. */
  async killProcessByName(
    name: string,
    force: boolean = false
  ): Promise<boolean> {
    try {
      const signal = force ? "-9" : "-15";
      await execAsync(`pkill ${signal} -x "${name}"`);
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------
  // System information
  // ------------------------------------------------------------------

  /** Get comprehensive system information. */
  getSystemInfo(): SystemInfo {
    const cpuInfo = cpus();
    return {
      hostname: hostname(),
      platform: this.platform,
      arch: arch(),
      cpuModel: cpuInfo[0]?.model ?? "unknown",
      cpuCores: cpuInfo.length,
      totalMemoryMB: Math.round(totalmem() / 1024 / 1024),
      freeMemoryMB: Math.round(freemem() / 1024 / 1024),
      nodeVersion: process.version,
      uptime: Math.round(process.uptime()),
    };
  }

  /** Get disk usage information. */
  async getDiskUsage(): Promise<DiskInfo[]> {
    try {
      if (this.platform === "macos" || this.platform === "linux") {
        const { stdout } = await execAsync("df -h / /tmp 2>/dev/null");
        const lines = stdout.trim().split("\n").slice(1);
        return lines.map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            filesystem: parts[0],
            size: parts[1],
            used: parts[2],
            available: parts[3],
            usePercent: parts[4],
            mountPoint: parts[5] ?? parts[parts.length - 1],
          };
        });
      }
      return [];
    } catch {
      return [];
    }
  }

  /** Get current platform. */
  get platform(): "macos" | "windows" | "linux" {
    switch (platform()) {
      case "darwin":
        return "macos";
      case "win32":
        return "windows";
      default:
        return "linux";
    }
  }
}

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface FileInfo {
  path: string;
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  modifiedAt: string;
  createdAt: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
}

export interface SystemInfo {
  hostname: string;
  platform: "macos" | "windows" | "linux";
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryMB: number;
  freeMemoryMB: number;
  nodeVersion: string;
  uptime: number;
}

export interface DiskInfo {
  filesystem: string;
  size: string;
  used: string;
  available: string;
  usePercent: string;
  mountPoint: string;
}
