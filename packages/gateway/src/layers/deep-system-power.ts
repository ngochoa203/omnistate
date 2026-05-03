/**
 * Deep System Layer — Power / Energy (UC-B21), Swap / Memory (UC-B30).
 *
 * macOS-first; Linux fallbacks where reasonable.
 */

import { platform } from "node:os";

import type { DeepLayer } from "./deep.js";
import type { BatteryInfo, MemoryPressure, SwapUsage, MemoryProcessInfo, VMStats } from "./deep-system-types.js";
import { execAsync } from "./deep-system-types.js";

abstract class DeepSystemPowerCore {
  constructor(protected readonly deep: DeepLayer) {}

  protected get os(): "macos" | "windows" | "linux" {
    switch (platform()) {
      case "darwin":
        return "macos";
      case "win32":
        return "windows";
      default:
        return "linux";
    }
  }

  protected async run(cmd: string, timeoutMs = 30_000): Promise<string> {
    try {
      const { stdout } = await execAsync(cmd, {
        timeout: timeoutMs,
        encoding: "utf-8",
      });
      return stdout.trim();
    } catch {
      return "";
    }
  }
}

export class DeepSystemPowerLayer extends DeepSystemPowerCore {
  // =========================================================================
  // UC-B21 — Power / Energy
  // =========================================================================

  /**
   * Get battery information via `pmset -g batt` (macOS).
   */
  async getBatteryInfo(): Promise<BatteryInfo> {
    const raw = await this.run("pmset -g batt 2>/dev/null");
    try {
      const percentMatch = raw.match(/(\d+)%/);
      const chargingMatch = raw.match(/;?\s*(charging|discharging|AC Power|charged)/i);
      const timeMatch = raw.match(/(\d+:\d+)\s+remaining/);
      return {
        present: raw.includes("%"),
        percentage: percentMatch ? parseInt(percentMatch[1], 10) : null,
        charging:
          !!chargingMatch &&
          /charging|AC Power|charged/i.test(chargingMatch[0]),
        timeRemaining: timeMatch ? timeMatch[1] : null,
        raw,
      };
    } catch {
      return { present: false, percentage: null, charging: false, timeRemaining: null, raw };
    }
  }

