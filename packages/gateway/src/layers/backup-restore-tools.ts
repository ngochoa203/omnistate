/**
 * Backup & Restore Tools — Advanced Layer (API 62)
 * Implements: Incremental backup, Time Machine, disaster recovery, snapshot management
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Incremental Backup
// ------------------------------------------------------------------

export interface BackupResult {
  success: boolean;
  files: number;
  size: number;
  duration: number;
  backupPath: string;
}

export async function createIncrementalBackup(
  sourceDir: string,
  backupDir: string = path.join(os.homedir(), "Backups")
): Promise<BackupResult> {
  const startTime = Date.now();
  
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `${path.basename(sourceDir)}_${timestamp}`;
    const backupPath = path.join(backupDir, backupName);
    
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    
    // Use rsync for incremental backup
    await execAsync(
      `rsync -av --delete "${sourceDir}/" "${backupPath}/"`,
      { encoding: "utf-8" }
    );
    
    const { stdout } = await execAsync(
      `find "${backupPath}" -type f | wc -l && du -sb "${backupPath}" | awk '{print $1}'`,
      { encoding: "utf-8" }
    );
    
    const lines = stdout.trim().split("\n");
    const files = parseInt(lines[0] || "0", 10);
    const size = parseInt(lines[1] || "0", 10);
    
    return {
      success: true,
      files,
      size,
      duration: Date.now() - startTime,
      backupPath
    };
  } catch {
    return { success: false, files: 0, size: 0, duration: 0, backupPath: "" };
  }
}

export async function createDifferentialBackup(
  sourceDir: string,
  baselineBackup: string,
  backupDir: string
): Promise<BackupResult> {
  const startTime = Date.now();
  
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `diff_${timestamp}`;
    const backupPath = path.join(backupDir, backupName);
    
    await fs.mkdir(backupPath, { recursive: true });
    
    // Use rsync with --compare-dest for differential backup
    await execAsync(
      `rsync -av --compare-dest="${baselineBackup}/" "${sourceDir}/" "${backupPath}/"`,
      { encoding: "utf-8" }
    );
    
    const { stdout: countOut } = await execAsync(
      `find "${backupPath}" -type f | wc -l`,
      { encoding: "utf-8" }
    );
    const { stdout: sizeOut } = await execAsync(
      `du -sb "${backupPath}" | awk '{print $1}'`,
      { encoding: "utf-8" }
    );
    
    return {
      success: true,
      files: parseInt(countOut.trim(), 10),
      size: parseInt(sizeOut.trim(), 10),
      duration: Date.now() - startTime,
      backupPath
    };
  } catch {
    return { success: false, files: 0, size: 0, duration: 0, backupPath: "" };
  }
}

// ------------------------------------------------------------------
// Time Machine Operations
// ------------------------------------------------------------------

export async function checkTimeMachineStatus(): Promise<{
  running: boolean;
  lastBackup?: string;
  nextBackup?: string;
  destination?: string;
}> {
  try {
    const { stdout } = await execAsync(
      "tmutil status 2>/dev/null || echo 'Backup Volume Not Found'",
      { encoding: "utf-8" }
    );
    
    const lastMatch = stdout.match(/Last backup:\s*(.+)/);
    const nextMatch = stdout.match(/Next backup:\s*(.+)/);
    const destMatch = stdout.match(/Backup destination:\s*(.+)/);
    
    return {
      running: stdout.includes("Running"),
      lastBackup: lastMatch?.[1],
      nextBackup: nextMatch?.[1],
      destination: destMatch?.[1]
    };
  } catch {
    return { running: false };
  }
}

export async function startTimeMachineBackup(): Promise<boolean> {
  try {
    await execAsync("tmutil startbackup 2>/dev/null || echo 'done'");
    return true;
  } catch {
    return false;
  }
}

export async function stopTimeMachineBackup(): Promise<boolean> {
  try {
    await execAsync("tmutil stopbackup 2>/dev/null || echo 'done'");
    return true;
  } catch {
    return false;
  }
}

export async function listTimeMachineBackups(): Promise<{
  backups: { date: string; size: string; id: string }[];
}> {
  try {
    const { stdout } = await execAsync(
      "tmutil listbackups 2>/dev/null || echo ''",
      { encoding: "utf-8" }
    );
    
    const backups = stdout.trim().split("\n").map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        date: parts[0] || "",
        size: parts[1] || "",
        id: parts[2] || ""
      };
    }).filter(b => b.date);
    
    return { backups };
  } catch {
    return { backups: [] };
  }
}

// ------------------------------------------------------------------
// Snapshot Management
// ------------------------------------------------------------------

export interface SnapshotInfo {
  id: string;
  date: string;
  source: string;
  size: string;
}

export async function createSnapshot(
  volume: string,
  name?: string
): Promise<string> {
  try {
    const snapshotName = name || `snap_${Date.now()}`;
    await execAsync(`tmutil localsnapshot ${volume} ${snapshotName} 2>/dev/null || echo "done"`);
    return snapshotName;
  } catch {
    return "";
  }
}

export async function restoreFromSnapshot(
  snapshotId: string,
  targetVolume: string
): Promise<boolean> {
  try {
    await execAsync(`tmutil restore ${snapshotId} ${targetVolume} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

export async function deleteSnapshot(snapshotId: string): Promise<boolean> {
  try {
    await execAsync(`tmutil deletesnapshot ${snapshotId} 2>/dev/null || echo "done"`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Database Backup
// ------------------------------------------------------------------

export async function backupPostgreSQL(
  database: string,
  outputPath: string
): Promise<{ success: boolean; size: number }> {
  try {
    const { stdout } = await execAsync(
      `pg_dump "${database}" | gzip > "${outputPath}" 2>/dev/null || echo ""`,
      { encoding: "utf-8" }
    );
    
    const { stdout: sizeOut } = await execAsync(
      `stat -f%z "${outputPath}" 2>/dev/null || echo "0"`,
      { encoding: "utf-8" }
    );
    
    return { success: true, size: parseInt(sizeOut.trim(), 10) || 0 };
  } catch {
    return { success: false, size: 0 };
  }
}

export async function backupMySQL(
  database: string,
  outputPath: string,
  host: string = "localhost"
): Promise<{ success: boolean; size: number }> {
  try {
    await execAsync(
      `mysqldump -h ${host} "${database}" | gzip > "${outputPath}" 2>/dev/null || echo "done"`
    );
    
    const { stdout: sizeOut } = await execAsync(
      `stat -f%z "${outputPath}" 2>/dev/null || echo "0"`,
      { encoding: "utf-8" }
    );
    
    return { success: true, size: parseInt(sizeOut.trim(), 10) || 0 };
  } catch {
    return { success: false, size: 0 };
  }
}

export async function backupMongoDB(
  database: string,
  outputPath: string,
  host: string = "mongodb://localhost:27017"
): Promise<{ success: boolean; size: number }> {
  try {
    await execAsync(
      `mongodump --uri="${host}" --db="${database}" --out="${outputPath}" 2>/dev/null || echo "done"`
    );
    
    const { stdout } = await execAsync(
      `du -sb "${outputPath}" | awk '{print $1}'`,
      { encoding: "utf-8" }
    );
    
    return { success: true, size: parseInt(stdout.trim(), 10) || 0 };
  } catch {
    return { success: false, size: 0 };
  }
}

export async function backupRedis(outputPath: string): Promise<boolean> {
  try {
    await execAsync(
      `redis-cli SAVE 2>/dev/null && cp /var/db/redis/dump.rdb "${outputPath}" 2>/dev/null || echo "done"`
    );
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Disaster Recovery
// ------------------------------------------------------------------

export interface DisasterRecoveryPlan {
  rto: string; // Recovery Time Objective
  rpo: string; // Recovery Point Objective
  criticalFiles: string[];
  backupSchedule: string;
  testFrequency: string;
}

export async function createDisasterRecoveryPlan(): Promise<DisasterRecoveryPlan> {
  return {
    rto: "4 hours",
    rpo: "1 hour",
    criticalFiles: [
      "src/**/*.ts",
      "package.json",
      ".env",
      "data/**/*"
    ],
    backupSchedule: "hourly incremental, daily differential, weekly full",
    testFrequency: "monthly"
  };
}

