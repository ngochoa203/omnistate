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

export async function checkThermal(): Promise<SensorResult> {
  try {
    if (process.platform === "darwin") {
      const pmsetOut = execSync("pmset -g therm 2>/dev/null", {
        encoding: "utf-8",
        timeout: 5000,
      });

      const limitMatch = pmsetOut.match(/CPU_Speed_Limit\s*=\s*(\d+)/i);
      const cpuLimit = limitMatch ? parseInt(limitMatch[1], 10) : 100;

      const pressureText = pmsetOut.toLowerCase();
      const hasHeavyPressure =
        pressureText.includes("heavy") || pressureText.includes("critical");
      const hasModeratePressure = pressureText.includes("moderate");

      let cpuTemp: number | undefined;
      try {
        const tempOut = execSync(
          'ioreg -l | grep -i "CPU die temperature" | head -1',
          {
            encoding: "utf-8",
            timeout: 5000,
          }
        );
        const tempMatch = tempOut.match(/=\s*([\d.]+)/);
        if (tempMatch) {
          cpuTemp = parseFloat(tempMatch[1]);
        }
      } catch {
        // ignore temperature parsing errors and fall back to CPU speed limit
      }

      const critical = cpuLimit <= 80 || (cpuTemp !== undefined && cpuTemp >= 90);
      const warning =
        !critical &&
        (cpuLimit < 100 ||
          hasHeavyPressure ||
          hasModeratePressure ||
          (cpuTemp !== undefined && cpuTemp >= 75));

      const status = critical ? "critical" : warning ? "warning" : "ok";
      const value = cpuTemp ?? cpuLimit;
      const unit = cpuTemp !== undefined ? "celsius" : "limit";

      return {
        status,
        value: Math.round(value),
        unit,
        message:
          status === "critical"
            ? `Thermal pressure critical (limit ${cpuLimit}%)`
            : status === "warning"
              ? `Thermal pressure elevated (limit ${cpuLimit}%)`
              : undefined,
      };
    }

    if (process.platform === "linux") {
      const tempOut = execSync(
        "cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null",
        {
          encoding: "utf-8",
          timeout: 5000,
        }
      ).trim();
      const cpuTemp = tempOut ? parseInt(tempOut, 10) / 1000 : 0;

      return {
        status: cpuTemp >= 90 ? "critical" : cpuTemp >= 75 ? "warning" : "ok",
        value: Math.round(cpuTemp),
        unit: "celsius",
        message:
          cpuTemp >= 90
            ? `CPU temperature critical at ${Math.round(cpuTemp)}C`
            : cpuTemp >= 75
              ? `CPU temperature high at ${Math.round(cpuTemp)}C`
              : undefined,
      };
    }

    return { status: "ok", value: 0, unit: "celsius" };
  } catch {
    return { status: "ok", value: 0, unit: "celsius" };
  }
}

