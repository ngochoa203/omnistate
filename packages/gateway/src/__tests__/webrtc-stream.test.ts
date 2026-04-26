import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("../hybrid/automation.js", () => ({
  transcribeAudio: vi.fn(),
}));

vi.mock("../llm/runtime-config.js", () => ({
  loadLlmRuntimeConfig: vi.fn(() => ({
    voice: {
      primaryProvider: "native",
      fallbackProviders: [],
      lowLatency: false,
    },
  })),
}));

vi.mock("../utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  childLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

vi.mock("../voice/whisper-local-client.js", () => ({
  whisperLocalClient: {
    startSession: vi.fn(),
    pushChunk: vi.fn().mockResolvedValue(undefined),
    stopSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../voice/verification.js", () => ({ verifySpeaker: vi.fn() }));
vi.mock("../voice/edge-tts.js", () => ({
  synthesize: vi.fn(),
  detectLanguage: vi.fn(),
  pickVoice: vi.fn(),
}));

import * as HybridAutomation from "../hybrid/automation.js";
const { VoiceStreamManager } = await import("../voice/webrtc-stream.js");

const SESSION_ID = "test-session-1";
const CLIENT_ID = "client-1";

function makeAudioBuffer(bytes: number): Buffer {
  return Buffer.alloc(bytes, 0x80);
}

function startSession(manager: InstanceType<typeof VoiceStreamManager>, send: ReturnType<typeof vi.fn>) {
  manager.handleControlMessage(CLIENT_ID, { type: "voice.stream.start", sessionId: SESSION_ID }, send);
}

function stopSession(manager: InstanceType<typeof VoiceStreamManager>, send: ReturnType<typeof vi.fn>) {
  manager.handleControlMessage(CLIENT_ID, { type: "voice.stream.stop", sessionId: SESSION_ID }, send);
}

beforeEach(() => {
  vi.mocked(HybridAutomation.transcribeAudio).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("VoiceStreamManager — STT pipeline", () => {
  it("Case A — no chunks: emits STT_EMPTY_AUDIO", async () => {
    const manager = new VoiceStreamManager();
    const send = vi.fn();
    startSession(manager, send);
    stopSession(manager, send);

    // finalize is async with a 150ms drain window; wait enough time
    await new Promise((r) => setTimeout(r, 300));

    const errorMsg = send.mock.calls.find(([m]) => m.type === "voice.stream.error")?.[0];
    expect(errorMsg).toBeDefined();
    expect(errorMsg.code).toBe("STT_EMPTY_AUDIO");
    expect(HybridAutomation.transcribeAudio).not.toHaveBeenCalled();
  });

  it("Case B — tiny audio (< 1 KB): emits STT_EMPTY_AUDIO", async () => {
    const manager = new VoiceStreamManager();
    const send = vi.fn();
    startSession(manager, send);
    manager.handleBinaryFrame(CLIENT_ID, makeAudioBuffer(512), send);
    stopSession(manager, send);

    await new Promise((r) => setTimeout(r, 300));

    const errorMsg = send.mock.calls.find(([m]) => m.type === "voice.stream.error")?.[0];
    expect(errorMsg).toBeDefined();
    expect(errorMsg.code).toBe("STT_EMPTY_AUDIO");
    expect(HybridAutomation.transcribeAudio).not.toHaveBeenCalled();
  });

  it("Case C — all providers throw: emits STT_PROVIDER_FAILED", async () => {
    vi.mocked(HybridAutomation.transcribeAudio).mockRejectedValue(new Error("network error"));

    const manager = new VoiceStreamManager();
    const send = vi.fn();
    startSession(manager, send);
    manager.handleBinaryFrame(CLIENT_ID, makeAudioBuffer(2048), send);
    stopSession(manager, send);

    await new Promise((r) => setTimeout(r, 300));

    const errorMsg = send.mock.calls.find(([m]) => m.type === "voice.stream.error")?.[0];
    expect(errorMsg).toBeDefined();
    expect(errorMsg.code).toBe("STT_PROVIDER_FAILED");
  });

  it("Case D — all providers return empty string: emits STT_NO_SPEECH", async () => {
    vi.mocked(HybridAutomation.transcribeAudio).mockResolvedValue({ text: "   " } as any);

    const manager = new VoiceStreamManager();
    const send = vi.fn();
    startSession(manager, send);
    manager.handleBinaryFrame(CLIENT_ID, makeAudioBuffer(2048), send);
    stopSession(manager, send);

    await new Promise((r) => setTimeout(r, 300));

    const errorMsg = send.mock.calls.find(([m]) => m.type === "voice.stream.error")?.[0];
    expect(errorMsg).toBeDefined();
    expect(errorMsg.code).toBe("STT_NO_SPEECH");
  });

  it("Case E — provider returns text: emits voice.stream.result with kind=final", async () => {
    vi.mocked(HybridAutomation.transcribeAudio).mockResolvedValue({ text: "turn off the lights" } as any);

    const manager = new VoiceStreamManager();
    const send = vi.fn();
    startSession(manager, send);
    manager.handleBinaryFrame(CLIENT_ID, makeAudioBuffer(2048), send);
    stopSession(manager, send);

    await new Promise((r) => setTimeout(r, 300));

    const resultMsg = send.mock.calls.find(([m]) => m.type === "voice.stream.result")?.[0];
    expect(resultMsg).toBeDefined();
    expect(resultMsg.kind).toBe("final");
    expect(resultMsg.text).toBe("turn off the lights");
    expect(resultMsg.provider).toBe("native");
  });
});