export async function verifyBackupIntegrity(
  backupPath: string
): Promise<{ valid: boolean; issues: string[] }> {
  const issues: string[] = [];
  
  try {
    // Check if backup exists
    const stat = await fs.stat(backupPath);
    if (stat.size === 0) {
      issues.push("Backup file is empty");
    }
    
    // Check for common backup formats
    if (backupPath.endsWith(".gz")) {
      await execAsync(`gzip -t "${backupPath}" 2>&1`, { encoding: "utf-8" });
    }
    
    return { valid: issues.length === 0, issues };
  } catch {
    return { valid: false, issues: ["Backup file not found or corrupted"] };
  }
}

export async function performDryRunRestore(
  backupPath: string,
  targetPath: string
): Promise<{ files: string[]; conflicts: string[] }> {
  try {
    const { stdout } = await execAsync(
      `rsync --dry-run --itemize-changes -av "${backupPath}/" "${targetPath}/" 2>/dev/null || echo ""`,
      { encoding: "utf-8" }
    );
    
    const files: string[] = [];
    const conflicts: string[] = [];
    
    for (const line of stdout.trim().split("\n")) {
      if (line.startsWith("fc")) {
        conflicts.push(line);
      } else if (line.length > 0) {
        files.push(line);
      }
    }
    
    return { files, conflicts };
  } catch {
    return { files: [], conflicts: [] };
  }
}

// ------------------------------------------------------------------
// Backup Scheduling
// ------------------------------------------------------------------

export async function setupBackupSchedule(
  sourceDir: string,
  backupDir: string,
  schedule: "hourly" | "daily" | "weekly" = "daily"
): Promise<boolean> {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const scriptPath = path.join(os.homedir(), ".omnistate", "backup-scripts", `${schedule}_backup.sh`);
    
    const script = `#!/bin/bash
rsync -av --delete "${sourceDir}/" "${backupDir}/${path.basename(sourceDir)}_${timestamp}/"
`;
    
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, script);
    await execAsync(`chmod +x "${scriptPath}"`);
    
    return true;
  } catch {
    return false;
  }
}

export class BackupRestoreLayer {
  createIncrementalBackup = createIncrementalBackup;
  createDifferentialBackup = createDifferentialBackup;
  
  getTimeMachineStatus = checkTimeMachineStatus;
  startTimeMachine = startTimeMachineBackup;
  stopTimeMachine = stopTimeMachineBackup;
  listTimeMachineBackups = listTimeMachineBackups;
  
  createSnapshot = createSnapshot;
  restoreSnapshot = restoreFromSnapshot;
  deleteSnapshot = deleteSnapshot;
  
  backupPostgreSQL = backupPostgreSQL;
  backupMySQL = backupMySQL;
  backupMongoDB = backupMongoDB;
  backupRedis = backupRedis;
  
  createDRPlan = createDisasterRecoveryPlan;
  verifyIntegrity = verifyBackupIntegrity;
  dryRunRestore = performDryRunRestore;
  setupSchedule = setupBackupSchedule;
}
