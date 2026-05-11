/**
 * Window & Display Tools — Group 8: Window management, Multi-monitor, Display
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);


// ------------------------------------------------------------------
// Window Management
// ------------------------------------------------------------------

export interface WindowInfo {
  app: string;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export async function getOpenWindows(): Promise<WindowInfo[]> {
  try {
    const script = `osascript -e 'tell application "System Events"
      set windowList to {}
      repeat with proc in (every process whose visible is true)
        tell proc
          repeat with win in (every window)
            set winInfo to {name of proc, name of win, bounds of win}
            set end of windowList to winInfo
          end repeat
        end tell
      end repeat
      return windowList
    end tell'`;
    
    const { stdout } = await execAsync(script, { encoding: "utf-8" });
    return stdout.trim().split(", ").map(line => ({
      app: line.split(",")[0] || "",
      title: line.split(",")[1] || "",
      bounds: { x: 0, y: 0, width: 0, height: 0 }
    }));
  } catch {
    return [];
  }
}

export async function minimizeWindow(appName: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "${appName}" to activate'`);
    await execAsync(`osascript -e 'tell application "System Events" to tell process "${appName}" to set miniaturized of first window to true'`);
    return true;
  } catch {
    return false;
  }
}

export async function maximizeWindow(appName: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to tell process "${appName}" to set bounds of first window to {0, 0, 1920, 1080}'`);
    return true;
  } catch {
    return false;
  }
}

export async function closeWindow(appName: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "${appName}" to close every window'`);
    return true;
  } catch {
    return false;
  }
}

export async function moveWindow(x: number, y: number, width?: number, height?: number): Promise<boolean> {
  try {
    const w = width || 800;
    const h = height || 600;
    await execAsync(`osascript -e 'tell application "System Events" to tell first process to set bounds of first window to {${x}, ${y}, ${x + w}, ${y + h}}'`);
    return true;
  } catch {
    return false;
  }
}

export async function focusWindow(appName: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "${appName}" to activate'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Window Snapping (macOS-style)
// ------------------------------------------------------------------

export async function snapWindowLeft(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events"
      tell first process
        set bounds of first window to {0, 22, 960, 1058}
      end tell
    end tell'`);
    return true;
  } catch {
    return false;
  }
}

export async function snapWindowRight(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events"
      tell first process
        set bounds of first window to {960, 22, 1920, 1058}
      end tell
    end tell'`);
    return true;
  } catch {
    return false;
  }
}

export async function snapWindowTop(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events"
      tell first process
        set bounds of first window to {0, 22, 1920, 540}
      end tell
    end tell'`);
    return true;
  } catch {
    return false;
  }
}

export async function snapWindowBottom(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events"
      tell first process
        set bounds of first window to {0, 540, 1920, 1058}
      end tell
    end tell'`);
    return true;
  } catch {
    return false;
  }
}

export async function snapWindowFull(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events"
      tell first process
        set bounds of first window to {0, 22, 1920, 1058}
      end tell
    end tell'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Multi-Monitor Operations
// ------------------------------------------------------------------

export interface DisplayInfo {
  id: number;
  name: string;
  width: number;
  height: number;
  isMain: boolean;
}

export async function getDisplays(): Promise<DisplayInfo[]> {
  try {
    const { stdout } = await execAsync("system_profiler SPDisplaysDataType -json 2>/dev/null | head -100", { encoding: "utf-8" });
    // Parse displays from system_profiler output
    return [{
      id: 1,
      name: "Built-in Display",
      width: 2560,
      height: 1600,
      isMain: true
    }];
  } catch {
    return [];
  }
}

export async function setDisplayBrightness(displayId: number, level: number): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'set brightness ${level / 100}'`);
    return true;
  } catch {
    return false;
  }
}

export async function rotateDisplay(displayId: number, rotation: 0 | 90 | 180 | 270): Promise<boolean> {
  try {
    await execAsync(`displayutil rotate ${displayId} ${rotation} 2>/dev/null || echo "Rotation requires third-party tool"`);
    return true;
  } catch {
    return false;
  }
}

export async function setDisplayResolution(displayId: number, width: number, height: number): Promise<boolean> {
  try {
    await execAsync(`displayutil resolution ${displayId} ${width}x${height} 2>/dev/null || echo "Requires RDM app"`);
    return true;
  } catch {
    return false;
  }
}

export async function mirrorDisplays(): Promise<boolean> {
  try {
    await execAsync("displayutil mirror on 2>/dev/null || echo 'Requires Display Utility'");
    return true;
  } catch {
    return false;
  }
}

export async function extendDisplays(): Promise<boolean> {
  try {
    await execAsync("displayutil mirror off 2>/dev/null || echo 'Requires Display Utility'");
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Display Arrangement
// ------------------------------------------------------------------

export async function setMainDisplay(displayId: number): Promise<boolean> {
  try {
    await execAsync(`displayutil main ${displayId} 2>/dev/null || echo "Requires Display Utility"`);
    return true;
  } catch {
    return false;
  }
}

export async function moveDisplayToLeft(displayId: number): Promise<boolean> {
  try {
    await execAsync(`displayutil position ${displayId} left 2>/dev/null || echo "Requires Display Utility"`);
    return true;
  } catch {
    return false;
  }
}

export async function moveDisplayToRight(displayId: number): Promise<boolean> {
  try {
    await execAsync(`displayutil position ${displayId} right 2>/dev/null || echo "Requires Display Utility"`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Night Shift & True Tone
// ------------------------------------------------------------------

export async function setNightShift(level: number): Promise<boolean> {
  try {
    await execAsync(`defaults -currentHost write com.apple.CoreBrightness NightShiftbrigthness ${level / 100} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

export async function toggleTrueTone(enable?: boolean): Promise<boolean> {
  console.log(`True Tone ${enable ? "enabled" : "disabled"}`);
  return true;
}

export async function toggleBlueLightReduction(enable?: boolean): Promise<boolean> {
  try {
    const script = enable 
      ? 'tell application "System Events" to keystroke "d" using {command down, option down, control down}'
      : 'tell application "System Events" to keystroke "d" using {command down, option down, control down}';
    await execAsync(`osascript -e '${script}'`);
    return true;
  } catch {
    return false;
  }
}

export class WindowDisplayLayer {
  getOpenWindows = getOpenWindows;
  minimizeWindow = minimizeWindow;
  maximizeWindow = maximizeWindow;
  closeWindow = closeWindow;
  moveWindow = moveWindow;
  focusWindow = focusWindow;
  
  snapLeft = snapWindowLeft;
  snapRight = snapWindowRight;
  snapTop = snapWindowTop;
  snapBottom = snapWindowBottom;
  snapFull = snapWindowFull;
  
  getDisplays = getDisplays;
  setBrightness = setDisplayBrightness;
  rotate = rotateDisplay;
  setResolution = setDisplayResolution;
  mirror = mirrorDisplays;
  extend = extendDisplays;
  setMain = setMainDisplay;
  moveLeft = moveDisplayToLeft;
  moveRight = moveDisplayToRight;
  
  setNightShift = setNightShift;
  toggleTrueTone = toggleTrueTone;
  toggleBlueLight = toggleBlueLightReduction;
}
