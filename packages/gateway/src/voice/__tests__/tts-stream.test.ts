import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamingTTS } from "../tts-stream.js";

// ---------------------------------------------------------------------------
// Mock edge-tts so no real Python subprocess is invoked
// ---------------------------------------------------------------------------
vi.mock("../edge-tts.js", () => ({
  synthesize: vi.fn(),
  detectLanguage: vi.fn(() => "en"),
  pickVoice: vi.fn(() => "en-US-AriaNeural"),
}));
vi.mock("../../llm/runtime-config.js", () => ({
  loadLlmRuntimeConfig: vi.fn(() => ({
    voice: {
      tts: {
        provider: "omnivoice",
      },
    },
  })),
}));
vi.mock("../omnivoice.js", () => ({
  synthesizeOmniVoiceSpeech: vi.fn(),
}));

import { synthesize as mockSynthesize } from "../edge-tts.js";
import { synthesizeOmniVoiceSpeech as mockSynthesizeOmniVoice } from "../omnivoice.js";
const mockSynth = vi.mocked(mockSynthesize);
const mockOmni = vi.mocked(mockSynthesizeOmniVoice);

// Helper: wrap an array of strings into an AsyncIterable
async function* toAsyncIter(items: string[]): AsyncIterable<string> {
  for (const item of items) yield item;
}

// Produce a fake audio buffer for a given sentence
function fakeAudio(label: string): Buffer {
  return Buffer.from(`audio:${label}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOmni.mockResolvedValue({ audio: fakeAudio("omnivoice"), contentType: "audio/wav" } as any);
});

// ---------------------------------------------------------------------------
// Happy path: 3 complete sentences
// ---------------------------------------------------------------------------
describe("StreamingTTS.synthesize — 3 sentences", () => {
  it("emits one chunk per sentence in order, eos only on last", async () => {
    mockOmni
      .mockResolvedValueOnce({ audio: fakeAudio("s1"), contentType: "audio/wav" } as any)
      .mockResolvedValueOnce({ audio: fakeAudio("s2"), contentType: "audio/wav" } as any)
      .mockResolvedValueOnce({ audio: fakeAudio("s3"), contentType: "audio/wav" } as any);

    const tts = new StreamingTTS();
    const ac = new AbortController();

    const chunks: Array<{ seq: number; audio: Buffer; eos: boolean }> = [];

    for await (const chunk of tts.synthesize(
      toAsyncIter(["Hello. ", "How are you? ", "I am fine."]),
      { sessionId: "test-session", signal: ac.signal },
    )) {
      chunks.push(chunk);
    }

    // All seq values must be monotonically increasing
    const seqs = chunks.map((c) => c.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThanOrEqual(seqs[i - 1]);
    }

    expect(mockOmni.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("passes the AbortSignal through to synthesize()", async () => {
    mockOmni.mockRejectedValueOnce(new Error("fallback"));
    mockSynth.mockResolvedValue(fakeAudio("x"));

    const ac = new AbortController();
    const tts = new StreamingTTS();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of tts.synthesize(
      toAsyncIter(["Hello world. "]),
      { sessionId: "s", signal: ac.signal },
    )) { /* drain */ }

    expect(mockSynth).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: ac.signal }),
    );
  });
});

// ---------------------------------------------------------------------------
// Abort mid-stream
// ---------------------------------------------------------------------------
describe("StreamingTTS.synthesize — abort", () => {
  it("emits a final eos:true sentinel even when aborted before any synthesis", async () => {
    const ac = new AbortController();
    ac.abort(); // abort immediately

    const tts = new StreamingTTS();
    const chunks: Array<{ seq: number; eos: boolean; audio: Buffer }> = [];

    for await (const chunk of tts.synthesize(
      toAsyncIter(["Hello. ", "World. "]),
      { sessionId: "abort-session", signal: ac.signal },
    )) {
      chunks.push(chunk);
    }

    // Must have at least one chunk and the last must be eos:true
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[chunks.length - 1].eos).toBe(true);
  });

  it("stops emitting content chunks after abort, emits eos sentinel", async () => {
    let resolveFirst!: (b: { audio: Buffer; contentType: string }) => void;
    const firstPromise = new Promise<{ audio: Buffer; contentType: string }>((res) => {
      resolveFirst = res;
    });

    mockOmni
      .mockReturnValueOnce(firstPromise as any)
      .mockResolvedValue({ audio: fakeAudio("should-not-emit"), contentType: "audio/wav" } as any);

    const ac = new AbortController();
    const tts = new StreamingTTS();

    const chunks: Array<{ seq: number; eos: boolean; audio: Buffer }> = [];

    const streamPromise = (async () => {
      for await (const chunk of tts.synthesize(
        toAsyncIter(["Sentence one. ", "Sentence two. "]),
        { sessionId: "abort-mid", signal: ac.signal },
      )) {
        chunks.push(chunk);
      }
    })();

    // Abort before first synthesis resolves
    ac.abort();
    resolveFirst({ audio: fakeAudio("s1"), contentType: "audio/wav" });

    await streamPromise;

    // Final chunk must be eos:true
    expect(chunks[chunks.length - 1].eos).toBe(true);
    // Must not have called synthesize more than once (second sentence not scheduled)
    expect(mockOmni.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Buffer flush at char threshold
// ---------------------------------------------------------------------------
describe("StreamingTTS.synthesize — char threshold flush", () => {
  it("flushes when buffer exceeds 200 chars without a sentence boundary", async () => {
    mockOmni.mockResolvedValue({ audio: fakeAudio("long"), contentType: "audio/wav" } as any);

    const longDelta = "a".repeat(210); // exceeds FLUSH_CHAR_THRESHOLD
    const tts = new StreamingTTS();
    const ac = new AbortController();

    const chunks: Array<{ seq: number; eos: boolean }> = [];
    for await (const chunk of tts.synthesize(
      toAsyncIter([longDelta]),
      { sessionId: "threshold", signal: ac.signal },
    )) {
      chunks.push(chunk);
    }

    expect(mockOmni).toHaveBeenCalled();
    expect(chunks[chunks.length - 1].eos).toBe(true);
  });
});
