/**
 * File Advanced Tools — Extended file operations, batch processing.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import * as fs from "node:fs";
import * as path from "node:path";


export async function batchRename(directory: string, pattern: string, replacement: string, dryRun = false): Promise<{ renamed: string[]; failed: string[] }> {
  const renamed: string[] = [];
  const failed: string[] = [];
  try {
    const { stdout } = await execAsync(`find "${directory}" -maxdepth 1 -type f -name "${pattern}" 2>/dev/null || echo ""`, { encoding: "utf-8" });
    const files = stdout.split("\n").filter(Boolean);
    for (const file of files) {
      const base = path.basename(file);
      const newName = base.replace(new RegExp(pattern.replace(/\*/g, ".*")), replacement);
      if (dryRun) {
        renamed.push(`${file} → ${newName}`);
      } else {
        try {
          await execAsync(`mv "${file}" "${path.join(directory, newName)}"`);
          renamed.push(newName);
        } catch { failed.push(file); }
      }
    }
  } catch (e) { console.error(e); }
  return { renamed, failed };
}

export async function renameByDate(directory: string, format = "%Y%m%d"): Promise<string[]> {
  const renamed: string[] = [];
  try {
    const files = await fs.promises.readdir(directory);
    for (const file of files) {
      const filepath = path.join(directory, file);
      const stat = await fs.promises.stat(filepath);
      const ext = path.extname(file);
      const base = path.basename(file, ext);
      const dateStr = new Date(stat.mtime).toISOString().split("T")[0].replace(/-/g, "");
      await execAsync(`mv "${filepath}" "${path.join(directory, `${dateStr}_${base}${ext}`)}"`);
      renamed.push(file);
    }
  } catch (e) { console.error(e); }
  return renamed;
}

export async function compareFiles(file1: string, file2: string): Promise<{ identical: boolean; diff?: string }> {
  try {
    const { stdout } = await execAsync(`diff -u "${file1}" "${file2}" || true`, { encoding: "utf-8" });
    return { identical: stdout === "", diff: stdout || undefined };
  } catch { return { identical: false }; }
}

export async function findLargeFiles(directory: string, minSizeMB = 100): Promise<{ path: string; size: number }[]> {
  try {
    const { stdout } = await execAsync(`find "${directory}" -type f -size +${minSizeMB}M -exec ls -lh {} \; 2>/dev/null | sort -k5 -rh | head -20`, { encoding: "utf-8" });
    return stdout.split("\n").filter(Boolean).map(line => {
      const match = line.match(/(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)/);
      if (match) {
        const sizeStr = match[5];
        const sizeNum = parseFloat(sizeStr) * (sizeStr.includes("G") ? 1024 : 1);
        return { path: match[6], size: sizeNum };
      }
      return { path: line, size: 0 };
    }).filter(f => f.size > 0);
  } catch { return []; }
}

export async function findDuplicateFiles(directory: string): Promise<Map<string, string[]>> {
  const sizeMap = new Map<number, string[]>();
  const dupMap = new Map<string, string[]>();
  try {
    const { stdout } = await execAsync(`find "${directory}" -type f -exec stat -f %z %N \; 2>/dev/null`, { encoding: "utf-8" });
    stdout.split("\n").filter(Boolean).forEach(line => {
      const parts = line.split("\t");
      if (parts.length >= 2) {
        const size = parseInt(parts[0], 10);
        const file = parts[1].trim();
        if (!sizeMap.has(size)) sizeMap.set(size, []);
        sizeMap.get(size)!.push(file);
      }
    });
    for (const [size, files] of sizeMap) {
      if (files.length > 1) {
        const hashMap = new Map<string, string[]>();
        for (const file of files) {
          const { stdout: hash } = await execAsync(`md5 -q "${file}" 2>/dev/null || echo ""`, { encoding: "utf-8" });
          if (hash) {
            if (!hashMap.has(hash)) hashMap.set(hash, []);
            hashMap.get(hash)!.push(file);
          }
        }
        hashMap.forEach((f) => { if (f.length > 1) dupMap.set(hashMap.keys().next().value || "", f); });
      }
    }
  } catch (e) { console.error(e); }
  return dupMap;
}

export async function emptyTrash(confirm = false): Promise<boolean> {
  if (!confirm) return false;
  try {
    await execAsync(`osascript -e 'tell application "Finder" to empty trash'`);
    return true;
  } catch { return false; }
}

export async function getFileMetadata(filePath: string): Promise<{ created: Date; modified: Date; size: number; permissions: string }> {
  try {
    const stat = await fs.promises.stat(filePath);
    const { stdout } = await execAsync(`stat -f %Sp "${filePath}"`, { encoding: "utf-8" });
    return { created: stat.birthtime, modified: stat.mtime, size: stat.size, permissions: stdout.trim() };
  } catch { return { created: new Date(), modified: new Date(), size: 0, permissions: "" }; }
}

export async function createArchive(source: string, dest: string, format: "zip" | "tar" | "tgz" = "zip"): Promise<boolean> {
  try {
    const cmd = format === "zip" ? `zip -r "${dest}" "${source}"` : format === "tgz" ? `tar -czf "${dest}" -C "${path.dirname(source)}" "${path.basename(source)}"` : `tar -cf "${dest}" -C "${path.dirname(source)}" "${path.basename(source)}"`;
    await execAsync(cmd);
    return true;
  } catch { return false; }
}

export async function extractArchive(archivePath: string, destDir: string): Promise<boolean> {
  try {
    const ext = path.extname(archivePath);
    const cmd = ext === ".zip" ? `unzip -o "${archivePath}" -d "${destDir}"` : ext === ".tgz" ? `tar -xzf "${archivePath}" -C "${destDir}"` : `tar -xf "${archivePath}" -C "${destDir}"`;
    await execAsync(cmd);
    return true;
  } catch { return false; }
}

export class FileAdvancedLayer {
  batchRename = batchRename;
  renameByDate = renameByDate;
  compareFiles = compareFiles;
  findLargeFiles = findLargeFiles;
  findDuplicateFiles = findDuplicateFiles;
  emptyTrash = emptyTrash;
  getFileMetadata = getFileMetadata;
  createArchive = createArchive;
  extractArchive = extractArchive;
}
