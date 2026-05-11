/**
 * System Automation Tools — Keyboard shortcuts, menu bar, automation.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function screenshotSelection(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to keystroke " " using {command down, shift down}'`);
    return true;
  } catch { return false; }
}

export async function screenshotWindow(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to keystroke " " using {command down, shift down, option down}'`);
    return true;
  } catch { return false; }
}

export async function screenshotClipboard(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to keystroke " " using {command down, shift down, control down}'`);
    return true;
  } catch { return false; }
}

export async function quitAllApps(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to keystroke "q" using {command down, option down}'`);
    return true;
  } catch { return false; }
}

export async function showDesktop(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to keystroke "d" using {command down, shift down}'`);
    return true;
  } catch { return false; }
}

export async function lockScreen(): Promise<boolean> {
  try {
    await execAsync(`pmset displaysleepnow`);
    return true;
  } catch { return false; }
}

export async function sleepMac(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to sleep'`);
    return true;
  } catch { return false; }
}

export async function restartMac(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to restart'`);
    return true;
  } catch { return false; }
}

export async function shutdownMac(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to shut down'`);
    return true;
  } catch { return false; }
}

export async function getMenuBarItems(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`osascript -e 'tell process "SystemUIServer" to get every menu bar item of menu bar 1'`, { encoding: "utf-8" });
    return stdout.split(", ").filter(Boolean);
  } catch { return []; }
}

export async function sendNotification(title: string, body: string, sound = true): Promise<boolean> {
  try {
    const s = sound ? "with sound" : "without sound";
    await execAsync(`osascript -e 'display notification "${body}" with title "${title}" ${s}'`);
    return true;
  } catch { return false; }
}

export async function enableDND(): Promise<boolean> {
  try {
    await execAsync(`shortcuts run "Turn On Do Not Disturb" 2>/dev/null || echo "not configured"`);
    return true;
  } catch { return false; }
}

export async function disableDND(): Promise<boolean> {
  try {
    await execAsync(`shortcuts run "Turn Off Do Not Disturb" 2>/dev/null || echo "not configured"`);
    return true;
  } catch { return false; }
}

export async function runShortcutsShortcut(name: string): Promise<boolean> {
  try {
    await execAsync(`shortcuts run "${name}"`);
    return true;
  } catch { return false; }
}

export async function listShortcuts(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`shortcuts list`, { encoding: "utf-8" });
    return stdout.split("\n").filter(Boolean);
  } catch { return []; }
}

export class SystemAutomationLayer {
  screenshotSelection = screenshotSelection;
  screenshotWindow = screenshotWindow;
  screenshotClipboard = screenshotClipboard;
  quitAllApps = quitAllApps;
  showDesktop = showDesktop;
  lockScreen = lockScreen;
  sleepMac = sleepMac;
  restartMac = restartMac;
  shutdownMac = shutdownMac;
  getMenuBarItems = getMenuBarItems;
  sendNotification = sendNotification;
  enableDND = enableDND;
  disableDND = disableDND;
  runShortcutsShortcut = runShortcutsShortcut;
  listShortcuts = listShortcuts;
}
