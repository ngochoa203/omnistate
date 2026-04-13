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
  watch,
  promises as fsPromises,
} from "node:fs";
import * as path from "node:path";
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

  // ------------------------------------------------------------------
  // Directory Operations
  // ------------------------------------------------------------------

  /** List directory contents with optional recursion, hidden files, and glob filtering. */
  async listDirectory(
    dirPath: string,
    options?: { recursive?: boolean; includeHidden?: boolean; pattern?: string }
  ): Promise<DirectoryEntry[]> {
    const { recursive = false, includeHidden = false, pattern } = options ?? {};
    const results: DirectoryEntry[] = [];

    const walk = async (currentPath: string): Promise<void> => {
      let entries;
      try {
        entries = await fsPromises.readdir(currentPath, { withFileTypes: true });
      } catch (err) {
        throw new Error(`Failed to read directory "${currentPath}": ${(err as Error).message}`);
      }

      for (const entry of entries) {
        if (!includeHidden && entry.name.startsWith(".")) continue;
        if (pattern) {
          const regex = new RegExp(
            "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
          );
          if (!regex.test(entry.name)) {
            if (!entry.isDirectory()) continue;
          }
        }

        const fullPath = path.join(currentPath, entry.name);
        let size = 0;
        let modifiedAt = "";
        try {
          const st = await fsPromises.stat(fullPath);
          size = st.size;
          modifiedAt = st.mtime.toISOString();
        } catch { /* ignore stat errors */ }

        const type: "file" | "directory" | "symlink" = entry.isSymbolicLink()
          ? "symlink"
          : entry.isDirectory()
          ? "directory"
          : "file";

        if (!pattern || new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$").test(entry.name) || type === "directory") {
          if (!pattern || type !== "directory") {
            results.push({ name: entry.name, path: fullPath, type, size, modifiedAt });
          }
        }

        if (recursive && entry.isDirectory()) {
          await walk(fullPath);
        }
      }
    };

    await walk(dirPath);
    return results;
  }

  // ------------------------------------------------------------------
  // File Search
  // ------------------------------------------------------------------

  /** Search for files by name or content under rootPath. */
  async searchFiles(
    rootPath: string,
    query: string,
    options?: { maxResults?: number; filePattern?: string; contentSearch?: boolean }
  ): Promise<SearchResult[]> {
    const { maxResults = 100, filePattern, contentSearch = false } = options ?? {};
    const results: SearchResult[] = [];

    try {
      if (contentSearch) {
        const patternArg = filePattern ? `--include="${filePattern}"` : "";
        const { stdout } = await execAsync(
          `grep -rn ${patternArg} -- "${query.replace(/"/g, '\\"')}" "${rootPath}" 2>/dev/null | head -${maxResults}`
        );
        for (const line of stdout.split("\n").filter(Boolean)) {
          const match = line.match(/^(.+):(\d+):(.*)$/);
          if (match) {
            results.push({
              path: match[1],
              name: path.basename(match[1]),
              matchLine: match[3],
              matchLineNumber: parseInt(match[2], 10),
            });
          }
        }
      } else {
        const nameArg = filePattern ? `-name "${filePattern}"` : `-name "*${query}*"`;
        const { stdout } = await execAsync(
          `find "${rootPath}" ${nameArg} -type f 2>/dev/null | head -${maxResults}`
        );
        for (const filePath of stdout.split("\n").filter(Boolean)) {
          results.push({ path: filePath, name: path.basename(filePath) });
        }
      }
    } catch (err) {
      throw new Error(`searchFiles failed: ${(err as Error).message}`);
    }

    return results;
  }

  // ------------------------------------------------------------------
  // File Metadata
  // ------------------------------------------------------------------

  /** Get extended file metadata including permissions, owner, and xattrs. */
  async getMetadata(filePath: string): Promise<FileMetadata> {
    try {
      const st = await fsPromises.lstat(filePath);
      const isSymlink = st.isSymbolicLink();
      let symlinkTarget: string | undefined;
      if (isSymlink) {
        symlinkTarget = await fsPromises.readlink(filePath);
      }

      const mode = (st.mode & 0o777).toString(8).padStart(3, "0");

      let owner = "";
      let group = "";
      try {
        const { stdout } = await execAsync(`stat -f "%Su %Sg" "${filePath}" 2>/dev/null || stat -c "%U %G" "${filePath}" 2>/dev/null`);
        [owner, group] = stdout.trim().split(" ");
      } catch { /* ignore */ }

      const extendedAttributes: Record<string, string> = {};
      try {
        const { stdout } = await execAsync(`xattr "${filePath}" 2>/dev/null`);
        const attrNames = stdout.split("\n").filter(Boolean);
        for (const attr of attrNames) {
          try {
            const { stdout: val } = await execAsync(`xattr -p "${attr}" "${filePath}" 2>/dev/null`);
            extendedAttributes[attr] = val.trim();
          } catch { /* ignore */ }
        }
      } catch { /* xattr not available */ }

      return {
        size: st.size,
        created: st.birthtime.toISOString(),
        modified: st.mtime.toISOString(),
        accessed: st.atime.toISOString(),
        permissions: mode,
        owner,
        group,
        isSymlink,
        symlinkTarget,
        extendedAttributes: Object.keys(extendedAttributes).length > 0 ? extendedAttributes : undefined,
      };
    } catch (err) {
      throw new Error(`getMetadata failed for "${filePath}": ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------------
  // File Permissions
  // ------------------------------------------------------------------

  /** Set file permissions using chmod. */
  async setPermissions(filePath: string, mode: string): Promise<void> {
    try {
      await execAsync(`chmod ${mode} "${filePath}"`);
    } catch (err) {
      throw new Error(`setPermissions failed: ${(err as Error).message}`);
    }
  }

  /** Get file permissions and readable/writable/executable flags. */
  async getPermissions(
    filePath: string
  ): Promise<{ mode: string; owner: string; group: string; readable: boolean; writable: boolean; executable: boolean }> {
    try {
      const st = await fsPromises.stat(filePath);
      const mode = (st.mode & 0o777).toString(8).padStart(3, "0");
      let owner = "";
      let group = "";
      try {
        const { stdout } = await execAsync(`stat -f "%Su %Sg" "${filePath}" 2>/dev/null || stat -c "%U %G" "${filePath}" 2>/dev/null`);
        [owner, group] = stdout.trim().split(" ");
      } catch { /* ignore */ }

      let readable = false, writable = false, executable = false;
      try {
        await fsPromises.access(filePath, fsPromises.constants?.R_OK ?? 4);
        readable = true;
      } catch { /* not readable */ }
      try {
        await fsPromises.access(filePath, fsPromises.constants?.W_OK ?? 2);
        writable = true;
      } catch { /* not writable */ }
      try {
        await fsPromises.access(filePath, fsPromises.constants?.X_OK ?? 1);
        executable = true;
      } catch { /* not executable */ }

      return { mode, owner, group, readable, writable, executable };
    } catch (err) {
      throw new Error(`getPermissions failed: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------------
  // Watch Directory
  // ------------------------------------------------------------------

  /** Watch a directory for changes. Returns a stopper function. */
  async watchDirectory(
    dirPath: string,
    callback: (event: WatchEvent) => void
  ): Promise<{ stop: () => void }> {
    const watcher = watch(dirPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const fullPath = path.join(dirPath, filename);
      const type: WatchEvent["type"] =
        eventType === "rename"
          ? existsSync(fullPath)
            ? "create"
            : "delete"
          : "modify";
      callback({ type, path: fullPath, timestamp: new Date() });
    });

    return {
      stop: () => {
        try { watcher.close(); } catch { /* ignore */ }
      },
    };
  }

  // ------------------------------------------------------------------
  // Symlink Operations
  // ------------------------------------------------------------------

  /** Create a symbolic link. */
  async createSymlink(target: string, linkPath: string): Promise<void> {
    try {
      await fsPromises.symlink(target, linkPath);
    } catch (err) {
      throw new Error(`createSymlink failed: ${(err as Error).message}`);
    }
  }

  /** Resolve a symbolic link to its real path. */
  async resolveSymlink(linkPath: string): Promise<string> {
    try {
      return await fsPromises.realpath(linkPath);
    } catch (err) {
      throw new Error(`resolveSymlink failed: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------------
  // Disk Space
  // ------------------------------------------------------------------

  /** Get disk space info for a given path (defaults to /). */
  async getDiskSpace(
    targetPath: string = "/"
  ): Promise<{ total: number; used: number; available: number; percentUsed: number }> {
    try {
      const { stdout } = await execAsync(`df -k "${targetPath}" | tail -1`);
      const parts = stdout.trim().split(/\s+/);
      // df -k columns: Filesystem 1K-blocks Used Available Use% Mounted
      const total = parseInt(parts[1], 10) * 1024;
      const used = parseInt(parts[2], 10) * 1024;
      const available = parseInt(parts[3], 10) * 1024;
      const percentUsed = total > 0 ? Math.round((used / total) * 100) : 0;
      return { total, used, available, percentUsed };
    } catch (err) {
      throw new Error(`getDiskSpace failed: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------------
  // File Comparison
  // ------------------------------------------------------------------

  /** Compare two files using the diff command. */
  async compareFiles(
    pathA: string,
    pathB: string
  ): Promise<{ identical: boolean; diff?: string }> {
    try {
      const { stdout } = await execAsync(`diff "${pathA}" "${pathB}" 2>/dev/null`);
      const identical = stdout.trim() === "";
      return { identical, diff: identical ? undefined : stdout };
    } catch (err: unknown) {
      // diff exits with code 1 when files differ (not an error per se)
      const anyErr = err as { code?: number; stdout?: string };
      if (anyErr.code === 1 && anyErr.stdout !== undefined) {
        return { identical: false, diff: anyErr.stdout };
      }
      throw new Error(`compareFiles failed: ${(err as Error).message}`);
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

export interface DirectoryEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
  modifiedAt: string;
}

export interface SearchResult {
  path: string;
  name: string;
  matchLine?: string;
  matchLineNumber?: number;
}

export interface FileMetadata {
  size: number;
  created: string;
  modified: string;
  accessed: string;
  permissions: string;
  owner: string;
  group: string;
  isSymlink: boolean;
  symlinkTarget?: string;
  extendedAttributes?: Record<string, string>;
}

export interface WatchEvent {
  type: "create" | "modify" | "delete";
  path: string;
  timestamp: Date;
}
