/**
 * OS & Hardware Tools — Group 1
 * Implements 10 system-level operations for macOS automation.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// UC1: Dark Mode Toggle
// ------------------------------------------------------------------

export async function darkModeToggle(enable?: boolean): Promise<boolean> {
  try {
    const current = await darkModeGet();
    const target = enable !== undefined ? enable : !current;
    const script = target
      ? 'tell application "System Events" to tell appearance preferences to set dark mode to true'
      : 'tell application "System Events" to tell appearance preferences to set dark mode to false';
    await execAsync(`osascript -e '${script}'`);
    return true;
  } catch (e) {
    console.error("darkModeToggle failed:", e);
    return false;
  }
}

export async function darkModeGet(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      'osascript -e \'tell application "System Events" to get dark mode of appearance preferences\'',
      { encoding: "utf-8" }
    );
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// UC2: Volume Control (0-100)
// ------------------------------------------------------------------

export async function setVolumePercent(percent: number): Promise<boolean> {
  try {
    const vol = Math.max(0, Math.min(100, Math.round(percent)));
    await execAsync(`osascript -e 'set volume output volume ${vol}'`);
    return true;
  } catch (e) {
    console.error("setVolumePercent failed:", e);
    return false;
  }
}

export async function getVolumePercent(): Promise<number> {
  try {
    const { stdout } = await execAsync(
      "osascript -e 'output volume of (get volume settings)'",
      { encoding: "utf-8" }
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

// ------------------------------------------------------------------
// UC3: WiFi Toggle
// ------------------------------------------------------------------

export async function wifiToggle(enable?: boolean): Promise<boolean> {
  try {
    const current = await wifiGetStatus();
    const target = enable !== undefined ? enable : !current;
    await execAsync(`networksetup -setairportpower en0 ${target ? "on" : "off"}`);
    return true;
  } catch (e) {
    console.error("wifiToggle failed:", e);
    return false;
  }
}

export async function wifiGetStatus(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("networksetup -getairportpower en0 | grep -i on");
    return stdout.includes("On");
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// UC4: Battery Info
// ------------------------------------------------------------------

export async function getBatteryPercent(): Promise<{ percent: number; isCharging: boolean; timeRemaining?: number }> {
  try {
    const { stdout } = await execAsync("pmset -g batt", { encoding: "utf-8" });
    const percentMatch = stdout.match(/(\d+)%/);
    const timeMatch = stdout.match(/(\d+:\d+)\s*(remaining|until full)/);
    const isCharging = stdout.includes("charging") || stdout.includes("AC Power");
    return {
      percent: percentMatch ? parseInt(percentMatch[1]!, 10) : 0,
      isCharging,
      timeRemaining: timeMatch ? parseInt(timeMatch[1]!.split(":")[0]!) * 60 + parseInt(timeMatch[1]!.split(":")[1]!) : undefined
    };
  } catch {
    return { percent: 0, isCharging: false };
  }
}

// ------------------------------------------------------------------
// UC5: Do Not Disturb Toggle
// ------------------------------------------------------------------

export async function dndToggle(enable?: boolean): Promise<boolean> {
  try {
    const current = await dndGetStatus();
    const target = enable !== undefined ? enable : !current;
    const script = target
      ? 'tell application "System Events" to keystroke "d" using {command down, option down, control down}'
      : 'tell application "System Events" to keystroke "d" using {command down, option down, control down}';
    await execAsync(`osascript -e '${script}'`);
    // Alternative: Shortcuts app integration
    await execAsync(`osascript -e 'tell application "Shortcuts" to run shortcut "Toggle Focus"' 2>/dev/null || true`);
    return true;
  } catch (e) {
    console.error("dndToggle failed:", e);
    return false;
  }
}

export async function dndGetStatus(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("defaults -currentHost read com.apple.notificationcenterui doNotDisturb", { encoding: "utf-8" });
    return stdout.trim() === "1";
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// UC6: Microphone Mute Toggle
// ------------------------------------------------------------------

export async function micMuteToggle(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'set volume input volume (if input volume of (get volume settings) = 0 then 100 else 0)'`);
    return true;
  } catch (e) {
    console.error("micMuteToggle failed:", e);
    return false;
  }
}

export async function micMuteStatus(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("osascript -e 'input volume of (get volume settings)'", { encoding: "utf-8" });
    return parseInt(stdout.trim(), 10) === 0;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// UC7: Lock Screen
// ------------------------------------------------------------------

export async function lockScreen(): Promise<boolean> {
  try {
    await execAsync("/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend");
    return true;
  } catch (e) {
    console.error("lockScreen failed:", e);
    return false;
  }
}

export async function lockScreenAlt(): Promise<boolean> {
  try {
    await execAsync("pmset displaysleepnow");
    return true;
  } catch (e) {
    console.error("lockScreenAlt failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// UC8: Brightness Control (0-100)
// ------------------------------------------------------------------

export async function setBrightness(level: number): Promise<boolean> {
  try {
    const brightness = Math.max(0, Math.min(100, Math.round(level)));
    await execAsync(`osascript -e 'set brightness ${brightness / 100}'`);
    return true;
  } catch (e) {
    try {
      await execAsync(`brightness ${level / 100}`);
      return true;
    } catch {
      return false;
    }
  }
}

export async function getBrightness(): Promise<number> {
  try {
    const { stdout } = await execAsync("osascript -e 'get brightness' | head -1", { encoding: "utf-8" });
    return Math.round(parseFloat(stdout.trim()) * 100);
  } catch {
    return 50;
  }
}

// ------------------------------------------------------------------
// UC9: Random Wallpaper from ~/Pictures
// ------------------------------------------------------------------

export async function setRandomWallpaper(): Promise<string | null> {
  try {
    const picturesDir = path.join(os.homedir(), "Pictures");
    const files = await fs.readdir(picturesDir);
    const images = files.filter(f => /\.(jpg|jpeg|png|heic)$/i.test(f));
    
    if (images.length === 0) return null;
    
    const chosen = images[Math.floor(Math.random() * images.length)];
    const fullPath = path.join(picturesDir, chosen);
    
    await execAsync(`osascript -e 'tell application "System Events" to tell every desktop to set picture to "${fullPath}"'`);
    return fullPath;
  } catch (e) {
    console.error("setRandomWallpaper failed:", e);
    return null;
  }
}

export async function setWallpaper(imagePath: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to tell every desktop to set picture to "${imagePath}"'`);
    return true;
  } catch (e) {
    console.error("setWallpaper failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// UC10: Top RAM Processes
// ------------------------------------------------------------------

export interface ProcessMemoryInfo {
  pid: number;
  name: string;
  memMB: number;
}

export async function topRamProcesses(limit: number = 10): Promise<ProcessMemoryInfo[]> {
  try {
    const { stdout } = await execAsync(
      `ps aux --sort=-%mem | head -${limit + 1} | tail -${limit}`,
      { encoding: "utf-8" }
    );
    
    const lines = stdout.trim().split("\n");
    return lines.map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: parseInt(parts[1] || "0", 10),
        name: parts[10] || "unknown",
        memMB: Math.round(parseFloat(parts[5] || "0") / 1024)
      };
    }).filter(p => p.pid > 0);
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Layer Export
// ------------------------------------------------------------------

export class OSHardwareLayer {
  darkModeToggle = darkModeToggle;
  darkModeGet = darkModeGet;
  setVolumePercent = setVolumePercent;
  getVolumePercent = getVolumePercent;
  wifiToggle = wifiToggle;
  wifiGetStatus = wifiGetStatus;
  getBatteryPercent = getBatteryPercent;
  dndToggle = dndToggle;
  dndGetStatus = dndGetStatus;
  micMuteToggle = micMuteToggle;
  micMuteStatus = micMuteStatus;
  lockScreen = lockScreen;
  lockScreenAlt = lockScreenAlt;
  setBrightness = setBrightness;
  getBrightness = getBrightness;
  setRandomWallpaper = setRandomWallpaper;
  setWallpaper = setWallpaper;
  topRamProcesses = topRamProcesses;
}
