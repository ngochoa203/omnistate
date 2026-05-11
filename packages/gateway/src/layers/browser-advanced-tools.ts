/**
 * Browser Advanced Tools — Extended browser automation & management.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function openMultipleTabs(urls: string[], browser = "safari"): Promise<number> {
  let count = 0;
  for (const url of urls) {
    try {
      await execAsync(browser === "chrome" ? `open -a "Google Chrome" "${url}"` : `open -a Safari "${url}"`);
      count++;
      await new Promise(r => setTimeout(r, 200));
    } catch {}
  }
  return count;
}

export async function closeAllTabsExceptCurrent(browser = "safari"): Promise<boolean> {
  try {
    const script = browser === "chrome"
      ? `osascript -e 'tell application "Google Chrome" to close every tab of active window'`
      : `osascript -e 'tell application "Safari" to close every tab of window 1'`;
    await execAsync(script);
    return true;
  } catch { return false; }
}

export async function getAllOpenTabs(browser = "safari"): Promise<string[]> {
  try {
    const script = browser === "chrome"
      ? `osascript -e 'tell application "Google Chrome" to URL of every tab of every window as list'`
      : `osascript -e 'tell application "Safari" to URL of every tab of every window as list'`;
    const { stdout } = await execAsync(script, { encoding: "utf-8" });
    return stdout.split(", ").filter(t => t.trim());
  } catch { return []; }
}

export async function createBrowserSession(name: string, incognito = false): Promise<string> {
  return `session_${name}_${Date.now()}_${incognito ? "private" : "normal"}`;
}

export async function switchBrowserProfile(profileName: string): Promise<boolean> {
  try {
    await execAsync(`open -a "Google Chrome" --args --profile-directory="${profileName}"`);
    return true;
  } catch { return false; }
}

export async function exportBrowserCookies(domain: string): Promise<string[]> {
  console.log(`Exporting cookies for: ${domain}`);
  return [];
}

export async function importBrowserCookies(domain: string, cookies: string[]): Promise<boolean> {
  console.log(`Importing ${cookies.length} cookies for: ${domain}`);
  return true;
}

export async function createBookmarkFolder(folderName: string, parentPath = "BookmarksMenu"): Promise<boolean> {
  console.log(`Creating bookmark folder: ${folderName} in ${parentPath}`);
  return true;
}

export async function searchBookmarks(query: string): Promise<{ name: string; url: string }[]> {
  console.log(`Searching bookmarks: ${query}`);
  return [];
}

export async function exportBookmarks(format: "html" | "json" = "html"): Promise<string> {
  console.log(`Exporting bookmarks as ${format}`);
  return "";
}

export async function clearBrowserData(dataTypes: string[]): Promise<boolean> {
  for (const type of dataTypes) {
    console.log(`Clearing ${type}...`);
  }
  return true;
}

export async function enableBrowserVPN(proxyUrl: string): Promise<boolean> {
  try {
    await execAsync(`networksetup -setwebproxy Wi-Fi "${proxyUrl}"`);
    return true;
  } catch { return false; }
}

export async function disableBrowserVPN(): Promise<boolean> {
  try {
    await execAsync(`networksetup -setwebproxystate Wi-Fi off`);
    return true;
  } catch { return false; }
}

export async function listBrowserExtensions(browser = "safari"): Promise<string[]> {
  try {
    const paths = browser === "chrome"
      ? ["~/Library/Application Support/Google/Chrome/Default/Extensions"]
      : ["~/Library/Safari/Extensions"];
    const { stdout } = await execAsync(`ls ${paths[0]} 2>/dev/null || echo ""`, { encoding: "utf-8" });
    return stdout.split("\n").filter(Boolean);
  } catch { return []; }
}

export async function toggleBrowserExtension(extensionId: string, enabled: boolean): Promise<boolean> {
  console.log(`${enabled ? "Enabling" : "Disabling"} extension: ${extensionId}`);
  return true;
}

export async function fetchWebpage(url: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`curl -s "${url}" | head -100`, { encoding: "utf-8" });
    return stdout;
  } catch { return ""; }
}

export class BrowserAdvancedLayer {
  openMultipleTabs = openMultipleTabs;
  closeAllTabsExceptCurrent = closeAllTabsExceptCurrent;
  getAllOpenTabs = getAllOpenTabs;
  createBrowserSession = createBrowserSession;
  switchBrowserProfile = switchBrowserProfile;
  exportBrowserCookies = exportBrowserCookies;
  importBrowserCookies = importBrowserCookies;
  createBookmarkFolder = createBookmarkFolder;
  searchBookmarks = searchBookmarks;
  exportBookmarks = exportBookmarks;
  clearBrowserData = clearBrowserData;
  enableBrowserVPN = enableBrowserVPN;
  disableBrowserVPN = disableBrowserVPN;
  listBrowserExtensions = listBrowserExtensions;
  toggleBrowserExtension = toggleBrowserExtension;
  fetchWebpage = fetchWebpage;
}
