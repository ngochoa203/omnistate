/**
 * System Monitoring Tools — System health and performance metrics.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import * as os from "node:os";


// ------------------------------------------------------------------
// CPU Monitoring
// ------------------------------------------------------------------

export interface CpuInfo {
  model: string;
  cores: number;
  speed: number;
  usage: number;
}

export async function getCpuInfo(): Promise<CpuInfo> {
  try {
    const { stdout: brand } = await execAsync("sysctl -n machdep.cpu.brand_string", { encoding: "utf-8" });
    const { stdout: cores } = await execAsync("sysctl -n hw.ncpu", { encoding: "utf-8" });
    const { stdout: speed } = await execAsync("sysctl -n hw.cpufrequency_max", { encoding: "utf-8" });
    
    // Get CPU usage
    const { stdout: top } = await execAsync("top -l 1 -n 1 | grep 'CPU usage' | awk '{print $3}' | tr -d '%'", { encoding: "utf-8" });
    
    return {
      model: brand.trim(),
      cores: parseInt(cores.trim(), 10),
      speed: Math.round(parseInt(speed.trim(), 10) / 1000000000),
      usage: parseFloat(top.trim()) || 0
    };
  } catch {
    return { model: "Unknown", cores: os.cpus().length, speed: 0, usage: 0 };
  }
}

export async function getCpuUsage(): Promise<number> {
  try {
    const { stdout } = await execAsync("top -l 1 -n 1 | grep 'CPU usage' | awk '{print $3}' | tr -d '%'", { encoding: "utf-8" });
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

// ------------------------------------------------------------------
// Memory Monitoring
// ------------------------------------------------------------------

export interface MemoryInfo {
  total: number;
  used: number;
  free: number;
  usagePercent: number;
}

export async function getMemoryInfo(): Promise<MemoryInfo> {
  try {
    const { stdout } = await execAsync("vm_stat | head -10", { encoding: "utf-8" });
    
    const pagesize = 4096; // Default page size
    const lines = stdout.split("\n");
    
    let free = 0, active = 0, wired = 0;
    
    for (const line of lines) {
      if (line.includes("Pages free:")) {
        const match = line.match(/(\d+)/);
        if (match) free = parseInt(match[1]!, 10) * pagesize / (1024 * 1024);
      }
      if (line.includes("Pages active:")) {
        const match = line.match(/(\d+)/);
        if (match) active = parseInt(match[1]!, 10) * pagesize / (1024 * 1024);
      }
      if (line.includes("Pages wired:")) {
        const match = line.match(/(\d+)/);
        if (match) wired = parseInt(match[1]!, 10) * pagesize / (1024 * 1024);
      }
    }
    
    const total = os.totalmem() / (1024 * 1024);
    const used = active + wired;
    const freeCalc = total - used;
    
    return {
      total: Math.round(total),
      used: Math.round(used),
      free: Math.round(freeCalc),
      usagePercent: Math.round((used / total) * 100)
    };
  } catch {
    return { total: 0, used: 0, free: 0, usagePercent: 0 };
  }
}

// ------------------------------------------------------------------
// Disk Monitoring
// ------------------------------------------------------------------

export interface DiskInfo {
  total: number;
  used: number;
  available: number;
  usagePercent: number;
}

export async function getDiskInfo(path: string = "/"): Promise<DiskInfo> {
  try {
    const { stdout } = await execAsync(`df -k "${path}" | tail -1`, { encoding: "utf-8" });
    const parts = stdout.trim().split(/\s+/);
    
    const total = parseInt(parts[1] || "0", 10) / 1024 / 1024;
    const used = parseInt(parts[2] || "0", 10) / 1024 / 1024;
    const available = parseInt(parts[3] || "0", 10) / 1024 / 1024;
    const usagePercent = parseInt(parts[4]?.replace("%", "") || "0", 10);
    
    return {
      total: Math.round(total),
      used: Math.round(used),
      available: Math.round(available),
      usagePercent
    };
  } catch {
    return { total: 0, used: 0, available: 0, usagePercent: 0 };
  }
}

export async function getAllDisks(): Promise<DiskInfo[]> {
  try {
    const { stdout } = await execAsync("df -k | tail -n +2", { encoding: "utf-8" });
    const lines = stdout.trim().split("\n");
    
    return lines.map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        total: Math.round(parseInt(parts[1] || "0", 10) / 1024 / 1024),
        used: Math.round(parseInt(parts[2] || "0", 10) / 1024 / 1024),
        available: Math.round(parseInt(parts[3] || "0", 10) / 1024 / 1024),
        usagePercent: parseInt(parts[4]?.replace("%", "") || "0", 10)
      };
    });
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Network Monitoring
// ------------------------------------------------------------------

export interface NetworkStats {
  interface: string;
  bytesIn: number;
  bytesOut: number;
  packetsIn: number;
  packetsOut: number;
}

export async function getNetworkStats(): Promise<NetworkStats[]> {
  try {
    const { stdout } = await execAsync("netstat -ib | tail -20", { encoding: "utf-8" });
    const lines = stdout.trim().split("\n");
    
    return lines.map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        interface: parts[0] || "unknown",
        bytesIn: parseInt(parts[6] || "0", 10),
        bytesOut: parseInt(parts[9] || "0", 10),
        packetsIn: parseInt(parts[3] || "0", 10),
        packetsOut: parseInt(parts[4] || "0", 10)
      };
    }).filter(s => s.interface && s.interface !== "Name");
  } catch {
    return [];
  }
}

export async function getLocalIPAddress(): Promise<string> {
  try {
    const { stdout } = await execAsync(`ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1`, { encoding: "utf-8" });
    const ip = stdout.trim();
    return /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : "Unknown";
  } catch {
    return "Unknown";
  }
}

// ------------------------------------------------------------------
// System Uptime
// ------------------------------------------------------------------

export async function getSystemUptime(): Promise<{ days: number; hours: number; minutes: number }> {
  try {
    const { stdout } = await execAsync("uptime | awk '{print $3, $4, $5}'", { encoding: "utf-8" });
    const parts = stdout.trim().replace(",", "").split(" ");
    
    return {
      days: parseInt(parts[0] || "0", 10),
      hours: parseInt(parts[1] || "0", 10),
      minutes: parseInt(parts[2] || "0", 10)
    };
  } catch {
    return { days: 0, hours: 0, minutes: 0 };
  }
}

// ------------------------------------------------------------------
// Process Monitoring
// ------------------------------------------------------------------

export async function getTopProcesses(limit: number = 10): Promise<{ pid: number; name: string; cpu: number; mem: number }[]> {
  try {
    const { stdout } = await execAsync(`ps aux --sort=-%cpu | head -${limit + 1}`, { encoding: "utf-8" });
    const lines = stdout.trim().split("\n").slice(1);
    
    return lines.map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: parseInt(parts[1] || "0", 10),
        name: parts[10] || "unknown",
        cpu: parseFloat(parts[2] || "0"),
        mem: parseFloat(parts[3] || "0")
      };
    });
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Battery Info
// ------------------------------------------------------------------

export async function getBatteryInfo(): Promise<{ percent: number; charging: boolean; timeRemaining?: number; health: string }> {
  try {
    const { stdout } = await execAsync("pmset -g batt", { encoding: "utf-8" });
    
    const percentMatch = stdout.match(/(\d+)%/);
    const timeMatch = stdout.match(/(\d+:\d+)\s*(remaining|until full)/);
    const isCharging = stdout.includes("charging") || stdout.includes("AC Power");
    const isFullyCharged = stdout.includes("fully charged");
    
    return {
      percent: percentMatch ? parseInt(percentMatch[1]!, 10) : 0,
      charging: isCharging,
      timeRemaining: timeMatch ? parseInt(timeMatch[1]!.split(":")[0]!) * 60 + parseInt(timeMatch[1]!.split(":")[1]!) : undefined,
      health: isFullyCharged ? "healthy" : "normal"
    };
  } catch {
    return { percent: 0, charging: false, health: "unknown" };
  }
}

export class SystemMonitorLayer {
  getCpuInfo = getCpuInfo;
  getCpuUsage = getCpuUsage;
  getMemoryInfo = getMemoryInfo;
  getDiskInfo = getDiskInfo;
  getAllDisks = getAllDisks;
  getNetworkStats = getNetworkStats;
  getLocalIP = getLocalIPAddress;
  getUptime = getSystemUptime;
  getTopProcesses = getTopProcesses;
  getBatteryInfo = getBatteryInfo;
}
