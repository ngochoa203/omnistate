import { readFile, unlink } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectLanguage, pickVoice, synthesize } from "../edge-tts.js";

// ---------------------------------------------------------------------------
// Mock node:child_process so no real Python is spawned
// ---------------------------------------------------------------------------
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Mock node:fs/promises so we can control file reads and spy on unlink
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn(),
}));

import { execFile } from "node:child_process";

const mockExecFile = vi.mocked(execFile);
const mockReadFile = vi.mocked(readFile);
const mockUnlink = vi.mocked(unlink);

// Build a promisified-style stub: execFile callback-based → promisify picks it up
function makeExecFileSuccess() {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
    cb(null, "", "");
    return {} as any;
  });
}

function makeExecFileFailure(stderr: string) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
    const err = Object.assign(new Error(`exit 1: ${stderr}`), { stderr });
    cb(err, "", stderr);
    return {} as any;
  });
}

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------
describe("detectLanguage", () => {
  it('returns "vi" for Vietnamese with diacritics', () => {
    expect(detectLanguage("xin chào các bạn")).toBe("vi");
  });

  it('returns "en" for plain ASCII English', () => {
    expect(detectLanguage("hello world")).toBe("en");
  });

  it('returns "vi" for mixed text with any diacritic (Tôi cần help)', () => {
    expect(detectLanguage("Tôi cần help")).toBe("vi");
  });

  it('returns "en" for empty string', () => {
    expect(detectLanguage("")).toBe("en");
  });
});

// ---------------------------------------------------------------------------
// pickVoice
// ---------------------------------------------------------------------------
describe("pickVoice", () => {
  beforeEach(() => {
    delete process.env.OMNISTATE_TTS_VOICE_VI;
    delete process.env.OMNISTATE_TTS_VOICE_EN;
  });

  it("returns vi default voice when lang=vi and no config override", () => {
    expect(pickVoice("vi")).toBe("vi-VN-HoaiMyNeural");
  });

  it("returns en default voice when lang=en and no config override", () => {
    expect(pickVoice("en")).toBe("en-US-AriaNeural");
  });

  it("returns config override for vi voice", () => {
    const config = { tts: { voiceVi: "vi-VN-NamMinhNeural" } };
    expect(pickVoice("vi", config as any)).toBe("vi-VN-NamMinhNeural");
  });

  it("returns config override for en voice", () => {
    const config = { tts: { voiceEn: "en-US-GuyNeural" } };
    expect(pickVoice("en", config as any)).toBe("en-US-GuyNeural");
  });

  it("falls back to env var for vi when no config", () => {
    process.env.OMNISTATE_TTS_VOICE_VI = "vi-VN-EnvVoiceNeural";
    expect(pickVoice("vi")).toBe("vi-VN-EnvVoiceNeural");
  });
});

// ---------------------------------------------------------------------------
// synthesize
// ---------------------------------------------------------------------------
describe("synthesize", () => {
  const fakeBuffer = Buffer.from("fake-mp3-data");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: calls python, reads temp file, returns buffer", async () => {
    makeExecFileSuccess();
    mockReadFile.mockResolvedValue(fakeBuffer as any);

    const result = await synthesize("xin chào");

    expect(mockExecFile).toHaveBeenCalledOnce();
    const [, args] = mockExecFile.mock.calls[0];
    expect(args).toContain("--text");
    expect(args).toContain("xin chào");
    expect(args).toContain("--voice");
    expect(args).toContain("--output");

    expect(result).toEqual(fakeBuffer);
  });

  it("happy path: cleans up temp file after success", async () => {
    makeExecFileSuccess();
    mockReadFile.mockResolvedValue(fakeBuffer as any);

    await synthesize("hello");

    expect(mockUnlink).toHaveBeenCalledOnce();
    const [unlinkedPath] = mockUnlink.mock.calls[0];
    expect(unlinkedPath).toMatch(/omnistate-edge-tts-.*\.mp3$/);
  });

  it("python failure: rejects with error containing stderr", async () => {
    makeExecFileFailure("edge-tts: voice not found");

    await expect(synthesize("hello")).rejects.toThrow(/edge-tts: voice not found/);
  });

  it("temp file is cleaned up even when python fails", async () => {
    makeExecFileFailure("some error");

    await synthesize("hello").catch(() => undefined);

    expect(mockUnlink).toHaveBeenCalledOnce();
  });

  it("uses provided voice option instead of auto-detected", async () => {
    makeExecFileSuccess();
    mockReadFile.mockResolvedValue(fakeBuffer as any);

    await synthesize("hello", { voice: "en-US-GuyNeural" });

    const [, args] = mockExecFile.mock.calls[0];
    const voiceIdx = (args as string[]).indexOf("--voice");
    expect((args as string[])[voiceIdx + 1]).toBe("en-US-GuyNeural");
  });

  it("rejects invalid voice identifier (allowlist regex)", async () => {
    await expect(synthesize("hello", { voice: "bad voice" })).rejects.toThrow(
      /Invalid voice identifier/,
    );
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
