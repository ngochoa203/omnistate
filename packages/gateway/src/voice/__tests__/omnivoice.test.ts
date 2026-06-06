import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

import { execFile } from "node:child_process";
import { readFile, readdir, stat, unlink } from "node:fs/promises";
import { normalizeOmniVoiceRate, synthesizeOmniVoiceSpeech } from "../omnivoice.js";

const mockExecFile = vi.mocked(execFile);
const mockReadFile = vi.mocked(readFile);
const mockReaddir = vi.mocked(readdir);
const mockStat = vi.mocked(stat);
const mockUnlink = vi.mocked(unlink);

function makeExecFileSuccess() {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
    cb(null, "", "");
    return {} as any;
  });
}

describe("normalizeOmniVoiceRate", () => {
  it("clamps the requested rate into the supported range", () => {
    expect(normalizeOmniVoiceRate()).toBe(1);
    expect(normalizeOmniVoiceRate(1.1)).toBe(1.1);
    expect(normalizeOmniVoiceRate(2)).toBe(1.3);
    expect(normalizeOmniVoiceRate(0.1)).toBe(0.7);
  });
});

describe("synthesizeOmniVoiceSpeech", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OMNISTATE_RTC_PROFILE_DIR = "/tmp/omnistate-test-profiles";
  });

  it("passes a reference speaker clip when a profile sample exists", async () => {
    makeExecFileSuccess();
    mockReaddir.mockResolvedValue(["sample-new.wav", "sample-old.wav"] as any);
    mockStat
      .mockResolvedValueOnce({ mtimeMs: 10 } as any)
      .mockResolvedValueOnce({ mtimeMs: 1 } as any);
    mockReadFile.mockResolvedValue(Buffer.from("omnivoice-audio") as any);

    const result = await synthesizeOmniVoiceSpeech({
      text: "xin chào",
      profileId: "profile-a",
      rate: 1.1,
    });

    expect(result.contentType).toBe("audio/wav");
    expect(result.speakerPath).toBe("/tmp/omnistate-test-profiles/profile-a/sample-new.wav");
    expect(mockExecFile).toHaveBeenCalledOnce();

    const [, args] = mockExecFile.mock.calls[0];
    expect(args).toContain("--ref-audio");
    expect(args).toContain("/tmp/omnistate-test-profiles/profile-a/sample-new.wav");
    expect(args).toContain("--speed");
    expect(args).toContain("1.1");
  });

  it("falls back to auto voice when no speaker profile is available", async () => {
    makeExecFileSuccess();
    mockReaddir.mockRejectedValue(new Error("missing profile"));
    mockReadFile.mockResolvedValue(Buffer.from("omnivoice-audio") as any);

    await synthesizeOmniVoiceSpeech({
      text: "hello world",
      profileId: "missing-profile",
    });

    const [, args] = mockExecFile.mock.calls[0];
    expect(args).not.toContain("--ref-audio");
  });

  it("cleans up the temp output file after synthesis", async () => {
    makeExecFileSuccess();
    mockReaddir.mockRejectedValue(new Error("missing profile"));
    mockReadFile.mockResolvedValue(Buffer.from("omnivoice-audio") as any);

    await synthesizeOmniVoiceSpeech({ text: "hello world" });

    expect(mockUnlink).toHaveBeenCalledOnce();
    const [unlinkedPath] = mockUnlink.mock.calls[0];
    expect(unlinkedPath).toMatch(/omnistate-omnivoice-.*\.wav$/);
  });
});
