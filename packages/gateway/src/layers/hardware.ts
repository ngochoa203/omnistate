/**
 * Hardware Layer — macOS hardware control operations.
 *
 * Implements UC9: Hardware Control.
 *   UC9.1 Volume Control        UC9.2 Brightness Control
 *   UC9.3 Bluetooth Control     UC9.4 Display Control
 *   UC9.5 Power & Battery
 *
 * macOS-first; uses AppleScript, shell commands, and system tools.
 * Every method has try/catch with safe fallback returns.
 */

import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";

import type { DeepLayer } from "./deep.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// UC9.1 — Volume Control
// ---------------------------------------------------------------------------

export interface AudioDevice {
  name: string;
  type: "input" | "output";
  isDefault: boolean;
}

// ---------------------------------------------------------------------------
// UC9.3 — Bluetooth Control
// ---------------------------------------------------------------------------

export interface BluetoothDevice {
  name: string;
  address: string;
  connected: boolean;
  type: string;
}

// ---------------------------------------------------------------------------
// UC9.4 — Display Control
// ---------------------------------------------------------------------------

export interface Resolution {
  width: number;
  height: number;
  scale?: number;
}

export interface DisplayInfo {
  id: number;
  name: string;
  resolution: Resolution;
  main: boolean;
}

export interface DisplayArrangement {
  displays: Array<{
    id: number;
    name: string;
    x: number;
    y: number;
    main: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// UC9.5 — Power & Battery
// ---------------------------------------------------------------------------

export interface BatteryInfo {
  percentage: number;
  charging: boolean;
  timeRemaining?: string;
  powerSource: "battery" | "ac";
}

export interface SleepSettings {
  displaySleep: number;
  diskSleep: number;
  systemSleep: number;
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class HardwareLayer {
  constructor(private readonly deep: DeepLayer) {}

  // ── helpers ─────────────────────────────────────────────────────────────

  private get isMac(): boolean {
    return platform() === "darwin";
  }

  /** Run a shell command asynchronously; returns stdout on success or "" on failure. */
  private async run(cmd: string, timeoutMs = 15_000): Promise<string> {
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

  /** Run an AppleScript snippet and return trimmed stdout. */
  private async osascript(script: string): Promise<string> {
    return this.run(`osascript -e ${JSON.stringify(script)}`);
  }

  // =========================================================================
  // UC9.1 — Volume Control
  // =========================================================================

  /**
   * Get the current output volume level (0-100) and muted state.
   */
  async getVolume(): Promise<{ volume: number; muted: boolean }> {
    try {
      const volStr = await this.osascript("output volume of (get volume settings)");
      const mutedStr = await this.osascript("output muted of (get volume settings)");
      return {
        volume: parseInt(volStr, 10) || 0,
        muted: mutedStr.toLowerCase() === "true",
      };
    } catch {
      return { volume: 0, muted: false };
    }
  }

  /**
   * Set the system output volume (0-100).
   */
  async setVolume(level: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    await this.osascript(`set volume output volume ${clamped}`);
  }

  /**
   * Mute the system output.
   */
  async mute(): Promise<void> {
    await this.osascript("set volume with output muted");
  }

  /**
   * Unmute the system output.
   */
  async unmute(): Promise<void> {
    await this.osascript("set volume without output muted");
  }

  /**
   * Toggle the output mute state.
   */
  async toggleMute(): Promise<void> {
    const { muted } = await this.getVolume();
    if (muted) {
      await this.unmute();
    } else {
      await this.mute();
    }
  }

  /**
   * Get the current input (microphone) volume level (0-100).
   */
  async getInputVolume(): Promise<number> {
    try {
      const str = await this.osascript("input volume of (get volume settings)");
      return parseInt(str, 10) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Set the input (microphone) volume level (0-100).
   */
  async setInputVolume(level: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    await this.osascript(`set volume input volume ${clamped}`);
  }

  /**
   * List all audio input and output devices via system_profiler.
   */
  async listAudioDevices(): Promise<AudioDevice[]> {
    try {
      const raw = await this.run("system_profiler SPAudioDataType -json", 20_000);
      if (!raw) return [];

      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const audioItems = (parsed["SPAudioDataType"] as unknown[]) ?? [];
      const devices: AudioDevice[] = [];

      for (const item of audioItems) {
        const record = item as Record<string, unknown>;
        const name = String(record["_name"] ?? "Unknown");
        const inputSources =
          (record["coreaudio_input_source"] as string) ?? "";
        const outputSources =
          (record["coreaudio_output_source"] as string) ?? "";

        if (outputSources) {
          devices.push({ name, type: "output", isDefault: false });
        }
        if (inputSources) {
          devices.push({ name, type: "input", isDefault: false });
        }
        if (!inputSources && !outputSources) {
          // Fallback: classify by device name heuristic
          const lower = name.toLowerCase();
          const type: AudioDevice["type"] = lower.includes("micr")
            ? "input"
            : "output";
          devices.push({ name, type, isDefault: false });
        }
      }

      return devices;
    } catch {
      return [];
    }
  }

  // =========================================================================
  // UC9.2 — Brightness Control
  // =========================================================================

  /**
   * Get the display brightness as a value from 0.0 to 1.0.
   * Reads from the ioreg AppleBacklightDisplay node.
   * Falls back to 0.5 if unreadable (e.g. external monitor without brightness support).
   */
  async getBrightness(): Promise<number> {
    try {
      // ioreg outputs something like: "brightness" = 0.75
      const raw = await this.run(
        `ioreg -c AppleBacklightDisplay -r -d 1 | grep '"brightness"'`
      );
      if (raw) {
        const m = raw.match(/"brightness"\s*=\s*([\d.]+)/);
        if (m) return parseFloat(m[1]);
      }
      // Fallback: try brightness CLI (brew install brightness)
      const braw = await this.run("brightness -l 2>/dev/null");
      if (braw) {
        const m2 = braw.match(/brightness:\s*([\d.]+)/i);
        if (m2) return parseFloat(m2[1]);
      }
      return 0.5;
    } catch {
      return 0.5;
    }
  }

  /**
   * Set the display brightness (0.0-1.0).
   * Uses the `brightness` CLI tool if available; otherwise uses osascript heuristic.
   */
  async setBrightness(level: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, level));
    try {
      // Try brightness CLI first (brew install brightness)
      const hasBrightness = await this.run("which brightness 2>/dev/null");
      if (hasBrightness) {
        await this.run(`brightness ${clamped.toFixed(2)}`);
        return;
      }
      // Fallback: osascript slider approach (requires Accessibility perms)
      const pct = Math.round(clamped * 100);
      await this.osascript(
        `tell application "System Events" to tell process "ControlCenter" to set value of slider 1 of window 1 to ${pct}`
      );
    } catch {
      // Silently fail — brightness control often requires elevated permissions
    }
  }

  /**
   * Get the Night Shift status and schedule.
   */
  async getNightShift(): Promise<{ enabled: boolean; schedule?: string }> {
    try {
      if (!this.isMac) return { enabled: false };
      const raw = await this.run(
        `defaults read com.apple.CoreBrightness.plist 2>/dev/null || echo ""`
      );
      // Night Shift schedule stored in CoreBrightness — check for BlueLightReductionSchedule
      const enabled = raw.includes("BlueLightReductionEnabled = 1");
      const scheduleMatch = raw.match(/CBBlueLightReductionScheduleType\s*=\s*(\d+)/);
      const scheduleTypes: Record<string, string> = {
        "0": "off",
        "1": "sunset-to-sunrise",
        "2": "custom",
      };
      const schedule = scheduleMatch
        ? (scheduleTypes[scheduleMatch[1]] ?? "unknown")
        : undefined;
      return { enabled, schedule };
    } catch {
      return { enabled: false };
    }
  }

  /**
   * Enable or disable Night Shift via osascript / defaults.
   * Requires macOS 10.12.4+.
   */
  async setNightShift(enabled: boolean): Promise<void> {
    try {
      // Toggle Night Shift via Control Center AppleScript
      const action = enabled ? "true" : "false";
      await this.osascript(
        `tell application "System Events"
          tell appearance preferences
            set nightShiftEnabled to ${action}
          end tell
        end tell`
      );
    } catch {
      // Silently fail — may require Accessibility permissions
    }
  }

  // =========================================================================
  // UC9.3 — Bluetooth Control
  // =========================================================================

  /**
   * Get the Bluetooth power state and a list of known devices.
   */
  async getBluetoothStatus(): Promise<{
    enabled: boolean;
    devices: BluetoothDevice[];
  }> {
    try {
      const raw = await this.run(
        "system_profiler SPBluetoothDataType -json",
        20_000
      );
      if (!raw) return { enabled: false, devices: [] };

      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const btData =
        (parsed["SPBluetoothDataType"] as Record<string, unknown>[])?.[0] ?? {};

      // Controller state
      const controllerProps =
        (btData["controller_properties"] as Record<string, unknown>) ?? {};
      const stateStr = String(
        controllerProps["controller_state"] ?? ""
      ).toLowerCase();
      const enabled =
        stateStr === "on" ||
        stateStr === "attrib_on" ||
        stateStr.includes("on");

      const devices = await this._parseBluetoothDevices(btData);
      return { enabled, devices };
    } catch {
      return { enabled: false, devices: [] };
    }
  }

  /** Parse device list from SPBluetoothDataType record. */
  private async _parseBluetoothDevices(
    btData: Record<string, unknown>
  ): Promise<BluetoothDevice[]> {
    const devices: BluetoothDevice[] = [];
    try {
      // Connected devices live under "device_connected", paired under "device_not_connected"
      const sections = ["device_connected", "device_not_connected"] as const;
      for (const section of sections) {
        const list = btData[section] as Record<string, unknown>[] | undefined;
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
          // Each entry is { "Device Name": { device_address, device_minorClassOfDevice_string, ... } }
          for (const [name, props] of Object.entries(entry)) {
            const p = props as Record<string, unknown>;
            devices.push({
              name,
              address: String(p["device_address"] ?? ""),
              connected: section === "device_connected",
              type: String(p["device_minorClassOfDevice_string"] ?? "Unknown"),
            });
          }
        }
      }
    } catch {
      // ignore parse errors
    }
    return devices;
  }

  /**
   * Enable Bluetooth (requires blueutil: brew install blueutil).
   */
  async enableBluetooth(): Promise<void> {
    try {
      const hasBlueutil = await this.run("which blueutil 2>/dev/null");
      if (hasBlueutil) {
        await this.run("blueutil --power 1");
      }
    } catch {
      // blueutil not installed or permission denied
    }
  }

  /**
   * Disable Bluetooth (requires blueutil: brew install blueutil).
   */
  async disableBluetooth(): Promise<void> {
    try {
      const hasBlueutil = await this.run("which blueutil 2>/dev/null");
      if (hasBlueutil) {
        await this.run("blueutil --power 0");
      }
    } catch {
      // blueutil not installed or permission denied
    }
  }

  /**
   * List all known Bluetooth devices (connected and paired).
   */
  async listBluetoothDevices(): Promise<BluetoothDevice[]> {
    try {
      const { devices } = await this.getBluetoothStatus();
      return devices;
    } catch {
      return [];
    }
  }

  /**
   * Connect to a Bluetooth device by address (requires blueutil).
   */
  async connectBluetoothDevice(address: string): Promise<void> {
    try {
      const hasBlueutil = await this.run("which blueutil 2>/dev/null");
      if (hasBlueutil) {
        await this.run(`blueutil --connect ${address}`);
      }
    } catch {
      // ignore
    }
  }

  /**
   * Disconnect a Bluetooth device by address (requires blueutil).
   */
  async disconnectBluetoothDevice(address: string): Promise<void> {
    try {
      const hasBlueutil = await this.run("which blueutil 2>/dev/null");
      if (hasBlueutil) {
        await this.run(`blueutil --disconnect ${address}`);
      }
    } catch {
      // ignore
    }
  }

  // =========================================================================
  // UC9.4 — Display Control
  // =========================================================================

  /**
   * List all connected displays with name and resolution info.
   */
  async listDisplays(): Promise<DisplayInfo[]> {
    try {
      const raw = await this.run(
        "system_profiler SPDisplaysDataType -json",
        20_000
      );
      if (!raw) return [];

      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const displayItems =
        (parsed["SPDisplaysDataType"] as Record<string, unknown>[]) ?? [];
      const displays: DisplayInfo[] = [];

      let id = 0;
      for (const item of displayItems) {
        // Each GPU entry can have a "spdisplays_ndrvs" array of monitors
        const monitors = (
          item["spdisplays_ndrvs"] as Record<string, unknown>[] | undefined
        ) ?? [item];

        for (const mon of monitors) {
          const name = String(mon["_name"] ?? "Unknown Display");
          const resStr = String(mon["spdisplays_resolution"] ?? "");
          const resolution = this._parseResolution(resStr);
          const isMain =
            String(mon["spdisplays_main"] ?? "").toLowerCase() === "spdisplays_yes";

          displays.push({ id: id++, name, resolution, main: isMain });
        }
      }

      return displays;
    } catch {
      return [];
    }
  }

  /** Parse a resolution string like "2560 x 1600 Retina" into a Resolution object. */
  private _parseResolution(str: string): Resolution {
    const m = str.match(/(\d+)\s*[xX×]\s*(\d+)/);
    if (!m) return { width: 0, height: 0 };
    const scale = str.toLowerCase().includes("retina") ? 2 : 1;
    return { width: parseInt(m[1], 10), height: parseInt(m[2], 10), scale };
  }

  /**
   * Get the current resolution of a display (by index, default 0).
   */
  async getDisplayResolution(displayId = 0): Promise<Resolution> {
    try {
      const displays = await this.listDisplays();
      return displays[displayId]?.resolution ?? { width: 0, height: 0 };
    } catch {
      return { width: 0, height: 0 };
    }
  }

  /**
   * Set the display resolution (requires displayplacer: brew install displayplacer).
   * Changes resolution for the primary display by default.
   */
  async setDisplayResolution(width: number, height: number): Promise<void> {
    try {
      const hasDP = await this.run("which displayplacer 2>/dev/null");
      if (!hasDP) return;
      await this.run(
        `displayplacer "id:1 res:${width}x${height} scaling:off"`,
        15_000
      );
    } catch {
      // displayplacer not installed, unsupported resolution, etc.
    }
  }

  /**
   * Get the arrangement of all connected displays (position and main flag).
   */
  async getDisplayArrangement(): Promise<DisplayArrangement> {
    try {
      const displays = await this.listDisplays();
      // displayplacer can output arrangement details
      const dpRaw = await this.run("displayplacer list 2>/dev/null");
      if (!dpRaw) {
        return {
          displays: displays.map((d) => ({
            id: d.id,
            name: d.name,
            x: 0,
            y: 0,
            main: d.main,
          })),
        };
      }
      // Parse "origin:(x,y)" from each entry
      const arranged = displays.map((d) => {
        const re = new RegExp(`${d.name}[\\s\\S]*?origin:\\(([-\\d]+),([-\\d]+)\\)`);
        const m = dpRaw.match(re);
        return {
          id: d.id,
          name: d.name,
          x: m ? parseInt(m[1], 10) : 0,
          y: m ? parseInt(m[2], 10) : 0,
          main: d.main,
        };
      });
      return { displays: arranged };
    } catch {
      return { displays: [] };
    }
  }

  /**
   * Enable or disable Dark Mode system-wide.
   */
  async setDarkMode(enabled: boolean): Promise<void> {
    const value = enabled ? "true" : "false";
    await this.osascript(
      `tell application "System Events"
        tell appearance preferences
          set dark mode to ${value}
        end tell
      end tell`
    );
  }

  /**
   * Returns true if Dark Mode is currently active.
   */
  async isDarkMode(): Promise<boolean> {
    try {
      const result = await this.osascript(
        `tell application "System Events"
          tell appearance preferences
            return dark mode
          end tell
        end tell`
      );
      return result.toLowerCase() === "true";
    } catch {
      return false;
    }
  }

  /**
   * Get the current appearance as 'light', 'dark', or 'auto'.
   * 'auto' means "Auto" (follow schedule) set via Accessibility Shortcut.
   */
  async getAppearance(): Promise<"light" | "dark" | "auto"> {
    try {
      const dark = await this.isDarkMode();
      // Check if Auto is set via AppleInterfaceStyleSwitchesAutomatically
      const autoRaw = await this.run(
        `defaults read -g AppleInterfaceStyleSwitchesAutomatically 2>/dev/null`
      );
      if (autoRaw === "1") return "auto";
      return dark ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  // =========================================================================
  // UC9.5 — Power & Battery
  // =========================================================================

  /**
   * Get the current battery status.
   * Parses `pmset -g batt` output.
   */
  async getBatteryStatus(): Promise<BatteryInfo> {
    try {
      const raw = await this.run("pmset -g batt");
      if (!raw) return { percentage: 0, charging: false, powerSource: "ac" };

      // e.g. "Now drawing from 'AC Power'" or "'Battery Power'"
      const acPower = raw.includes("AC Power");
      const powerSource: BatteryInfo["powerSource"] = acPower ? "ac" : "battery";

      // e.g. "-InternalBattery-0 (id=...)	85%; charging; 1:23 remaining present: true"
      const pctMatch = raw.match(/(\d+)%/);
      const percentage = pctMatch ? parseInt(pctMatch[1], 10) : 0;

      const charging =
        raw.includes("charging") && !raw.includes("discharging");

      const timeMatch = raw.match(/(\d+:\d+)\s+remaining/);
      const timeRemaining = timeMatch ? timeMatch[1] : undefined;

      return { percentage, charging, timeRemaining, powerSource };
    } catch {
      return { percentage: 0, charging: false, powerSource: "ac" };
    }
  }

  /**
   * Get the current sleep/power settings from pmset.
   */
  async getSleepSettings(): Promise<SleepSettings> {
    try {
      const raw = await this.run("pmset -g custom");
      const extract = (key: string): number => {
        const m = raw.match(new RegExp(`${key}\\s+(\\d+)`));
        return m ? parseInt(m[1], 10) : 0;
      };
      return {
        displaySleep: extract("displaysleep"),
        diskSleep: extract("disksleep"),
        systemSleep: extract("sleep"),
      };
    } catch {
      return { displaySleep: 0, diskSleep: 0, systemSleep: 0 };
    }
  }

  /**
   * Prevent the system from sleeping for `minutes` minutes.
   * Spawns `caffeinate -t <seconds>` in the background and returns its PID.
   * Returns `{ pid: -1 }` if caffeinate could not be started.
   */
  async preventSleep(minutes: number): Promise<{ pid: number }> {
    try {
      const seconds = Math.max(1, Math.round(minutes * 60));
      const child = spawn("caffeinate", ["-t", String(seconds)], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return { pid: child.pid ?? -1 };
    } catch {
      return { pid: -1 };
    }
  }

  /**
   * Allow sleep again by killing the caffeinate process started by `preventSleep`.
   */
  async allowSleep(pid: number): Promise<void> {
    try {
      if (pid > 0) {
        await this.run(`kill ${pid} 2>/dev/null`);
      }
    } catch {
      // Process may have already exited
    }
  }

  /**
   * Put the Mac to sleep immediately.
   */
  async sleep(): Promise<void> {
    await this.run("pmset sleepnow");
  }

  /**
   * Restart the Mac (prompts user via System Events; user must confirm dialogs).
   */
  async restart(): Promise<void> {
    await this.osascript('tell application "System Events" to restart');
  }

  /**
   * Shut down the Mac (prompts user via System Events; user must confirm dialogs).
   */
  async shutdown(): Promise<void> {
    await this.osascript('tell application "System Events" to shut down');
  }

  // =========================================================================
  // Keyboard Control
  // =========================================================================

  /**
   * Get the current keyboard backlight brightness level (0-100).
   * Uses `light` CLI if available, otherwise reads via ioreg.
   */
  async getKeyboardBacklight(): Promise<number> {
    // Try light CLI (brew install light)
    try {
      const out = await this.run("light -G -s sysfs/leds/smc::kbd_backlight 2>/dev/null");
      const val = parseFloat(out.trim());
      if (!isNaN(val)) return Math.round(val);
    } catch { /* fall through */ }

    // Try ioreg
    try {
      const out = await this.run(
        "ioreg -c AppleHIDKeyboardDevice -r -d 1 2>/dev/null | grep -i backlight",
      );
      const m = out.match(/"LMUValue"\s*=\s*(\d+)/);
      if (m) return Math.min(100, Math.round((parseInt(m[1], 10) / 255) * 100));
    } catch { /* fall through */ }

    return -1; // unavailable
  }

  /**
   * Set keyboard backlight level (0-100).
   * Uses `light` CLI if available, otherwise osascript JXA.
   */
  async setKeyboardBacklight(level: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, level));

    // Try light CLI
    try {
      await this.run(
        `light -S ${clamped} -s sysfs/leds/smc::kbd_backlight 2>/dev/null`,
      );
      return;
    } catch { /* fall through */ }

    // Fallback: osascript JXA via CoreBrightness
    const pct = clamped / 100;
    await this.run(
      `osascript -l JavaScript -e 'ObjC.import("CoreBrightness"); $.CBKeyboardBacklightClient.sharedClient().setKeyboardBacklight(${pct})'`,
    ).catch(() => { /* best-effort */ });
  }

  /**
   * Returns true if keyboard backlight is set to automatic (ambient-light sensor).
   */
  async isKeyboardBacklightAuto(): Promise<boolean> {
    try {
      const out = await this.run(
        'defaults read /Library/Preferences/com.apple.keyboard.plist "Automatic Keyboard Enabled" 2>/dev/null',
      );
      return out.trim() === "1";
    } catch {
      return false;
    }
  }

  // =========================================================================
  // USB & Peripherals
  // =========================================================================

  /** List all connected USB devices. */
  async listUSBDevices(): Promise<
    Array<{
      name: string;
      vendorId: string;
      productId: string;
      speed: string;
      serialNumber?: string;
    }>
  > {
    type SPUSBDevice = {
      _name?: string;
      vendor_id?: string;
      product_id?: string;
      device_speed?: string;
      serial_num?: string;
      _items?: SPUSBDevice[];
    };
    type SPUSBData = { SPUSBDataType?: SPUSBDevice[] };

    const flatten = (devices: SPUSBDevice[]): SPUSBDevice[] =>
      devices.flatMap((d) => [d, ...flatten(d._items ?? [])]);

    try {
      const raw = await this.run("system_profiler SPUSBDataType -json");
      const data: SPUSBData = JSON.parse(raw);
      const all = flatten(data.SPUSBDataType ?? []);
      return all
        .filter((d) => d._name)
        .map((d) => ({
          name: d._name ?? "unknown",
          vendorId: d.vendor_id ?? "",
          productId: d.product_id ?? "",
          speed: d.device_speed ?? "unknown",
          ...(d.serial_num ? { serialNumber: d.serial_num } : {}),
        }));
    } catch {
      return [];
    }
  }

  /** List connected Thunderbolt/USB4 devices. */
  async listThunderboltDevices(): Promise<
    Array<{ name: string; vendor: string; speed: string }>
  > {
    type SPTBDevice = {
      _name?: string;
      vendor_name?: string;
      link_speed?: string;
      _items?: SPTBDevice[];
    };
    type SPTBData = { SPThunderboltDataType?: SPTBDevice[] };

    const flatten = (devices: SPTBDevice[]): SPTBDevice[] =>
      devices.flatMap((d) => [d, ...flatten(d._items ?? [])]);

    try {
      const raw = await this.run("system_profiler SPThunderboltDataType -json");
      const data: SPTBData = JSON.parse(raw);
      const all = flatten(data.SPThunderboltDataType ?? []);
      return all
        .filter((d) => d._name && d._name !== "Thunderbolt Bus")
        .map((d) => ({
          name: d._name ?? "unknown",
          vendor: d.vendor_name ?? "unknown",
          speed: d.link_speed ?? "unknown",
        }));
    } catch {
      return [];
    }
  }

  /** List wired and Bluetooth input devices (keyboard, mouse, trackpad). */
  async getInputDevices(): Promise<
    Array<{
      name: string;
      type: "keyboard" | "mouse" | "trackpad" | "other";
      connected: boolean;
    }>
  > {
    const devices: Array<{
      name: string;
      type: "keyboard" | "mouse" | "trackpad" | "other";
      connected: boolean;
    }> = [];

    // BT devices from system_profiler
    try {
      const raw = await this.run("system_profiler SPBluetoothDataType -json");
      const data = JSON.parse(raw) as Record<string, unknown>;
      const bt = (data.SPBluetoothDataType as Record<string, unknown>[] | undefined) ?? [];
      for (const entry of bt) {
        const items = (entry as Record<string, unknown[]>)["device_connected"] ?? [];
        for (const item of items as Record<string, unknown>[]) {
          const name = String(Object.keys(item)[0] ?? "Unknown");
          const lower = name.toLowerCase();
          const type: "keyboard" | "mouse" | "trackpad" | "other" = lower.includes("keyboard")
            ? "keyboard"
            : lower.includes("mouse")
            ? "mouse"
            : lower.includes("trackpad")
            ? "trackpad"
            : "other";
          devices.push({ name, type, connected: true });
        }
      }
    } catch { /* fall through */ }

    // HID devices via ioreg (wired keyboard/mouse)
    try {
      const out = await this.run(
        "ioreg -r -c IOHIDDevice -d 1 2>/dev/null | grep -A2 'Product '",
      );
      const names = [...out.matchAll(/"Product"\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
      for (const name of names) {
        if (devices.some((d) => d.name === name)) continue;
        const lower = name.toLowerCase();
        const type: "keyboard" | "mouse" | "trackpad" | "other" = lower.includes("keyboard")
          ? "keyboard"
          : lower.includes("mouse")
          ? "mouse"
          : lower.includes("trackpad")
          ? "trackpad"
          : "other";
        devices.push({ name, type, connected: true });
      }
    } catch { /* fall through */ }

    return devices;
  }

  /** Eject a disk by name or identifier (e.g. "disk2" or a volume name). */
  async ejectDisk(diskName: string): Promise<boolean> {
    try {
      await this.run(`diskutil eject "${diskName}"`);
      return true;
    } catch {
      return false;
    }
  }

  // =========================================================================
  // Network Hardware
  // =========================================================================

  /**
   * Get current Wi-Fi connection details (SSID, BSSID, channel, RSSI, etc.).
   * Returns null if not connected or airport is unavailable.
   */
  async getWifiInfo(): Promise<{
    ssid: string;
    bssid: string;
    channel: number;
    rssi: number;
    noise: number;
    security: string;
    txRate: number;
  } | null> {
    const airportPath =
      "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
    try {
      const out = await this.run(`${airportPath} -I`);
      const get = (key: string): string => {
        const m = out.match(new RegExp(`${key}:\\s*(.+)`));
        return m ? m[1].trim() : "";
      };
      const ssid = get("SSID");
      if (!ssid) return null;
      return {
        ssid,
        bssid: get("BSSID"),
        channel: parseInt(get("channel"), 10) || 0,
        rssi: parseInt(get("agrCtlRSSI"), 10) || 0,
        noise: parseInt(get("agrCtlNoise"), 10) || 0,
        security: get("link auth"),
        txRate: parseFloat(get("lastTxRate")) || 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Scan for nearby Wi-Fi networks.
   */
  async getWifiNetworks(): Promise<
    Array<{
      ssid: string;
      bssid: string;
      rssi: number;
      channel: number;
      security: string;
    }>
  > {
    const airportPath =
      "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
    try {
      const out = await this.run(`${airportPath} -s`);
      const lines = out.split("\n").slice(1); // skip header
      return lines
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 3) return null;
          const ssid = parts[0];
          const bssid = parts[1];
          const rssi = parseInt(parts[2], 10);
          const channel = parseInt(parts[3], 10);
          const security = parts.slice(6).join(" ") || "none";
          return { ssid, bssid, rssi: isNaN(rssi) ? 0 : rssi, channel: isNaN(channel) ? 0 : channel, security };
        })
        .filter((n): n is NonNullable<typeof n> => n !== null && Boolean(n.ssid));
    } catch {
      return [];
    }
  }

  /**
   * Connect to a Wi-Fi network.
   * Uses networksetup; interface defaults to en0.
   */
  async connectToWifi(ssid: string, password?: string): Promise<boolean> {
    try {
      const cmd = password
        ? `networksetup -setairportnetwork en0 "${ssid}" "${password}"`
        : `networksetup -setairportnetwork en0 "${ssid}"`;
      await this.run(cmd);
      return true;
    } catch {
      return false;
    }
  }
}

export default HardwareLayer;
