/**
 * Tests for AudioIngest (Phase 2 Silero VAD endpointing).
 *
 * onnxruntime-node is mocked so no real ONNX model is needed.
 * The model download (fetch + fs) is also mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted before any imports
// ---------------------------------------------------------------------------

// Mock onnxruntime-node so tests can script VAD probability output
const mockSessionRun = vi.fn();
const mockInferenceSessionCreate = vi.fn();

vi.mock("onnxruntime-node", () => ({
  InferenceSession: {
    create: mockInferenceSessionCreate,
  },
  Tensor: class MockTensor {
    constructor(
      public type: string,
      public data: Float32Array | BigInt64Array,
      public dims: number[],
    ) {}
  },
}));

// Mock fs so the model appears to exist (no actual download)
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn().mockReturnValue({ write: vi.fn(), end: vi.fn() }),
  };
});

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  childLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a 512-sample Int16Array with constant amplitude. */
function makePcm16(samples = 512, value = 100): Int16Array {
  return new Int16Array(samples).fill(value);
}

/**
 * Build a VAD mock session that returns the given probability sequence.
 * After the sequence is exhausted, subsequent calls return the last value.
 */
function makeVadSession(probs: number[]): { run: typeof mockSessionRun } {
  let idx = 0;
  const run = vi.fn(async () => {
    const prob = probs[Math.min(idx++, probs.length - 1)] ?? 0;
    return {
      output: { data: new Float32Array([prob]), dims: [1] },
      hn: { data: new Float32Array(2 * 1 * 64), dims: [2, 1, 64] },
      cn: { data: new Float32Array(2 * 1 * 64), dims: [2, 1, 64] },
    };
  });
  return { run };
}

// ---------------------------------------------------------------------------
// Reset module between test suites so ORT init state is fresh
// ---------------------------------------------------------------------------

// We need to re-import AudioIngest after setting up each mock variation.
// Vitest module cache is cleared per suite with resetModules.

// ---------------------------------------------------------------------------
// Suite 1: Bypass mode (vadEnabled=false)
// ---------------------------------------------------------------------------

describe("AudioIngest — bypass mode (vadEnabled=false)", () => {
  it("emits speech.frame for every PCM chunk, no start/end", async () => {
    const { AudioIngest } = await import("../audio-ingest.js");
    const ingest = new AudioIngest({ vadEnabled: false });

    const frames: unknown[] = [];
    const starts: unknown[] = [];
    const ends: unknown[] = [];

    ingest.on("speech.frame", (ev) => frames.push(ev));
    ingest.on("speech.start", (ev) => starts.push(ev));
    ingest.on("speech.end", (ev) => ends.push(ev));

    ingest.start("s1");

    for (let i = 0; i < 5; i++) {
      await ingest.pushPCM16("s1", makePcm16());
    }

    await ingest.stop("s1");

    expect(frames).toHaveLength(5);
    expect(starts).toHaveLength(0);
    expect(ends).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: VAD mocked — speech.start / speech.end flow
// ---------------------------------------------------------------------------

describe("AudioIngest — VAD mocked", () => {
  beforeEach(() => {
    vi.resetModules();
    mockInferenceSessionCreate.mockReset();
    mockSessionRun.mockReset();
  });

  it("emits speech.start after 3 consecutive high-prob frames then speech.end after silence", async () => {
    // probs: 3 silence, 3+ speech onset, 14 speech body, then silence frames
    const speechFrames = Array(14).fill(0.9);
    const silenceFrames = Array(15).fill(0.1); // > 400ms silence (15 * 32ms = 480ms)
    const probs = [0.1, 0.1, 0.1, 0.9, 0.9, 0.9, ...speechFrames, ...silenceFrames];

    const session = makeVadSession(probs);
    mockInferenceSessionCreate.mockResolvedValue(session);

    const { AudioIngest } = await import("../audio-ingest.js");
    const ingest = new AudioIngest({
      vadEnabled: true,
      speechThreshold: 0.5,
      silenceThreshold: 0.35,
      silenceThresholdMs: 400,
      minSpeechMs: 0, // disable minSpeechMs filter for this test
    });

    const starts: Array<{ sessionId: string; t: number }> = [];
    const frameEvents: unknown[] = [];
    const ends: Array<{ sessionId: string; t: number; durationMs: number }> = [];

    ingest.on("speech.start", (ev) => starts.push(ev));
    ingest.on("speech.frame", (ev) => frameEvents.push(ev));
    ingest.on("speech.end", (ev) => ends.push(ev));

    ingest.start("s2");
    await ingest.warmup();

    for (let i = 0; i < probs.length; i++) {
      await ingest.pushPCM16("s2", makePcm16());
    }

    await ingest.stop("s2");

    expect(starts).toHaveLength(1);
    expect(starts[0]!.sessionId).toBe("s2");
    expect(ends).toHaveLength(1);
    expect(ends[0]!.sessionId).toBe("s2");
    expect(ends[0]!.durationMs).toBeGreaterThan(0);
    // speech frames = 3 onset + 14 body frames emitted during inSpeech
    expect(frameEvents.length).toBeGreaterThan(0);
  });

  it("drops speech segment shorter than minSpeechMs", async () => {
    // 3 onset + 2 speech body + long silence → segment is only 2 frames * 32ms = 64ms
    const probs = [0.9, 0.9, 0.9, 0.9, 0.9, ...Array(15).fill(0.1)];
    const session = makeVadSession(probs);
    mockInferenceSessionCreate.mockResolvedValue(session);

    const { AudioIngest } = await import("../audio-ingest.js");
    const ingest = new AudioIngest({
      vadEnabled: true,
      speechThreshold: 0.5,
      silenceThreshold: 0.35,
      silenceThresholdMs: 400,
      minSpeechMs: 250, // 250 ms minimum — 2 frames (64ms) should be dropped
    });

    const starts: unknown[] = [];
    const ends: unknown[] = [];

    ingest.on("speech.start", (ev) => starts.push(ev));
    ingest.on("speech.end", (ev) => ends.push(ev));

    ingest.start("s3");
    await ingest.warmup();

    for (let i = 0; i < probs.length; i++) {
      await ingest.pushPCM16("s3", makePcm16());
    }

    await ingest.stop("s3");

    // speech.start should still fire (onset confirmed), but speech.end should NOT
    // because the segment was shorter than minSpeechMs
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(0);
  });

  it("falls back to bypass when ORT is unavailable", async () => {
    mockInferenceSessionCreate.mockRejectedValue(new Error("ort unavailable"));

    const { AudioIngest } = await import("../audio-ingest.js");
    const ingest = new AudioIngest({
      vadEnabled: true,
      speechThreshold: 0.5,
      silenceThreshold: 0.35,
      silenceThresholdMs: 400,
      minSpeechMs: 0,
    });

    const frames: unknown[] = [];
    ingest.on("speech.frame", (ev) => frames.push(ev));

    ingest.start("s4");
    await ingest.warmup().catch(() => {/* expected */});

    for (let i = 0; i < 3; i++) {
      await ingest.pushPCM16("s4", makePcm16());
    }

    await ingest.stop("s4");

    // Falls through to bypass: all frames forwarded
    expect(frames).toHaveLength(3);
  });
});