  /**
   * Put the system to sleep immediately (macOS: `pmset sleepnow`).
   */
  async sleep(): Promise<boolean> {
    try {
      if (this.os === "macos") await execAsync("pmset sleepnow", { timeout: 5_000 });
      else await execAsync("systemctl suspend", { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Hibernate the system (macOS: pmset hibernatemode 25 + sleepnow).
   */
  async hibernate(): Promise<boolean> {
    try {
      if (this.os === "macos") {
        await execAsync("sudo pmset -a hibernatemode 25 && pmset sleepnow", {
          timeout: 10_000,
        });
      } else {
        await execAsync("systemctl hibernate", { timeout: 5_000 });
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Schedule a system shutdown after `delay` minutes (0 = immediate).
   */
  async shutdown(delay = 0): Promise<boolean> {
    try {
      if (this.os === "macos" || this.os === "linux") {
        const when = delay === 0 ? "now" : `+${delay}`;
        await execAsync(`sudo shutdown -h ${when}`, { timeout: 5_000 });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Schedule a system restart after `delay` minutes (0 = immediate).
   */
  async restart(delay = 0): Promise<boolean> {
    try {
      const when = delay === 0 ? "now" : `+${delay}`;
      await execAsync(`sudo shutdown -r ${when}`, { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Put the system to sleep after `minutes` minutes (macOS only).
   */
  async scheduleSleep(minutes: number): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      await execAsync(`sleep ${minutes * 60} && pmset sleepnow &`, { timeout: 3_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Schedule a wake event at a specific date/time (macOS: `pmset schedule wake`).
   *
   * @param date  Date string accepted by `pmset`, e.g. "04/10/2024 09:00:00".
   */
  async scheduleWake(date: string): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      await execAsync(`sudo pmset schedule wake "${date}"`, { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cancel all scheduled power events (macOS: `pmset schedule cancelall`).
   */
  async cancelScheduledPower(): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      await execAsync("sudo pmset schedule cancelall", { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the pmset power event log for the last `hours` hours (macOS).
   */
  async getPowerLog(hours = 24): Promise<string[]> {
    try {
      if (this.os !== "macos") return [];
      const out = await this.run(
        `pmset -g log 2>/dev/null | grep -v '^$' | tail -200`
      );
      return out.split("\n").filter(Boolean).slice(-hours * 10);
    } catch {
      return [];
    }
  }

  // =========================================================================
  // UC-B30 — Swap / Memory Pressure
  // =========================================================================

  /**
   * Get the current memory pressure level (macOS: `memory_pressure`).
   */
  async getMemoryPressure(): Promise<MemoryPressure> {
    const raw = await this.run("memory_pressure 2>/dev/null");
    try {
      const lower = raw.toLowerCase();
      let level: MemoryPressure["level"] = "unknown";
      if (lower.includes("critical")) level = "critical";
      else if (lower.includes("warn")) level = "warning";
      else if (lower.includes("normal")) level = "normal";
      return { level, raw };
    } catch {
      return { level: "unknown", raw };
    }
  }

  /**
   * Get swap usage via `sysctl vm.swapusage` (macOS) or `/proc/meminfo` (Linux).
   */
  async getSwapUsage(): Promise<SwapUsage> {
    const raw =
      this.os === "macos"
        ? await this.run("sysctl vm.swapusage 2>/dev/null")
        : await this.run("free -h 2>/dev/null | grep -i swap");
    try {
      if (this.os === "macos") {
        const total = raw.match(/total\s*=\s*(\S+)/)?.[1] ?? "0";
        const used = raw.match(/used\s*=\s*(\S+)/)?.[1] ?? "0";
        const free = raw.match(/free\s*=\s*(\S+)/)?.[1] ?? "0";
        const encrypted = raw.includes("encrypted");
        return { total, used, free, encrypted, raw };
      }
      const parts = raw.trim().split(/\s+/);
      return {
        total: parts[1] ?? "0",
        used: parts[2] ?? "0",
        free: parts[3] ?? "0",
        raw,
      };
    } catch {
      return { total: "0", used: "0", free: "0", raw };
    }
  }

  /**
   * Get the top `count` memory-consuming processes.
   */
  async getTopMemoryProcesses(count = 10): Promise<MemoryProcessInfo[]> {
    try {
      const out = await this.run(
        `ps -eo pid,pmem,rss,comm --sort=-pmem 2>/dev/null | head -n ${count + 1}`
      );
      return out
        .split("\n")
        .slice(1)
        .filter(Boolean)
        .slice(0, count)
        .map((l) => {
          const parts = l.trim().split(/\s+/);
          return {
            pid: parseInt(parts[0] ?? "0", 10),
            memPercent: parseFloat(parts[1] ?? "0"),
            memRSS: parts[2] ?? "0",
            name: parts.slice(3).join(" "),
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Purge disk cache and free up inactive memory (macOS: `purge`, requires sudo).
   */
  async purgeMemory(): Promise<boolean> {
    try {
      if (this.os === "macos") {
        await execAsync("sudo purge", { timeout: 30_000 });
        return true;
      }
      await execAsync(
        "sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'",
        { timeout: 10_000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get virtual memory statistics (`vm_stat` on macOS, `/proc/vmstat` on Linux).
   */
  async getVMStats(): Promise<VMStats> {
    const raw =
      this.os === "macos"
        ? await this.run("vm_stat 2>/dev/null")
        : await this.run("vmstat -s 2>/dev/null | head -20");
    try {
      const getNum = (key: string): number | null => {
        const m = raw.match(new RegExp(`${key}[:\\s]+([\\d,]+)`));
        return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
      };
      return {
        pagesFree: getNum("Pages free"),
        pagesActive: getNum("Pages active"),
        pagesInactive: getNum("Pages inactive"),
        pagesWiredDown: getNum("Pages wired down"),
        pageSize: getNum("page size of"),
        raw,
      };
    } catch {
      return {
        pagesFree: null,
        pagesActive: null,
        pagesInactive: null,
        pagesWiredDown: null,
        pageSize: null,
        raw,
      };
    }
  }
}