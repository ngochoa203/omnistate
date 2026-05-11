/**
 * Quick Action Tools — Frequently used one-liner combinations.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Quick Actions
// ------------------------------------------------------------------

export async function focusMode(): Promise<boolean> {
  try {
    // Enable DND + hide notifications
    await execAsync(`osascript -e 'tell application "System Events" to keystroke "d" using {command down, option down, control down}'`);
    // Set volume to low
    await execAsync(`osascript -e 'set volume output volume 20'`);
    return true;
  } catch {
    return false;
  }
}

export async function endFocusMode(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'set volume output volume 50'`);
    return true;
  } catch {
    return false;
  }
}

export async function showDesktop(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Finder" to activate'`);
    await execAsync(`osascript -e 'tell application "System Events" to keystroke "d" using command down'`); // F11
    return true;
  } catch {
    return false;
  }
}

export async function openDownloads(): Promise<boolean> {
  try {
    await execAsync(`open ~/Downloads`);
    return true;
  } catch {
    return false;
  }
}

export async function openTerminalHere(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Finder" to activate'`);
    await execAsync(`osascript -e 'tell application "System Events" to tell process "Finder" to tell menu bar 1 to click menu item "New Terminal at Folder" of menu "File"'`);
    return true;
  } catch {
    return false;
  }
}

export async function screenshot(): Promise<boolean> {
  try {
    await execAsync(`screencapture ~/Desktop/screenshot-$(date +%Y%m%d-%H%M%S).png`);
    return true;
  } catch {
    return false;
  }
}

export async function screenshotArea(): Promise<boolean> {
  try {
    await execAsync(`screencapture -i ~/Desktop/screenshot-$(date +%Y%m%d-%H%M%S).png`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// System Controls
// ------------------------------------------------------------------

export async function ejectAllDrives(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Finder" to eject every disk'`);
    return true;
  } catch {
    return false;
  }
}

export async function restartMac(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to restart'`);
    return true;
  } catch {
    return false;
  }
}

export async function shutdownMac(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to shut down'`);
    return true;
  } catch {
    return false;
  }
}

export async function sleepMac(): Promise<boolean> {
  try {
    await execAsync("pmset sleepnow");
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Quick App Launches
// ------------------------------------------------------------------

export async function openSlack(): Promise<boolean> {
  try { await execAsync(`open -a "Slack"`); return true; } catch { return false; }
}

export async function openDiscord(): Promise<boolean> {
  try { await execAsync(`open -a "Discord"`); return true; } catch { return false; }
}

export async function openZoom(): Promise<boolean> {
  try { await execAsync(`open -a "zoom.us"`); return true; } catch { return false; }
}

export async function openTeams(): Promise<boolean> {
  try { await execAsync(`open -a "Microsoft Teams"`); return true; } catch { return false; }
}

export async function openNotion(): Promise<boolean> {
  try { await execAsync(`open -a "Notion"`); return true; } catch { return false; }
}

export async function openObsidian(): Promise<boolean> {
  try { await execAsync(`open -a "Obsidian"`); return true; } catch { return false; }
}

export async function openFigma(): Promise<boolean> {
  try { await execAsync(`open -a "Figma"`); return true; } catch { return false; }
}

export async function openPhotoshop(): Promise<boolean> {
  try { await execAsync(`open -a "Adobe Photoshop 2024"`); return true; } catch { return false; }
}

// ------------------------------------------------------------------
// Quick Text Actions
// ------------------------------------------------------------------

export async function copyLastScreenshot(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("ls -t ~/Desktop/screenshot*.png | head -1", { encoding: "utf-8" });
    const latest = stdout.trim();
    if (latest) {
      await execAsync(`osascript -e 'set the clipboard to (read alias POSIX file "${latest}" as JPEG picture)'`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function newNoteFromClipboard(): Promise<boolean> {
  try {
    const content = await execAsync("osascript -e 'the clipboard as text'", { encoding: "utf-8" });
    await execAsync(`echo "${content.stdout.trim()}" >> ~/Desktop/clipboard-note.txt`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Quick Searches
// ------------------------------------------------------------------

export async function quickGoogleSearch(query: string): Promise<boolean> {
  try {
    const encoded = encodeURIComponent(query);
    await execAsync(`open -a "Safari" "https://www.google.com/search?q=${encoded}"`);
    return true;
  } catch {
    return false;
  }
}

export async function quickSpotlight(term: string): Promise<boolean> {
  try {
    // Open Spotlight
    await execAsync(`osascript -e 'tell application "System Events" to keystroke " "' using {command down, shift down}`);
    await new Promise(r => setTimeout(r, 500));
    // Type search term
    await execAsync(`osascript -e 'tell application "System Events" to keystroke "${term}"'`);
    return true;
  } catch {
    return false;
  }
}

export class QuickActionLayer {
  focusMode = focusMode;
  endFocusMode = endFocusMode;
  showDesktop = showDesktop;
  openDownloads = openDownloads;
  openTerminalHere = openTerminalHere;
  screenshot = screenshot;
  screenshotArea = screenshotArea;
  ejectAllDrives = ejectAllDrives;
  restartMac = restartMac;
  shutdownMac = shutdownMac;
  sleepMac = sleepMac;
  openSlack = openSlack;
  openDiscord = openDiscord;
  openZoom = openZoom;
  openTeams = openTeams;
  openNotion = openNotion;
  openObsidian = openObsidian;
  openFigma = openFigma;
  openPhotoshop = openPhotoshop;
  copyLastScreenshot = copyLastScreenshot;
  newNoteFromClipboard = newNoteFromClipboard;
  quickGoogleSearch = quickGoogleSearch;
  quickSpotlight = quickSpotlight;
}