export async function checkBattery(): Promise<SensorResult> {
  try {
    if (process.platform === "darwin") {
      const pmsetOut = execSync("pmset -g batt", {
        encoding: "utf-8",
        timeout: 5000,
      });

      if (/No batteries?/i.test(pmsetOut)) {
        return { status: "ok", value: 100, unit: "%" };
      }

      const percentMatch = pmsetOut.match(/(\d+)%/);
      const chargePercent = percentMatch ? parseInt(percentMatch[1], 10) : 0;
      const charging = /AC Power/i.test(pmsetOut) && /charging/i.test(pmsetOut);

      let healthRatio: number | undefined;
      try {
        const ioregOut = execSync(
          "ioreg -l -n AppleSmartBattery 2>/dev/null | head -80",
          {
            encoding: "utf-8",
            timeout: 8000,
          }
        );
        const designMatch = ioregOut.match(/"DesignCapacity"\s*=\s*(\d+)/);
        const maxMatch = ioregOut.match(/"(?:MaxCapacity|FullChargeCapacity)"\s*=\s*(\d+)/);
        const design = designMatch ? parseInt(designMatch[1], 10) : undefined;
        const max = maxMatch ? parseInt(maxMatch[1], 10) : undefined;
        if (design && max && design > 0) {
          healthRatio = max / design;
        }
      } catch {
        // ignore detailed battery health parsing errors
      }

      const lowBatteryCritical = !charging && chargePercent <= 10;
      const lowBatteryWarning = !charging && chargePercent <= 20;
      const degradedHealthWarning =
        healthRatio !== undefined && healthRatio > 0 && healthRatio < 0.8;
      const degradedHealthCritical =
        healthRatio !== undefined && healthRatio > 0 && healthRatio < 0.6;

      const status = lowBatteryCritical || degradedHealthCritical
        ? "critical"
        : lowBatteryWarning || degradedHealthWarning
          ? "warning"
          : "ok";

      let message: string | undefined;
      if (lowBatteryCritical || lowBatteryWarning) {
        message = `Battery low at ${chargePercent}%`;
      } else if (degradedHealthWarning && healthRatio !== undefined) {
        message = `Battery health degraded at ${Math.round(healthRatio * 100)}% of design capacity`;
      }

      return {
        status,
        value: chargePercent,
        unit: "%",
        message,
      };
    }

    if (process.platform === "linux") {
      const out = execSync("upower -i $(upower -e | grep battery) 2>/dev/null", {
        encoding: "utf-8",
        timeout: 8000,
      });

      const percentMatch = out.match(/percentage:\s*([\d.]+)%/i);
      const chargePercent = percentMatch ? Math.round(parseFloat(percentMatch[1])) : 0;
      const charging = /state:\s*charging/i.test(out);
      const status = !charging && chargePercent <= 10
        ? "critical"
        : !charging && chargePercent <= 20
          ? "warning"
          : "ok";

      return {
        status,
        value: chargePercent,
        unit: "%",
        message: status !== "ok" ? `Battery low at ${chargePercent}%` : undefined,
      };
    }

    return { status: "ok", value: 100, unit: "%" };
  } catch {
    return { status: "ok", value: 100, unit: "%" };
  }
}

export async function checkDnsResolution(host: string): Promise<SensorResult> {
  try {
    const output = execSync(
      `nslookup "${host}" 2>/dev/null || dig +short "${host}" 2>/dev/null`,
      {
        encoding: "utf-8",
        timeout: 5000,
      }
    ).trim();

    const resolved = output.length > 0;
    return {
      status: resolved ? "ok" : "critical",
      value: resolved ? 1 : 0,
      unit: "resolved",
      message: resolved ? undefined : `DNS resolution failed for ${host}`,
    };
  } catch {
    return {
      status: "critical",
      value: 0,
      unit: "resolved",
      message: `DNS resolution failed for ${host}`,
    };
  }
}

export async function checkCertificateExpiry(
  host: string,
  port: number = 443,
  warningDays: number = 30
): Promise<SensorResult> {
  try {
    const output = execSync(
      `echo | openssl s_client -servername "${host}" -connect "${host}:${port}" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null`,
      {
        encoding: "utf-8",
        timeout: 10000,
      }
    );

    const match = output.match(/notAfter=(.+)/);
    if (!match) {
      return {
        status: "critical",
        value: -1,
        unit: "days",
        message: `Could not read certificate expiry for ${host}:${port}`,
      };
    }

    const expiresAt = new Date(match[1].trim());
    const daysLeft = Math.floor(
      (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    if (daysLeft < 0) {
      return {
        status: "critical",
        value: daysLeft,
        unit: "days",
        message: `Certificate expired for ${host}:${port}`,
      };
    }

    if (daysLeft <= warningDays) {
      return {
        status: "warning",
        value: daysLeft,
        unit: "days",
        message: `Certificate for ${host}:${port} expires in ${daysLeft} days`,
      };
    }

    return {
      status: "ok",
      value: daysLeft,
      unit: "days",
    };
  } catch {
    return {
      status: "critical",
      value: -1,
      unit: "days",
      message: `Certificate check failed for ${host}:${port}`,
    };
  }
}
