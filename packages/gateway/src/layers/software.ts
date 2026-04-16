/**
 * Software & Environment Management Layer — UC8
 *
 * Implements UC8.1 through UC8.5:
 *   UC8.1 Homebrew package management
 *   UC8.2 Node.js / npm / pnpm management
 *   UC8.3 Python / pip management
 *   UC8.4 Environment variables
 *   UC8.5 System information
 *
 * macOS-first; every method has try/catch with safe fallback returns.
 * All shell commands use execSync.
 */

import { execSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { DeepLayer } from "./deep.js";

// ---------------------------------------------------------------------------
// Shared interfaces
// ---------------------------------------------------------------------------

export interface InstallResult {
  success: boolean;
  installed: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// UC8.1 — Homebrew
// ---------------------------------------------------------------------------

export interface BrewPackage {
  name: string;
  version: string;
}

export interface BrewPackageInfo {
  name: string;
  version: string;
  desc: string;
  homepage: string;
  installed: boolean;
}

// ---------------------------------------------------------------------------
// UC8.2 — Node.js / npm / pnpm
// ---------------------------------------------------------------------------

export interface NpmPackage {
  name: string;
  version: string;
  description?: string;
}

export interface NpmOutdated {
  name: string;
  current: string;
  wanted: string;
  latest: string;
}

export interface NpmAuditResult {
  vulnerabilities: {
    low: number;
    moderate: number;
    high: number;
    critical: number;
  };
}

// ---------------------------------------------------------------------------
// UC8.3 — Python / pip
// ---------------------------------------------------------------------------

export interface PipPackage {
  name: string;
  version: string;
}

// ---------------------------------------------------------------------------
// UC8.5 — System info
// ---------------------------------------------------------------------------

export interface SystemInfo {
  os: string;
  version: string;
  arch: string;
  hostname: string;
  cpu: string;
  memory: string;
}

export interface DiskInfo {
  filesystem: string;
  size: string;
  used: string;
  available: string;
  mountpoint: string;
  usePercent: number;
}

export interface MemoryInfo {
  total: number;
  free: number;
  active: number;
  wired: number;
}

export interface CpuInfo {
  model: string;
  cores: number;
  usage: number;
  temperature?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string): string {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function runJson<T>(cmd: string, fallback: T): T {
  try {
    return JSON.parse(run(cmd)) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// SoftwareLayer
// ---------------------------------------------------------------------------

export class SoftwareLayer {
  constructor(deep: DeepLayer) {
    void deep;
  }

  // =========================================================================
  // UC8.1 — Homebrew
  // =========================================================================

  async brewInstall(packages: string[]): Promise<InstallResult> {
    const installed: string[] = [];
    const errors: string[] = [];

    for (const pkg of packages) {
      try {
        run(`brew install ${pkg}`);
        installed.push(pkg);
      } catch (err) {
        errors.push(`${pkg}: ${(err as Error).message}`);
      }
    }

    return { success: errors.length === 0, installed, errors };
  }

  async brewUninstall(packages: string[]): Promise<void> {
    run(`brew uninstall ${packages.join(" ")}`);
  }

  async brewUpdate(): Promise<string> {
    try {
      const updateOut = run("brew update");
      const upgradeOut = run("brew upgrade");
      return `${updateOut}\n${upgradeOut}`.trim();
    } catch (err) {
      return (err as Error).message;
    }
  }

  async brewSearch(query: string): Promise<BrewPackage[]> {
    try {
      // brew search --formula outputs newline-separated names (no version)
      const output = run(`brew search --formula ${query}`);
      return output
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((name) => ({ name, version: "" }));
    } catch {
      return [];
    }
  }

  async brewList(): Promise<BrewPackage[]> {
    try {
      const output = run("brew list --versions");
      return output
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s+/);
          return { name: parts[0] ?? line, version: parts[1] ?? "" };
        });
    } catch {
      return [];
    }
  }

  async brewInfo(name: string): Promise<BrewPackageInfo> {
    try {
      const raw = runJson<{ formulae?: unknown[]; casks?: unknown[] }>(
        `brew info --json=v2 ${name}`,
        {}
      );

      // Try formulae first, then casks
      const entry =
        (raw.formulae?.[0] as Record<string, unknown>) ??
        (raw.casks?.[0] as Record<string, unknown>) ??
        {};

      const versions = entry.versions as Record<string, string> | undefined;
      const stableVersion = versions?.stable ?? "";
      const installedArr = entry.installed as Array<Record<string, string>> | undefined;
      const installed = Array.isArray(installedArr) && installedArr.length > 0;

      return {
        name: (entry.name as string) ?? name,
        version: stableVersion,
        desc: (entry.desc as string) ?? "",
        homepage: (entry.homepage as string) ?? "",
        installed,
      };
    } catch {
      return { name, version: "", desc: "", homepage: "", installed: false };
    }
  }

  async brewDoctor(): Promise<string[]> {
    try {
      const output = run("brew doctor");
      return output
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } catch (err) {
      // brew doctor exits non-zero when it finds warnings — capture that output
      const msg = (err as NodeJS.ErrnoException & { stdout?: string }).stdout ?? (err as Error).message;
      return msg
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    }
  }

  async brewCaskInstall(app: string): Promise<InstallResult> {
    try {
      run(`brew install --cask ${app}`);
      return { success: true, installed: [app], errors: [] };
    } catch (err) {
      return { success: false, installed: [], errors: [(err as Error).message] };
    }
  }

  async brewCaskList(): Promise<string[]> {
    try {
      const output = run("brew list --cask");
      return output
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  // =========================================================================
  // UC8.2 — Node.js / npm / pnpm
  // =========================================================================

  async npmInstall(
    packages: string[],
    opts?: { global?: boolean; dev?: boolean }
  ): Promise<InstallResult> {
    // Prefer pnpm if available, fall back to npm
    const pm = this._detectNodePm();
    const globalFlag = opts?.global ? (pm === "pnpm" ? " --global" : " -g") : "";
    const devFlag = opts?.dev ? (pm === "pnpm" ? " --save-dev" : " -D") : "";
    const cmd =
      pm === "pnpm"
        ? `pnpm add${globalFlag}${devFlag} ${packages.join(" ")}`
        : `npm install${globalFlag}${devFlag} ${packages.join(" ")}`;

    const installed: string[] = [];
    const errors: string[] = [];

    try {
      run(cmd);
      installed.push(...packages);
    } catch (err) {
      errors.push((err as Error).message);
    }

    return { success: errors.length === 0, installed, errors };
  }

  async npmUninstall(packages: string[]): Promise<void> {
    const pm = this._detectNodePm();
    const cmd =
      pm === "pnpm"
        ? `pnpm remove ${packages.join(" ")}`
        : `npm uninstall ${packages.join(" ")}`;
    run(cmd);
  }

  async npmList(opts?: { global?: boolean; depth?: number }): Promise<NpmPackage[]> {
    try {
      const globalFlag = opts?.global ? " -g" : "";
      const depth = opts?.depth ?? 0;
      const raw = runJson<{
        dependencies?: Record<string, { version?: string; description?: string }>;
      }>(`npm list${globalFlag} --json --depth=${depth}`, {});

      return Object.entries(raw.dependencies ?? {}).map(([name, info]) => ({
        name,
        version: info.version ?? "",
        description: info.description,
      }));
    } catch {
      return [];
    }
  }

  async npmSearch(query: string): Promise<NpmPackage[]> {
    try {
      const raw = runJson<Array<{ name?: string; version?: string; description?: string }>>(
        `npm search --json ${query}`,
        []
      );
      return raw.map((p) => ({
        name: p.name ?? "",
        version: p.version ?? "",
        description: p.description,
      }));
    } catch {
      return [];
    }
  }

  async npmOutdated(): Promise<NpmOutdated[]> {
    try {
      // npm outdated --json exits with code 1 when outdated packages exist
      const raw = runJson<
        Record<string, { current?: string; wanted?: string; latest?: string }>
      >("npm outdated --json", {});
      return Object.entries(raw).map(([name, info]) => ({
        name,
        current: info.current ?? "",
        wanted: info.wanted ?? "",
        latest: info.latest ?? "",
      }));
    } catch (err) {
      // npm outdated exits non-zero when packages are outdated; grab stdout
      try {
        const stdout =
          (err as NodeJS.ErrnoException & { stdout?: string }).stdout ?? "{}";
        const raw = JSON.parse(stdout) as Record<
          string,
          { current?: string; wanted?: string; latest?: string }
        >;
        return Object.entries(raw).map(([name, info]) => ({
          name,
          current: info.current ?? "",
          wanted: info.wanted ?? "",
          latest: info.latest ?? "",
        }));
      } catch {
        return [];
      }
    }
  }

  async npmAudit(): Promise<NpmAuditResult> {
    try {
      const raw = runJson<{
        metadata?: {
          vulnerabilities?: {
            low?: number;
            moderate?: number;
            high?: number;
            critical?: number;
          };
        };
        vulnerabilities?: Record<
          string,
          { severity?: string }
        >;
      }>("npm audit --json", {});

      // npm v7+ puts counts in metadata.vulnerabilities
      if (raw.metadata?.vulnerabilities) {
        const v = raw.metadata.vulnerabilities;
        return {
          vulnerabilities: {
            low: v.low ?? 0,
            moderate: v.moderate ?? 0,
            high: v.high ?? 0,
            critical: v.critical ?? 0,
          },
        };
      }

      // Fallback: count from vulnerabilities map
      const counts = { low: 0, moderate: 0, high: 0, critical: 0 };
      for (const v of Object.values(raw.vulnerabilities ?? {})) {
        const sev = v.severity as keyof typeof counts | undefined;
        if (sev && sev in counts) counts[sev]++;
      }
      return { vulnerabilities: counts };
    } catch (err) {
      // npm audit exits non-zero when vulnerabilities exist
      try {
        const stdout =
          (err as NodeJS.ErrnoException & { stdout?: string }).stdout ?? "{}";
        const raw = JSON.parse(stdout) as {
          metadata?: {
            vulnerabilities?: {
              low?: number;
              moderate?: number;
              high?: number;
              critical?: number;
            };
          };
        };
        const v = raw.metadata?.vulnerabilities ?? {};
        return {
          vulnerabilities: {
            low: v.low ?? 0,
            moderate: v.moderate ?? 0,
            high: v.high ?? 0,
            critical: v.critical ?? 0,
          },
        };
      } catch {
        return { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 } };
      }
    }
  }

  async getNodeVersion(): Promise<string> {
    try {
      return run("node --version");
    } catch {
      return "";
    }
  }

  async getNpmVersion(): Promise<string> {
    // Prefer pnpm if available
    try {
      return run("pnpm --version");
    } catch {
      try {
        return run("npm --version");
      } catch {
        return "";
      }
    }
  }

  // =========================================================================
  // UC8.3 — Python / pip
  // =========================================================================

  async pipInstall(packages: string[], opts?: { user?: boolean }): Promise<InstallResult> {
    const userFlag = opts?.user ? " --user" : "";
    const installed: string[] = [];
    const errors: string[] = [];

    for (const pkg of packages) {
      try {
        run(`pip3 install${userFlag} ${pkg}`);
        installed.push(pkg);
      } catch (err) {
        errors.push(`${pkg}: ${(err as Error).message}`);
      }
    }

    return { success: errors.length === 0, installed, errors };
  }

  async pipUninstall(packages: string[]): Promise<void> {
    run(`pip3 uninstall -y ${packages.join(" ")}`);
  }

  async pipList(): Promise<PipPackage[]> {
    try {
      const raw = runJson<Array<{ name?: string; version?: string }>>(
        "pip3 list --format=json",
        []
      );
      return raw.map((p) => ({ name: p.name ?? "", version: p.version ?? "" }));
    } catch {
      return [];
    }
  }

  async pipOutdated(): Promise<PipPackage[]> {
    try {
      const raw = runJson<Array<{ name?: string; version?: string }>>(
        "pip3 list --outdated --format=json",
        []
      );
      return raw.map((p) => ({ name: p.name ?? "", version: p.version ?? "" }));
    } catch {
      return [];
    }
  }

  async getPythonVersion(): Promise<string> {
    try {
      return run("python3 --version");
    } catch {
      return "";
    }
  }

  async createVenv(path: string): Promise<void> {
    run(`python3 -m venv ${path}`);
  }

  // =========================================================================
  // UC8.4 — Environment Variables
  // =========================================================================

  async getEnvVar(name: string): Promise<string | undefined> {
    return process.env[name];
  }

  async setEnvVar(
    name: string,
    value: string,
    opts?: { persist?: boolean; shell?: "zsh" | "bash" }
  ): Promise<void> {
    // Set in the current process
    process.env[name] = value;

    if (opts?.persist) {
      const shell = opts.shell ?? "zsh";
      const rcFile =
        shell === "bash"
          ? join(homedir(), ".bashrc")
          : join(homedir(), ".zshrc");
      const line = `\nexport ${name}="${value}"\n`;
      appendFileSync(rcFile, line, "utf8");
    }
  }

  async listEnvVars(filter?: string): Promise<Record<string, string>> {
    try {
      const cmd = filter ? `printenv | grep ${filter}` : "printenv";
      const output = run(cmd);
      const result: Record<string, string> = {};
      for (const line of output.split("\n")) {
        const idx = line.indexOf("=");
        if (idx === -1) continue;
        const key = line.slice(0, idx);
        const val = line.slice(idx + 1);
        result[key] = val;
      }
      return result;
    } catch {
      return {};
    }
  }

  async getPath(): Promise<string[]> {
    const PATH = process.env["PATH"] ?? "";
    return PATH.split(":").filter(Boolean);
  }

  async addToPath(dir: string, opts?: { persist?: boolean }): Promise<void> {
    const current = process.env["PATH"] ?? "";
    if (!current.split(":").includes(dir)) {
      process.env["PATH"] = `${dir}:${current}`;
    }

    if (opts?.persist) {
      const rcFile = join(homedir(), ".zshrc");
      const line = `\nexport PATH="${dir}:$PATH"\n`;
      appendFileSync(rcFile, line, "utf8");
    }
  }

  // =========================================================================
  // UC8.5 — System Info
  // =========================================================================

  async getSystemInfo(): Promise<SystemInfo> {
    try {
      const swRaw = runJson<{
        SPSoftwareDataType?: Array<Record<string, string>>;
      }>("system_profiler SPSoftwareDataType -json", {});
      const hwRaw = runJson<{
        SPHardwareDataType?: Array<Record<string, string>>;
      }>("system_profiler SPHardwareDataType -json", {});

      const sw = swRaw.SPSoftwareDataType?.[0] ?? {};
      const hw = hwRaw.SPHardwareDataType?.[0] ?? {};

      return {
        os: sw["os_version"]?.split(" ")[0] ?? "macOS",
        version: sw["os_version"] ?? "",
        arch: hw["cpu_type"] ?? run("uname -m"),
        hostname: sw["local_host_name"] ?? run("hostname"),
        cpu: hw["chip_type"] ?? hw["cpu_type"] ?? "",
        memory: hw["physical_memory"] ?? "",
      };
    } catch {
      return {
        os: "macOS",
        version: "",
        arch: "",
        hostname: "",
        cpu: "",
        memory: "",
      };
    }
  }

  async getDiskUsage(): Promise<DiskInfo[]> {
    try {
      const output = run("df -h");
      const lines = output.split("\n").slice(1); // skip header
      const result: DiskInfo[] = [];

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) continue;

        // df -h columns: Filesystem Size Used Avail Capacity iused ...
        // We want: filesystem, size, used, avail, use%, mountpoint
        // On macOS: Filesystem 512B-blocks Used Available %Capacity iused ifree %iused Mounted on
        // with -h:  Filesystem   Size    Used  Avail Capacity iused ifree %iused  Mounted on
        const filesystem = parts[0] ?? "";
        const size = parts[1] ?? "";
        const used = parts[2] ?? "";
        const available = parts[3] ?? "";
        const capacityStr = parts[4] ?? "0%";
        const mountpoint = parts[parts.length - 1] ?? "";
        const usePercent = parseInt(capacityStr.replace("%", ""), 10) || 0;

        result.push({ filesystem, size, used, available, mountpoint, usePercent });
      }

      return result;
    } catch {
      return [];
    }
  }

  async getMemoryUsage(): Promise<MemoryInfo> {
    try {
      const output = run("vm_stat");
      const pageSize = 4096; // macOS default page size in bytes

      const parse = (key: string): number => {
        const match = output.match(new RegExp(`${key}:\\s+(\\d+)`));
        return match ? parseInt(match[1]!, 10) * pageSize : 0;
      };

      const free = parse("Pages free");
      const active = parse("Pages active");
      const wired = parse("Pages wired down");
      const speculative = parse("Pages speculative");
      const total = free + active + wired + speculative + parse("Pages inactive");

      return { total, free, active, wired };
    } catch {
      return { total: 0, free: 0, active: 0, wired: 0 };
    }
  }

  async getCpuUsage(): Promise<CpuInfo> {
    try {
      const output = run("top -l 1 -n 0");

      // Model: parse from sysctl
      let model = "";
      try {
        model = run("sysctl -n machdep.cpu.brand_string");
      } catch {
        model = "";
      }

      // Cores
      let cores = 0;
      try {
        cores = parseInt(run("sysctl -n hw.ncpu"), 10) || 0;
      } catch {
        cores = 0;
      }

      // CPU usage: look for "CPU usage: X.X% user, X.X% sys, X.X% idle"
      const usageMatch = output.match(/CPU usage:\s+([\d.]+)%\s+user,\s+([\d.]+)%\s+sys/);
      let usage = 0;
      if (usageMatch) {
        const user = parseFloat(usageMatch[1]!) || 0;
        const sys = parseFloat(usageMatch[2]!) || 0;
        usage = user + sys;
      }

      return { model, cores, usage };
    } catch {
      return { model: "", cores: 0, usage: 0 };
    }
  }

  async getUptime(): Promise<string> {
    try {
      return run("uptime");
    } catch {
      return "";
    }
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private _detectNodePm(): "pnpm" | "npm" {
    try {
      run("pnpm --version");
      return "pnpm";
    } catch {
      return "npm";
    }
  }

  // =========================================================================
  // Version Manager Integration
  // =========================================================================

  /** Get installed Node versions and the active version manager. */
  async getNodeVersions(): Promise<{
    current: string;
    installed: string[];
    manager: "nvm" | "fnm" | "volta" | "none";
  }> {
    // Try nvm
    try {
      const out = run(
        `bash -c 'source "$HOME/.nvm/nvm.sh" 2>/dev/null && nvm ls --no-colors 2>/dev/null'`,
      );
      const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
      const installed = lines
        .filter((l) => l.match(/v\d+/))
        .map((l) => {
          const m = l.match(/v[\d.]+/);
          return m ? m[0] : l;
        });
      const currentMatch = out.match(/->[\s]+(v[\d.]+)/);
      const current = currentMatch ? currentMatch[1] : run("node --version").trim();
      return { current, installed, manager: "nvm" };
    } catch { /* fall through */ }

    // Try fnm
    try {
      const out = run("fnm list 2>/dev/null");
      const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
      const installed = lines.map((l) => l.replace(/^\*\s*/, "").split(" ")[0]).filter(Boolean);
      const currentRaw = lines.find((l) => l.startsWith("*"));
      const current = currentRaw
        ? currentRaw.replace(/^\*\s*/, "").split(" ")[0]
        : run("node --version").trim();
      return { current, installed, manager: "fnm" };
    } catch { /* fall through */ }

    // Try volta
    try {
      const out = run("volta list node --format plain 2>/dev/null");
      const installed = out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const m = l.match(/[\d.]+/);
          return m ? `v${m[0]}` : l;
        });
      const current = run("node --version").trim();
      return { current, installed, manager: "volta" };
    } catch { /* fall through */ }

    // No manager
    try {
      const current = run("node --version").trim();
      return { current, installed: [current], manager: "none" };
    } catch {
      return { current: "unknown", installed: [], manager: "none" };
    }
  }

  /** Switch Node version using the detected version manager. */
  async setNodeVersion(version: string): Promise<boolean> {
    try {
      const v = version.startsWith("v") ? version : `v${version}`;
      const { manager } = await this.getNodeVersions();
      if (manager === "nvm") {
        run(`bash -c 'source "$HOME/.nvm/nvm.sh" && nvm use ${v}'`);
      } else if (manager === "fnm") {
        run(`fnm use ${v}`);
      } else if (manager === "volta") {
        run(`volta pin node@${v.replace(/^v/, "")}`);
      } else {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Get installed Python versions via pyenv. */
  async getPythonVersions(): Promise<{
    current: string;
    installed: string[];
    manager: "pyenv" | "none";
  }> {
    try {
      const out = run("pyenv versions --bare 2>/dev/null");
      const installed = out.split("\n").map((l) => l.trim()).filter(Boolean);
      const current = run("pyenv version-name 2>/dev/null").trim();
      return { current, installed, manager: "pyenv" };
    } catch { /* fall through */ }

    try {
      const current = run("python3 --version 2>/dev/null").replace("Python ", "").trim();
      return { current, installed: [current], manager: "none" };
    } catch {
      return { current: "unknown", installed: [], manager: "none" };
    }
  }

  /** Set Python version using pyenv (local first, falls back to global). */
  async setPythonVersion(version: string): Promise<boolean> {
    try {
      run(`pyenv local ${version}`);
      return true;
    } catch {
      try {
        run(`pyenv global ${version}`);
        return true;
      } catch {
        return false;
      }
    }
  }

  /** Get installed Ruby versions via rbenv or rvm. */
  async getRubyVersions(): Promise<{
    current: string;
    installed: string[];
    manager: "rbenv" | "rvm" | "none";
  }> {
    // Try rbenv
    try {
      const out = run("rbenv versions --bare 2>/dev/null");
      const installed = out.split("\n").map((l) => l.trim()).filter(Boolean);
      const current = run("rbenv version-name 2>/dev/null").trim();
      return { current, installed, manager: "rbenv" };
    } catch { /* fall through */ }

    // Try rvm
    try {
      const out = run("rvm list strings 2>/dev/null");
      const installed = out.split("\n").map((l) => l.trim()).filter(Boolean);
      const currentRaw = run("rvm current 2>/dev/null").trim();
      return { current: currentRaw, installed, manager: "rvm" };
    } catch { /* fall through */ }

    try {
      const current = run("ruby --version 2>/dev/null").split(" ")[1] ?? "unknown";
      return { current, installed: [current], manager: "none" };
    } catch {
      return { current: "unknown", installed: [], manager: "none" };
    }
  }

  // =========================================================================
  // Homebrew Cask Management (rich responses)
  // =========================================================================

  /** Install a cask application; returns success status and command output. */
  async caskInstall(name: string): Promise<{ success: boolean; output: string }> {
    try {
      const output = run(`brew install --cask ${name}`);
      return { success: true, output };
    } catch (err) {
      return { success: false, output: (err as Error).message };
    }
  }

  /** Uninstall a cask application. */
  async caskUninstall(name: string): Promise<{ success: boolean; output: string }> {
    try {
      const output = run(`brew uninstall --cask ${name}`);
      return { success: true, output };
    } catch (err) {
      return { success: false, output: (err as Error).message };
    }
  }

  /** List installed cask applications with name and version. */
  async caskList(): Promise<Array<{ name: string; version: string }>> {
    try {
      const raw = runJson<Record<string, unknown>[]>(
        "brew list --cask --json=v2",
        [],
      );
      // brew --json=v2 returns { casks: [...] }
      const casksAny = (raw as unknown as { casks?: unknown[] }).casks ?? raw;
      const casks = casksAny as Array<{ token?: string; installed_versions?: string[] }>;
      return casks.map((c) => ({
        name: c.token ?? "unknown",
        version: (c.installed_versions ?? [])[0] ?? "unknown",
      }));
    } catch {
      // Fallback: plain list
      try {
        const lines = run("brew list --cask").split("\n").map((l) => l.trim()).filter(Boolean);
        return lines.map((name) => ({ name, version: "unknown" }));
      } catch {
        return [];
      }
    }
  }

  /** Search for cask applications matching a query. */
  async caskSearch(query: string): Promise<string[]> {
    try {
      const out = run(`brew search --cask ${query}`);
      return out.split("\n").map((l) => l.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  // =========================================================================
  // App Management
  // =========================================================================

  /** List all installed macOS applications via system_profiler. */
  async getInstalledApps(): Promise<
    Array<{ name: string; version: string; path: string; bundleId: string }>
  > {
    type SPApp = {
      _name?: string;
      version?: string;
      path?: string;
      bundleId?: string;
    };
    type SPAppsData = { SPApplicationsDataType?: SPApp[] };

    try {
      const data = runJson<SPAppsData>(
        "system_profiler SPApplicationsDataType -json",
        {},
      );
      const apps = data.SPApplicationsDataType ?? [];
      return apps.map((a) => ({
        name: a._name ?? "unknown",
        version: a.version ?? "unknown",
        path: a.path ?? "",
        bundleId: a.bundleId ?? "",
      }));
    } catch {
      return [];
    }
  }

  /** Get info for a specific application by name. */
  async getAppInfo(
    appName: string,
  ): Promise<{
    name: string;
    version: string;
    path: string;
    bundleId: string;
    size: number;
  } | null> {
    try {
      const apps = await this.getInstalledApps();
      const lower = appName.toLowerCase();
      const found = apps.find((a) => a.name.toLowerCase().includes(lower));
      if (!found) return null;

      // Try to get size via du
      let size = 0;
      if (found.path) {
        try {
          const du = run(`du -sk "${found.path}"`);
          const kb = parseInt(du.split("\t")[0], 10);
          size = isNaN(kb) ? 0 : kb * 1024;
        } catch { /* size stays 0 */ }
      }

      return { ...found, size };
    } catch {
      return null;
    }
  }

  /** Check whether a specific application is installed. */
  async isAppInstalled(appName: string): Promise<boolean> {
    const info = await this.getAppInfo(appName);
    return info !== null;
  }
}
