import type { HealthReport } from "../health/monitor.js";
import {
  clearTransientVoiceRuntimeOverride,
  loadLlmRuntimeConfig,
  setTransientVoiceRuntimeOverride,
  type TransientVoiceRuntimeOverride,
  type VoiceRuntimeConfig,
  type WhisperLocalModel,
} from "../llm/runtime-config.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("voice-power");

export type VoicePowerMode = "normal" | "low_power" | "battery_saver";

const MODEL_ORDER: WhisperLocalModel[] = ["tiny", "base", "small", "medium", "large-v3"];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function capModel(current: WhisperLocalModel, ceiling: WhisperLocalModel): WhisperLocalModel {
  const currentIdx = MODEL_ORDER.indexOf(current);
  const ceilingIdx = MODEL_ORDER.indexOf(ceiling);
  if (currentIdx === -1 || ceilingIdx === -1) return ceiling;
  return currentIdx <= ceilingIdx ? current : ceiling;
}

export function deriveVoicePowerMode(report: HealthReport): VoicePowerMode {
  const thermal = report.sensors.thermal?.status;
  const battery = report.sensors.battery?.status;
  const cpu = report.sensors.cpu?.status;
  const memory = report.sensors.memory?.status;

  if (thermal === "critical" || battery === "critical") {
    return "battery_saver";
  }

  if (
    thermal === "warning" ||
    battery === "warning" ||
    report.overall === "critical" ||
    cpu === "critical" ||
    memory === "critical"
  ) {
    return "low_power";
  }

  return "normal";
}

export function buildVoiceRuntimeOverride(
  base: VoiceRuntimeConfig,
  mode: VoicePowerMode,
): TransientVoiceRuntimeOverride | null {
  if (mode === "normal") return null;

  if (mode === "battery_saver") {
    return {
      whisperLocalModel: capModel(base.whisperLocalModel, "tiny"),
      lowLatency: false,
      chunkMs: Math.max(base.chunkMs, 420),
      vad: {
        speechThreshold: clamp01(base.vad.speechThreshold + 0.12),
        silenceThreshold: clamp01(base.vad.silenceThreshold + 0.08),
      },
      wake: {
        cooldownMs: Math.max(base.wake.cooldownMs, 6000),
        threshold: clamp01(base.wake.threshold + 0.15),
      },
    };
  }

  return {
    whisperLocalModel: capModel(base.whisperLocalModel, "base"),
    lowLatency: base.lowLatency,
    chunkMs: Math.max(base.chunkMs, 320),
    vad: {
      speechThreshold: clamp01(base.vad.speechThreshold + 0.08),
      silenceThreshold: clamp01(base.vad.silenceThreshold + 0.05),
    },
    wake: {
      cooldownMs: Math.max(base.wake.cooldownMs, 4000),
      threshold: clamp01(base.wake.threshold + 0.08),
    },
  };
}

interface PowerAwareVoiceRuntimeControllerDeps {
  clearOverride?: () => void;
  getBaseVoiceConfig?: () => VoiceRuntimeConfig;
  restartWakeListener: () => void;
  setOverride?: (override: TransientVoiceRuntimeOverride | null) => void;
}

export class PowerAwareVoiceRuntimeController {
  private currentMode: VoicePowerMode = "normal";
  private readonly clearOverride: () => void;
  private readonly getBaseVoiceConfig: () => VoiceRuntimeConfig;
  private readonly restartWakeListener: () => void;
  private readonly setOverride: (override: TransientVoiceRuntimeOverride | null) => void;

  constructor(deps: PowerAwareVoiceRuntimeControllerDeps) {
    this.clearOverride = deps.clearOverride ?? clearTransientVoiceRuntimeOverride;
    this.getBaseVoiceConfig =
      deps.getBaseVoiceConfig ?? (() => loadLlmRuntimeConfig().voice);
    this.restartWakeListener = deps.restartWakeListener;
    this.setOverride = deps.setOverride ?? setTransientVoiceRuntimeOverride;
  }

  getMode(): VoicePowerMode {
    return this.currentMode;
  }

  handleHealthReport(report: HealthReport): void {
    const nextMode = deriveVoicePowerMode(report);
    if (nextMode === this.currentMode) return;

    this.currentMode = nextMode;

    if (nextMode === "normal") {
      this.clearOverride();
      this.restartWakeListener();
      log.info({ nextMode }, "restored normal voice runtime profile");
      return;
    }

    const override = buildVoiceRuntimeOverride(this.getBaseVoiceConfig(), nextMode);
    this.setOverride(override);
    this.restartWakeListener();
    log.info({ nextMode, override }, "applied power-aware voice runtime profile");
  }
}
