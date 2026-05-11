/**
 * System Advanced Layer — Clipboard, Notifications, System Info.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Clipboard Operations
// ------------------------------------------------------------------

export async function getClipboard(): Promise<string> {
  try {
    const { stdout } = await execAsync("osascript -e 'the clipboard as text'", { encoding: "utf-8" });
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function setClipboard(text: string): Promise<boolean> {
  try {
    const escaped = text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    await execAsync(`osascript -e 'set the clipboard to "${escaped}"'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Notifications
// ------------------------------------------------------------------

export async function showNotification(title: string, message: string, sound: boolean = true): Promise<boolean> {
  try {
    const soundFlag = sound ? "with sound" : "without sound";
    const escapedTitle = title.replace(/"/g, '\\"');
    const escapedMsg = message.replace(/"/g, '\\"');
    await execAsync(`osascript -e 'display notification "${escapedMsg}" with title "${escapedTitle}" ${soundFlag}'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// System Information
// ------------------------------------------------------------------

export async function getBatteryInfo(): Promise<{ percentage: number; isCharging: boolean; timeRemaining?: number }> {
  try {
    const { stdout } = await execAsync(`pmset -g batt | grep -E "([0-9]+)%|charging|discharging"`, { encoding: "utf-8" });
    const percentageMatch = stdout.match(/(\d+)%/);
    const isCharging = stdout.includes("charging") || stdout.includes("AC Power");
    return {
      percentage: percentageMatch ? parseInt(percentageMatch[1]!, 10) : 0,
      isCharging
    };
  } catch {
    return { percentage: 0, isCharging: false };
  }
}

export async function getDiskUsage(path: string = "/"): Promise<{ total: number; used: number; available: number; percentage: number }> {
  try {
    const { stdout } = await execAsync(`df -k "${path}" | tail -1`, { encoding: "utf-8" });
    const parts = stdout.trim().split(/\s+/);
    const total = parseInt(parts[1] || "0", 10) * 1024;
    const used = parseInt(parts[2] || "0", 10) * 1024;
    const available = parseInt(parts[3] || "0", 10) * 1024;
    const percentage = parseInt(parts[4]?.replace("%", "") || "0", 10);
    return { total, used, available, percentage };
  } catch {
    return { total: 0, used: 0, available: 0, percentage: 0 };
  }
}

// ------------------------------------------------------------------
// Process Management
// ------------------------------------------------------------------

export async function listProcesses(pattern?: string): Promise<Array<{ pid: number; name: string; cpu: number; memory: number }>> {
  try {
    const filter = pattern ? ` | grep -i "${pattern}"` : "";
    const { stdout } = await execAsync(`ps -ax -o pid,comm,%cpu,%mem | head -100${filter}`, { encoding: "utf-8" });
    return stdout.split("\n").slice(1).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: parseInt(parts[0] || "0", 10),
        name: parts.slice(1, -2).join(" "),
        cpu: parseFloat(parts[parts.length - 2] || "0"),
        memory: parseFloat(parts[parts.length - 1] || "0")
      };
    }).filter(p => p.pid > 0);
  } catch {
    return [];
  }
}

export async function killProcessByName(name: string): Promise<number> {
  try {
    await execAsync(`pkill -x "${name}"`);
    return 1;
  } catch {
    return 0;
  }
}