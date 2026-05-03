/**
 * Deep System Layer — Shell / Terminal (UC-B16), Font-Locale (UC-B19), Startup (UC-B20).
 *
 * macOS-first; Linux fallbacks where reasonable.
 * Every method has try/catch with safe fallback returns.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join, basename } from "node:path";

import type { DeepLayer } from "./deep.js";
import type {
  ShellInfo,
  AliasEntry,
  FontInfo,
  KeyboardLayout,
  StartupItem,
  StartupItemConfig,
} from "./deep-system-types.js";
import { execAsync } from "./deep-system-types.js";

// =========================================================================
// Helpers
// =========================================================================

abstract class DeepSystemShellCore {
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

  protected runSync(cmd: string, timeoutMs = 10_000): string {
    try {
      return this.deep.exec(cmd, timeoutMs).trim();
    } catch {
      return "";
    }
  }
}

// =========================================================================
// UC-B16 — Shell / Terminal Profile
// =========================================================================

export class DeepSystemShellLayer extends DeepSystemShellCore {
  /**
   * Detect the current user's login shell.
   * Checks $SHELL env, falls back to /etc/passwd inspection.
   */
  getShellType(): ShellInfo {
    try {
      // Sanitize USER env var before interpolating into a shell command
      const safeUser = (process.env.USER ?? "root").replace(/[^a-zA-Z0-9._-]/g, "");
      const shellPath =
        process.env.SHELL ??
        this.runSync(`getent passwd ${safeUser} | cut -d: -f7`) ??
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
      if (!existsSync(dest)) {
        const { mkdirSync } = require("node:fs");
        mkdirSync(dest, { recursive: true });
      }
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
}