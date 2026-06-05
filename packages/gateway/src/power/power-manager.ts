import { execSync } from "node:child_process";
import { v4 as uuid } from "uuid";
import type { EventBus } from "../events/event-bus.js";
import { childLogger } from "../utils/logger.js";
import type { VoicePowerMode } from "../voice/power-aware-runtime.js";

const log = childLogger("power-manager");

export interface PowerState {
  mode: VoicePowerMode;
  isOnBattery: boolean;
  isCharging: boolean;
  chargePercent: number | null;
  lowPowerModeEnabled: boolean;
  thermalPressure: "nominal" | "moderate" | "heavy" | "critical" | "unknown";
  sampledAt: number;
}

export interface PowerManagerOptions {
  lowBatteryThreshold?: number;
  criticalBatteryThreshold?: number;
  pollIntervalMs?: number;
  readState?: () => PowerState;
}

function safeExec(command: string): string {
  try {
    return execSync(command, { encoding: "utf-8" });
  } catch {
    return "";
  }
}

export function parseBatteryState(pmsetBattOutput: string): {
  chargePercent: number | null;
  isOnBattery: boolean;
  isCharging: boolean;
} {
  const percentMatch = pmsetBattOutput.match(/(\d+)%/);
  const chargePercent = percentMatch ? Number.parseInt(percentMatch[1], 10) : null;
  const isOnBattery = /Battery Power/i.test(pmsetBattOutput);
  const isCharging = /AC Power/i.test(pmsetBattOutput) && /charging/i.test(pmsetBattOutput);
  return { chargePercent, isOnBattery, isCharging };
}

export function parseThermalPressure(
  pmsetThermOutput: string,
): PowerState["thermalPressure"] {
  const text = pmsetThermOutput.toLowerCase();
  if (text.includes("critical")) return "critical";
  if (text.includes("heavy")) return "heavy";
  if (text.includes("moderate")) return "moderate";
  if (text.includes("nominal") || text.includes("no thermal warning")) return "nominal";

  const limitMatch = pmsetThermOutput.match(/CPU_Speed_Limit\s*=\s*(\d+)/i);
  const limit = limitMatch ? Number.parseInt(limitMatch[1], 10) : null;
  if (limit === null || Number.isNaN(limit)) return "unknown";
  if (limit >= 90) return "nominal";
  if (limit >= 70) return "moderate";
  if (limit >= 50) return "heavy";
  return "critical";
}

export function parseLowPowerMode(pmsetCustomOutput: string): boolean {
  return /\blowpowermode\b\s+1\b/i.test(pmsetCustomOutput);
}

export function derivePowerMode(
  state: Pick<PowerState, "chargePercent" | "isCharging" | "isOnBattery" | "lowPowerModeEnabled" | "thermalPressure">,
  thresholds: { lowBatteryThreshold: number; criticalBatteryThreshold: number },
): VoicePowerMode {
  if (
    state.thermalPressure === "critical" ||
    (!state.isCharging &&
      state.chargePercent !== null &&
      state.chargePercent <= thresholds.criticalBatteryThreshold)
  ) {
    return "battery_saver";
  }

  if (
    state.lowPowerModeEnabled ||
    state.thermalPressure === "heavy" ||
    state.thermalPressure === "moderate" ||
    (state.isOnBattery &&
      !state.isCharging &&
      state.chargePercent !== null &&
      state.chargePercent <= thresholds.lowBatteryThreshold)
  ) {
    return "low_power";
  }

  return "normal";
}

export class PowerManager {
  private currentState: PowerState | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lowBatteryThreshold: number;
  private readonly criticalBatteryThreshold: number;
  private readonly pollIntervalMs: number;
  private readonly readStateImpl: () => PowerState;

  constructor(
    private readonly eventBus: EventBus | null,
    options: PowerManagerOptions = {},
  ) {
    this.lowBatteryThreshold = options.lowBatteryThreshold ?? 20;
    this.criticalBatteryThreshold = options.criticalBatteryThreshold ?? 10;
    this.pollIntervalMs = options.pollIntervalMs ?? 15_000;
    this.readStateImpl = options.readState ?? (() => this.readStateFromSystem());
  }

  start(): void {
    this.refresh();
    if (this.timer) return;
    this.timer = setInterval(() => this.refresh(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getState(): PowerState | null {
    return this.currentState;
  }

  refresh(): PowerState {
    const nextState = this.readStateImpl();
    const changed =
      !this.currentState ||
      this.currentState.mode !== nextState.mode ||
      this.currentState.isOnBattery !== nextState.isOnBattery ||
      this.currentState.isCharging !== nextState.isCharging ||
      this.currentState.chargePercent !== nextState.chargePercent ||
      this.currentState.lowPowerModeEnabled !== nextState.lowPowerModeEnabled ||
      this.currentState.thermalPressure !== nextState.thermalPressure;

    this.currentState = nextState;

    if (changed) {
      log.info({ state: nextState }, "power state changed");
      this.eventBus?.emit({
        id: uuid(),
        type: "power.state.changed",
        source: "power-manager",
        payload: nextState as unknown as Record<string, unknown>,
        timestamp: nextState.sampledAt,
      });
    }

    return nextState;
  }

  private readStateFromSystem(): PowerState {
    const battery = parseBatteryState(safeExec("pmset -g batt"));
    const thermalPressure = parseThermalPressure(safeExec("pmset -g therm 2>/dev/null"));
    const lowPowerModeEnabled = parseLowPowerMode(
      safeExec("pmset -g custom 2>/dev/null || pmset -g 2>/dev/null"),
    );

    const sampledAt = Date.now();
    const mode = derivePowerMode(
      {
        ...battery,
        lowPowerModeEnabled,
        thermalPressure,
      },
      {
        lowBatteryThreshold: this.lowBatteryThreshold,
        criticalBatteryThreshold: this.criticalBatteryThreshold,
      },
    );

    return {
      mode,
      isOnBattery: battery.isOnBattery,
      isCharging: battery.isCharging,
      chargePercent: battery.chargePercent,
      lowPowerModeEnabled,
      thermalPressure,
      sampledAt,
    };
  }
}
