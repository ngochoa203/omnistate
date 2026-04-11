/**
 * Health Monitor — system health watchdog daemon.
 *
 * Runs periodic health checks, detects anomalies,
 * and triggers auto-repair when configured.
 */

import { execSync } from "node:child_process";
import {
  checkCpu,
  checkMemory,
  checkDisk,
  checkNetwork,
  checkProcesses,
  checkThermal,
  checkBattery,
  checkDnsResolution,
  checkCertificateExpiry,
} from "./sensors.js";
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

export interface ProcessWatchConfig {
  name: string;
  checkCommand?: string;
  restartCommand: string;
  maxRestarts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  check?: () => Promise<boolean>;
  restart?: () => Promise<boolean>;
}

export interface DnsWatchConfig {
  host: string;
  check?: () => Promise<SensorResult>;
}

export interface CertWatchConfig {
  host: string;
  port?: number;
  warningDays?: number;
  check?: () => Promise<SensorResult>;
}

interface ProcessWatchState {
  restartCount: number;
  lastRestartMs: number;
}

export class HealthMonitor {
  private intervalMs: number;
  private autoRepairEnabled: boolean;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: ((report: HealthReport) => void)[] = [];
  private processWatches = new Map<string, ProcessWatchConfig>();
  private processStates = new Map<string, ProcessWatchState>();
  private dnsWatches: DnsWatchConfig[] = [];
  private certWatches: CertWatchConfig[] = [];
  private thermalCheck: () => Promise<SensorResult> = checkThermal;
  private batteryCheck: () => Promise<SensorResult> = checkBattery;

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

  /** Register a process that should be auto-restarted after crashes. */
  watchProcess(config: ProcessWatchConfig): void {
    this.processWatches.set(config.name, config);
    if (!this.processStates.has(config.name)) {
      this.processStates.set(config.name, { restartCount: 0, lastRestartMs: 0 });
    }
  }

  /** Stop watching a process for crash recovery. */
  unwatchProcess(name: string): void {
    this.processWatches.delete(name);
    this.processStates.delete(name);
  }

  /** Configure DNS targets for monitoring. */
  setDnsWatches(watches: DnsWatchConfig[]): void {
    this.dnsWatches = [...watches];
  }

  /** Configure certificate targets for expiry monitoring. */
  setCertWatches(watches: CertWatchConfig[]): void {
    this.certWatches = [...watches];
  }

  /** Override thermal sensor function (primarily for tests). */
  setThermalCheck(check: () => Promise<SensorResult>): void {
    this.thermalCheck = check;
  }

  /** Override battery sensor function (primarily for tests). */
  setBatteryCheck(check: () => Promise<SensorResult>): void {
    this.batteryCheck = check;
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
    sensors.thermal = await this.thermalCheck();
    sensors.battery = await this.batteryCheck();

    // UC-C14: DNS monitoring
    for (const dnsWatch of this.dnsWatches) {
      const key = `dns.${dnsWatch.host}`;
      sensors[key] = dnsWatch.check
        ? await dnsWatch.check()
        : await checkDnsResolution(dnsWatch.host);
    }

    // UC-C14: Certificate expiry monitoring
    for (const certWatch of this.certWatches) {
      const port = certWatch.port ?? 443;
      const warningDays = certWatch.warningDays ?? 30;
      const key = `cert.${certWatch.host}:${port}`;
      sensors[key] = certWatch.check
        ? await certWatch.check()
        : await checkCertificateExpiry(certWatch.host, port, warningDays);
    }

    // UC-C04: Crash detection + auto-restart with exponential backoff
    for (const [name, watch] of this.processWatches.entries()) {
      const state = this.processStates.get(name) ?? {
        restartCount: 0,
        lastRestartMs: 0,
      };

      const isRunning = watch.check
        ? await watch.check()
        : this.isProcessRunning(watch);

      sensors[`service.${name}`] = {
        status: isRunning ? "ok" : "critical",
        value: isRunning ? 1 : 0,
        unit: "running",
        message: isRunning ? undefined : `${name} is not running`,
      };

      if (isRunning) {
        state.restartCount = 0;
        this.processStates.set(name, state);
        continue;
      }

      if (!this.autoRepairEnabled) continue;

      const maxRestarts = watch.maxRestarts ?? 5;
      if (state.restartCount >= maxRestarts) {
        repairs.push({
          sensor: `service.${name}`,
          action: `Skipped restart for ${name} (max retries reached)`,
          success: false,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const baseBackoffMs = watch.baseBackoffMs ?? 1000;
      const maxBackoffMs = watch.maxBackoffMs ?? 30000;
      const delayMs = Math.min(
        baseBackoffMs * Math.pow(2, state.restartCount),
        maxBackoffMs
      );
      const now = Date.now();

      if (state.lastRestartMs > 0 && now - state.lastRestartMs < delayMs) {
        continue;
      }

      const restarted = watch.restart
        ? await watch.restart()
        : this.restartProcess(watch);

      state.lastRestartMs = now;
      state.restartCount += 1;
      this.processStates.set(name, state);

      repairs.push({
        sensor: `service.${name}`,
        action: restarted
          ? `Restarted ${name} with backoff`
          : `Failed to restart ${name}`,
        success: restarted,
        timestamp: new Date().toISOString(),
        detail: `attempt=${state.restartCount} backoffMs=${delayMs}`,
      });
    }

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

  private isProcessRunning(watch: ProcessWatchConfig): boolean {
    try {
      const checkCommand = watch.checkCommand ?? `pgrep -f "${watch.name}"`;
      execSync(checkCommand, { encoding: "utf-8", timeout: 5000, stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  private restartProcess(watch: ProcessWatchConfig): boolean {
    try {
      execSync(watch.restartCommand, {
        encoding: "utf-8",
        timeout: 15000,
        stdio: "pipe",
      });
      return true;
    } catch {
      return false;
    }
  }
}
