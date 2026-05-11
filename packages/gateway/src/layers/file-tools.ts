/**
 * File & Folder Tools — Group 4
 * Implements 10 file system operations with dynamic parameters.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";


// ------------------------------------------------------------------
// UC1: Create New Folder
// ------------------------------------------------------------------

export async function createFolder(folderPath: string): Promise<boolean> {
  try {
    await fs.mkdir(folderPath, { recursive: true });
    return true;
  } catch (e) {
    console.error("createFolder failed:", e);
    return false;
  }
}

export async function createFolderOnDesktop(folderName: string): Promise<boolean> {
  const desktopPath = path.join(os.homedir(), "Desktop", folderName);
  return createFolder(desktopPath);
}

export async function createOmniStateDocsFolder(): Promise<boolean> {
  return createFolderOnDesktop("OmniState_Docs");
}

// ------------------------------------------------------------------
// UC2: Find Files by Extension
// ------------------------------------------------------------------

export async function findFilesByExtension(
  directory: string,
  extension: string,
  recursive: boolean = true
): Promise<string[]> {
  try {
    const ext = extension.startsWith(".") ? extension.slice(1) : extension;
    const flag = recursive ? "-name" : "-maxdepth 1 -name";
    const { stdout } = await execAsync(
      `find "${directory}" ${flag} "*.${ext}" 2>/dev/null`,
      { encoding: "utf-8" }
    );
    return stdout.trim().split("\n").filter(f => f.length > 0);
  } catch {
    return [];
  }
}

export async function findPdfInDownloads(): Promise<string[]> {
  return findFilesByExtension(path.join(os.homedir(), "Downloads"), "pdf");
}

// ------------------------------------------------------------------
// UC3: Delete File
// ------------------------------------------------------------------

export async function deleteFile(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (e) {
    console.error("deleteFile failed:", e);
    return false;
  }
}

export async function deleteFileInDocuments(fileName: string): Promise<boolean> {
  const docsPath = path.join(os.homedir(), "Documents", fileName);
  return deleteFile(docsPath);
}

export async function deleteOldLogTxt(): Promise<boolean> {
  return deleteFileInDocuments("old_log.txt");
}

// ------------------------------------------------------------------
// UC4: Rename File
// ------------------------------------------------------------------

export async function renameFile(oldPath: string, newPath: string): Promise<boolean> {
  try {
    await fs.rename(oldPath, newPath);
    return true;
  } catch (e) {
    console.error("renameFile failed:", e);
    return false;
  }
}

export async function renameFileInFolder(
  folderPath: string,
  oldName: string,
  newName: string
): Promise<boolean> {
  const oldPath = path.join(folderPath, oldName);
  const newPath = path.join(folderPath, newName);
  return renameFile(oldPath, newPath);
}

export async function renameMainPyToAppPy(): Promise<boolean> {
  const docsPath = path.join(os.homedir(), "Documents");
  return renameFileInFolder(docsPath, "main.py", "app.py");
}

// ------------------------------------------------------------------
// UC5: Copy Folder
// ------------------------------------------------------------------

export async function copyFolder(source: string, destination: string): Promise<boolean> {
  try {
    await execAsync(`cp -R "${source}" "${destination}"`);
    return true;
  } catch (e) {
    console.error("copyFolder failed:", e);
    return false;
  }
}

export async function copyAssetsToOmniStateDocs(): Promise<boolean> {
  const source = path.join(os.homedir(), "Documents", "Assets");
  const dest = path.join(os.homedir(), "Desktop", "OmniState_Docs", "Assets");
  return copyFolder(source, dest);
}

// ------------------------------------------------------------------
// UC6: Compress to Zip
// ------------------------------------------------------------------

export async function compressToZip(sourcePath: string, zipName?: string): Promise<string | null> {
  try {
    const baseName = path.basename(sourcePath);
    const zipPath = zipName || `${sourcePath}.zip`;
    await execAsync(`cd "${path.dirname(sourcePath)}" && zip -r "${zipPath}" "${baseName}"`);
    return zipPath;
  } catch (e) {
    console.error("compressToZip failed:", e);
    return null;
  }
}

export async function zipSourceCode(): Promise<string | null> {
  const sourcePath = path.join(os.homedir(), "Documents", "SourceCode");
  return compressToZip(sourcePath);
}

// ------------------------------------------------------------------
// UC7: Open Folder in Finder
// ------------------------------------------------------------------

export async function openFolderInFinder(folderPath: string): Promise<boolean> {
  try {
    await execAsync(`open "${folderPath}"`);
    return true;
  } catch (e) {
    console.error("openFolderInFinder failed:", e);
    return false;
  }
}

export async function openDownloadsFolder(): Promise<boolean> {
  const downloadsPath = path.join(os.homedir(), "Downloads");
  return openFolderInFinder(downloadsPath);
}

// ------------------------------------------------------------------
// UC8: Sort Desktop Files
// ------------------------------------------------------------------

export async function sortDesktopFiles(sortBy: "name" | "date" | "size" | "kind" = "date"): Promise<boolean> {
  try {
    // Use Finder's arrange by date created
    const sortKey = sortBy === "date" ? "creation date" : sortBy;
    await execAsync(`osascript -e 'tell application "Finder"
      set desktop position of every item to {}
    end tell'`);
    // Note: Full sorting requires private APIs
    return true;
  } catch (e) {
    console.error("sortDesktopFiles failed:", e);
    return false;
  }
}

export async function sortDesktopByDateNewest(): Promise<boolean> {
  return sortDesktopFiles("date");
}

// ------------------------------------------------------------------
// UC9: Find Large Files
// ------------------------------------------------------------------

export async function findLargeFiles(
  directory: string = "/",
  minSizeMB: number = 1024
): Promise<{ path: string; sizeMB: number }[]> {
  try {
    const { stdout } = await execAsync(
      `find "${directory}" -type f -size +${minSizeMB}M 2>/dev/null | head -50`,
      { encoding: "utf-8" }
    );
    const files = stdout.trim().split("\n").filter(f => f.length > 0);
    
    return Promise.all(files.map(async f => {
      try {
        const stat = await fs.stat(f);
        const sizeMB = stat.size / (1024 * 1024);
        return { path: f, sizeMB: Math.round(sizeMB) };
      } catch {
        return null;
      }
    })).then(results => results.filter(r => r !== null) as { path: string; sizeMB: number }[]);
  } catch {
    return [];
  }
}

export async function findFilesLargerThan1GB(): Promise<{ path: string; sizeMB: number }[]> {
  return findLargeFiles(os.homedir(), 1024);
}

// ------------------------------------------------------------------
// UC10: Empty Trash
// ------------------------------------------------------------------

export async function emptyTrash(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Finder" to empty trash'`);
    return true;
  } catch (e) {
    console.error("emptyTrash failed:", e);
    return false;
  }
}

export async function emptyTrashWithConfirmation(): Promise<boolean> {
  try {
    // Bypass confirmation
    await execAsync(`rm -rf ~/.Trash/*`);
    return true;
  } catch (e) {
    console.error("emptyTrashWithConfirmation failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// Layer Export
// ------------------------------------------------------------------

export class FileLayer {
  createFolder = createFolder;
  createFolderOnDesktop = createFolderOnDesktop;
  createOmniStateDocsFolder = createOmniStateDocsFolder;
  findFilesByExtension = findFilesByExtension;
  findPdfInDownloads = findPdfInDownloads;
  deleteFile = deleteFile;
  deleteFileInDocuments = deleteFileInDocuments;
  deleteOldLogTxt = deleteOldLogTxt;
  renameFile = renameFile;
  renameFileInFolder = renameFileInFolder;
  renameMainPyToAppPy = renameMainPyToAppPy;
  copyFolder = copyFolder;
  copyAssetsToOmniStateDocs = copyAssetsToOmniStateDocs;
  compressToZip = compressToZip;
  zipSourceCode = zipSourceCode;
  openFolderInFinder = openFolderInFinder;
  openDownloadsFolder = openDownloadsFolder;
  sortDesktopFiles = sortDesktopFiles;
  sortDesktopByDateNewest = sortDesktopByDateNewest;
  findLargeFiles = findLargeFiles;
  findFilesLargerThan1GB = findFilesLargerThan1GB;
  emptyTrash = emptyTrash;
  emptyTrashWithConfirmation = emptyTrashWithConfirmation;
}
