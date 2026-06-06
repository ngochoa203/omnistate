/**
 * Tests for VoiceStreamManager — focusing on the buffer-flush/stop-drain path
 * that ensures in-flight binary frames arriving just before voice.stream.stop
 * are included in STT processing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { VoiceStreamManager, resolveVoiceExecutionPolicy } from "../webrtc-stream.js";
import type { LlmRuntimeConfig } from "../../llm/runtime-config.js";
import type { DeviceProfile } from "../device-profiles.js";

// Stub heavy dependencies that aren't needed for these unit tests
vi.mock("../../hybrid/automation.js", () => ({
  transcribeAudio: vi.fn().mockResolvedValue({ text: "hello world", confidence: 1, durationMs: 100, provider: "whisper-local" }),
}));
vi.mock("../../llm/runtime-config.js", () => ({
  loadLlmRuntimeConfig: vi.fn().mockReturnValue({
    voice: {
      primaryProvider: "whisper-local",
      fallbackProviders: [],
      lowLatency: false,
      vad: {
        enabled: true,
        silenceThresholdMs: 400,
        speechThreshold: 0.5,
        silenceThreshold: 0.35,
        minSpeechMs: 250,
      },
      tts: { provider: "none" },
    },
  }),
}));
vi.mock("../verification.js", () => ({ verifySpeaker: vi.fn() }));
vi.mock("../edge-tts.js", () => ({
  synthesize: vi.fn(),
  detectLanguage: vi.fn(),
  pickVoice: vi.fn(),
}));
vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  childLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));
vi.mock("../whisper-local-client.js", () => ({
  whisperLocalClient: {
    startSession: vi.fn(),
    pushChunk: vi.fn().mockResolvedValue(undefined),
    stopSession: vi.fn().mockResolvedValue(undefined),
  },
}));

const SESSION_ID = "test-session-1";
const CLIENT_ID = "client-1";

function makeChunk(size = 4096): Buffer {
  return Buffer.alloc(size, 0x11);
}

describe("VoiceStreamManager", () => {
  let manager: VoiceStreamManager;
  const messages: unknown[] = [];
  const send = (msg: unknown) => messages.push(msg);

  beforeEach(() => {
    manager = new VoiceStreamManager();
    messages.length = 0;
  });

  it("accumulates chunks and finalizes on stop", async () => {
    manager.handleControlMessage(CLIENT_ID, { type: "voice.stream.start", sessionId: SESSION_ID }, send);

    const chunk1 = makeChunk(8192);
    const chunk2 = makeChunk(4096);
    manager.handleBinaryFrame(CLIENT_ID, chunk1, send);
    manager.handleBinaryFrame(CLIENT_ID, chunk2, send);

    // Trigger stop and wait for drain delay + async finalize
    manager.handleControlMessage(CLIENT_ID, { type: "voice.stream.stop", sessionId: SESSION_ID }, send);

    // Wait for drain (150ms) + async processing
    await new Promise((r) => setTimeout(r, 400));

    const result = messages.find((m: any) => m.type === "voice.stream.result") as any;
    expect(result).toBeDefined();
    expect(result.kind).toBe("final");
    expect(result.text).toBe("hello world");
  });

  it("includes a binary frame sent just before stop (flush window)", async () => {
    const { transcribeAudio } = await import("../../hybrid/automation.js");
    let capturedBytes = 0;
    vi.mocked(transcribeAudio).mockImplementation(async (buf: Buffer) => {
      capturedBytes = buf.length;
      return { text: "captured", confidence: 1, durationMs: 100, provider: "whisper-local" };
    });

    manager.handleControlMessage(CLIENT_ID, { type: "voice.stream.start", sessionId: SESSION_ID }, send);

    const earlyChunk = makeChunk(8192);
    manager.handleBinaryFrame(CLIENT_ID, earlyChunk, send);

    // Simulate: stop message arrives simultaneously with last chunk
    manager.handleControlMessage(CLIENT_ID, { type: "voice.stream.stop", sessionId: SESSION_ID }, send);
    // Last chunk arrives within the drain window
    const lateChunk = makeChunk(2048);
    manager.handleBinaryFrame(CLIENT_ID, lateChunk, send);

    await new Promise((r) => setTimeout(r, 400));

    // Both chunks should have been fed to STT
    expect(capturedBytes).toBe(earlyChunk.length + lateChunk.length);
  });

  it("rejects unknown session on stop", () => {
    manager.handleControlMessage(CLIENT_ID, { type: "voice.stream.stop", sessionId: "no-such-session" }, send);
    const err = messages.find((m: any) => m.type === "voice.stream.error") as any;
    expect(err).toBeDefined();
    expect(err.error).toMatch(/No active streaming session/);
  });

  it("drops frames after session is finalized", async () => {
    manager.handleControlMessage(CLIENT_ID, { type: "voice.stream.start", sessionId: SESSION_ID }, send);
    manager.handleBinaryFrame(CLIENT_ID, makeChunk(4096), send);
    manager.handleControlMessage(CLIENT_ID, { type: "voice.stream.stop", sessionId: SESSION_ID }, send);
    await new Promise((r) => setTimeout(r, 400));

    // After finalization, binary frames should be silently dropped
    const beforeCount = messages.length;
    manager.handleBinaryFrame(CLIENT_ID, makeChunk(512), send);
    expect(messages.length).toBe(beforeCount);
  });
});

describe("resolveVoiceExecutionPolicy", () => {
  const runtime = {
    activeProviderId: "x",
    activeModel: "y",
    fallbackProviderIds: [],
    providers: [],
    fastPathThreshold: 0.92,
    tokenBudget: {
      compactPrompt: true,
      intentMaxTokens: 100,
      decomposeMaxTokens: 100,
      maxInputChars: 1000,
    },
    power: {
      lowBatteryThreshold: 20,
      criticalBatteryThreshold: 10,
      pollIntervalMs: 15000,
    },
    voice: {
      primaryProvider: "native",
      fallbackProviders: ["whisper-local", "whisper-cloud"],
      lowLatency: true,
      autoExecuteTranscript: true,
      whisperLocalModel: "small",
      chunkMs: 220,
      tts: { provider: "rtvc" },
      siri: {
        enabled: false,
        mode: "handoff",
        shortcutName: "",
        endpoint: "",
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
        phrase: "hey mimi",
        cooldownMs: 2500,
        commandWindowSec: 7,
        engine: "oww",
        aliases: [],
        threshold: 0.5,
      },
    },
    session: {
      currentSessionId: "default",
      sessions: [],
    },
  } satisfies LlmRuntimeConfig;

  function makeProfile(
    powerMode: DeviceProfile["powerMode"],
    overrides?: Partial<DeviceProfile["recommendedSettings"]>,
  ): DeviceProfile {
    return {
      deviceType: "macos",
      capabilities: {
        maxSampleRate: 48000,
        supportsStereo: true,
        hasGoodMicrophone: true,
        hasGoodSpeaker: true,
        supportsLowLatency: true,
        supportsHardwareAcceleration: true,
        maxConcurrentStreams: 4,
        supportsWakeWordDsp: true,
      },
      audioProfile: {
        inputLatencyMs: 5,
        outputLatencyMs: 10,
        recommendedChunkMs: 260,
        bufferSize: 1024,
        noiseSuppression: true,
        echoCancellation: true,
        automaticGainControl: true,
      },
      powerMode,
      recommendedSettings: {
        sttProvider: "whisper-local",
        whisperModel: "small",
        vadEnabled: true,
        vadSpeechThreshold: 0.5,
        vadSilenceThreshold: 0.35,
        wakeEngine: "personal",
        wakeThreshold: 0.5,
        ttsProvider: "edge",
        ttsVoiceSpeed: 1.0,
        enableContinuousListening: powerMode !== "battery_saver",
        enableOnDeviceProcessing: powerMode === "normal",
        ...overrides,
      },
      confidence: 1,
    };
  }

  it("prioritizes the device profile STT provider and preserves chunk guidance", () => {
    const policy = resolveVoiceExecutionPolicy(runtime, makeProfile("normal"), "audio/webm");
    expect(policy.orderedProviders[0]).toBe("whisper-local");
    expect(policy.preferredChunkMs).toBe(260);
  });

  it("disables streaming and low-latency race in battery saver", () => {
    const policy = resolveVoiceExecutionPolicy(runtime, makeProfile("battery_saver"), "audio/pcm");
    expect(policy.useStreamingStt).toBe(false);
    expect(policy.useLowLatencyRace).toBe(false);
  });

  it("falls back from rtvc to edge TTS in low-power modes", () => {
    const policy = resolveVoiceExecutionPolicy(runtime, makeProfile("low_power"), "audio/webm");
    expect(policy.ttsProvider).toBe("edge");
  });

  it("falls back from omnivoice to edge TTS in low-power modes", () => {
    const omnivoiceRuntime = {
      ...runtime,
      voice: {
        ...runtime.voice,
        tts: { provider: "omnivoice" as const },
      },
    } satisfies LlmRuntimeConfig;

    const policy = resolveVoiceExecutionPolicy(omnivoiceRuntime, makeProfile("low_power"), "audio/webm");
    expect(policy.ttsProvider).toBe("edge");
  });

  it("raises TTS cadence in constrained power modes", () => {
    expect(resolveVoiceExecutionPolicy(runtime, makeProfile("normal"), "audio/webm").ttsRate).toBe(1);
    expect(resolveVoiceExecutionPolicy(runtime, makeProfile("low_power"), "audio/webm").ttsRate).toBe(1.05);
    expect(resolveVoiceExecutionPolicy(runtime, makeProfile("battery_saver"), "audio/webm").ttsRate).toBe(1.1);
  });

  it("respects the device profile base TTS speed before power adjustments", () => {
    const policy = resolveVoiceExecutionPolicy(
      runtime,
      makeProfile("low_power", { ttsVoiceSpeed: 0.95 }),
      "audio/webm",
    );
    expect(policy.ttsRate).toBe(1);
  });

  it("raises VAD buffering thresholds in constrained power modes", () => {
    const normal = resolveVoiceExecutionPolicy(runtime, makeProfile("normal"), "audio/webm");
    const saver = resolveVoiceExecutionPolicy(runtime, makeProfile("battery_saver"), "audio/webm");

    expect(saver.vadConfig.silenceThresholdMs).toBeGreaterThan(normal.vadConfig.silenceThresholdMs);
    expect(saver.vadConfig.minSpeechMs).toBeGreaterThan(normal.vadConfig.minSpeechMs);
    expect(saver.vadConfig.speechThreshold).toBeGreaterThan(normal.vadConfig.speechThreshold);
  });

  it("adds extra VAD damping for devices without low-latency audio", () => {
    const policy = resolveVoiceExecutionPolicy(
      runtime,
      {
        ...makeProfile("normal"),
        capabilities: {
          ...makeProfile("normal").capabilities,
          supportsLowLatency: false,
        },
      },
      "audio/webm",
    );

    expect(policy.vadConfig.silenceThresholdMs).toBeGreaterThan(runtime.voice.vad.silenceThresholdMs);
    expect(policy.vadConfig.minSpeechMs).toBeGreaterThan(runtime.voice.vad.minSpeechMs);
  });
});
