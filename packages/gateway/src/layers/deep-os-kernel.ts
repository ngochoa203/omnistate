/**
 * Deep OS Layer — Kernel & System Operations.
 *
 * UC-B06: Service/daemon management.
 * UC-B07: Package management.
 * UC-B09: Kernel/hardware tuning.
 * UC-B10: Peripheral control (audio, Bluetooth, brightness).
 * UC-B11: Scheduled tasks.
 */

import type { DeepLayer } from "./deep.js";
import type {
  ServiceInfo,
  ServiceStatus,
  LaunchDaemonConfig,
  PackageInfo,
  PowerSettings,
  AudioDevice,
  BluetoothStatus,
  BluetoothDevice,
  ScheduledTask,
  ScheduledTaskConfig,
} from "./deep-os-types.js";

// ------------------------------------------------------------------
// UC-B06: Service/Daemon Management (launchctl on macOS, systemctl on Linux)
// ------------------------------------------------------------------

export class DeepOSKernelLayer {
  constructor(private readonly deep: DeepLayer) {}

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
}
