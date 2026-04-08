/**
 * Health Monitor — system health watchdog daemon.
 *
 * Runs periodic health checks, detects anomalies,
 * and triggers auto-repair when configured.
 */

import { checkCpu, checkMemory, checkDisk, checkNetwork, checkProcesses } from "./sensors.js";
import { autoRepair, type RepairAction } from "./repair.js";

export type HealthStatus = "healthy" | "degraded" | "critical";
export type SeverityLevel = "info" | "warning" | "critical";

export interface HealthReport {
  timestamp: string;
  overall: HealthStatus;
  sensors: Record<string, SensorResult>;
  alerts: HealthAlert[];
  repairs: RepairAction[];
}

export interface SensorResult {
  status: "ok" | "warning" | "critical";
  value: number;
  unit: string;
  message?: string;
}

export interface HealthAlert {
  sensor: string;
  severity: SeverityLevel;
  message: string;
  timestamp: string;
}

export class HealthMonitor {
  private intervalMs: number;
  private autoRepairEnabled: boolean;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: ((report: HealthReport) => void)[] = [];

  constructor(intervalMs: number = 30000, autoRepair: boolean = true) {
    this.intervalMs = intervalMs;
    this.autoRepairEnabled = autoRepair;
  }

  /** Start periodic health monitoring. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.runCheck(), this.intervalMs);
    // Run immediately on start
    this.runCheck();
  }

  /** Stop monitoring. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Register a listener for health reports. */
  onReport(listener: (report: HealthReport) => void): void {
    this.listeners.push(listener);
  }

  /** Run a single health check cycle. */
  async runCheck(): Promise<HealthReport> {
    const sensors: Record<string, SensorResult> = {};
    const alerts: HealthAlert[] = [];
    const repairs: RepairAction[] = [];

    // Collect sensor data
    sensors.cpu = await checkCpu();
    sensors.memory = await checkMemory();
    sensors.disk = await checkDisk();
    sensors.network = await checkNetwork();
    sensors.processes = await checkProcesses();

    // Generate alerts from sensor results
    for (const [name, result] of Object.entries(sensors)) {
      if (result.status !== "ok") {
        alerts.push({
          sensor: name,
          severity: result.status === "critical" ? "critical" : "warning",
          message: result.message ?? `${name} is ${result.status}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Auto-repair if enabled
    if (this.autoRepairEnabled && alerts.length > 0) {
      for (const alert of alerts) {
        const action = await autoRepair(alert);
        if (action) repairs.push(action);
      }
    }

    // Determine overall status
    const hasAnyCritical = Object.values(sensors).some(
      (s) => s.status === "critical"
    );
    const hasAnyWarning = Object.values(sensors).some(
      (s) => s.status === "warning"
    );
    const overall: HealthStatus = hasAnyCritical
      ? "critical"
      : hasAnyWarning
        ? "degraded"
        : "healthy";

    const report: HealthReport = {
      timestamp: new Date().toISOString(),
      overall,
      sensors,
      alerts,
      repairs,
    };

    // Notify listeners
    for (const listener of this.listeners) {
      listener(report);
    }

    return report;
  }
}
