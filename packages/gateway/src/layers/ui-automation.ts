/**
 * UI Automation Layer for macOS.
 *
 * Provides low-level UI interaction via:
 * - AX (Accessibility) API for element discovery
 * - CGEvent for mouse/keyboard simulation
 * - AppleScript/JXA for app control
 */

import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface Point { x: number; y: number; }
export interface ElementRef { role: string; title?: string; value?: string; axId?: string; }

// ------------------------------------------------------------------
// Screen & Element Discovery
// ------------------------------------------------------------------

/**
 * Get screen dimensions.
 */
export function getScreenSize(): Point {
  try {
    const out = execSync("system_profiler SPDisplaysDataType | grep Resolution", { encoding: "utf8" });
    const match = out.match(/(\d+)\s*x\s*(\d+)/);
    if (match) {
      return { x: parseInt(match[1]!, 10), y: parseInt(match[2]!, 10) };
    }
  } catch {
    // fall through
  }
  // Common fallback
  return { x: 1440, y: 900 };
}

/**
 * Get frontmost window info from an app using osascript.
 */
export async function getFrontmostWindow(appName: string): Promise<{
  name: string;
  position: Point;
  size: Point;
} | null> {
  try {
    const script = `
      tell application "${appName}"
        if (count of windows) > 0 then
          set w to front window
          set winName to name of w
          set winPos to position of w
          set winSize to size of w
          return "name:" & winName & ",x:" & (item 1 of winPos as string) & ",y:" & (item 2 of winPos as string)
        end if
      end tell
    `;
    const { stdout: out } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    const match = out.match(/name:(.*),x:(\d+),y:(\d+)/);
    if (!match) return null;
    return {
      name: match[1],
      position: { x: parseInt(match[2]!, 10), y: parseInt(match[3]!, 10) },
      size: { x: 0, y: 0 }
    };
  } catch {
    return null;
  }
}

/**
 * Find UI element by AX attribute using osascript.
 * Returns all matching elements with their properties.
 */
export async function findElements(
  appName: string,
  criteria: { role?: string; title?: string; value?: string; text?: string }
): Promise<ElementRef[]> {
  try {
    const parts: string[] = [];
    if (criteria.role) parts.push(`AXRole = "${criteria.role}"`);
    if (criteria.title) parts.push(`AXTitle = "${criteria.title}"`);
    if (criteria.value) parts.push(`AXValue = "${criteria.value}"`);
    if (criteria.text) parts.push(`AXDescription = "${criteria.text}"`);

    const where = parts.length ? ` where ${parts.join(" and ")}` : "";
    const script = `
      tell application "${appName}"
        try
          tell front window
            set elemList to every UI element${where}
            set resultList to {}
            repeat with e in elemList
              set end of resultList to (AXRole of e as string) & "|" & (AXTitle of e as string)
            end repeat
            return resultList as string
          end tell
        on error
          return ""
        end try
      end tell
    `;
    const { stdout: out } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    if (!out.trim()) return [];

    return out.trim().split("\n").map((line: string) => {
      const [role, title] = line.split("|");
      return { role: role || "AXElement", title: title?.trim() };
    }).filter((e: ElementRef) => e.title);
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Mouse & Keyboard
// ------------------------------------------------------------------

/**
 * Click at absolute screen coordinates.
 */
export async function clickAt(x: number, y: number, _button: "left" | "right" = "left"): Promise<void> {
  await execAsync(
    `osascript -e 'tell application "System Events" to click at {${x}, ${y}}'`
  );
}

/**
 * Double click at absolute screen coordinates.
 */
export async function doubleClickAt(x: number, y: number): Promise<void> {
  await execAsync(
    `osascript -e 'tell application "System Events" to double click at {${x}, ${y}}'`
  );
}

/**
 * Right click at absolute screen coordinates.
 */
export async function rightClickAt(x: number, y: number): Promise<void> {
  try {
    await execAsync(
      `osascript -e 'tell application "System Events" to click at {${x}, ${y}} with role list button'`
    );
  } catch {
    try {
      await execAsync(
        `osascript -e 'tell application "System Events" to right click at {${x}, ${y}}'`
      );
    } catch {
      // Both failed - ignore
    }
  }
}

/**
 * Type text using keyboard simulation.
 */
export async function typeText(text: string): Promise<void> {
  // Escape for AppleScript
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  await execAsync(
    `osascript -e 'tell application "System Events" to keystroke "${escaped}"'`
  );
}

/**
 * Press a key (with optional modifiers).
 */
export async function pressKey(
  key: string,
  modifiers: ("command" | "shift" | "option" | "control")[] = []
): Promise<void> {
  const modMap: Record<string, string> = {
    command: "command down",
    shift: "shift down",
    option: "option down",
    control: "control down"
  };
  const usingPart = modifiers.length
    ? ` using {${modifiers.map(m => modMap[m]).join(", ")}}`
    : "";
  await execAsync(
    `osascript -e 'tell application "System Events" to keystroke "${key}"${usingPart}'`
  );
}

/**
 * Press Enter/Return key.
 */
export async function pressEnter(): Promise<void> {
  await pressKey("return");
}

/**
 * Press Tab key.
 */
export async function pressTab(): Promise<void> {
  await pressKey("tab");
}

/**
 * Press Escape key.
 */
export async function pressEscape(): Promise<void> {
  await pressKey("escape");
}

/**
 * Paste text from clipboard (handles special chars better than typeText).
 */
export async function pasteText(text: string): Promise<void> {
  const script = `
    set oldClip to (the clipboard as text)
    set the clipboard to "${text.replace(/"/g, '\\"')}"
    delay 0.1
    tell application "System Events" to keystroke "v" using command down
    delay 0.2
    set the clipboard to oldClip
  `;
  await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
}

/**
 * Select all (Cmd+A).
 */
export async function selectAll(): Promise<void> {
  await pressKey("a", ["command"]);
}

// ------------------------------------------------------------------
// App Control
// ------------------------------------------------------------------

/**
 * Open an application by name.
 */
export async function openApp(name: string): Promise<boolean> {
  try {
    await execAsync(`open -a "${name}"`);
    await sleep(1);
    return true;
  } catch {
    return false;
  }
}

/**
 * Close an application by name.
 */
export async function closeApp(name: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "${name}" to quit'`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Focus an application (bring to front).
 */
export async function focusApp(name: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "${name}" to activate'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Utilities
// ------------------------------------------------------------------

export function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, seconds * 1000)));
}

