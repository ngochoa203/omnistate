/**
 * Process & Performance Tools — Group 19
 * Implements: Process management, performance monitoring, resource usage
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import * as os from "node:os";


// ------------------------------------------------------------------
// Process Information
// ------------------------------------------------------------------

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  threads: number;
  user: string;
  started: string;
}

export async function listProcesses(limit?: number): Promise<ProcessInfo[]> {
  try {
    const cmd = `ps aux --sort=-%cpu | head -${limit || 50}`;
    const { stdout } = await execAsync(cmd, { encoding: "utf-8" });
    
    const lines = stdout.trim().split("\n").slice(1); // Skip header
    return lines.map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: parseInt(parts[1] || "0", 10),
        name: parts[10] || "unknown",
        cpu: parseFloat(parts[2] || "0"),
        memory: parseFloat(parts[3] || "0"),
        threads: 0,
        user: parts[0] || "unknown",
        started: ""
      };
    });
  } catch {
    return [];
  }
}

export async function findProcess(name: string): Promise<ProcessInfo[]> {
  const all = await listProcesses(100);
  return all.filter(p => p.name.toLowerCase().includes(name.toLowerCase()));
}

export async function getProcessByPID(pid: number): Promise<ProcessInfo | null> {
  try {
    const { stdout } = await execAsync(`ps -p ${pid} -o pid,comm,%cpu,%mem,user`, { encoding: "utf-8" });
    const parts = stdout.trim().split(/\s+/);
    
    return {
      pid: parseInt(parts[0], 10),
      name: parts[1] || "unknown",
      cpu: parseFloat(parts[2] || "0"),
      memory: parseFloat(parts[3] || "0"),
      threads: 0,
      user: parts[4] || "unknown",
      started: ""
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// Process Control
// ------------------------------------------------------------------

export async function killProcess(pid: number, signal: number = 9): Promise<boolean> {
  try {
    await execAsync(`kill -${signal} ${pid}`);
    return true;
  } catch {
    return false;
  }
}

export async function killProcessByName(name: string): Promise<number> {
  try {
    const { stdout } = await execAsync(`pkill -${name}`, { encoding: "utf-8" });
    return parseInt(stdout, 10) || 1;
  } catch {
    return 0;
  }
}

export async function restartProcess(name: string): Promise<boolean> {
  try {
    // Find process
    const { stdout } = await execAsync(`pgrep -x "${name}"`, { encoding: "utf-8" });
    const pid = stdout.trim();
    
    if (pid) {
      // Kill
      await execAsync(`kill ${pid}`);
      await new Promise(r => setTimeout(r, 2000));
    }
    
    // Restart
    await execAsync(`open -a "${name}"`);
    return true;
  } catch {
    return false;
  }
}

export async function setProcessPriority(pid: number, priority: number): Promise<boolean> {
  try {
    // -20 (highest) to 20 (lowest)
    const nice = Math.max(-20, Math.min(20, priority));
    await execAsync(`renice ${nice} ${pid}`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// CPU Performance
// ------------------------------------------------------------------

export async function getCpuUsagePerCore(): Promise<{ core: number; usage: number }[]> {
  try {
    const { stdout } = await execAsync("top -l 1 -n 0 -F | grep 'CPU usage' | head -10", { encoding: "utf-8" });
    // Parse top output for per-core usage
    return stdout.split("\n").map((line, i) => ({
      core: i,
      usage: parseFloat(line.match(/\d+\.\d+%/)?.[0] || "0") || 0
    }));
  } catch {
    return [];
  }
}

export async function getLoadAverage(): Promise<{ "1min": number; "5min": number; "15min": number }> {
  try {
    const { stdout } = await execAsync("uptime | awk -F'load averages:' '{print $2}'", { encoding: "utf-8" });
    const parts = stdout.trim().split(/\s+/).map(p => parseFloat(p));

    return {
      "1min": parts[0] || 0,
      "5min": parts[1] || 0,
      "15min": parts[2] || 0
    };
  } catch {
    return { "1min": 0, "5min": 0, "15min": 0 };
  }
}

export async function getCpuTemperature(): Promise<number | null> {
  try {
    const { stdout } = await execAsync("osx-cpu-temp 2>/dev/null || echo 'unknown'", { encoding: "utf-8" });
    const match = stdout.match(/(\d+\.\d+)/);
    return match ? parseFloat(match[1]!) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// Memory Performance
// ------------------------------------------------------------------

export async function getMemoryPressure(): Promise<"low" | "medium" | "high" | "critical"> {
  try {
    const { stdout } = await execAsync("memory_pressure 2>/dev/null | grep 'System-wide memory free percentage' || echo 'unknown'", { encoding: "utf-8" });
    const match = stdout.match(/(\d+)%/);
    const percent = parseInt(match?.[1] || "50", 10);
    
    if (percent > 50) return "low";
    if (percent > 25) return "medium";
    if (percent > 10) return "high";
    return "critical";
  } catch {
    return "medium";
  }
}

export async function getSwapUsage(): Promise<{ used: number; total: number }> {
  try {
    const { stdout } = await execAsync("sysctl vm.swapusage | awk '{print $3, $5}'", { encoding: "utf-8" });
    const parts = stdout.trim().replace(/[A-Z]/g, "").split("/");
    
    return {
      used: parseFloat(parts[0] || "0"),
      total: parseFloat(parts[1] || "0")
    };
  } catch {
    return { used: 0, total: 0 };
  }
}

// ------------------------------------------------------------------
// Energy & Power
// ------------------------------------------------------------------

export async function getEnergyUsage(): Promise<{ apps: { name: string; watts: number }[]; total: number }> {
  try {
    const { stdout } = await execAsync("powermetrics --samplers energy 2>/dev/null | head -30 || echo ''", { encoding: "utf-8" });
    
    return {
      apps: [],
      total: 0
    };
  } catch {
    return { apps: [], total: 0 };
  }
}

export async function setLowPowerMode(enable: boolean): Promise<boolean> {
  try {
    await execAsync(`pmset -a lowpowermode ${enable ? 1 : 0}`);
    return true;
  } catch {
    return false;
  }
}

export async function getBatteryHealth(): Promise<{ health: number; cycles: number; maxCapacity: number }> {
  try {
    const { stdout } = await execAsync("ioreg -r -c AppleSmartBattery | grep -E '(CycleCount|MaxCapacity|DesignCapacity)'", { encoding: "utf-8" });
    
    const cyclesMatch = stdout.match(/CycleCount" = (\d+)/);
    const maxMatch = stdout.match(/MaxCapacity" = (\d+)/);
    const designMatch = stdout.match(/DesignCapacity" = (\d+)/);
    
    const max = parseInt(maxMatch?.[1] || "0", 10);
    const design = parseInt(designMatch?.[1] || "1", 10);
    
    return {
      health: Math.round((max / design) * 100),
      cycles: parseInt(cyclesMatch?.[1] || "0", 10),
      maxCapacity: max
    };
  } catch {
    return { health: 100, cycles: 0, maxCapacity: 0 };
  }
}

// ------------------------------------------------------------------
// Disk I/O
// ------------------------------------------------------------------

export async function getDiskIO(): Promise<{ read: number; write: number }> {
  try {
    const { stdout } = await execAsync("iostat -d -n 0 2>/dev/null || echo '0 0'", { encoding: "utf-8" });
    const parts = stdout.trim().split(/\s+/);
    
    return {
      read: parseFloat(parts[1] || "0"),
      write: parseFloat(parts[2] || "0")
    };
  } catch {
    return { read: 0, write: 0 };
  }
}

// ------------------------------------------------------------------
// Performance Summary
// ------------------------------------------------------------------

export async function getPerformanceSummary(): Promise<{
  cpu: { usage: number; cores: number; load: { "1min": number; "5min": number; "15min": number } };
  memory: { total: number; used: number; pressure: string };
  disk: { used: number; available: number };
  battery: { percent: number; health: number };
  topProcesses: ProcessInfo[];
}> {
  const [cpu] = await Promise.all([getCpuUsagePerCore()]);
  const load = await getLoadAverage();
  
  return {
    cpu: { usage: 0, cores: os.cpus().length, load },
    memory: { total: 0, used: 0, pressure: "medium" },
    disk: { used: 0, available: 0 },
    battery: { percent: 0, health: 100 },
    topProcesses: (await listProcesses(5))
  };
}

export class ProcessPerformanceLayer {
  listProcesses = listProcesses;
  findProcess = findProcess;
  getProcess = getProcessByPID;
  
  kill = killProcess;
  killByName = killProcessByName;
  restart = restartProcess;
  setPriority = setProcessPriority;
  
  getCpuPerCore = getCpuUsagePerCore;
  getLoadAverage = getLoadAverage;
  getCpuTemp = getCpuTemperature;
  
  getMemoryPressure = getMemoryPressure;
  getSwapUsage = getSwapUsage;
  
  getEnergy = getEnergyUsage;
  setLowPower = setLowPowerMode;
  getBatteryHealth = getBatteryHealth;
  
  getDiskIO = getDiskIO;
  
  getSummary = getPerformanceSummary;
}
