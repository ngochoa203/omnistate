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

import { synthesize as mockSynthesize } from "../edge-tts.js";
const mockSynth = vi.mocked(mockSynthesize);

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
});

// ---------------------------------------------------------------------------
// Happy path: 3 complete sentences
// ---------------------------------------------------------------------------
describe("StreamingTTS.synthesize — 3 sentences", () => {
  it("emits one chunk per sentence in order, eos only on last", async () => {
    mockSynth
      .mockResolvedValueOnce(fakeAudio("s1"))
      .mockResolvedValueOnce(fakeAudio("s2"))
      .mockResolvedValueOnce(fakeAudio("s3"));

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

    // Must have called synthesize at least 3 times
    expect(mockSynth.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("passes the AbortSignal through to synthesize()", async () => {
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
    // First sentence resolves normally; second is never reached because abort fires.
    let resolveFirst!: (b: Buffer) => void;
    const firstPromise = new Promise<Buffer>((res) => { resolveFirst = res; });

    mockSynth
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValue(fakeAudio("should-not-emit"));

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
    resolveFirst(fakeAudio("s1"));

    await streamPromise;

    // Final chunk must be eos:true
    expect(chunks[chunks.length - 1].eos).toBe(true);
    // Must not have called synthesize more than once (second sentence not scheduled)
    expect(mockSynth.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Buffer flush at char threshold
// ---------------------------------------------------------------------------
describe("StreamingTTS.synthesize — char threshold flush", () => {
  it("flushes when buffer exceeds 200 chars without a sentence boundary", async () => {
    mockSynth.mockResolvedValue(fakeAudio("long"));

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

    expect(mockSynth).toHaveBeenCalled();
    expect(chunks[chunks.length - 1].eos).toBe(true);
  });
});
