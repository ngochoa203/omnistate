/**
 * Health sensors — collect system metrics.
 *
 * Each sensor returns a SensorResult with status and value.
 */

import { execSync } from "node:child_process";
import type { SensorResult } from "./monitor.js";

export async function checkCpu(): Promise<SensorResult> {
  try {
    // macOS: use `top -l 1` to get CPU usage
    if (process.platform === "darwin") {
      const output = execSync("top -l 1 -n 0 | grep 'CPU usage'", {
        encoding: "utf-8",
        timeout: 5000,
      });
      const match = output.match(/([\d.]+)% idle/);
      const idle = match ? parseFloat(match[1]) : 50;
      const usage = 100 - idle;

      return {
        status: usage > 90 ? "critical" : usage > 70 ? "warning" : "ok",
        value: Math.round(usage),
        unit: "%",
        message: usage > 90 ? `CPU at ${Math.round(usage)}%` : undefined,
      };
    }

    return { status: "ok", value: 0, unit: "%" };
  } catch {
    return { status: "ok", value: 0, unit: "%" };
  }
}

export async function checkMemory(): Promise<SensorResult> {
  try {
    if (process.platform === "darwin") {
      const output = execSync("vm_stat", { encoding: "utf-8", timeout: 5000 });
      const pageSize = 16384; // macOS ARM page size
      const freeMatch = output.match(/Pages free:\s+(\d+)/);
      const activeMatch = output.match(/Pages active:\s+(\d+)/);
      const inactiveMatch = output.match(/Pages inactive:\s+(\d+)/);
      const wiredMatch = output.match(/Pages wired down:\s+(\d+)/);

      if (freeMatch && activeMatch && inactiveMatch && wiredMatch) {
        const free = parseInt(freeMatch[1]) * pageSize;
        const active = parseInt(activeMatch[1]) * pageSize;
        const inactive = parseInt(inactiveMatch[1]) * pageSize;
        const wired = parseInt(wiredMatch[1]) * pageSize;
        const total = free + active + inactive + wired;
        const used = active + wired;
        const percent = Math.round((used / total) * 100);

        return {
          status: percent > 90 ? "critical" : percent > 80 ? "warning" : "ok",
          value: percent,
          unit: "%",
          message: percent > 80 ? `Memory at ${percent}%` : undefined,
        };
      }
    }

    return { status: "ok", value: 0, unit: "%" };
  } catch {
    return { status: "ok", value: 0, unit: "%" };
  }
}

export async function checkDisk(): Promise<SensorResult> {
  try {
    const output = execSync("df -h / | tail -1", {
      encoding: "utf-8",
      timeout: 5000,
    });
    const match = output.match(/(\d+)%/);
    const percent = match ? parseInt(match[1]) : 0;

    return {
      status: percent > 95 ? "critical" : percent > 85 ? "warning" : "ok",
      value: percent,
      unit: "%",
      message: percent > 85 ? `Disk at ${percent}%` : undefined,
    };
  } catch {
    return { status: "ok", value: 0, unit: "%" };
  }
}

export async function checkNetwork(): Promise<SensorResult> {
  try {
    execSync("ping -c 1 -W 3 1.1.1.1", { encoding: "utf-8", timeout: 5000 });
    return { status: "ok", value: 1, unit: "connected" };
  } catch {
    return {
      status: "critical",
      value: 0,
      unit: "connected",
      message: "No internet connectivity",
    };
  }
}

export async function checkProcesses(): Promise<SensorResult> {
  try {
    if (process.platform === "darwin") {
      const output = execSync("ps aux | wc -l", {
        encoding: "utf-8",
        timeout: 5000,
      });
      const count = parseInt(output.trim()) - 1; // minus header

      // Check for zombies
      const zombies = execSync("ps aux | grep -c Z | head -1", {
        encoding: "utf-8",
        timeout: 5000,
      });
      const zombieCount = parseInt(zombies.trim());

      return {
        status: zombieCount > 5 ? "warning" : "ok",
        value: count,
        unit: "processes",
        message: zombieCount > 0 ? `${zombieCount} zombie processes` : undefined,
      };
    }

    return { status: "ok", value: 0, unit: "processes" };
  } catch {
    return { status: "ok", value: 0, unit: "processes" };
  }
}
