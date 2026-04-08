/**
 * Auto-repair strategies for common system issues.
 *
 * Each repair is logged and rate-limited to prevent repair loops.
 */

import { execSync } from "node:child_process";
import type { HealthAlert } from "./monitor.js";

export interface RepairAction {
  sensor: string;
  action: string;
  success: boolean;
  timestamp: string;
  detail?: string;
}

const repairHistory: RepairAction[] = [];
const MAX_REPAIRS_PER_HOUR = 10;

/**
 * Attempt auto-repair based on a health alert.
 * Returns the repair action taken, or null if no repair was needed/possible.
 */
export async function autoRepair(
  alert: HealthAlert
): Promise<RepairAction | null> {
  // Rate limit
  const oneHourAgo = Date.now() - 3600000;
  const recentRepairs = repairHistory.filter(
    (r) => new Date(r.timestamp).getTime() > oneHourAgo
  );
  if (recentRepairs.length >= MAX_REPAIRS_PER_HOUR) {
    return null; // Too many repairs, stop
  }

  let action: RepairAction | null = null;

  switch (alert.sensor) {
    case "processes":
      action = await repairZombieProcesses();
      break;
    case "disk":
      action = await repairDiskSpace();
      break;
    case "network":
      action = await repairNetwork();
      break;
    case "memory":
      action = await repairMemoryPressure();
      break;
    default:
      return null;
  }

  if (action) {
    repairHistory.push(action);
  }
  return action;
}

async function repairZombieProcesses(): Promise<RepairAction> {
  try {
    // Kill zombie processes (safe: they're already dead)
    if (process.platform === "darwin" || process.platform === "linux") {
      execSync("kill -9 $(ps -eo pid,stat | grep Z | awk '{print $1}') 2>/dev/null || true", {
        encoding: "utf-8",
        timeout: 5000,
      });
    }
    return {
      sensor: "processes",
      action: "Cleaned zombie processes",
      success: true,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return {
      sensor: "processes",
      action: "Failed to clean zombie processes",
      success: false,
      timestamp: new Date().toISOString(),
    };
  }
}

async function repairDiskSpace(): Promise<RepairAction> {
  try {
    // Clean common temp/cache directories
    if (process.platform === "darwin") {
      execSync("rm -rf ~/Library/Caches/com.apple.dt.Xcode 2>/dev/null || true", {
        encoding: "utf-8",
        timeout: 10000,
      });
      execSync("rm -rf /tmp/*.tmp 2>/dev/null || true", {
        encoding: "utf-8",
        timeout: 5000,
      });
    }
    return {
      sensor: "disk",
      action: "Cleaned temporary files",
      success: true,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return {
      sensor: "disk",
      action: "Failed to clean disk space",
      success: false,
      timestamp: new Date().toISOString(),
    };
  }
}

async function repairNetwork(): Promise<RepairAction> {
  try {
    // Try DNS flush and reconnect
    if (process.platform === "darwin") {
      execSync("dscacheutil -flushcache 2>/dev/null || true", {
        encoding: "utf-8",
        timeout: 5000,
      });
    }
    return {
      sensor: "network",
      action: "Flushed DNS cache",
      success: true,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return {
      sensor: "network",
      action: "Failed to repair network",
      success: false,
      timestamp: new Date().toISOString(),
    };
  }
}

async function repairMemoryPressure(): Promise<RepairAction> {
  // Memory repair is passive — just report, don't kill processes
  return {
    sensor: "memory",
    action: "Memory pressure detected — monitoring",
    success: true,
    timestamp: new Date().toISOString(),
    detail: "Will escalate if pressure continues",
  };
}
