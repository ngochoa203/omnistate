/**
 * Browser Tools — Group 3
 * Implements 10 browser automation operations for Safari/Chrome.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Browser Detection
// ------------------------------------------------------------------

type Browser = "safari" | "chrome";

async function getActiveBrowser(): Promise<Browser> {
  try {
    const { stdout } = await execAsync(
      'osascript -e \'tell application "System Events" to get name of first process whose frontmost is true\'',
      { encoding: "utf-8" }
    );
    const app = stdout.trim().toLowerCase();
    if (app.includes("chrome")) return "chrome";
    if (app.includes("safari")) return "safari";
    return "safari"; // default
  } catch {
    return "safari";
  }
}

// ------------------------------------------------------------------
// UC1: Open URL in Browser
// ------------------------------------------------------------------

export async function openUrl(url: string, browser?: Browser): Promise<boolean> {
  try {
    if (browser === "chrome") {
      await execAsync(`open -a "Google Chrome" "${url}"`);
    } else {
      await execAsync(`open -a "Safari" "${url}"`);
    }
    return true;
  } catch (e) {
    console.error("openUrl failed:", e);
    return false;
  }
}

export async function openSafariGithub(): Promise<boolean> {
  return openUrl("https://github.com", "safari");
}

// ------------------------------------------------------------------
// UC2: Google Search
// ------------------------------------------------------------------

export async function googleSearch(query: string): Promise<boolean> {
  const encoded = encodeURIComponent(query);
  return openUrl(`https://www.google.com/search?q=${encoded}`, "chrome");
}

export async function googleSearchSepay(): Promise<boolean> {
  return googleSearch("cách cấu hình SePay API");
}

// ------------------------------------------------------------------
// UC3: Open Incognito/Private Window
// ------------------------------------------------------------------

export async function openIncognitoWindow(): Promise<boolean> {
  try {
    // Chrome private window
    await execAsync(`osascript -e 'tell application "Google Chrome"
      make new window
      tell active window
        execute javascript "chrome.tabs.create({incognito: true})"
      end tell
    end tell' 2>/dev/null || true`);
    
    // Fallback: use keyboard shortcut
    await execAsync(`osascript -e 'tell application "Google Chrome" to activate'`);
    await execAsync(`osascript -e 'tell application "System Events" to keystroke "n" using {command down, shift down}'`);
    return true;
  } catch (e) {
    console.error("openIncognitoWindow failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// UC4: Close All Browser Tabs
// ------------------------------------------------------------------

export async function closeAllBrowserTabs(browser?: Browser): Promise<boolean> {
  try {
    const b = browser || await getActiveBrowser();
    if (b === "chrome") {
      await execAsync(`osascript -e 'tell application "Google Chrome" to close every tab'`);
    } else {
      await execAsync(`osascript -e 'tell application "Safari" to close every tab'`);
    }
    return true;
  } catch (e) {
    console.error("closeAllBrowserTabs failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// UC5: YouTube Operations
// ------------------------------------------------------------------

export async function youtubeSearch(query: string): Promise<boolean> {
  const encoded = encodeURIComponent(query);
  return openUrl(`https://www.youtube.com/results?search_query=${encoded}`);
}

export async function youtubeLofiCoding(): Promise<boolean> {
  return youtubeSearch("lofi coding music");
}

export async function youtubePlayVideo(videoId?: string): Promise<boolean> {
  const url = videoId ? `https://www.youtube.com/watch?v=${videoId}` : "https://www.youtube.com";
  return openUrl(url);
}

// ------------------------------------------------------------------
// UC6: Get Active Tab URL
// ------------------------------------------------------------------

export async function getActiveTabUrl(browser?: Browser): Promise<string | null> {
  try {
    const b = browser || await getActiveBrowser();
    if (b === "chrome") {
      const script = `osascript -e 'tell application "Google Chrome"
        get URL of active tab of active window
      end tell'`;
      const { stdout } = await execAsync(script, { encoding: "utf-8" });
      return stdout.trim();
    } else {
      const script = `osascript -e 'tell application "Safari"
        get URL of front document
      end tell'`;
      const { stdout } = await execAsync(script, { encoding: "utf-8" });
      return stdout.trim();
    }
  } catch (e) {
    console.error("getActiveTabUrl failed:", e);
    return null;
  }
}

// ------------------------------------------------------------------
// UC7: Reload Current Page
// ------------------------------------------------------------------

export async function reloadCurrentPage(browser?: Browser): Promise<boolean> {
  try {
    const b = browser || await getActiveBrowser();
    if (b === "chrome") {
      await execAsync(`osascript -e 'tell application "Google Chrome" to reload active tab of active window'`);
    } else {
      await execAsync(`osascript -e 'tell application "Safari" to reload'`);
    }
    return true;
  } catch (e) {
    console.error("reloadCurrentPage failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// UC8: Google Maps Directions
// ------------------------------------------------------------------

export async function googleMapsDirections(destination: string): Promise<boolean> {
  const encoded = encodeURIComponent(destination);
  return openUrl(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`);
}

export async function googleMapsTo(coffeeShop: string): Promise<boolean> {
  return googleMapsDirections(coffeeShop);
}

// ------------------------------------------------------------------
// UC9: Bookmark Current Page
// ------------------------------------------------------------------

export async function bookmarkCurrentPage(title?: string, browser?: Browser): Promise<boolean> {
  try {
    const b = browser || await getActiveBrowser();
    const url = await getActiveTabUrl(b);
    
    if (!url) return false;
    
    // Add to Safari/Chrome bookmarks via AppleScript
    if (b === "safari") {
      await execAsync(`osascript -e 'tell application "Safari"
        tell window 1
          make new bookmark item with properties {URL:"${url}", name:"${title || url}"}
        end tell
      end tell'`);
    } else {
      // Chrome bookmark API
      await execAsync(`osascript -e 'tell application "Google Chrome"
        add bookmark of active tab of active window
      end tell'`);
    }
    return true;
  } catch (e) {
    console.error("bookmarkCurrentPage failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// UC10: Find Places Near Location
// ------------------------------------------------------------------

export async function findNearby(category: string, location: string): Promise<boolean> {
  const encoded = encodeURIComponent(`${category} near ${location}`);
  return openUrl(`https://www.google.com/maps/search/${encoded}`);
}

export async function findBunChaDaNang(): Promise<boolean> {
  return findNearby("Bún Chả", "Đà Nẵng");
}

export async function findCoffeeShop(name: string, location?: string): Promise<boolean> {
  const query = name + (location ? ` ${location}` : "");
  return findNearby("quán cà phê", query);
}

// ------------------------------------------------------------------
// Layer Export
// ------------------------------------------------------------------

export class BrowserLayer {
  openUrl = openUrl;
  openSafariGithub = openSafariGithub;
  googleSearch = googleSearch;
  googleSearchSepay = googleSearchSepay;
  openIncognitoWindow = openIncognitoWindow;
  closeAllBrowserTabs = closeAllBrowserTabs;
  youtubeSearch = youtubeSearch;
  youtubeLofiCoding = youtubeLofiCoding;
  youtubePlayVideo = youtubePlayVideo;
  getActiveTabUrl = getActiveTabUrl;
  reloadCurrentPage = reloadCurrentPage;
  googleMapsDirections = googleMapsDirections;
  googleMapsTo = googleMapsTo;
  bookmarkCurrentPage = bookmarkCurrentPage;
  findNearby = findNearby;
  findBunChaDaNang = findBunChaDaNang;
  findCoffeeShop = findCoffeeShop;
}
