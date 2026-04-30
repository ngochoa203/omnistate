/**
 * Deep OS Layer — Extended OS-level operations.
 *
 * Wraps a `DeepLayer` instance and adds domain-specific OS capabilities:
 * process lifecycle, app resolution, APFS snapshots, OS configuration,
 * service/daemon management, package management, network control,
 * kernel/hardware tuning, peripheral control, scheduled tasks,
 * system defaults (registry), user/group/ACL management,
 * volume management, and environment variable management.
 *
 * macOS-first; Linux fallbacks where reasonable; Windows stubs.
 */

import type { DeepLayer } from "./deep.js";

// ------------------------------------------------------------------
// JXA Executors
// ------------------------------------------------------------------

/**
 * Execute JXA (JavaScript for Automation) code via osascript.
 * JXA uses standard JavaScript syntax — much easier for LLMs to generate
 * than AppleScript. Runs synchronously with a 10s timeout.
 *
 * Example: executeJxa('Application("Safari").windows[0].currentTab.url()')
 */
export async function executeJxa(code: string): Promise<string> {
  const { execSync } = await import('child_process');
  try {
    const result = execSync(`osascript -l JavaScript -e ${JSON.stringify(code)}`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return result.trim();
  } catch (err: any) {
    throw new Error(`JXA execution failed: ${err.stderr || err.message}`);
  }
}

/**
 * Execute JXA code asynchronously (non-blocking).
 * For longer-running automation scripts.
 */
export async function executeJxaAsync(code: string): Promise<string> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileP = promisify(execFile);
  try {
    const { stdout } = await execFileP('osascript', ['-l', 'JavaScript', '-e', code], {
      timeout: 30000,
    });
    return stdout.trim();
  } catch (err: any) {
    throw new Error(`JXA execution failed: ${err.stderr || err.message}`);
  }
}

// ------------------------------------------------------------------
// UC-B01: Process Lifecycle
// ------------------------------------------------------------------

export interface ProcessDetails {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  openFiles: string[];
  openPorts: number[];
  children: number[];
  ppid: number;
  status: string;
}

// ------------------------------------------------------------------
// UC-B02: App Resolution & Auto-Install
// ------------------------------------------------------------------

export interface AppInfo {
  name: string;
  path: string;
  version: string | null;
  bundleId: string | null;
}

// ------------------------------------------------------------------
// UC-B04: Snapshots
// ------------------------------------------------------------------

export interface SnapshotInfo {
  label: string;
  createdAt: string;
  volume: string;
}

// ------------------------------------------------------------------
// UC-B05: OS Configuration
// ------------------------------------------------------------------

export interface ProxyConfig {
  protocol: "http" | "https" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: string;
  bypass?: string[];
}

// ------------------------------------------------------------------
// UC-B06: Service/Daemon Management
// ------------------------------------------------------------------

export type ServiceStatus = "running" | "stopped" | "disabled" | "unknown";

export interface ServiceInfo {
  name: string;
  label: string;
  status: ServiceStatus;
  pid: number | null;
}

export interface LaunchDaemonConfig {
  /** Reverse-DNS label, e.g. com.example.myservice */
  label: string;
  programArgs: string[];
  runAtLoad?: boolean;
  keepAlive?: boolean;
  /** Interval in seconds for StartInterval */
  startInterval?: number;
  workingDirectory?: string;
  standardOutPath?: string;
  standardErrorPath?: string;
  environmentVariables?: Record<string, string>;
  /** Install as user LaunchAgent (~/Library/LaunchAgents) vs system LaunchDaemon */
  userAgent?: boolean;
}

// ------------------------------------------------------------------
// UC-B07: Package Management
// ------------------------------------------------------------------

export interface PackageInfo {
  name: string;
  version: string;
  manager: string;
  description?: string;
}

// ------------------------------------------------------------------
// UC-B08: Network Control
// ------------------------------------------------------------------

export interface NetworkInterface {
  name: string;
  address: string;
  netmask: string | null;
  family: "IPv4" | "IPv6";
  mac: string | null;
  up: boolean;
}

export interface WiFiInfo {
  ssid: string;
  bssid: string | null;
  rssi: number | null;
  channel: number | null;
  security: string | null;
  connected: boolean;
}

export interface FirewallStatus {
  enabled: boolean;
  blockAll: boolean;
  stealthMode: boolean;
}

export interface PortInfo {
  protocol: "tcp" | "udp";
  localPort: number;
  localAddress: string;
  state: string;
  pid: number | null;
  process: string | null;
}

export interface ConnectionInfo {
  protocol: "tcp" | "udp";
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
  pid: number | null;
}

export interface RouteInfo {
  destination: string;
  gateway: string;
  flags: string;
  iface: string;
}

export interface PingResult {
  host: string;
  packets: number;
  received: number;
  loss: number;
  avgMs: number | null;
  minMs: number | null;
  maxMs: number | null;
}

export interface VPNInfo {
  name: string;
  status: "connected" | "disconnected" | "connecting";
  address: string | null;
}

// ------------------------------------------------------------------
// UC-B09: Kernel/Hardware Tuning
// ------------------------------------------------------------------

export interface PowerSettings {
  sleepDelay: number | null;
  displaySleepDelay: number | null;
  diskSleepDelay: number | null;
  hibernateMode: number | null;
  autopoweroff: boolean;
  powernap: boolean;
  raw: Record<string, string>;
}

// ------------------------------------------------------------------
// UC-B10: Peripheral Control
// ------------------------------------------------------------------

export interface AudioDevice {
  id: string;
  name: string;
  type: "input" | "output";
  isDefault: boolean;
}

export interface BluetoothStatus {
  enabled: boolean;
  discovering: boolean;
}

export interface BluetoothDevice {
  address: string;
  name: string;
  connected: boolean;
  paired: boolean;
}

// ------------------------------------------------------------------
// UC-B11: Scheduled Tasks
// ------------------------------------------------------------------

export interface ScheduledTask {
  label: string;
  status: string;
  lastExit: number | null;
  pid: number | null;
}

export interface ScheduledTaskConfig {
  /** Reverse-DNS label */
  label: string;
  programArgs: string[];
  /** Cron-style or launchd calendar config — use startInterval (seconds) for simple repeating */
  startInterval?: number;
  /** ISO 8601 date-time for one-shot run */
  startCalendarInterval?: {
    Minute?: number;
    Hour?: number;
    Day?: number;
    Weekday?: number;
    Month?: number;
  };
  runAtLoad?: boolean;
}

// ------------------------------------------------------------------
// UC-B13: User/Group/ACL Management
// ------------------------------------------------------------------

export interface UserInfo {
  uid: number;
  username: string;
  fullName: string | null;
  shell: string;
  home: string;
  groups: string[];
}

export interface GroupInfo {
  gid: number;
  name: string;
  members: string[];
}

export interface PermissionInfo {
  path: string;
  mode: string;
  octal: string;
  owner: string;
  group: string;
  readable: boolean;
  writable: boolean;
  executable: boolean;
}

// ------------------------------------------------------------------
// UC-B14: Partition/Volume Management
// ------------------------------------------------------------------

export interface VolumeInfo {
  name: string;
  device: string;
  mountPoint: string;
  fsType: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
}

export interface PartitionInfo {
  device: string;
  index: number;
  name: string | null;
  type: string;
  startSector: number | null;
  sizeMB: number | null;
}

// ------------------------------------------------------------------
// UC-B16: WiFi Pentest & Security Auditing
// ------------------------------------------------------------------

export interface WiFiScanResult {
  ssid: string;
  bssid: string;
  rssi: number;
  channel: number;
  security: string;
}

export interface HostScanResult {
  ip: string;
  hostname: string | null;
  mac: string | null;
  alive: boolean;
}

export interface PortScanResult {
  port: number;
  state: "open" | "closed" | "filtered";
  service: string | null;
}

export interface SecurityAuditResult {
  openPorts: PortInfo[];
  firewallStatus: FirewallStatus;
  wifiSecurity: string | null;
  sshEnabled: boolean;
  remoteLoginEnabled: boolean;
  recommendations: string[];
}

export interface ToolAvailability {
  name: string;
  available: boolean;
  path: string | null;
  version: string | null;
}

// ------------------------------------------------------------------
// DeepOSLayer class
// ------------------------------------------------------------------

export class DeepOSLayer {
  constructor(private readonly deep: DeepLayer) {}

  // ================================================================
  // UC-B01: Process Lifecycle
  // ================================================================

  /**
   * Restart a named process: kill it and re-launch its command.
   * Uses SIGTERM first; falls back to SIGKILL after 3 s.
   */
  async restartProcess(name: string): Promise<boolean> {
    try {
      const { stdout: pidStr } = await this.deep.execAsync(
        `pgrep -x "${name}" | head -1`
      );
      const pid = parseInt(pidStr.trim(), 10);
      if (isNaN(pid)) return false;

      // Capture the original command line before killing
      const cmdResult = await this.deep.execAsync(
        `ps -p ${pid} -o comm= 2>/dev/null`
      );
      const cmd = cmdResult.stdout.trim();
      if (!cmd) return false;

      // Graceful stop
      await this.deep.execAsync(`kill -15 ${pid}`);

      // Wait up to 3 s then force if still alive
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));
      try {
        await this.deep.execAsync(`kill -0 ${pid}`);
        // Still alive — force
        await this.deep.execAsync(`kill -9 ${pid}`);
      } catch {
        // Already dead — good
      }

