import { describe, expect, it, vi } from "vitest";
import type { HealthReport } from "../../health/monitor.js";
import type { VoiceRuntimeConfig } from "../../llm/runtime-config.js";
import {
  buildVoiceRuntimeOverride,
  deriveVoicePowerMode,
  PowerAwareVoiceRuntimeController,
} from "../power-aware-runtime.js";

function makeVoiceConfig(): VoiceRuntimeConfig {
  return {
    whisperLocalModel: "small",
    lowLatency: true,
    autoExecuteTranscript: true,
    primaryProvider: "whisper-local",
    fallbackProviders: ["whisper-cloud", "native"],
    chunkMs: 220,
    siri: {
      enabled: false,
      mode: "handoff",
      shortcutName: "OmniState Bridge",
      endpoint: "http://127.0.0.1:19801/siri/command",
      token: "",
    },
    vad: {
      enabled: true,
      silenceThresholdMs: 400,
      speechThreshold: 0.5,
      silenceThreshold: 0.35,
      minSpeechMs: 250,
    },
    wake: {
      enabled: true,
      phrase: "hey omni",
      cooldownMs: 2500,
      commandWindowSec: 7,
      engine: "oww",
      aliases: ["hey omni"],
      threshold: 0.5,
    },
  };
}

function makeHealthReport(
  overrides: Partial<HealthReport["sensors"]>,
  overall: HealthReport["overall"] = "healthy",
): HealthReport {
  return {
    timestamp: new Date().toISOString(),
    overall,
    sensors: {
      cpu: { status: "ok", value: 20, unit: "%" },
      memory: { status: "ok", value: 40, unit: "%" },
      disk: { status: "ok", value: 50, unit: "%" },
      network: { status: "ok", value: 1, unit: "ms" },
      processes: { status: "ok", value: 10, unit: "count" },
      thermal: { status: "ok", value: 55, unit: "celsius" },
      battery: { status: "ok", value: 82, unit: "%" },
      ...overrides,
    },
    alerts: [],
    repairs: [],
  };
}

describe("power-aware voice runtime", () => {
  it("derives battery_saver for critical thermal or battery pressure", () => {
    expect(
      deriveVoicePowerMode(
        makeHealthReport({
          thermal: { status: "critical", value: 98, unit: "celsius" },
        }),
      ),
    ).toBe("battery_saver");

    expect(
      deriveVoicePowerMode(
        makeHealthReport({
          battery: { status: "critical", value: 4, unit: "%" },
        }),
      ),
    ).toBe("battery_saver");
  });

  it("builds a lower-power override without disabling wake entirely", () => {
    const override = buildVoiceRuntimeOverride(makeVoiceConfig(), "low_power");
    expect(override?.whisperLocalModel).toBe("base");
    expect(override?.chunkMs).toBeGreaterThanOrEqual(320);
    expect(override?.wake?.threshold).toBeGreaterThan(0.5);
    expect(override?.wake?.cooldownMs).toBeGreaterThanOrEqual(4000);
  });

  it("applies and clears transient overrides when health mode changes", () => {
    const restartWakeListener = vi.fn();
    const setOverride = vi.fn();
    const clearOverride = vi.fn();
    const controller = new PowerAwareVoiceRuntimeController({
      clearOverride,
      getBaseVoiceConfig: makeVoiceConfig,
      restartWakeListener,
      setOverride,
    });

    controller.handleHealthReport(
      makeHealthReport({
        battery: { status: "warning", value: 14, unit: "%" },
      }),
    );

    expect(controller.getMode()).toBe("low_power");
    expect(setOverride).toHaveBeenCalledOnce();
    expect(restartWakeListener).toHaveBeenCalledOnce();

    controller.handleHealthReport(makeHealthReport({}));

    expect(controller.getMode()).toBe("normal");
    expect(clearOverride).toHaveBeenCalledOnce();
    expect(restartWakeListener).toHaveBeenCalledTimes(2);
  });
});
