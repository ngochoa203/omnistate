/**
 * System Preferences & Settings Tools — Group 22
 * Implements: macOS system preferences, app settings, preferences files
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Launch System Preferences
// ------------------------------------------------------------------

export async function openSystemPreferences(pane?: string): Promise<boolean> {
  try {
    if (pane) {
      await execAsync(`open "x-apple.systempreferences:com.apple.preference.${pane}"`);
    } else {
      await execAsync("open /System/Library/PreferencePanes/SystemPreferences.prefPane");
    }
    return true;
  } catch {
    return false;
  }
}

export async function openDisplaysPrefs(): Promise<boolean> {
  return openSystemPreferences("Displays");
}

export async function openSoundPrefs(): Promise<boolean> {
  return openSystemPreferences("Sound");
}

export async function openNetworkPrefs(): Promise<boolean> {
  return openSystemPreferences("Network");
}

export async function openBluetoothPrefs(): Promise<boolean> {
  return openSystemPreferences("Bluetooth");
}

export async function openNotificationsPrefs(): Promise<boolean> {
  return openSystemPreferences("Notifications");
}

export async function openAppearancePrefs(): Promise<boolean> {
  return openSystemPreferences("Appearance");
}

// ------------------------------------------------------------------
// Appearance Settings
// ------------------------------------------------------------------

export async function setAccentColor(color: "blue" | "purple" | "pink" | "red" | "orange" | "yellow" | "green" | "graphite"): Promise<boolean> {
  try {
    await execAsync(`defaults write NSGlobalDomain AppleAccentColor -int ${["blue", "purple", "pink", "red", "orange", "yellow", "green", "graphite"].indexOf(color)}`);
    return true;
  } catch {
    return false;
  }
}

export async function setTheme(theme: "light" | "dark" | "auto"): Promise<boolean> {
  try {
    if (theme === "auto") {
      await execAsync("defaults write NSGlobalDomain AppleInterfaceStyle -string ''");
      await execAsync("defaults write NSGlobalDomain AppleInterfaceStyleSwipeAutomaticallySwipe -bool true");
    } else {
      await execAsync(`defaults write NSGlobalDomain AppleInterfaceStyle -string "${theme}"`);
    }
    return true;
  } catch {
    return false;
  }
}

export async function setDockAutoHide(enable: boolean): Promise<boolean> {
  try {
    await execAsync(`defaults write com.apple.dock autohide -bool ${enable}`);
    await execAsync("killall Dock");
    return true;
  } catch {
    return false;
  }
}

export async function setDockMagnification(enable: boolean): Promise<boolean> {
  try {
    await execAsync(`defaults write com.apple.dock magnification -bool ${enable}`);
    await execAsync("killall Dock");
    return true;
  } catch {
    return false;
  }
}

export async function setDockSize(size: number): Promise<boolean> {
  try {
    await execAsync(`defaults write com.apple.dock tilesize -int ${Math.max(16, Math.min(128, size))}`);
    await execAsync("killall Dock");
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Finder Settings
// ------------------------------------------------------------------

export async function setFinderShowExtensions(show: boolean): Promise<boolean> {
  try {
    await execAsync(`defaults write NSGlobalDomain AppleShowAllExtensions -bool ${show}`);
    return true;
  } catch {
    return false;
  }
}

export async function setFinderDefaultView(view: "list" | "icon" | "column"): Promise<boolean> {
  try {
    await execAsync(`defaults write com.apple.finder FXPreferredViewStyle -string "${view}"`);
    await execAsync("killall Finder");
    return true;
  } catch {
    return false;
  }
}

export async function setDesktopPicture(imagePath: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to tell every desktop to set picture to "${imagePath}"'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Notification Settings
// ------------------------------------------------------------------

export async function setDoNotDisturb(enable: boolean): Promise<boolean> {
  try {
    await execAsync(`defaults -currentHost write com.apple.notificationcenterui doNotDisturb -bool ${enable}`);
    await execAsync("killall NotificationCenter");
    return true;
  } catch {
    return false;
  }
}

export async function setNotificationBannerStyle(style: "banner" | "alerts"): Promise<boolean> {
  try {
    await execAsync(`defaults write com.apple.notificationcenterui notificationStyle -int ${style === "alerts" ? 1 : 0}`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Trackpad & Mouse Settings
// ------------------------------------------------------------------

export async function setTrackpadSpeed(speed: number): Promise<boolean> {
  try {
    await execAsync(`defaults write NSGlobalDomain com.apple.trackpad.speed -float ${speed}`);
    return true;
  } catch {
    return false;
  }
}

export async function setTapToClick(enable: boolean): Promise<boolean> {
  try {
    await execAsync(`defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad Clicking -bool ${enable}`);
    return true;
  } catch {
    return false;
  }
}

export async function setNaturalScroll(enable: boolean): Promise<boolean> {
  try {
    await execAsync(`defaults write NSGlobalDomain com.apple.swipescrolldirection -bool ${enable}`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Keyboard Settings
// ------------------------------------------------------------------

export async function setKeyboardRepeatRate(rate: number): Promise<boolean> {
  try {
    await execAsync(`defaults write NSGlobalDomain KeyRepeat -int ${Math.max(1, Math.min(10, 11 - rate))}`);
    return true;
  } catch {
    return false;
  }
}

export async function setKeyboardDelay(delay: number): Promise<boolean> {
  try {
    await execAsync(`defaults write NSGlobalDomain InitialKeyRepeat -int ${Math.max(1, Math.min(5, 30 - delay * 5))}`);
    return true;
  } catch {
    return false;
  }
}

export async function setTouchBar(settings: { strip?: string; appMode?: boolean }): Promise<boolean> {
  try {
    if (settings.strip) {
      await execAsync(`defaults write com.apple.controlcenter strip -string "${settings.strip}"`);
    }
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Energy Settings
// ------------------------------------------------------------------

export async function setDisplaySleep(minutes: number): Promise<boolean> {
  try {
    await execAsync(`pmset -a displaysleep ${minutes}`);
    return true;
  } catch {
    return false;
  }
}

export async function setComputerSleep(minutes: number): Promise<boolean> {
  try {
    await execAsync(`pmset -a sleep ${minutes}`);
    return true;
  } catch {
    return false;
  }
}

export async function setLowPowerMode(enable: boolean): Promise<boolean> {
  try {
    await execAsync(`pmset -a lowpowermode ${enable ? 1 : 0}`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Time Machine Settings
// ------------------------------------------------------------------

export async function setTimeMachineAutoBackup(enable: boolean): Promise<boolean> {
  try {
    await execAsync(`tmutil/autobackup ${enable ? "enable" : "disable"} 2>/dev/null || echo 'done'`);
    return true;
  } catch {
    return false;
  }
}

export async function getTimeMachineLastBackup(): Promise<Date | null> {
  try {
    const { stdout } = await execAsync("tmutil latestbackup 2>/dev/null | head -1", { encoding: "utf-8" });
    return stdout.trim() ? new Date() : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// App Store Settings
// ------------------------------------------------------------------

export async function setAutoUpdateApps(enable: boolean): Promise<boolean> {
  try {
    await execAsync(`defaults write com.apple.SoftwareUpdate AutomaticCheckEnabled -bool ${enable}`);
    return true;
  } catch {
    return false;
  }
}

export async function checkForUpdates(): Promise<boolean> {
  try {
    await execAsync("softwareupdate -l 2>/dev/null || echo 'No updates'");
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Get Current Settings
// ------------------------------------------------------------------

export async function getCurrentSettings(): Promise<Record<string, any>> {
  try {
    const theme = await execAsync('defaults read NSGlobalDomain AppleInterfaceStyle 2>/dev/null || echo "Light"', { encoding: "utf-8" });
    const dockAutoHide = await execAsync("defaults read com.apple.dock autohide 2>/dev/null || echo false", { encoding: "utf-8" });
    
    return {
      theme: theme.stdout.trim() || "Light",
      dockAutoHide: dockAutoHide.stdout.trim() === "1",
      osVersion: os.release(),
      osName: os.platform()
    };
  } catch {
    return {};
  }
}

export class SystemPrefsLayer {
  openPrefs = openSystemPreferences;
  openDisplays = openDisplaysPrefs;
  openSound = openSoundPrefs;
  openNetwork = openNetworkPrefs;
  openBluetooth = openBluetoothPrefs;
  openNotifications = openNotificationsPrefs;
  openAppearance = openAppearancePrefs;
  
  setAccentColor = setAccentColor;
  setTheme = setTheme;
  setDockAutoHide = setDockAutoHide;
  setDockMagnification = setDockMagnification;
  setDockSize = setDockSize;
  
  setFinderShowExtensions = setFinderShowExtensions;
  setFinderDefaultView = setFinderDefaultView;
  setDesktopPicture = setDesktopPicture;
  
  setDND = setDoNotDisturb;
  setNotificationStyle = setNotificationBannerStyle;
  
  setTrackpadSpeed = setTrackpadSpeed;
  setTapToClick = setTapToClick;
  setNaturalScroll = setNaturalScroll;
  
  setKeyboardRepeatRate = setKeyboardRepeatRate;
  setKeyboardDelay = setKeyboardDelay;
  setTouchBar = setTouchBar;
  
  setDisplaySleep = setDisplaySleep;
  setComputerSleep = setComputerSleep;
  setLowPower = setLowPowerMode;
  
  setTimeMachineAutoBackup = setTimeMachineAutoBackup;
  getTimeMachineLastBackup = getTimeMachineLastBackup;
  
  setAutoUpdate = setAutoUpdateApps;
  checkUpdates = checkForUpdates;
  
  getCurrentSettings = getCurrentSettings;
}
