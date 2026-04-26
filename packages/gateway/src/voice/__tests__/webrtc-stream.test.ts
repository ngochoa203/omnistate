/**
 * Tests for VoiceStreamManager — focusing on the buffer-flush/stop-drain path
 * that ensures in-flight binary frames arriving just before voice.stream.stop
 * are included in STT processing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { VoiceStreamManager } from "../webrtc-stream.js";

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
      speakerVerification: null,
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
