/**
 * Deep System Layer — OS Update (UC-B29).
 *
 * macOS-first; Linux fallbacks where reasonable.
 */

import { platform } from "node:os";

import type { DeepLayer } from "./deep.js";
import type { OSVersion, SoftwareUpdate } from "./deep-system-types.js";
import { execAsync } from "./deep-system-types.js";

abstract class DeepSystemUpdateCore {
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

export class DeepSystemUpdateLayer extends DeepSystemUpdateCore {
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
}