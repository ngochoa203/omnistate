import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue(["sample.wav", "speaker-embedding.npy"]),
  readFile: vi.fn().mockResolvedValue(Buffer.from("rtvc-audio")),
  stat: vi.fn().mockResolvedValue({ mtimeMs: 10 }),
  unlink: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { normalizeRtvcPlaybackRate, synthesizeRtvcSpeech } from "../rtvc.js";

const mockExecFile = vi.mocked(execFile);
const mockReadFile = vi.mocked(readFile);
const mockUnlink = vi.mocked(unlink);

function mockExecFileSuccess() {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
    cb(null, "", "");
    return {} as never;
  });
}

describe("normalizeRtvcPlaybackRate", () => {
  it("defaults to 1 and clamps the supported range", () => {
    expect(normalizeRtvcPlaybackRate()).toBe(1);
    expect(normalizeRtvcPlaybackRate(2)).toBe(1.15);
    expect(normalizeRtvcPlaybackRate(0.2)).toBe(0.85);
  });
});

describe("synthesizeRtvcSpeech", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFileSuccess();
    mockReadFile.mockResolvedValue(Buffer.from("rtvc-audio"));
  });

  it("applies ffmpeg atempo when a non-neutral rate is requested", async () => {
    await synthesizeRtvcSpeech({
      text: "xin chào",
      profileId: "default",
      language: "vi",
      rate: 1.1,
    });

    expect(mockExecFile).toHaveBeenCalledTimes(2);
    const [ffmpegCmd, ffmpegArgs] = mockExecFile.mock.calls[1]!;
    expect(ffmpegCmd).toBe("ffmpeg");
    expect((ffmpegArgs as string[])).toContain("-filter:a");
    expect((ffmpegArgs as string[])).toContain("atempo=1.10");
  });

  it("skips ffmpeg post-processing for neutral playback rate", async () => {
    await synthesizeRtvcSpeech({
      text: "xin chào",
      profileId: "default",
      language: "vi",
      rate: 1,
    });

    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it("cleans up generated temporary wav files", async () => {
    await synthesizeRtvcSpeech({
      text: "xin chào",
      profileId: "default",
      language: "vi",
      rate: 1.1,
    });

    expect(mockUnlink).toHaveBeenCalledTimes(2);
  });
});
