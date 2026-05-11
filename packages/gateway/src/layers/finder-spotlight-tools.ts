/**
 * Finder & Spotlight Tools — Group 18
 * Implements: Finder operations, Spotlight search, file categorization
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";


// ------------------------------------------------------------------
// Finder Window Operations
// ------------------------------------------------------------------

export async function openInFinder(targetPath: string): Promise<boolean> {
  try {
    await execAsync(`open "${targetPath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function revealInFinder(filePath: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Finder" to reveal POSIX file "${filePath}"'`);
    return true;
  } catch {
    return false;
  }
}

export async function closeAllFinderWindows(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Finder" to close every window'`);
    return true;
  } catch {
    return false;
  }
}

export async function newFinderWindow(path?: string): Promise<boolean> {
  try {
    const p = path ? `"${path}"` : "";
    await execAsync(`osascript -e 'tell application "Finder" to make new Finder window to POSIX file ${p}'`);
    return true;
  } catch {
    return false;
  }
}

export async function navigateFinder(path: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Finder" to set target of first window to POSIX file "${path}"'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Finder Selection Operations
// ------------------------------------------------------------------

export async function getFinderSelection(): Promise<string[]> {
  try {
    const script = `osascript -e 'tell application "Finder" to get selection as alias list'`;
    const { stdout } = await execAsync(script, { encoding: "utf-8" });
    
    if (!stdout.trim() || stdout.includes("missing value")) return [];
    
    return stdout.split(", ").map(f => f.replace(/alias /g, "").replace(/"/g, ""));
  } catch {
    return [];
  }
}

export async function selectFileInFinder(filePath: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Finder" to select POSIX file "${filePath}"'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Finder View Options
// ------------------------------------------------------------------

export async function setFinderView(view: "icon" | "list" | "column" | "coverflow"): Promise<boolean> {
  try {
    const viewMap = {
      "icon": "icon view",
      "list": "list view",
      "column": "column view",
      "coverflow": "flow view"
    };
    
    await execAsync(`osascript -e 'tell application "Finder" to set current view of first window to ${viewMap[view]}'`);
    return true;
  } catch {
    return false;
  }
}

export async function setFinderSortBy(sortBy: "name" | "date" | "size" | "kind" | "dateModified"): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Finder" to set arrange by of first window to ${sortBy}'`);
    return true;
  } catch {
    return false;
  }
}

export async function showHiddenFiles(show: boolean): Promise<boolean> {
  try {
    await execAsync(`defaults write com.apple.finder AppleShowAllFiles ${show ? "true" : "false"}`);
    await execAsync("killall Finder");
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Spotlight Search
// ------------------------------------------------------------------

export interface SpotlightResult {
  name: string;
  path: string;
  type: string;
  dateModified: Date;
}

export async function spotlightSearch(query: string, scope?: string): Promise<SpotlightResult[]> {
  try {
    const scopeFlag = scope ? `-a "${scope}"` : "";
    const { stdout } = await execAsync(
      `mdfind -onlyin ${scope || "."} "${query}" 2>/dev/null | head -50`,
      { encoding: "utf-8" }
    );
    
    return stdout.trim().split("\n").filter(l => l.trim()).map(f => ({
      name: path.basename(f),
      path: f,
      type: "file",
      dateModified: new Date()
    }));
  } catch {
    return [];
  }
}

export async function spotlightFiles(extension: string): Promise<SpotlightResult[]> {
  return spotlightSearch(`kMDItemFSName == "*.${extension}"`);
}

export async function spotlightByDate(startDate: Date, endDate: Date): Promise<SpotlightResult[]> {
  const start = startDate.toISOString();
  const end = endDate.toISOString();
  return spotlightSearch(`kMDItemFSCreationDate >= "${start}" && kMDItemFSCreationDate <= "${end}"`);
}

// ------------------------------------------------------------------
// Smart Folders
// ------------------------------------------------------------------

export async function createSmartFolder(
  name: string,
  searchCriteria: { kind?: string; date?: string; name?: string }[],
  savePath: string
): Promise<boolean> {
  try {
    // Create smart folder plist
    const sfPath = path.join(savePath, `${name}.smartfolder`);
    await fs.writeFile(sfPath, JSON.stringify({ name, criteria: searchCriteria }));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Recent Items
// ------------------------------------------------------------------

export async function getRecentDocuments(limit: number = 20): Promise<{ name: string; path: string; date: Date }[]> {
  try {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to get name of every item of recent documents'`,
      { encoding: "utf-8" }
    );
    
    return stdout.split(", ").map((name, i) => ({
      name: name.trim(),
      path: "",
      date: new Date()
    })).slice(0, limit);
  } catch {
    return [];
  }
}

export async function getRecentApplications(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to get name of every item of recent applications'`,
      { encoding: "utf-8" }
    );
    
    return stdout.split(", ").map(n => n.trim());
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// File Tags (macOS Tags)
// ------------------------------------------------------------------

export async function getFileTags(filePath: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`mdls -name kMDItemUserTags "${filePath}" 2>/dev/null || echo ""`, { encoding: "utf-8" });
    const match = stdout.match(/\(([^)]+)\)/);
    return match ? match[1].split(", ") : [];
  } catch {
    return [];
  }
}

export async function setFileTags(filePath: string, tags: string[]): Promise<boolean> {
  try {
    const tagsStr = tags.join(",");
    await execAsync(`xattr -w com.apple.metadata:_kMDItemUserTags "<array>${tagsStr}</array>" "${filePath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function addFileTag(filePath: string, tag: string): Promise<boolean> {
  const current = await getFileTags(filePath);
  if (!current.includes(tag)) {
    return setFileTags(filePath, [...current, tag]);
  }
  return true;
}

export async function removeFileTag(filePath: string, tag: string): Promise<boolean> {
  const current = await getFileTags(filePath);
  return setFileTags(filePath, current.filter(t => t !== tag));
}

// ------------------------------------------------------------------
// Desktop Operations
// ------------------------------------------------------------------

export async function getDesktopItems(): Promise<{ name: string; path: string }[]> {
  try {
    const desktopPath = path.join(os.homedir(), "Desktop");
    const files = await fs.readdir(desktopPath);
    return files.map(name => ({ name, path: path.join(desktopPath, name) }));
  } catch {
    return [];
  }
}

export async function cleanDesktop(): Promise<{ moved: number; deleted: number }> {
  try {
    const desktopPath = path.join(os.homedir(), "Desktop");
    const downloadsPath = path.join(os.homedir(), "Downloads");
    
    // Move files to Downloads
    const files = await fs.readdir(desktopPath);
    let moved = 0;
    
    for (const file of files) {
      if (!file.startsWith(".")) {
        const src = path.join(desktopPath, file);
        const dest = path.join(downloadsPath, file);
        try {
          await fs.rename(src, dest);
          moved++;
        } catch {
          // File already exists in downloads
        }
      }
    }
    
    return { moved, deleted: 0 };
  } catch {
    return { moved: 0, deleted: 0 };
  }
}

export class FinderSpotlightLayer {
  open = openInFinder;
  reveal = revealInFinder;
  closeAll = closeAllFinderWindows;
  newWindow = newFinderWindow;
  navigate = navigateFinder;
  
  getSelection = getFinderSelection;
  selectFile = selectFileInFinder;
  
  setView = setFinderView;
  setSort = setFinderSortBy;
  showHidden = showHiddenFiles;
  
  spotlight = spotlightSearch;
  spotlightFiles = spotlightFiles;
  spotlightByDate = spotlightByDate;
  
  createSmartFolder = createSmartFolder;
  
  getRecentDocs = getRecentDocuments;
  getRecentApps = getRecentApplications;
  
  getTags = getFileTags;
  setTags = setFileTags;
  addTag = addFileTag;
  removeTag = removeFileTag;
  
  getDesktopItems = getDesktopItems;
  cleanDesktop = cleanDesktop;
}