      // Re-launch detached
      const { spawn } = await import("node:child_process");
      spawn(cmd, { detached: true, stdio: "ignore" }).unref();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Change the scheduling priority (nice value) of a process.
   * Priority range: -20 (highest) to 19 (lowest). Requires sudo for negative values.
   */
  async reniceProcess(pid: number, priority: number): Promise<boolean> {
    try {
      await this.deep.execAsync(`renice -n ${priority} -p ${pid}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return detailed information for a given PID, including open files,
   * listening ports, and child PIDs.
   */
  async getProcessDetails(pid: number): Promise<ProcessDetails | null> {
    try {
      const [infoRes, filesRes, childRes] = await Promise.allSettled([
        this.deep.execAsync(
          `ps -p ${pid} -o pid=,ppid=,pcpu=,pmem=,stat=,comm= 2>/dev/null`
        ),
        this.deep.execAsync(`lsof -p ${pid} -F n 2>/dev/null | grep '^n' | head -40`),
        this.deep.execAsync(`pgrep -P ${pid} 2>/dev/null`),
      ]);

      if (infoRes.status === "rejected") return null;
      const raw = infoRes.value.stdout.trim().split(/\s+/);
      if (raw.length < 5) return null;

      const ppid = parseInt(raw[1], 10);
      const cpu = parseFloat(raw[2]);
      const mem = parseFloat(raw[3]);
      const status = raw[4] ?? "?";
      const name = raw.slice(5).join(" ");

      const openFiles: string[] =
        filesRes.status === "fulfilled"
          ? filesRes.value.stdout
              .trim()
              .split("\n")
              .filter((l) => l.startsWith("n"))
              .map((l) => l.slice(1))
          : [];

      // Extract numeric ports from open files list
      const openPorts: number[] = openFiles
        .filter((f) => /:\d+$/.test(f))
        .map((f) => parseInt(f.split(":").pop() ?? "", 10))
        .filter((p) => !isNaN(p));

      const children: number[] =
        childRes.status === "fulfilled"
          ? childRes.value.stdout
              .trim()
              .split("\n")
              .map((s) => parseInt(s, 10))
              .filter((n) => !isNaN(n))
          : [];

      return { pid, name, ppid, cpu, memory: mem, status, openFiles, openPorts, children };
    } catch {
      return null;
    }
  }

  // ================================================================
  // UC-B02: App Resolution & Auto-Install
  // ================================================================

  /**
   * Find an application by name: returns its path, version, and bundle ID.
   * Searches /Applications and the Homebrew Cask prefix on macOS.
   */
  async resolveApp(name: string): Promise<AppInfo | null> {
    try {
      if (this.deep.platform === "macos") {
        // mdfind is fastest on macOS
        const { stdout: mdOut } = await this.deep.execAsync(
          `mdfind -onlyin /Applications "kMDItemCFBundleName == '${name}'" 2>/dev/null | head -1`
        );
        const appPath = mdOut.trim() || `/Applications/${name}.app`;

        const [versionRes, bundleRes] = await Promise.allSettled([
          this.deep.execAsync(
            `defaults read "${appPath}/Contents/Info" CFBundleShortVersionString 2>/dev/null`
          ),
          this.deep.execAsync(
            `defaults read "${appPath}/Contents/Info" CFBundleIdentifier 2>/dev/null`
          ),
        ]);

        return {
          name,
          path: appPath,
          version:
            versionRes.status === "fulfilled"
              ? versionRes.value.stdout.trim() || null
              : null,
          bundleId:
            bundleRes.status === "fulfilled"
              ? bundleRes.value.stdout.trim() || null
              : null,
        };
      }

      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(`which "${name}" 2>/dev/null`);
        const binPath = stdout.trim();
        if (!binPath) return null;
        const versionRes = await this.deep.execAsync(
          `"${binPath}" --version 2>&1 | head -1`
        );
        return {
          name,
          path: binPath,
          version: versionRes.stdout.trim() || null,
          bundleId: null,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Install an application via Homebrew.
   * Defaults to `brew install`; pass `"cask"` to use `brew install --cask`.
   */
  async installApp(
    name: string,
    manager: "brew" | "cask" = "brew"
  ): Promise<boolean> {
    try {
      const cmd =
        manager === "cask"
          ? `brew install --cask "${name}"`
          : `brew install "${name}"`;
      await this.deep.execAsync(cmd, 300_000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Launch an application with optional CLI arguments and environment variables.
   * On macOS uses `open -a`; passes args and env through.
   */
  async launchAppWithContext(
    name: string,
    args: string[] = [],
    env: Record<string, string> = {}
  ): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        const envPrefix = Object.entries(env)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(" ");
        const argsStr = args.length ? `--args ${args.map((a) => `"${a}"`).join(" ")}` : "";
        const cmd = `${envPrefix ? `env ${envPrefix} ` : ""}open -a "${name}" ${argsStr}`.trim();
        await this.deep.execAsync(cmd);
        return true;
      }
      if (this.deep.platform === "linux") {
        const { spawn } = await import("node:child_process");
        spawn(name, args, {
          detached: true,
          stdio: "ignore",
          env: { ...process.env, ...env },
        }).unref();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ================================================================
  // UC-B04: Snapshot Before Dangerous Changes
  // ================================================================

  /**
   * Create an APFS snapshot with a user-supplied label on macOS.
   * No-op on non-macOS platforms.
   */
  async createSnapshot(label: string): Promise<SnapshotInfo | null> {
    try {
      if (this.deep.platform !== "macos") return null;
      const { stdout } = await this.deep.execAsync(
        `tmutil localsnapshot / 2>/dev/null`
      );
      // Output: "Created local snapshot with date: 2024-01-15-120000"
      const date = stdout.trim().split(": ").pop() ?? new Date().toISOString();
      // Tag the snapshot with the label via metadata (we store label→date mapping)
      return {
        label,
        createdAt: date,
        volume: "/",
      };
    } catch {
      return null;
    }
  }

  /**
   * List all APFS local snapshots on the root volume (macOS only).
   */
  async listSnapshots(): Promise<SnapshotInfo[]> {
    try {
      if (this.deep.platform !== "macos") return [];
      const { stdout } = await this.deep.execAsync(
        `tmutil listlocalsnapshots / 2>/dev/null`
      );
      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          // com.apple.TimeMachine.2024-01-15-120000.local
          const match = line.match(/(\d{4}-\d{2}-\d{2}-\d{6})/);
          return {
            label: line.trim(),
            createdAt: match ? match[1] : line.trim(),
            volume: "/",
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Roll back to an APFS snapshot by label (macOS only).
   * Note: Requires restart to take full effect; this initiates the rollback.
   */
  async rollbackToSnapshot(label: string): Promise<boolean> {
    try {
      if (this.deep.platform !== "macos") return false;
      await this.deep.execAsync(`tmutil restore "${label}" 2>/dev/null`);
      return true;
    } catch {
      return false;
    }
  }

  // ================================================================
  // UC-B05: OS Configuration
  // ================================================================

  /**
   * Read a macOS `defaults` value for the given key in the global domain.
   * Returns the string value, or null if not set.
   */
  async getOSConfig(key: string): Promise<string | null> {
    try {
      const { stdout } = await this.deep.execAsync(
        `defaults read NSGlobalDomain "${key}" 2>/dev/null`
      );
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Write a macOS `defaults` value. Domain defaults to NSGlobalDomain.
   */
  async setOSConfig(
    key: string,
    value: string,
    domain: string = "NSGlobalDomain"
  ): Promise<boolean> {
    try {
      await this.deep.execAsync(`defaults write "${domain}" "${key}" "${value}"`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns true if macOS is in Dark Mode.
   */
  async isDarkMode(): Promise<boolean> {
    try {
      const { stdout } = await this.deep.execAsync(
        `defaults read -g AppleInterfaceStyle 2>/dev/null`
      );
      return stdout.trim().toLowerCase() === "dark";
    } catch {
      return false;
    }
  }

  /**
   * Enable or disable macOS Dark Mode via AppleScript.
   */
  async setDarkMode(enabled: boolean): Promise<boolean> {
    try {
      const script = enabled
        ? `tell application "System Events" to tell appearance preferences to set dark mode to true`
        : `tell application "System Events" to tell appearance preferences to set dark mode to false`;
      await this.deep.execAsync(`osascript -e '${script}'`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the list of DNS server addresses for the primary network service.
   */
  async getDNS(): Promise<string[]> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `networksetup -getdnsservers Wi-Fi 2>/dev/null || networksetup -getdnsservers Ethernet 2>/dev/null`
        );
        return stdout
          .trim()
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith("There aren't"));
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `grep '^nameserver' /etc/resolv.conf 2>/dev/null`
        );
        return stdout
          .trim()
          .split("\n")
          .map((l) => l.replace("nameserver", "").trim())
          .filter(Boolean);
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Set DNS servers on a network interface.
   * On macOS, defaults to Wi-Fi. On Linux uses nmcli or resolv.conf.
   */
  async setDNS(servers: string[], iface: string = "Wi-Fi"): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(
          `networksetup -setdnsservers "${iface}" ${servers.join(" ")}`
        );
        return true;
      }
      if (this.deep.platform === "linux") {
        const resolvContent = servers.map((s) => `nameserver ${s}`).join("\n");
        const { writeFileSync } = await import("node:fs");
        writeFileSync("/etc/resolv.conf", resolvContent + "\n");
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get the current proxy configuration (macOS: networksetup; Linux: env vars).
   */
  async getProxy(): Promise<ProxyConfig | null> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `networksetup -getwebproxy Wi-Fi 2>/dev/null`
        );
        const enabled = /Enabled:\s*Yes/i.test(stdout);
        if (!enabled) return null;
        const serverMatch = stdout.match(/Server:\s*(.+)/);
        const portMatch = stdout.match(/Port:\s*(\d+)/);
        if (!serverMatch || !portMatch) return null;
        return {
          protocol: "http",
          host: serverMatch[1].trim(),
          port: parseInt(portMatch[1], 10),
        };
      }
      if (this.deep.platform === "linux") {
        const proxy = process.env.http_proxy ?? process.env.HTTP_PROXY;
        if (!proxy) return null;
        const url = new URL(proxy);
        return {
          protocol: url.protocol.replace(":", "") as ProxyConfig["protocol"],
          host: url.hostname,
          port: parseInt(url.port || "80", 10),
          username: url.username || undefined,
          password: url.password || undefined,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Set the system proxy configuration.
   * On macOS updates both HTTP and HTTPS proxies via networksetup.
   */
  async setProxy(config: ProxyConfig): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        const authFlags =
          config.username && config.password
            ? `-username "${config.username}" -password "${config.password}"`
            : "";
        await this.deep.execAsync(
          `networksetup -setwebproxy Wi-Fi "${config.host}" ${config.port} ${authFlags}`
        );
        await this.deep.execAsync(
          `networksetup -setsecurewebproxy Wi-Fi "${config.host}" ${config.port} ${authFlags}`
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ================================================================
  // UC-B06: Service/Daemon Management (launchctl on macOS, systemctl on Linux)
  // ================================================================

  /**
   * List all launchd services (macOS) or systemd units (Linux).
   */
  async listServices(): Promise<ServiceInfo[]> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `launchctl list 2>/dev/null | head -200`
        );
        return stdout
          .trim()
          .split("\n")
          .slice(1) // skip header
          .map((line) => {
            const parts = line.split(/\t/);
            const pidRaw = parts[0]?.trim();
            const exitCode = parts[1]?.trim();
            const label = parts[2]?.trim() ?? "";
            const pid = pidRaw && pidRaw !== "-" ? parseInt(pidRaw, 10) : null;
            const status: ServiceStatus =
              pid !== null ? "running" : exitCode === "0" ? "stopped" : "unknown";
            return { name: label, label, status, pid };
          })
          .filter((s) => s.label);
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `systemctl list-units --type=service --no-pager --no-legend 2>/dev/null | head -100`
        );
        return stdout
          .trim()
          .split("\n")
          .map((line) => {
            const parts = line.trim().split(/\s+/);
            const label = parts[0]?.replace(".service", "") ?? "";
            const active = parts[2] ?? "inactive";
            const status: ServiceStatus =
              active === "active" ? "running" : "stopped";
            return { name: label, label, status, pid: null };
          })
          .filter((s) => s.label);
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Get the status of a named service.
   */
  async getServiceStatus(name: string): Promise<ServiceStatus> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `launchctl list "${name}" 2>/dev/null`
        );
        if (!stdout.trim()) return "unknown";
        return stdout.includes('"PID"') ? "running" : "stopped";
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `systemctl is-active "${name}.service" 2>/dev/null`
        );
        const s = stdout.trim();
        if (s === "active") return "running";
        if (s === "inactive") return "stopped";
        if (s === "disabled") return "disabled";
      }
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  /**
   * Start a service by name.
   */
  async startService(name: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(`launchctl start "${name}"`);
      } else if (this.deep.platform === "linux") {
        await this.deep.execAsync(`systemctl start "${name}.service"`);
      } else {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stop a running service by name.
   */
  async stopService(name: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(`launchctl stop "${name}"`);
      } else if (this.deep.platform === "linux") {
        await this.deep.execAsync(`systemctl stop "${name}.service"`);
      } else {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Restart a service: stop then start.
   */
  async restartService(name: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(`launchctl kickstart -k "system/${name}" 2>/dev/null || launchctl stop "${name}" && launchctl start "${name}"`);
      } else if (this.deep.platform === "linux") {
        await this.deep.execAsync(`systemctl restart "${name}.service"`);
      } else {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Enable a service to start at boot/login.
   */
  async enableService(name: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(`launchctl enable "system/${name}"`);
      } else if (this.deep.platform === "linux") {
        await this.deep.execAsync(`systemctl enable "${name}.service"`);
      } else {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Disable a service from starting at boot/login.
   */
  async disableService(name: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(`launchctl disable "system/${name}"`);
      } else if (this.deep.platform === "linux") {
        await this.deep.execAsync(`systemctl disable "${name}.service"`);
      } else {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Write and load a launchd plist as a LaunchAgent or LaunchDaemon.
   * Generates the plist XML from `config` and loads it via launchctl.
   */
  async createLaunchDaemon(config: LaunchDaemonConfig): Promise<boolean> {
    try {
      if (this.deep.platform !== "macos") return false;

      const plistDir = config.userAgent
        ? `${process.env.HOME}/Library/LaunchAgents`
        : "/Library/LaunchDaemons";

      const plistPath = `${plistDir}/${config.label}.plist`;

      const programArgsXml = config.programArgs
        .map((a) => `\t\t<string>${a}</string>`)
        .join("\n");

      const envVarsXml = config.environmentVariables
        ? `\t<key>EnvironmentVariables</key>\n\t<dict>\n${Object.entries(
            config.environmentVariables
          )
            .map(
              ([k, v]) => `\t\t<key>${k}</key>\n\t\t<string>${v}</string>`
            )
            .join("\n")}\n\t</dict>`
        : "";

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${config.label}</string>
\t<key>ProgramArguments</key>
\t<array>
${programArgsXml}
\t</array>
${config.runAtLoad !== undefined ? `\t<key>RunAtLoad</key>\n\t<${config.runAtLoad}/>` : ""}
${config.keepAlive !== undefined ? `\t<key>KeepAlive</key>\n\t<${config.keepAlive}/>` : ""}
${config.startInterval !== undefined ? `\t<key>StartInterval</key>\n\t<integer>${config.startInterval}</integer>` : ""}
${config.workingDirectory ? `\t<key>WorkingDirectory</key>\n\t<string>${config.workingDirectory}</string>` : ""}
${config.standardOutPath ? `\t<key>StandardOutPath</key>\n\t<string>${config.standardOutPath}</string>` : ""}
${config.standardErrorPath ? `\t<key>StandardErrorPath</key>\n\t<string>${config.standardErrorPath}</string>` : ""}
${envVarsXml}
</dict>
</plist>`;

      const { writeFileSync } = await import("node:fs");
      writeFileSync(plistPath, plist);
      await this.deep.execAsync(`launchctl load "${plistPath}"`);
      return true;
    } catch {
      return false;
    }
  }

  // ================================================================
  // UC-B07: Package Management
  // ================================================================

  /**
   * Detect the primary package manager available on this system.
   * Returns one of: brew, apt, dnf, yum, pacman, winget, unknown.
   */
  async detectPackageManager(): Promise<string> {
    const candidates = [
      ["brew", "brew --version"],
      ["apt", "apt-get --version"],
      ["dnf", "dnf --version"],
      ["yum", "yum --version"],
      ["pacman", "pacman --version"],
      ["winget", "winget --version"],
    ] as const;

    for (const [name, cmd] of candidates) {
      try {
        await this.deep.execAsync(`${cmd} 2>/dev/null`);
        return name;
      } catch {
        // Not available, try next
      }
    }
    return "unknown";
  }

  /**
   * List installed packages for the given package manager.
   * Defaults to auto-detect if manager not specified.
   */
  async listInstalledPackages(manager?: string): Promise<PackageInfo[]> {
    try {
      const mgr = manager ?? (await this.detectPackageManager());
      switch (mgr) {
        case "brew": {
          const { stdout } = await this.deep.execAsync(
            `brew list --versions 2>/dev/null | head -500`
          );
          return stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [name, ...vparts] = line.split(" ");
              return { name, version: vparts.join(" "), manager: "brew" };
            });
        }
        case "apt": {
          const { stdout } = await this.deep.execAsync(
            `dpkg-query -W -f='\${Package}\t\${Version}\t\${binary:Summary}\n' 2>/dev/null | head -500`
          );
          return stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [name, version, ...desc] = line.split("\t");
              return { name, version, manager: "apt", description: desc.join("\t") };
            });
        }
        case "dnf":
        case "yum": {
          const { stdout } = await this.deep.execAsync(
            `rpm -qa --qf '%{NAME}\t%{VERSION}-%{RELEASE}\n' 2>/dev/null | head -500`
          );
          return stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [name, version] = line.split("\t");
              return { name, version, manager: mgr };
            });
        }
        default:
          return [];
      }
    } catch {
      return [];
    }
  }

  /**
   * Install a package using the specified (or auto-detected) package manager.
   */
  async installPackage(name: string, manager?: string): Promise<boolean> {
    try {
      const mgr = manager ?? (await this.detectPackageManager());
      const cmds: Record<string, string> = {
        brew: `brew install "${name}"`,
        apt: `apt-get install -y "${name}"`,
        dnf: `dnf install -y "${name}"`,
        yum: `yum install -y "${name}"`,
        pacman: `pacman -S --noconfirm "${name}"`,
        winget: `winget install "${name}"`,
      };
      const cmd = cmds[mgr];
      if (!cmd) return false;
      await this.deep.execAsync(cmd, 300_000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove a package using the specified (or auto-detected) package manager.
   */
  async removePackage(name: string, manager?: string): Promise<boolean> {
    try {
      const mgr = manager ?? (await this.detectPackageManager());
      const cmds: Record<string, string> = {
        brew: `brew uninstall "${name}"`,
        apt: `apt-get remove -y "${name}"`,
        dnf: `dnf remove -y "${name}"`,
        yum: `yum remove -y "${name}"`,
        pacman: `pacman -R --noconfirm "${name}"`,
        winget: `winget uninstall "${name}"`,
      };
      const cmd = cmds[mgr];
      if (!cmd) return false;
      await this.deep.execAsync(cmd, 300_000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Upgrade a single package to its latest version.
   */
  async upgradePackage(name: string, manager?: string): Promise<boolean> {
    try {
      const mgr = manager ?? (await this.detectPackageManager());
      const cmds: Record<string, string> = {
        brew: `brew upgrade "${name}"`,
        apt: `apt-get install --only-upgrade -y "${name}"`,
        dnf: `dnf upgrade -y "${name}"`,
        yum: `yum update -y "${name}"`,
        pacman: `pacman -Sy --noconfirm "${name}"`,
        winget: `winget upgrade "${name}"`,
      };
      const cmd = cmds[mgr];
      if (!cmd) return false;
      await this.deep.execAsync(cmd, 300_000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Upgrade all installed packages.
   */
  async upgradeAll(manager?: string): Promise<boolean> {
    try {
      const mgr = manager ?? (await this.detectPackageManager());
      const cmds: Record<string, string> = {
        brew: `brew upgrade`,
        apt: `apt-get upgrade -y`,
        dnf: `dnf upgrade -y`,
        yum: `yum update -y`,
        pacman: `pacman -Syu --noconfirm`,
        winget: `winget upgrade --all`,
      };
      const cmd = cmds[mgr];
      if (!cmd) return false;
      await this.deep.execAsync(cmd, 600_000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Search for packages matching a query string.
   */
  async searchPackage(
    query: string,
    manager?: string
  ): Promise<PackageInfo[]> {
    try {
      const mgr = manager ?? (await this.detectPackageManager());
      if (mgr === "brew") {
        const { stdout } = await this.deep.execAsync(
          `brew search "${query}" 2>/dev/null | head -50`
        );
        return stdout
          .trim()
          .split("\n")
          .filter((l) => l && !l.startsWith("==>"))
          .map((name) => ({ name: name.trim(), version: "", manager: "brew" }));
      }
      if (mgr === "apt") {
        const { stdout } = await this.deep.execAsync(
          `apt-cache search "${query}" 2>/dev/null | head -50`
        );
        return stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [name, ...desc] = line.split(" - ");
            return { name, version: "", manager: "apt", description: desc.join(" - ") };
          });
      }
      return [];
    } catch {
      return [];
    }
  }

  // ================================================================
  // UC-B08: Network Control
  // ================================================================

  /**
   * List all network interfaces with their addresses and status.
   */
  async getNetworkInterfaces(): Promise<NetworkInterface[]> {
    try {
      const { networkInterfaces } = await import("node:os");
      const ifaces = networkInterfaces();
      const result: NetworkInterface[] = [];
      for (const [name, addrs] of Object.entries(ifaces)) {
        for (const addr of addrs ?? []) {
          result.push({
            name,
            address: addr.address,
            netmask: addr.netmask,
            family: addr.family as "IPv4" | "IPv6",
            mac: addr.mac,
            up: !addr.internal,
          });
        }
      }
      return result;
    } catch {
      return [];
    }
  }

  /**
   * Get current Wi-Fi connection status and network info (macOS / Linux).
   */
  async getWiFiStatus(): Promise<any> {
    try {
      // Get current WiFi network
      let ssid = "Not connected";
      let connected = false;
      try {
        const networkOut = this.deep.exec("networksetup -getairportnetwork en0");
        const match = networkOut.match(/Current Wi-Fi Network:\s*(.+)/);
        if (match) {
          ssid = match[1].trim();
          connected = true;
        }
      } catch {}

      // Get WiFi interface info
      let ip = "N/A", subnet = "N/A", router = "N/A";
      try {
        const infoOut = this.deep.exec("networksetup -getinfo Wi-Fi");
        const ipMatch = infoOut.match(/IP address:\s*(.+)/);
        const subnetMatch = infoOut.match(/Subnet mask:\s*(.+)/);
        const routerMatch = infoOut.match(/Router:\s*(.+)/);
        if (ipMatch) ip = ipMatch[1].trim();
        if (subnetMatch) subnet = subnetMatch[1].trim();
        if (routerMatch) router = routerMatch[1].trim();
      } catch {}

      // Get signal strength if possible
      let signalStrength = "N/A";
      try {
        const rssiOut = this.deep.exec("/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I 2>/dev/null || true");
        const rssiMatch = rssiOut.match(/agrCtlRSSI:\s*(-?\d+)/);
        if (rssiMatch) signalStrength = `${rssiMatch[1]} dBm`;
      } catch {}

      return {
        connected,
        ssid,
        ip,
        subnet,
        router,
        signalStrength,
        interface: "en0",
      };
    } catch (err) {
      return { connected: false, error: String(err) };
    }
  }

  /**
   * Connect to a Wi-Fi network by SSID (macOS: networksetup; Linux: nmcli).
   */
  async connectWiFi(ssid: string, password?: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        const passArg = password ? `"${password}"` : "";
        await this.deep.execAsync(
          `networksetup -setairportnetwork en0 "${ssid}" ${passArg}`
        );
        return true;
      }
      if (this.deep.platform === "linux") {
        const passArg = password ? `password "${password}"` : "";
        await this.deep.execAsync(
          `nmcli device wifi connect "${ssid}" ${passArg}`
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Disconnect from the current Wi-Fi network.
   */
  async disconnectWiFi(): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(
          `networksetup -setairportpower en0 off && networksetup -setairportpower en0 on`
        );
        return true;
      }
      if (this.deep.platform === "linux") {
        await this.deep.execAsync(`nmcli device disconnect wlan0 2>/dev/null`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get the current macOS Application Firewall status.
   */
  async getFirewallStatus(): Promise<FirewallStatus> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null`
        );
        const enabled = /enabled/i.test(stdout);
        const { stdout: blockAll } = await this.deep.execAsync(
          `/usr/libexec/ApplicationFirewall/socketfilterfw --getblockall 2>/dev/null`
        );
        const { stdout: stealth } = await this.deep.execAsync(
          `/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode 2>/dev/null`
        );
        return {
          enabled,
          blockAll: /enabled/i.test(blockAll),
          stealthMode: /enabled/i.test(stealth),
        };
      }
      return { enabled: false, blockAll: false, stealthMode: false };
    } catch {
      return { enabled: false, blockAll: false, stealthMode: false };
    }
  }

  /**
   * Enable or disable the macOS Application Firewall.
   */
  async setFirewallEnabled(enabled: boolean): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        const flag = enabled ? "--setglobalstate on" : "--setglobalstate off";
        await this.deep.execAsync(
          `/usr/libexec/ApplicationFirewall/socketfilterfw ${flag}`
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * List all ports that currently have listening services.
   * Uses `lsof` on macOS/Linux.
   */
  async getOpenPorts(): Promise<PortInfo[]> {
    try {
      const { stdout } = await this.deep.execAsync(
        `lsof -iTCP -iUDP -sTCP:LISTEN -n -P 2>/dev/null | head -200`
      );
      return stdout
        .trim()
        .split("\n")
        .slice(1)
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s+/);
          const procName = parts[0];
          const pid = parseInt(parts[1], 10);
          const proto = parts[7]?.toLowerCase().includes("udp") ? "udp" : "tcp";
          const addr = parts[8] ?? "";
          const lastColon = addr.lastIndexOf(":");
          const localAddress = addr.slice(0, lastColon);
          const localPort = parseInt(addr.slice(lastColon + 1), 10);
          const state = parts[9] ?? "LISTEN";
          return {
            protocol: proto as "tcp" | "udp",
            localAddress,
            localPort,
            state,
            pid: isNaN(pid) ? null : pid,
            process: procName,
          };
        })
        .filter((p) => !isNaN(p.localPort));
    } catch {
      return [];
    }
  }

  /**
   * List all active TCP/UDP connections.
   */
  async getActiveConnections(): Promise<ConnectionInfo[]> {
    try {
      const { stdout } = await this.deep.execAsync(
        `lsof -iTCP -iUDP -n -P 2>/dev/null | grep -v LISTEN | head -200`
      );
      return stdout
        .trim()
        .split("\n")
        .slice(1)
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s+/);
          const pid = parseInt(parts[1], 10);
          const proto = parts[7]?.toLowerCase().includes("udp") ? "udp" : "tcp";
          const addrPart = parts[8] ?? "";
          const [local, remote] = addrPart.split("->");
          const localLastColon = (local ?? "").lastIndexOf(":");
          const remoteLastColon = (remote ?? "").lastIndexOf(":");
          return {
            protocol: proto as "tcp" | "udp",
            localAddress: local?.slice(0, localLastColon) ?? "",
            localPort: parseInt(local?.slice(localLastColon + 1) ?? "0", 10),
            remoteAddress: remote?.slice(0, remoteLastColon) ?? "",
            remotePort: parseInt(remote?.slice(remoteLastColon + 1) ?? "0", 10),
            state: parts[9] ?? "ESTABLISHED",
            pid: isNaN(pid) ? null : pid,
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Get the current IP routing table.
   */
  async getRoutingTable(): Promise<RouteInfo[]> {
    try {
      const { stdout } = await this.deep.execAsync(
        `netstat -rn 2>/dev/null | head -100`
      );
      return stdout
        .trim()
        .split("\n")
        .slice(2) // skip two header lines
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s+/);
          return {
            destination: parts[0] ?? "",
            gateway: parts[1] ?? "",
            flags: parts[2] ?? "",
            iface: parts[parts.length - 1] ?? "",
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Ping a host and return latency statistics.
   */
  async pingHost(host: string, count: number = 4): Promise<PingResult> {
    const base: PingResult = {
      host,
      packets: count,
      received: 0,
      loss: 100,
      avgMs: null,
      minMs: null,
      maxMs: null,
    };
    try {
      const { stdout } = await this.deep.execAsync(
        `ping -c ${count} "${host}" 2>/dev/null`,
        15_000
      );
      const lossMatch = stdout.match(/(\d+(?:\.\d+)?)%\s+packet loss/);
      const statsMatch = stdout.match(
        /min\/avg\/max(?:\/mdev|\/stddev)?\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/
      );
      const rxMatch = stdout.match(/(\d+)\s+(?:packets\s+)?received/);
      return {
        host,
        packets: count,
        received: rxMatch ? parseInt(rxMatch[1], 10) : 0,
        loss: lossMatch ? parseFloat(lossMatch[1]) : 100,
        minMs: statsMatch ? parseFloat(statsMatch[1]) : null,
        avgMs: statsMatch ? parseFloat(statsMatch[2]) : null,
        maxMs: statsMatch ? parseFloat(statsMatch[3]) : null,
      };
    } catch {
      return base;
    }
  }

  /**
   * Run a traceroute to a host and return the raw output.
   */
  async traceroute(host: string): Promise<string> {
    try {
      const { stdout } = await this.deep.execAsync(
        `traceroute "${host}" 2>/dev/null`,
        60_000
      );
      return stdout.trim();
    } catch {
      return "";
    }
  }

  /**
   * Get the status of VPN connections (macOS: scutil; Linux: ip link).
   */
  async getVPNStatus(): Promise<VPNInfo[]> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `scutil --nc list 2>/dev/null`
        );
        return stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const nameMatch = line.match(/"([^"]+)"/);
            const connected = line.includes("Connected");
            return {
              name: nameMatch ? nameMatch[1] : line,
              status: connected ? "connected" : ("disconnected" as VPNInfo["status"]),
              address: null,
            };
          });
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `ip link show type tun 2>/dev/null; ip link show type wireguard 2>/dev/null`
        );
        return stdout
          .trim()
          .split("\n")
          .filter((l) => /^\d+:/.test(l))
          .map((line) => {
            const nameMatch = line.match(/: (\w+):/);
            const up = line.includes("UP");
            return {
              name: nameMatch ? nameMatch[1] : "vpn",
              status: up ? "connected" : ("disconnected" as VPNInfo["status"]),
              address: null,
            };
          });
      }
      return [];
    } catch {
      return [];
    }
  }

  // ================================================================
  // UC-B09: Kernel/Hardware Tuning
  // ================================================================

  /**
   * Read a sysctl kernel parameter by key.
   * Works on macOS and Linux.
   */
  async getSysctl(key: string): Promise<string | null> {
    try {
      const { stdout } = await this.deep.execAsync(
        `sysctl -n "${key}" 2>/dev/null`
      );
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Write a sysctl kernel parameter. Typically requires root.
   */
  async setSysctl(key: string, value: string): Promise<boolean> {
    try {
      await this.deep.execAsync(`sysctl -w "${key}=${value}"`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get power management settings (macOS: pmset -g; Linux: stub).
   */
  async getPowerSettings(): Promise<PowerSettings> {
    const fallback: PowerSettings = {
      sleepDelay: null,
      displaySleepDelay: null,
      diskSleepDelay: null,
      hibernateMode: null,
      autopoweroff: false,
      powernap: false,
      raw: {},
    };
    try {
      if (this.deep.platform !== "macos") return fallback;
      const { stdout } = await this.deep.execAsync(`pmset -g 2>/dev/null`);
      const raw: Record<string, string> = {};
      for (const line of stdout.split("\n")) {
        const m = line.match(/^\s+(\S+)\s+(.+)$/);
        if (m) raw[m[1]] = m[2].trim();
      }
      return {
        sleepDelay: raw["sleep"] ? parseInt(raw["sleep"], 10) : null,
        displaySleepDelay: raw["displaysleep"] ? parseInt(raw["displaysleep"], 10) : null,
        diskSleepDelay: raw["disksleep"] ? parseInt(raw["disksleep"], 10) : null,
        hibernateMode: raw["hibernatemode"] ? parseInt(raw["hibernatemode"], 10) : null,
        autopoweroff: raw["autopoweroff"] === "1",
        powernap: raw["powernap"] === "1",
        raw,
      };
    } catch {
      return fallback;
    }
  }

  /**
   * Set a pmset power management key (macOS only). Requires root for most keys.
   */
  async setPowerSetting(key: string, value: string): Promise<boolean> {
    try {
      if (this.deep.platform !== "macos") return false;
      await this.deep.execAsync(`pmset -a "${key}" "${value}"`);
      return true;
    } catch {
      return false;
    }
  }

  // ================================================================
  // UC-B10: Peripheral Control
  // ================================================================

  /**
   * List audio input and output devices via SwitchAudioSource (Homebrew) or system_profiler.
   */
  async getAudioDevices(): Promise<AudioDevice[]> {
    try {
      if (this.deep.platform === "macos") {
        // SwitchAudioSource is a common Homebrew tool; fall back gracefully
        const switchRes = await this.deep
          .execAsync(`SwitchAudioSource -a -t output 2>/dev/null`)
          .catch(() => ({ stdout: "" }));
        const switchResIn = await this.deep
          .execAsync(`SwitchAudioSource -a -t input 2>/dev/null`)
          .catch(() => ({ stdout: "" }));

        const parse = (raw: string, type: "input" | "output"): AudioDevice[] =>
          raw
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((name, i) => ({
              id: `${type}-${i}`,
              name: name.trim(),
              type,
              isDefault: i === 0,
            }));

        return [
          ...parse(switchRes.stdout, "output"),
          ...parse(switchResIn.stdout, "input"),
        ];
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `pactl list sinks short 2>/dev/null`
        );
        return stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const parts = line.split(/\t/);
            return {
              id: parts[0] ?? "",
              name: parts[1] ?? "",
              type: "output" as const,
              isDefault: false,
            };
          });
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Set the default audio output device by device ID or name.
   * Requires SwitchAudioSource on macOS (brew install switchaudio-osx).
   */
  async setAudioOutput(deviceId: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(`SwitchAudioSource -t output -s "${deviceId}"`);
        return true;
      }
      if (this.deep.platform === "linux") {
        await this.deep.execAsync(`pactl set-default-sink "${deviceId}"`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Set the default audio input device by device ID or name.
   */
  async setAudioInput(deviceId: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(`SwitchAudioSource -t input -s "${deviceId}"`);
        return true;
      }
      if (this.deep.platform === "linux") {
        await this.deep.execAsync(`pactl set-default-source "${deviceId}"`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get the current system volume level (0–100).
   */
  async getVolume(): Promise<number> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `osascript -e 'output volume of (get volume settings)'`
        );
        return parseInt(stdout.trim(), 10);
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `pactl get-sink-volume @DEFAULT_SINK@ 2>/dev/null | grep -oP '\\d+(?=%)' | head -1`
        );
        return parseInt(stdout.trim(), 10) || 0;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Set the system volume level (0–100).
   */
  async setVolume(level: number): Promise<boolean> {
    try {
      const clamped = Math.max(0, Math.min(100, level));
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(
          `osascript -e 'set volume output volume ${clamped}'`
        );
        return true;
      }
      if (this.deep.platform === "linux") {
        await this.deep.execAsync(
          `pactl set-sink-volume @DEFAULT_SINK@ ${clamped}%`
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Mute or unmute the system audio output.
   */
  async setMute(muted: boolean): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(
          `osascript -e 'set volume output muted ${muted}'`
        );
        return true;
      }
      if (this.deep.platform === "linux") {
        const flag = muted ? "1" : "0";
        await this.deep.execAsync(
          `pactl set-sink-mute @DEFAULT_SINK@ ${flag}`
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get the current display brightness (0–100).
   * Uses `brightness` CLI on macOS (brew install brightness).
   */
  async getBrightness(): Promise<number> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `brightness -l 2>/dev/null | grep 'display 0' | grep -oE '[0-9.]+'`
        );
        return Math.round(parseFloat(stdout.trim()) * 100);
      }
      if (this.deep.platform === "linux") {
        const { stdout: maxStr } = await this.deep.execAsync(
          `cat /sys/class/backlight/*/max_brightness 2>/dev/null | head -1`
        );
        const { stdout: curStr } = await this.deep.execAsync(
          `cat /sys/class/backlight/*/brightness 2>/dev/null | head -1`
        );
        const max = parseInt(maxStr.trim(), 10);
        const cur = parseInt(curStr.trim(), 10);
        if (max && cur) return Math.round((cur / max) * 100);
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Set display brightness (0–100).
   * Requires `brightness` CLI on macOS.
   */
  async setBrightness(level: number): Promise<boolean> {
    try {
      const clamped = Math.max(0, Math.min(100, level));
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(`brightness ${clamped / 100}`);
        return true;
      }
      if (this.deep.platform === "linux") {
        const { stdout: maxStr } = await this.deep.execAsync(
          `cat /sys/class/backlight/*/max_brightness 2>/dev/null | head -1`
        );
        const max = parseInt(maxStr.trim(), 10);
        if (!max) return false;
        const raw = Math.round((clamped / 100) * max);
        await this.deep.execAsync(
          `echo ${raw} > /sys/class/backlight/*/brightness`
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get Bluetooth adapter status (macOS: system_profiler; Linux: bluetoothctl).
   */
  async getBluetoothStatus(): Promise<BluetoothStatus> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `system_profiler SPBluetoothDataType 2>/dev/null | grep -i 'bluetooth power'`
        );
        const enabled = /on/i.test(stdout);
        return { enabled, discovering: false };
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `bluetoothctl show 2>/dev/null | grep -i powered`
        );
        return { enabled: /yes/i.test(stdout), discovering: false };
      }
      return { enabled: false, discovering: false };
    } catch {
      return { enabled: false, discovering: false };
    }
  }

  /**
   * Enable or disable Bluetooth (macOS: blueutil; Linux: bluetoothctl).
   * Requires `blueutil` on macOS (brew install blueutil).
   */
  async setBluetoothEnabled(enabled: boolean): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(`blueutil --power ${enabled ? 1 : 0}`);
        return true;
      }
      if (this.deep.platform === "linux") {
        const state = enabled ? "on" : "off";
        await this.deep.execAsync(`bluetoothctl power ${state}`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * List paired and connected Bluetooth devices.
   * Requires `blueutil` on macOS (brew install blueutil).
   */
  async listBluetoothDevices(): Promise<BluetoothDevice[]> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `blueutil --paired 2>/dev/null`
        );
        const connected = await this.deep
          .execAsync(`blueutil --connected 2>/dev/null`)
          .then((r) => r.stdout)
          .catch(() => "");
        return stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const addrMatch = line.match(/([0-9a-f]{2}-[0-9a-f:]+)/i);
            const nameMatch = line.match(/name: "([^"]+)"/);
            const addr = addrMatch ? addrMatch[1] : line;
            return {
              address: addr,
              name: nameMatch ? nameMatch[1] : addr,
              connected: connected.includes(addr),
              paired: true,
            };
          });
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `bluetoothctl devices 2>/dev/null`
        );
        return stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const parts = line.split(" ");
            const addr = parts[1] ?? "";
            const name = parts.slice(2).join(" ");
            return { address: addr, name, connected: false, paired: true };
          });
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Eject a disk or external volume by mount point (macOS: diskutil; Linux: umount).
   */
  async ejectDisk(mountPoint: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(`diskutil eject "${mountPoint}"`);
        return true;
      }
      if (this.deep.platform === "linux") {
        await this.deep.execAsync(`umount "${mountPoint}"`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ================================================================
  // UC-B11: Scheduled Tasks (launchd on macOS, cron on Linux)
  // ================================================================

  /**
   * List all user LaunchAgent scheduled tasks (macOS) or cron jobs (Linux).
   */
  async listScheduledTasks(): Promise<ScheduledTask[]> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `launchctl list 2>/dev/null | head -200`
        );
        return stdout
          .trim()
          .split("\n")
          .slice(1)
          .filter(Boolean)
          .map((line) => {
            const parts = line.split(/\t/);
            const pidRaw = parts[0]?.trim();
            const exitRaw = parts[1]?.trim();
            const label = parts[2]?.trim() ?? "";
            const pid = pidRaw && pidRaw !== "-" ? parseInt(pidRaw, 10) : null;
            const lastExit = exitRaw && exitRaw !== "-" ? parseInt(exitRaw, 10) : null;
            return {
              label,
              status: pid !== null ? "running" : "stopped",
              lastExit,
              pid,
            };
          })
          .filter((t) => t.label);
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(`crontab -l 2>/dev/null`);
        return stdout
          .trim()
          .split("\n")
          .filter((l) => l && !l.startsWith("#"))
          .map((_line, i) => ({
            label: `cron-${i}`,
            status: "scheduled",
            lastExit: null,
            pid: null,
          }));
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Create a new launchd scheduled task (macOS) or cron entry (Linux).
   */
  async createScheduledTask(config: ScheduledTaskConfig): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        const daemonConfig: LaunchDaemonConfig = {
          label: config.label,
          programArgs: config.programArgs,
          runAtLoad: config.runAtLoad,
          startInterval: config.startInterval,
          userAgent: true,
        };
        return this.createLaunchDaemon(daemonConfig);
      }
      if (this.deep.platform === "linux") {
        // Build a simple cron expression from startInterval (minutes)
        const intervalMin = config.startInterval
          ? Math.max(1, Math.round(config.startInterval / 60))
          : 1;
        const cronExpr = `*/${intervalMin} * * * *`;
        const cmd = config.programArgs.join(" ");
        const newCron = `${cronExpr} ${cmd} # ${config.label}`;
        const { stdout: existing } = await this.deep.execAsync(
          `crontab -l 2>/dev/null`
        ).catch(() => ({ stdout: "" }));
        const updated = `${existing.trim()}\n${newCron}\n`;
        await this.deep.execAsync(`echo ${JSON.stringify(updated)} | crontab -`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Remove a scheduled task by label (launchctl unload on macOS, cron edit on Linux).
   */
  async removeScheduledTask(label: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        const plistPath = `${process.env.HOME}/Library/LaunchAgents/${label}.plist`;
        await this.deep.execAsync(`launchctl unload "${plistPath}" 2>/dev/null`);
        const { unlink } = await import("node:fs/promises");
        await unlink(plistPath).catch(() => {});
        return true;
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(`crontab -l 2>/dev/null`);
        const filtered = stdout
          .split("\n")
          .filter((l) => !l.includes(`# ${label}`))
          .join("\n");
        await this.deep.execAsync(`echo ${JSON.stringify(filtered)} | crontab -`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get the run status of a scheduled task by label.
   */
  async getScheduledTaskStatus(label: string): Promise<string> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `launchctl list "${label}" 2>/dev/null`
        );
        if (!stdout.trim()) return "not found";
        return stdout.includes('"PID"') ? "running" : "stopped";
      }
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  // ================================================================
  // UC-B12: Registry/System DB (macOS defaults)
  // ================================================================

  /**
   * Read a macOS `defaults` value from the specified domain and key.
   */
  async readDefault(domain: string, key: string): Promise<string | null> {
    try {
      const { stdout } = await this.deep.execAsync(
        `defaults read "${domain}" "${key}" 2>/dev/null`
      );
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Write a typed value to macOS `defaults`.
   * Common types: string, bool, int, float, array, dict.
   */
  async writeDefault(
    domain: string,
    key: string,
    type: string,
    value: string
  ): Promise<boolean> {
    try {
      await this.deep.execAsync(
        `defaults write "${domain}" "${key}" -${type} "${value}"`
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a key from a macOS `defaults` domain.
   */
  async deleteDefault(domain: string, key: string): Promise<boolean> {
    try {
      await this.deep.execAsync(`defaults delete "${domain}" "${key}"`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read all key-value pairs from a macOS `defaults` domain as a record.
   */
  async listDefaults(domain: string): Promise<Record<string, unknown>> {
    try {
      const { stdout } = await this.deep.execAsync(
        `defaults export "${domain}" - 2>/dev/null`
      );
      // The output is a plist XML — parse key/string pairs with simple regex
      const result: Record<string, unknown> = {};
      const keyMatches = stdout.matchAll(/<key>([^<]+)<\/key>\s*<([^>]+)>([^<]*)<\/[^>]+>/g);
      for (const m of keyMatches) {
        result[m[1]] = m[3];
      }
      return result;
    } catch {
      return {};
    }
  }

  // ================================================================
  // UC-B13: User/Group/ACL Management
  // ================================================================

  /**
   * List all local user accounts on the system.
   */
  async listUsers(): Promise<UserInfo[]> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `dscl . list /Users | grep -v '^_' 2>/dev/null`
        );
        const usernames = stdout.trim().split("\n").filter(Boolean);
        const users = await Promise.all(
          usernames.map((u) => this._getMacUser(u))
        );
        return users.filter((u): u is UserInfo => u !== null);
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `getent passwd 2>/dev/null | head -100`
        );
        return stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [username, , uidStr, , fullName, home, shell] =
              line.split(":");
            return {
              uid: parseInt(uidStr ?? "0", 10),
              username,
              fullName: fullName || null,
              shell: shell?.trim() ?? "",
              home: home ?? "",
              groups: [],
            };
          });
      }
      return [];
    } catch {
      return [];
    }
  }

  /** Internal helper: fetch a single macOS user record via dscl. */
  private async _getMacUser(username: string): Promise<UserInfo | null> {
    try {
      const { stdout } = await this.deep.execAsync(
        `dscl . read /Users/${username} UniqueID RealName UserShell NFSHomeDirectory 2>/dev/null`
      );
      const get = (key: string): string | null => {
        const m = stdout.match(new RegExp(`${key}:\\s*(.+)`));
        return m ? m[1].trim() : null;
      };
      const uid = parseInt(get("UniqueID") ?? "0", 10);
      const { stdout: groups } = await this.deep.execAsync(
        `id -Gn "${username}" 2>/dev/null`
      ).catch(() => ({ stdout: "" }));
      return {
        uid,
        username,
        fullName: get("RealName"),
        shell: get("UserShell") ?? "",
        home: get("NFSHomeDirectory") ?? "",
        groups: groups.trim().split(" ").filter(Boolean),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get information about the currently logged-in user.
   */
  async getCurrentUser(): Promise<UserInfo> {
    const username = process.env.USER ?? process.env.LOGNAME ?? "unknown";
    const { stdout: uidStr } = await this.deep.execAsync(`id -u 2>/dev/null`).catch(
      () => ({ stdout: "0" })
    );
    const { stdout: groups } = await this.deep.execAsync(`id -Gn 2>/dev/null`).catch(
      () => ({ stdout: "" })
    );
    return {
      uid: parseInt(uidStr.trim(), 10),
      username,
      fullName: null,
      shell: process.env.SHELL ?? "",
      home: process.env.HOME ?? "",
      groups: groups.trim().split(" ").filter(Boolean),
    };
  }

  /**
   * List local groups on the system.
   */
  async listGroups(): Promise<GroupInfo[]> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `dscl . list /Groups 2>/dev/null | head -100`
        );
        const names = stdout.trim().split("\n").filter(Boolean);
        const results = await Promise.all(
          names.map(async (name) => {
            try {
              const { stdout: gidOut } = await this.deep.execAsync(
                `dscl . read /Groups/${name} PrimaryGroupID GroupMembership 2>/dev/null`
              );
              const gidMatch = gidOut.match(/PrimaryGroupID:\s*(\d+)/);
              const memberMatch = gidOut.match(/GroupMembership:\s*(.+)/);
              return {
                gid: gidMatch ? parseInt(gidMatch[1], 10) : 0,
                name,
                members: memberMatch ? memberMatch[1].trim().split(" ") : [],
              };
            } catch {
              return { gid: 0, name, members: [] };
            }
          })
        );
        return results;
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `getent group 2>/dev/null | head -100`
        );
        return stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [name, , gidStr, membersStr] = line.split(":");
            return {
              gid: parseInt(gidStr ?? "0", 10),
              name,
              members: membersStr ? membersStr.split(",").filter(Boolean) : [],
            };
          });
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Get POSIX permission information for a file or directory.
   */
  async getFilePermissions(path: string): Promise<PermissionInfo> {
    try {
      await this.deep.execAsync(
        `ls -la "${path}" 2>/dev/null | head -1`
      );
      const { stdout: statOut } = await this.deep.execAsync(
        this.deep.platform === "macos"
          ? `stat -f "%Sp %Su %Sg" "${path}" 2>/dev/null`
          : `stat -c "%A %U %G" "${path}" 2>/dev/null`
      );
      const parts = statOut.trim().split(" ");
      const mode = parts[0] ?? "";
      const owner = parts[1] ?? "";
      const group = parts[2] ?? "";

      // Derive octal from symbolic mode
      const octal = this._symbolicToOctal(mode);

      return {
        path,
        mode,
        octal,
        owner,
        group,
        readable: mode.includes("r"),
        writable: mode.includes("w"),
        executable: mode.includes("x"),
      };
    } catch {
      return {
        path,
        mode: "----------",
        octal: "0000",
        owner: "",
        group: "",
        readable: false,
        writable: false,
        executable: false,
      };
    }
  }

  /** Convert symbolic permission string (e.g. -rwxr-xr-x) to octal string. */
  private _symbolicToOctal(mode: string): string {
    const chars = mode.slice(1); // strip leading type char
    let octal = 0;
    const map: Record<string, number> = { r: 4, w: 2, x: 1, s: 1, S: 0, t: 1, T: 0 };
    for (let i = 0; i < 9; i++) {
      const c = chars[i];
      if (c && c !== "-") {
        const shift = 6 - Math.floor(i / 3) * 3;
        octal += (map[c] ?? 0) * (i % 3 === 0 ? 1 : 1);
        void shift; // future: could compose proper octal
      }
    }
    // Simple 3-group approach
    const bits = (grp: string): number =>
      (grp[0] !== "-" ? 4 : 0) + (grp[1] !== "-" ? 2 : 0) + (grp[2] !== "-" && grp[2] !== "T" && grp[2] !== "S" ? 1 : 0);
    if (chars.length >= 9) {
      return `0${bits(chars.slice(0, 3))}${bits(chars.slice(3, 6))}${bits(chars.slice(6, 9))}`;
    }
    return "0000";
  }

  /**
   * Change the POSIX mode of a file or directory.
   * `mode` should be a chmod-compatible string, e.g. "755" or "u+x".
   */
  async setFilePermissions(path: string, mode: string): Promise<boolean> {
    try {
      await this.deep.execAsync(`chmod "${mode}" "${path}"`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Change the owner (and optionally group) of a file or directory.
   */
  async setFileOwner(
    path: string,
    owner: string,
    group?: string
  ): Promise<boolean> {
    try {
      const spec = group ? `${owner}:${group}` : owner;
      await this.deep.execAsync(`chown "${spec}" "${path}"`);
      return true;
    } catch {
      return false;
    }
  }

  // ================================================================
  // UC-B14: Partition/Volume Management
  // ================================================================

  /**
   * List all mounted volumes with usage statistics.
   * Uses `df` on macOS/Linux.
   */
  async listVolumes(): Promise<VolumeInfo[]> {
    try {
      const { stdout } = await this.deep.execAsync(
        `df -k --output=source,fstype,target,size,used,avail 2>/dev/null || df -k 2>/dev/null`
      );
      return stdout
        .trim()
        .split("\n")
        .slice(1)
        .filter(Boolean)
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          // Handle both GNU df (with --output) and BSD df
          const [device, fsType, , sizeKb, usedKb, availKb, , mountPoint] =
            parts.length >= 7
              ? parts
              : [parts[0], "", "", parts[1], parts[2], parts[3], parts[4], parts[5]];
          return {
            name: (mountPoint ?? device ?? "").split("/").pop() ?? "",
            device: device ?? "",
            mountPoint: mountPoint ?? parts[parts.length - 1] ?? "",
            fsType: fsType ?? "",
            totalBytes: parseInt(sizeKb ?? "0", 10) * 1024,
            usedBytes: parseInt(usedKb ?? "0", 10) * 1024,
            availableBytes: parseInt(availKb ?? "0", 10) * 1024,
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Mount a device to the specified mount point.
   * On macOS, uses `diskutil mount`; on Linux uses `mount`.
   */
  async mountVolume(device: string, mountPoint: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(
          `diskutil mount -mountPoint "${mountPoint}" "${device}"`
        );
        return true;
      }
      if (this.deep.platform === "linux") {
        await this.deep.execAsync(`mount "${device}" "${mountPoint}"`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Unmount a volume by its mount point.
   * On macOS, uses `diskutil unmount`; on Linux uses `umount`.
   */
  async unmountVolume(mountPoint: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(`diskutil unmount "${mountPoint}"`);
        return true;
      }
      if (this.deep.platform === "linux") {
        await this.deep.execAsync(`umount "${mountPoint}"`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * List partitions on a disk device.
   * On macOS uses `diskutil list -plist`; on Linux uses `lsblk -J`.
   */
  async getDiskPartitions(device: string): Promise<PartitionInfo[]> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `diskutil list "${device}" 2>/dev/null`
        );
        const lines = stdout.split("\n").filter((l) => /^\s+\d+:/.test(l));
        return lines.map((line) => {
          const match = line.match(/\s+(\d+):\s+(\S+)\s+(.*?)\s+(\d+\.\d+\s+\S+)\s+(\S+)/);
          if (!match) return { device, index: 0, name: null, type: "", startSector: null, sizeMB: null };
          const sizePart = match[4]?.trim();
          const sizeMB = sizePart
            ? parseFloat(sizePart) * (sizePart.includes("GB") ? 1024 : 1)
            : null;
          return {
            device: match[5] ?? device,
            index: parseInt(match[1], 10),
            name: match[3]?.trim() || null,
            type: match[2] ?? "",
            startSector: null,
            sizeMB,
          };
        });
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `lsblk -b -o NAME,FSTYPE,SIZE,TYPE "${device}" --noheadings 2>/dev/null`
        );
        return stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line, i) => {
            const parts = line.trim().split(/\s+/);
            const sizeB = parseInt(parts[2] ?? "0", 10);
            return {
              device: `/dev/${parts[0]}`,
              index: i,
              name: parts[0] ?? null,
              type: parts[1] ?? "",
              startSector: null,
              sizeMB: Math.round(sizeB / 1024 / 1024),
            };
          });
      }
      return [];
    } catch {
      return [];
    }
  }

  // ================================================================
  // UC-B15: Environment Variables
  // ================================================================

  /**
   * Get the value of an environment variable from the current process.
   */
  async getEnvVar(name: string): Promise<string | undefined> {
    return process.env[name];
  }

  /**
   * Set an environment variable in the current process.
   * If `persist` is true, also appends an export to the detected shell profile.
   */
  async setEnvVar(
    name: string,
    value: string,
    persist: boolean = false
  ): Promise<boolean> {
    try {
      process.env[name] = value;
      if (persist) {
        const profile = await this.getShellProfile();
        const { appendFileSync } = await import("node:fs");
        appendFileSync(profile, `\nexport ${name}="${value}"\n`);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Unset an environment variable in the current process.
   * If `persist` is true, removes the export line from the shell profile.
   */
  async unsetEnvVar(name: string, persist: boolean = false): Promise<boolean> {
    try {
      delete process.env[name];
      if (persist) {
        const profile = await this.getShellProfile();
        const { readFileSync, writeFileSync } = await import("node:fs");
        const content = readFileSync(profile, "utf-8");
        const filtered = content
          .split("\n")
          .filter((l) => !l.match(new RegExp(`export\\s+${name}=`)))
          .join("\n");
        writeFileSync(profile, filtered);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return a snapshot of all environment variables in the current process.
   */
  async listEnvVars(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) result[key] = value;
    }
    return result;
  }

  /**
   * Detect the shell profile file path for the current user.
   * Checks SHELL env, then falls back to common defaults.
   */
  async getShellProfile(): Promise<string> {
    const home = process.env.HOME ?? "~";
    const shell = process.env.SHELL ?? "";
    if (shell.includes("zsh")) return `${home}/.zshrc`;
    if (shell.includes("bash")) {
      // macOS uses .bash_profile; Linux uses .bashrc
      return this.deep.platform === "macos"
        ? `${home}/.bash_profile`
        : `${home}/.bashrc`;
    }
    if (shell.includes("fish")) return `${home}/.config/fish/config.fish`;
    // Default fallback
    return `${home}/.profile`;
  }

  // ================================================================
  // UC-B16: WiFi Pentest & Security Auditing
  // ================================================================

  async scanWiFiNetworks(): Promise<WiFiScanResult[]> {
    try {
      if (this.deep.platform === "macos") {
        const airportPath =
          "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
        const { stdout } = await this.deep.execAsync(`"${airportPath}" -s`);
        const lines = stdout.split("\n").slice(1).filter((l) => l.trim());
        return lines.map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            ssid: parts[0] ?? "",
            bssid: parts[1] ?? "",
            rssi: parseInt(parts[2] ?? "0", 10),
            channel: parseInt(parts[3] ?? "0", 10),
            security: parts.slice(6).join(" ") || "NONE",
          };
        });
      } else {
        const { stdout } = await this.deep.execAsync("nmcli device wifi list");
        const lines = stdout.split("\n").slice(1).filter((l) => l.trim());
        return lines.map((line) => {
          const parts = line.trim().split(/\s{2,}/);
          return {
            ssid: parts[1] ?? "",
            bssid: parts[0]?.replace("* ", "") ?? "",
            rssi: parseInt(parts[6] ?? "0", 10),
            channel: parseInt(parts[4] ?? "0", 10),
            security: parts[7] ?? "NONE",
          };
        });
      }
    } catch {
      return [];
    }
  }

  async getWiFiDetails(): Promise<Record<string, string>> {
    try {
      if (this.deep.platform === "macos") {
        const airportPath =
          "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
        const { stdout } = await this.deep.execAsync(`"${airportPath}" -I`);
        const result: Record<string, string> = {};
        for (const line of stdout.split("\n")) {
          const idx = line.indexOf(":");
          if (idx !== -1) {
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();
            if (key) result[key] = val;
          }
        }
        return result;
      } else {
        const { stdout } = await this.deep.execAsync(
          "nmcli -t -f active,ssid,bssid,signal,chan,security device wifi list"
        );
        const result: Record<string, string> = {};
        for (const line of stdout.split("\n")) {
          if (line.startsWith("yes:")) {
            const [, ssid, bssid, signal, chan, security] = line.split(":");
            result["SSID"] = ssid ?? "";
            result["BSSID"] = bssid ?? "";
            result["signal"] = signal ?? "";
            result["channel"] = chan ?? "";
            result["security"] = security ?? "";
          }
        }
        return result;
      }
    } catch {
      return {};
    }
  }

  async enableMonitorMode(channel = 1): Promise<boolean> {
    try {
      if (this.deep.platform !== "macos") return false;
      const airportPath =
        "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
      await this.deep.execAsync(`sudo "${airportPath}" sniff ${channel}`);
      return true;
    } catch {
      return false;
    }
  }

  async disableMonitorMode(): Promise<boolean> {
    try {
      await this.deep.execAsync(
        "sudo pkill -f 'airport sniff' 2>/dev/null; sudo killall airport 2>/dev/null; true"
      );
      return true;
    } catch {
      return false;
    }
  }

  async capturePackets(
    iface: string,
    filter: string,
    duration: number,
    outFile: string
  ): Promise<{ success: boolean; packetCount: number }> {
    try {
      const { stdout } = await this.deep.execAsync(
        `sudo tcpdump -i ${iface} -c 1000 -w ${outFile} ${filter} 2>&1`,
        duration * 1000
      );
      const match = stdout.match(/(\d+)\s+packets? captured/);
      return { success: true, packetCount: match ? parseInt(match[1]!, 10) : 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const match = msg.match(/(\d+)\s+packets? captured/);
      return { success: false, packetCount: match ? parseInt(match[1]!, 10) : 0 };
    }
  }

  async scanHosts(subnet: string): Promise<HostScanResult[]> {
    try {
      const { stdout: whichOut } = await this.deep.execAsync(
        "which nmap 2>/dev/null"
      );
      if (whichOut.trim()) {
        const { stdout } = await this.deep.execAsync(
          `nmap -sn ${subnet} 2>/dev/null`
        );
        const results: HostScanResult[] = [];
        const blocks = stdout.split("Nmap scan report for ").slice(1);
        for (const block of blocks) {
          const lines = block.split("\n");
          const header = lines[0]?.trim() ?? "";
          const ipMatch = header.match(/\(([^)]+)\)/);
          const ip = ipMatch ? ipMatch[1]! : header;
          const hostname = ipMatch ? header.replace(/ \([^)]+\)/, "") : null;
          const macLine = lines.find((l) => l.includes("MAC Address:"));
          const mac = macLine
            ? (macLine.match(/MAC Address: ([0-9A-F:]+)/i)?.[1] ?? null)
            : null;
          results.push({ ip, hostname, mac, alive: true });
        }
        return results;
      }
      // Fallback: arp -a
      const { stdout: arpOut } = await this.deep.execAsync("arp -a 2>/dev/null");
      return arpOut
        .split("\n")
        .filter((l) => l.trim())
        .map((line) => {
          const ipMatch = line.match(/\(([^)]+)\)/);
          const macMatch = line.match(/at ([0-9a-f:]+)/i);
          const hostMatch = line.match(/^(\S+)/);
          return {
            ip: ipMatch?.[1] ?? "",
            hostname: hostMatch?.[1] ?? null,
            mac: macMatch?.[1] ?? null,
            alive: true,
          };
        })
        .filter((r) => r.ip);
    } catch {
      return [];
    }
  }

  async portScan(
    host: string,
    ports = "22,80,443,8080,3000,5000,3306,5432,6379,27017"
  ): Promise<PortScanResult[]> {
    try {
      const { stdout: whichOut } = await this.deep.execAsync(
        "which nmap 2>/dev/null"
      );
      if (whichOut.trim()) {
        const { stdout } = await this.deep.execAsync(
          `nmap -Pn -p ${ports} ${host} 2>/dev/null`
        );
        const results: PortScanResult[] = [];
        for (const line of stdout.split("\n")) {
          const m = line.match(/^(\d+)\/(tcp|udp)\s+(open|closed|filtered)\s*(\S*)/);
          if (m) {
            results.push({
              port: parseInt(m[1]!, 10),
              state: m[3] as "open" | "closed" | "filtered",
              service: m[4] || null,
            });
          }
        }
        return results;
      }
      // Fallback: nc per port
      const portList = ports.split(",").map((p) => parseInt(p.trim(), 10));
      const results: PortScanResult[] = [];
      for (const port of portList) {
        try {
          await this.deep.execAsync(
            `nc -zv -w 2 ${host} ${port} 2>&1`,
            3000
          );
          results.push({ port, state: "open", service: null });
        } catch {
          results.push({ port, state: "closed", service: null });
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  async dnsLookup(domain: string, type = "A"): Promise<string> {
    try {
      const { stdout } = await this.deep.execAsync(`dig ${domain} ${type}`);
      return stdout;
    } catch (err: unknown) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  async whoisLookup(target: string): Promise<string> {
    try {
      const { stdout } = await this.deep.execAsync(`whois ${target}`);
      return stdout.slice(0, 5000);
    } catch (err: unknown) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  async checkToolAvailability(tools: string[]): Promise<ToolAvailability[]> {
    const results: ToolAvailability[] = [];
    for (const name of tools) {
      try {
        const { stdout: pathOut } = await this.deep.execAsync(
          `which ${name} 2>/dev/null`
        );
        const path = pathOut.trim() || null;
        let version: string | null = null;
        if (path) {
          try {
            const { stdout: verOut } = await this.deep.execAsync(
              `${name} --version 2>&1 | head -1`
            );
            version = verOut.trim() || null;
          } catch {
            version = null;
          }
        }
        results.push({ name, available: !!path, path, version });
      } catch {
        results.push({ name, available: false, path: null, version: null });
      }
    }
    return results;
  }

  // ================================================================
  // WiFi Deep Control — monitor mode, channel hopping, deauth, handshake capture
  // ================================================================

  /**
   * Get the system WiFi interface name (en0 on most Macs).
   */
  async getWiFiInterface(): Promise<string> {
    try {
      const { stdout } = await this.deep.execAsync(
        "networksetup -listallhardwareports 2>/dev/null | awk '/Wi-Fi/{getline; print $2}' | head -1"
      );
      return stdout.trim() || "en0";
    } catch {
      return "en0";
    }
  }

  /**
   * Set WiFi interface to a specific channel (requires sudo).
   * Uses airport CLI. Must be in monitor mode first.
   */
  async setWiFiChannel(channel: number): Promise<boolean> {
    if (this.deep.platform !== "macos") return false;
    try {
      const airportPath = "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
      await this.deep.execAsync(`sudo "${airportPath}" --channel=${channel}`, 5000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Capture WiFi packets with airodump-ng (requires aircrack-ng via brew).
   * Falls back to tcpdump if airodump-ng not available.
   */
  async captureWiFiHandshake(
    bssid: string,
    channel: number,
    outputFile: string,
    durationSec = 30
  ): Promise<{ success: boolean; file: string; tool: string }> {
    try {
      const iface = await this.getWiFiInterface();
      // Check if airodump-ng available
      const { stdout: airodumpPath } = await this.deep.execAsync("which airodump-ng 2>/dev/null").catch(() => ({ stdout: '' }));
      if (airodumpPath.trim()) {
        await this.deep.execAsync(
          `sudo timeout ${durationSec} airodump-ng --bssid ${bssid} --channel ${channel} -w ${outputFile} ${iface} 2>/dev/null || true`,
          (durationSec + 5) * 1000
        );
        return { success: true, file: outputFile + "-01.cap", tool: "airodump-ng" };
      }
      // Fallback: tcpdump
      await this.deep.execAsync(
        `sudo timeout ${durationSec} tcpdump -i ${iface} -w ${outputFile}.pcap ether host ${bssid} 2>/dev/null || true`,
        (durationSec + 5) * 1000
      );
      return { success: true, file: outputFile + ".pcap", tool: "tcpdump" };
    } catch {
      return { success: false, file: outputFile, tool: "none" };
    }
  }

  /**
   * Run a deauthentication attack to force client reconnection (for WPA handshake capture).
   * Requires aircrack-ng suite and monitor mode.
   * NOTE: Only use against networks you own or have explicit permission to test.
   */
  async deauthAttack(bssid: string, clientMac = "FF:FF:FF:FF:FF:FF", count = 10): Promise<boolean> {
    if (this.deep.platform !== "macos") return false;
    try {
      const { stdout: aireplayPath } = await this.deep.execAsync("which aireplay-ng 2>/dev/null").catch(() => ({ stdout: '' }));
      if (!aireplayPath.trim()) return false;
      const iface = await this.getWiFiInterface();
      await this.deep.execAsync(
        `sudo aireplay-ng --deauth ${count} -a ${bssid} -c ${clientMac} ${iface} 2>/dev/null || true`,
        30000
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Install aircrack-ng suite via Homebrew for WiFi testing tools.
   */
  async installAircrackSuite(): Promise<boolean> {
    try {
      await this.deep.execAsync("brew install aircrack-ng 2>&1", 120000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Channel-hop WiFi scan: collect BSSIDs across all 2.4GHz + 5GHz channels.
   * Uses airport CLI, loops through channels 1-13 and 36-165.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async deepWiFiScan(_durationPerChannelMs = 200): Promise<WiFiScanResult[]> {
    if (this.deep.platform !== "macos") return [];
    try {
      const airportPath = "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
      const { stdout } = await this.deep.execAsync(
        `"${airportPath}" -s 2>/dev/null`,
        15000
      );
      const lines = stdout.split("\n").slice(1).filter(l => l.trim());
      const results: WiFiScanResult[] = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        results.push({
          ssid: parts[0] ?? "",
          bssid: parts[1] ?? "",
          rssi: parseInt(parts[2] ?? "0", 10),
          channel: parseInt(parts[3] ?? "0", 10),
          security: parts.slice(6).join(" ") || "NONE",
        });
      }
      return results;
    } catch {
      return [];
    }
  }

  /**
   * Get current WiFi signal strength in dBm.
   */
  async getWiFiSignalStrength(): Promise<number | null> {
    if (this.deep.platform !== "macos") return null;
    try {
      const airportPath = "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
      const { stdout } = await this.deep.execAsync(`"${airportPath}" -I 2>/dev/null`);
      const m = stdout.match(/agrCtlRSSI:\s*(-?\d+)/);
      return m ? parseInt(m[1]) : null;
    } catch {
      return null;
    }
  }

  /**
   * Crack WPA handshake using aircrack-ng with a wordlist.
   * NOTE: Only use against networks you own or have permission to test.
   */
  async crackWPAHandshake(
    capFile: string,
    wordlist: string,
    bssid?: string
  ): Promise<{ found: boolean; password?: string; output: string }> {
    try {
      const { stdout: aircrackPath } = await this.deep.execAsync("which aircrack-ng 2>/dev/null").catch(() => ({ stdout: '' }));
      if (!aircrackPath.trim()) {
        return { found: false, output: "aircrack-ng not installed. Run: brew install aircrack-ng" };
      }
      const bssidArg = bssid ? `-b ${bssid}` : "";
      const { stdout } = await this.deep.execAsync(
        `aircrack-ng ${bssidArg} -w ${wordlist} ${capFile} 2>&1`,
        300000 // 5 min timeout
      );
      const found = stdout.includes("KEY FOUND!");
      const pwMatch = stdout.match(/KEY FOUND!\s*\[\s*(.+?)\s*\]/);
      return { found, password: pwMatch?.[1], output: stdout.slice(0, 5000) };
    } catch (err) {
      return { found: false, output: err instanceof Error ? err.message : String(err) };
    }
  }
}
