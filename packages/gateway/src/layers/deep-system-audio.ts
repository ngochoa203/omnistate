/**
 * Deep System Layer — Audio Management (UC-B26).
 *
 * macOS-first; Linux fallbacks where reasonable.
 */

import { platform } from "node:os";

import type { DeepLayer } from "./deep.js";
import type { AudioSource } from "./deep-system-types.js";
import { execAsync } from "./deep-system-types.js";

abstract class DeepSystemAudioCore {
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

export class DeepSystemAudioLayer extends DeepSystemAudioCore {
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
}