/**
 * Wait for a condition with polling.
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeoutSeconds: number = 10,
  intervalMs: number = 500
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutSeconds * 1000) {
    if (await condition()) return true;
    await sleep(intervalMs / 1000);
  }
  return false;
}

/**
 * Check if an app is running.
 */
export async function isAppRunning(appName: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`pgrep -f "${appName}"`);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Take screenshot for debugging.
 */
export async function screenshot(path?: string): Promise<string> {
  const outPath = path || `/tmp/screenshot-${Date.now()}.png`;
  await execAsync(`screencapture "${outPath}"`);
  return outPath;
}

/**
 * Get current mouse position.
 */
export async function getMousePosition(): Promise<Point> {
  try {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to get position of mouse'`
    );
    const [x, y] = stdout.trim().split(", ").map(Number);
    return { x, y };
  } catch {
    return { x: 0, y: 0 };
  }
}

// ------------------------------------------------------------------
// Browser Automation
// ------------------------------------------------------------------

export interface BrowserInfo {
  name: string;
  running: boolean;
  url?: string;
}

/**
 * List common browsers and check if running.
 */
export async function listBrowsers(): Promise<BrowserInfo[]> {
  const browsers = [
    { name: "Safari", process: "Safari" },
    { name: "Google Chrome", process: "Google Chrome" },
    { name: "Firefox", process: "Firefox" },
    { name: "Arc", process: "Arc" },
    { name: "Brave Browser", process: "Brave Browser" },
    { name: "Microsoft Edge", process: "Microsoft Edge" },
  ];

  const results: BrowserInfo[] = [];
  for (const browser of browsers) {
    try {
      const pid = await execAsync(`pgrep -ix "${browser.process}" 2>/dev/null || echo ""`);
      const running = pid.stdout.trim().length > 0;
      results.push({ name: browser.name, running });
    } catch {
      results.push({ name: browser.name, running: false });
    }
  }
  return results;
}

/**
 * Open a URL in specified browser or default.
 */
export async function openBrowserUrl(
  url: string,
  browser: "safari" | "chrome" | "firefox" | "arc" | "default" = "default"
): Promise<{ success: boolean; browser: string; error?: string }> {
  try {
    let cmd = "";
    switch (browser) {
      case "safari":
        cmd = `open -a Safari "${url}"`;
        break;
      case "chrome":
        cmd = `open -a "Google Chrome" "${url}"`;
        break;
      case "firefox":
        cmd = `open -a Firefox "${url}"`;
        break;
      case "arc":
        cmd = `open -a Arc "${url}"`;
        break;
      default:
        cmd = `open "${url}"`;
    }

    await execAsync(cmd);
    return { success: true, browser };
  } catch (err: unknown) {
    return { success: false, browser, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Open Google Maps with navigation query.
 */
export async function openGoogleMaps(
  destination: string,
  origin?: string,
  travelMode: "driving" | "walking" | "transit" | "bicycling" = "driving"
): Promise<{ success: boolean; url: string; error?: string }> {
  try {
    const modeMap: Record<string, string> = {
      driving: "driving",
      walking: "walking",
      transit: "transit",
      bicycling: "bicycling"
    };

    const destEncoded = encodeURIComponent(destination);
    let url = `https://www.google.com/maps/dir/?api=1&destination=${destEncoded}`;

    if (origin) {
      url += `&origin=${encodeURIComponent(origin)}`;
    }

    url += `&travelmode=${modeMap[travelMode]}`;

    await openBrowserUrl(url, "default");
    return { success: true, url };
  } catch (err: unknown) {
    return { success: false, url: "", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Search Google Maps for a place.
 */
export async function searchGoogleMaps(
  query: string
): Promise<{ success: boolean; url: string; error?: string }> {
  try {
    const queryEncoded = encodeURIComponent(query);
    const url = `https://www.google.com/maps/search/?api=1&query=${queryEncoded}`;
    await openBrowserUrl(url, "default");
    return { success: true, url };
  } catch (err: unknown) {
    return { success: false, url: "", error: err instanceof Error ? err.message : String(err) };
  }
}