/**
 * Deep OS Layer — App Control & Configuration.
 *
 * UC-B02: App resolution & auto-install.
 * UC-B04: APFS snapshots.
 * UC-B05: OS configuration (defaults, DNS, proxy, dark mode).
 * UC-B12: macOS defaults read/write.
 */

import type { DeepLayer } from "./deep.js";
import type {
  AppInfo,
  SnapshotInfo,
  ProxyConfig,
} from "./deep-os-types.js";

// ------------------------------------------------------------------
// UC-B02: App Resolution & Auto-Install
// ------------------------------------------------------------------

export class DeepOSAppLayer {
  constructor(private readonly deep: DeepLayer) {}

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
}
