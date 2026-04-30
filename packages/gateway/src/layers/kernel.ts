/**
 * Kernel Layer — Deep macOS kernel-level control.
 *
 * Wraps low-level macOS subsystems:
 *   - sysctl: kernel parameter inspection & tuning
 *   - vm_stat / vm.swapusage: virtual memory statistics
 *   - purge: memory pressure relief
 *   - vmmap: per-process memory map
 *   - kextstat / kextload / kextunload: kernel extension management
 *   - dtruss: syscall tracing
 *   - lsof: open file / file-descriptor inspection
 *   - mdfind / mdutil: Spotlight indexing
 *   - csrutil: SIP status
 *   - nvram: boot arguments
 *   - launchctl: service management
 *
 * macOS-first. Every public method:
 *   1. Checks isMac() and returns a safe default on non-Mac.
 *   2. Wraps its body in try/catch and returns a safe default on error.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";

const execFileAsync = promisify(execFile);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMac(): boolean {
  return platform() === "darwin";
}

/** Run a command and return trimmed stdout, or null on error. */
async function run(
  cmd: string,
  args: string[],
  opts?: { timeout?: number }
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout: opts?.timeout ?? 30_000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface VMStats {
  pageSize: number;
  pagesFree: number;
  pagesActive: number;
  pagesInactive: number;
  pagesWiredDown: number;
  pagesSpeculative: number;
  pageablePages: number;
  pageouts: number;
  pageins: number;
  swapins: number;
  swapouts: number;
  copyOnWriteFaults: number;
  zeroFillPages: number;
  reactivations: number;
  purgeablePages: number;
  purgedPages: number;
  /** Raw key-value pairs not mapped to named fields */
  raw: Record<string, number>;
}

export interface SwapInfo {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  encrypted: boolean;
  raw: string;
}

export interface KextInfo {
  index: number;
  refs: number;
  size: number;
  wiredBytes: number;
  name: string;
  version: string;
  id?: string;
  /** True if the kext is loaded */
  loaded: boolean;
}

export interface FDInfo {
  pid: number;
  command: string;
  fd: string;
  type: string;
  device: string;
  size: number | null;
  node: string;
  name: string;
}

export interface SpotlightResult {
  path: string;
}

export interface LaunchctlJob {
  pid: number | null;
  lastExitStatus: number | null;
  label: string;
}

export interface MemoryRegion {
  address: string;
  size: number;
  permissions: string;
  type: string;
  description: string;
}

// ─── KernelLayer ──────────────────────────────────────────────────────────────

export class KernelLayer {
  // ── sysctl ────────────────────────────────────────────────────────────────

  /**
   * Returns all sysctl key-value pairs via `sysctl -a`.
   */
  async getSysctlAll(): Promise<Record<string, string>> {
    if (!isMac()) return {};
    try {
      const out = await run("sysctl", ["-a"]);
      if (!out) return {};
      return this._parseSysctlOutput(out);
    } catch {
      return {};
    }
  }

  /**
   * Returns a single sysctl value via `sysctl -n <key>`, or null if missing.
   */
  async getSysctl(key: string): Promise<string | null> {
    if (!isMac()) return null;
    try {
      return await run("sysctl", ["-n", key]);
    } catch {
      return null;
    }
  }

  /**
   * Sets a sysctl parameter via `sudo sysctl -w <key>=<value>`.
   * @param persist  Ignored on macOS (persistence requires /etc/sysctl.conf).
   */
  async setSysctl(
    key: string,
    value: string,
    _persist?: boolean
  ): Promise<boolean> {
    if (!isMac()) return false;
    try {
      const out = await run("sudo", ["sysctl", "-w", `${key}=${value}`]);
      return out !== null;
    } catch {
      return false;
    }
  }

  /**
   * Returns all sysctl keys that begin with `prefix` via `sysctl <prefix>`.
   */
  async getSysctlByPrefix(prefix: string): Promise<Record<string, string>> {
    if (!isMac()) return {};
    try {
      const out = await run("sysctl", [prefix]);
      if (!out) return {};
      return this._parseSysctlOutput(out);
    } catch {
      return {};
    }
  }

  /** Parse multi-line `key: value` or `key = value` sysctl output. */
  private _parseSysctlOutput(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      // sysctl -a uses "key: value" on macOS
      const colonIdx = line.indexOf(": ");
      if (colonIdx !== -1) {
        const k = line.slice(0, colonIdx).trim();
        const v = line.slice(colonIdx + 2).trim();
        if (k) result[k] = v;
        continue;
      }
      // "key = value" (some tools)
      const eqIdx = line.indexOf(" = ");
      if (eqIdx !== -1) {
        const k = line.slice(0, eqIdx).trim();
        const v = line.slice(eqIdx + 3).trim();
        if (k) result[k] = v;
      }
    }
    return result;
  }

  // ── Virtual Memory ────────────────────────────────────────────────────────

  /**
   * Returns VM statistics parsed from `vm_stat`.
   */
  async getVMStats(): Promise<VMStats> {
    const empty: VMStats = {
      pageSize: 0,
      pagesFree: 0,
      pagesActive: 0,
      pagesInactive: 0,
      pagesWiredDown: 0,
      pagesSpeculative: 0,
      pageablePages: 0,
      pageouts: 0,
      pageins: 0,
      swapins: 0,
      swapouts: 0,
      copyOnWriteFaults: 0,
      zeroFillPages: 0,
      reactivations: 0,
      purgeablePages: 0,
      purgedPages: 0,
      raw: {},
    };
    if (!isMac()) return empty;
    try {
      const out = await run("vm_stat", []);
      if (!out) return empty;

      const raw: Record<string, number> = {};
      let pageSize = 4096;

      for (const line of out.split("\n")) {
        // "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
        const pageSizeMatch = line.match(/page size of (\d+) bytes/);
        if (pageSizeMatch) {
          pageSize = parseInt(pageSizeMatch[1], 10);
          continue;
        }
        // "Pages free:                               12345."
        const kvMatch = line.match(/^(.+?):\s+([\d]+)\.?\s*$/);
        if (kvMatch) {
          const k = kvMatch[1].trim().toLowerCase().replace(/\s+/g, "_");
          raw[k] = parseInt(kvMatch[2], 10);
        }
      }

      return {
        pageSize,
        pagesFree: raw["pages_free"] ?? 0,
        pagesActive: raw["pages_active"] ?? 0,
        pagesInactive: raw["pages_inactive"] ?? 0,
        pagesWiredDown: raw["pages_wired_down"] ?? 0,
        pagesSpeculative: raw["pages_speculative"] ?? 0,
        pageablePages: raw["pages_purgeable"] ?? 0,
        pageouts: raw["pageouts"] ?? 0,
        pageins: raw["pageins"] ?? 0,
        swapins: raw["swapins"] ?? 0,
        swapouts: raw["swapouts"] ?? 0,
        copyOnWriteFaults: raw["copy-on-write_faults"] ?? 0,
        zeroFillPages: raw["pages_zero_filled"] ?? 0,
        reactivations: raw["pages_reactivated"] ?? 0,
        purgeablePages: raw["pages_purgeable"] ?? 0,
        purgedPages: raw["pages_purged"] ?? 0,
        raw,
      };
    } catch {
      return empty;
    }
  }

  /**
   * Returns swap usage parsed from `sysctl vm.swapusage`.
   *
   * Example output:
   *   vm.swapusage: total = 2048.00M  used = 512.00M  free = 1536.00M  (encrypted)
   */
  async getSwapUsage(): Promise<SwapInfo> {
    const empty: SwapInfo = {
      totalBytes: 0,
      usedBytes: 0,
      freeBytes: 0,
      encrypted: false,
      raw: "",
    };
    if (!isMac()) return empty;
    try {
      const out = await run("sysctl", ["-n", "vm.swapusage"]);
      if (!out) return empty;

      const toBytes = (val: string, unit: string): number => {
        const n = parseFloat(val);
        switch (unit.toUpperCase()) {
          case "K": return n * 1024;
          case "M": return n * 1024 * 1024;
          case "G": return n * 1024 * 1024 * 1024;
          default:  return n;
        }
      };

      // "total = 2048.00M  used = 512.00M  free = 1536.00M  (encrypted)"
      const totalM = out.match(/total\s*=\s*([\d.]+)([KMGB])/i);
      const usedM  = out.match(/used\s*=\s*([\d.]+)([KMGB])/i);
      const freeM  = out.match(/free\s*=\s*([\d.]+)([KMGB])/i);

      return {
        totalBytes: totalM ? toBytes(totalM[1], totalM[2]) : 0,
        usedBytes:  usedM  ? toBytes(usedM[1],  usedM[2])  : 0,
        freeBytes:  freeM  ? toBytes(freeM[1],  freeM[2])  : 0,
        encrypted: /encrypted/i.test(out),
        raw: out,
      };
    } catch {
      return empty;
    }
  }

  /**
   * Purges inactive memory via `sudo purge`.
   */
  async purgeMemory(): Promise<boolean> {
    if (!isMac()) return false;
    try {
      const out = await run("sudo", ["purge"]);
      return out !== null;
    } catch {
      return false;
    }
  }

  /**
   * Returns a summary memory map for `pid` via `vmmap -summary <pid>`.
   */
  async getMemoryMap(pid: number): Promise<MemoryRegion[]> {
    if (!isMac()) return [];
    try {
      const out = await run("vmmap", ["-summary", String(pid)], { timeout: 15_000 });
      if (!out) return [];

      const regions: MemoryRegion[] = [];
      // Parse lines like:
      // __TEXT                             000104000-000108000 [   16K    16K    0K    0K] r-x/r-x SM=COW  /usr/bin/foo
      for (const line of out.split("\n")) {
        const m = line.match(
          /^(\S+)\s+([\da-f]+-[\da-f]+)\s+\[\s*([\d.]+[KMGB]?)/i
        );
        if (!m) continue;

        const [, type, address, sizeStr] = m;
        const permsMatch = line.match(/\]\s+([rwx\-/]+)/);
        const permissions = permsMatch ? permsMatch[1] : "";
        const descMatch = line.match(/SM=\S+\s+(.+)$/);
        const description = descMatch ? descMatch[1].trim() : "";

        regions.push({
          address,
          size: this._parseHumanSize(sizeStr),
          permissions,
          type,
          description,
        });
      }
      return regions;
    } catch {
      return [];
    }
  }

  private _parseHumanSize(s: string): number {
    const m = s.match(/([\d.]+)([KMGB]?)/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    switch (m[2].toUpperCase()) {
      case "K": return n * 1024;
      case "M": return n * 1024 * 1024;
      case "G": return n * 1024 * 1024 * 1024;
      default:  return n;
    }
  }

  // ── Kernel Extensions ─────────────────────────────────────────────────────

  /**
   * Lists all loaded kernel extensions via `kextstat -l`.
   */
  async listKexts(): Promise<KextInfo[]> {
    if (!isMac()) return [];
    try {
      const out = await run("kextstat", ["-l"]);
      if (!out) return [];
      return this._parseKextstat(out);
    } catch {
      return [];
    }
  }

  /**
   * Returns info for a specific kext by bundle identifier name,
   * or null if not found / not loaded.
   */
  async getKextInfo(name: string): Promise<KextInfo | null> {
    if (!isMac()) return null;
    try {
      const all = await this.listKexts();
      return all.find((k) => k.name === name) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Loads a kernel extension from `path` via `sudo kextload <path>`.
   */
  async loadKext(path: string): Promise<boolean> {
    if (!isMac()) return false;
    try {
      const out = await run("sudo", ["kextload", path], { timeout: 30_000 });
      return out !== null;
    } catch {
      return false;
    }
  }

  /**
   * Unloads a kernel extension by bundle identifier via `sudo kextunload -b <name>`.
   */
  async unloadKext(name: string): Promise<boolean> {
    if (!isMac()) return false;
    try {
      const out = await run("sudo", ["kextunload", "-b", name], { timeout: 30_000 });
      return out !== null;
    } catch {
      return false;
    }
  }

  /**
   * Parse `kextstat -l` output.
   *
   * Header line (skip): "Index Refs Address            Size       Wired      Name (Version) <Linked Against>"
   * Data line example:
   *   "    1    0 0xffffff7f8a7c0000 0x2000     0x2000     com.apple.kpi.bsd (20.5.0)"
   */
  private _parseKextstat(raw: string): KextInfo[] {
    const results: KextInfo[] = [];
    for (const line of raw.split("\n")) {
      // Skip header or empty
      if (!line.trim() || /^\s*Index/.test(line)) continue;

      const m = line.match(
        /^\s*(\d+)\s+(\d+)\s+0x[\da-f]+\s+(0x[\da-f]+)\s+(0x[\da-f]+)\s+(\S+)\s+\(([^)]+)\)/i
      );
      if (!m) continue;

      const [, idxStr, refsStr, sizeHex, wiredHex, name, version] = m;
      results.push({
        index: parseInt(idxStr, 10),
        refs: parseInt(refsStr, 10),
        size: parseInt(sizeHex, 16),
        wiredBytes: parseInt(wiredHex, 16),
        name,
        version,
        loaded: true,
      });
    }
    return results;
  }

  // ── Syscall / File Tracing ─────────────────────────────────────────────────

  /**
   * Traces syscalls for `pid` for `durationMs` milliseconds via `sudo dtruss -p <pid>`.
   * Returns the raw dtruss output as a string.
   */
  async traceSyscalls(pid: number, durationMs = 5000): Promise<string> {
    if (!isMac()) return "";
    return new Promise((resolve) => {
      const { spawn } = require("node:child_process") as typeof import("node:child_process");
      let output = "";
      let timedOut = false;

      const child = spawn("sudo", ["dtruss", "-p", String(pid)], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { output += d.toString(); });

      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGINT"); } catch { /* ignore */ }
      }, durationMs);

      child.on("close", () => {
        if (!timedOut) clearTimeout(timer);
        resolve(output.trim());
      });

      child.on("error", () => {
        clearTimeout(timer);
        resolve(output.trim());
      });
    });
  }

  /**
   * Returns a list of open file paths for `pid` via `lsof -p <pid> -Fn`.
   * The `-Fn` flag outputs only filenames, one per line (prefixed with "n").
   */
  async traceOpenFiles(pid: number): Promise<string[]> {
    if (!isMac()) return [];
    try {
      const out = await run("lsof", ["-p", String(pid), "-Fn"]);
      if (!out) return [];
      return out
        .split("\n")
        .filter((l) => l.startsWith("n"))
        .map((l) => l.slice(1).trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Returns detailed file-descriptor info for `pid` via `lsof -p <pid>`.
   */
  async getOpenFileDescriptors(pid: number): Promise<FDInfo[]> {
    if (!isMac()) return [];
    try {
      const out = await run("lsof", ["-p", String(pid)]);
      if (!out) return [];

      const lines = out.split("\n");
      if (lines.length < 2) return [];

      const results: FDInfo[] = [];
      // Skip header line
      for (const line of lines.slice(1)) {
        if (!line.trim()) continue;
        // Fields: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
        const cols = line.split(/\s+/);
        if (cols.length < 9) continue;
        const [command, pidStr, , fd, type, device, sizeStr, node, ...rest] = cols;
        const size = sizeStr && /^\d+$/.test(sizeStr) ? parseInt(sizeStr, 10) : null;
        results.push({
          pid: parseInt(pidStr, 10),
          command,
          fd,
          type,
          device,
          size,
          node,
          name: rest.join(" "),
        });
      }
      return results;
    } catch {
      return [];
    }
  }

  // ── Spotlight ─────────────────────────────────────────────────────────────

  /**
   * Runs a Spotlight metadata query via `mdfind <query>`.
   */
  async spotlightQuery(
    query: string,
    maxResults = 100
  ): Promise<SpotlightResult[]> {
    if (!isMac()) return [];
    try {
      const out = await run("mdfind", [query], { timeout: 15_000 });
      if (!out) return [];
      return out
        .split("\n")
        .filter(Boolean)
        .slice(0, maxResults)
        .map((path) => ({ path }));
    } catch {
      return [];
    }
  }

  /**
   * Returns Spotlight indexing status for `volume` (defaults to "/") via `mdutil -s`.
   */
  async mdutilStatus(
    volume = "/"
  ): Promise<{ indexing: boolean; status: string }> {
    if (!isMac()) return { indexing: false, status: "" };
    try {
      const out = await run("mdutil", ["-s", volume]);
      if (!out) return { indexing: false, status: "" };
      const indexing = /indexing enabled/i.test(out);
      return { indexing, status: out };
    } catch {
      return { indexing: false, status: "" };
    }
  }

  /** Enable Spotlight indexing on `volume` via `sudo mdutil -i on <volume>`. */
  async mdutilEnable(volume: string): Promise<boolean> {
    if (!isMac()) return false;
    try {
      const out = await run("sudo", ["mdutil", "-i", "on", volume]);
      return out !== null;
    } catch {
      return false;
    }
  }

  /** Disable Spotlight indexing on `volume` via `sudo mdutil -i off <volume>`. */
  async mdutilDisable(volume: string): Promise<boolean> {
    if (!isMac()) return false;
    try {
      const out = await run("sudo", ["mdutil", "-i", "off", volume]);
      return out !== null;
    } catch {
      return false;
    }
  }

  /** Trigger a Spotlight re-index on `volume` via `sudo mdutil -E <volume>`. */
  async mdutilReindex(volume: string): Promise<boolean> {
    if (!isMac()) return false;
    try {
      const out = await run("sudo", ["mdutil", "-E", volume]);
      return out !== null;
    } catch {
      return false;
    }
  }

  // ── SIP & Boot ────────────────────────────────────────────────────────────

  /**
   * Returns System Integrity Protection status via `csrutil status`.
   *
   * Example: "System Integrity Protection status: enabled."
   */
  async getSIPStatus(): Promise<{ enabled: boolean; flags: string }> {
    if (!isMac()) return { enabled: false, flags: "" };
    try {
      const out = await run("csrutil", ["status"]);
      if (!out) return { enabled: false, flags: "" };
      const enabled = /enabled/i.test(out) && !/disabled/i.test(out);
      // Extract flags section if present
      const flagsMatch = out.match(/\(([^)]+)\)/);
      const flags = flagsMatch ? flagsMatch[1] : out;
      return { enabled, flags };
    } catch {
      return { enabled: false, flags: "" };
    }
  }

  /**
   * Returns the current NVRAM boot-args via `nvram boot-args`.
   */
  async getBootArgs(): Promise<string> {
    if (!isMac()) return "";
    try {
      const out = await run("nvram", ["boot-args"]);
      if (!out) return "";
      // Output: "boot-args\t<value>"
      const parts = out.split("\t");
      return parts.length > 1 ? parts.slice(1).join("\t").trim() : out.trim();
    } catch {
      return "";
    }
  }

  // ── launchctl ─────────────────────────────────────────────────────────────

  /**
   * Lists all launchctl jobs via `launchctl list`.
   */
  async launchctlList(): Promise<LaunchctlJob[]> {
    if (!isMac()) return [];
    try {
      const out = await run("launchctl", ["list"]);
      if (!out) return [];

      const results: LaunchctlJob[] = [];
      for (const line of out.split("\n")) {
        if (!line.trim() || /^PID/.test(line)) continue;
        // Columns: PID  Status  Label
        const cols = line.split(/\t/);
        if (cols.length < 3) continue;
        const [pidStr, statusStr, label] = cols;
        results.push({
          pid: pidStr.trim() === "-" ? null : parseInt(pidStr.trim(), 10),
          lastExitStatus:
            statusStr.trim() === "-" ? null : parseInt(statusStr.trim(), 10),
          label: label.trim(),
        });
      }
      return results;
    } catch {
      return [];
    }
  }

  /**
   * Load a launchd plist via `launchctl load <plist>`.
   */
  async launchctlLoad(plist: string): Promise<boolean> {
    if (!isMac()) return false;
    try {
      const out = await run("launchctl", ["load", plist]);
      return out !== null;
    } catch {
      return false;
    }
  }

  /**
   * Unload a launchd plist via `launchctl unload <plist>`.
   */
  async launchctlUnload(plist: string): Promise<boolean> {
    if (!isMac()) return false;
    try {
      const out = await run("launchctl", ["unload", plist]);
      return out !== null;
    } catch {
      return false;
    }
  }

  /**
   * Kickstart a service via `launchctl kickstart <service>`.
   * Example service: "system/com.apple.metadata.mds"
   */
  async launchctlKickstart(service: string): Promise<boolean> {
    if (!isMac()) return false;
    try {
      const out = await run("launchctl", ["kickstart", service]);
      return out !== null;
    } catch {
      return false;
    }
  }
}
