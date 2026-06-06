import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import {
  getOmniStateVoiceRuntimeStatus,
  installOmniStateVoiceRuntime,
  normalizeOmniStateVoiceRate,
  synthesizeOmniStateVoiceSpeech,
} from "../omnistate-voice.js";

const mockExecFile = vi.mocked(execFile);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdir = vi.mocked(mkdir);
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

describe("normalizeOmniStateVoiceRate", () => {
  it("clamps the requested rate into the supported range", () => {
    expect(normalizeOmniStateVoiceRate()).toBe(1);
    expect(normalizeOmniStateVoiceRate(1.1)).toBe(1.1);
    expect(normalizeOmniStateVoiceRate(2)).toBe(1.3);
    expect(normalizeOmniStateVoiceRate(0.1)).toBe(0.7);
  });
});

describe("synthesizeOmniStateVoiceSpeech", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OMNISTATE_RTC_PROFILE_DIR = "/tmp/omnistate-test-profiles";
    delete process.env.OMNISTATE_VOICE_PYTHON;
    delete process.env.OMNISTATE_OMNIVOICE_PYTHON;
    mockMkdir.mockResolvedValue(undefined as any);
    mockExistsSync.mockReturnValue(true);
  });

  it("reports ready when a managed runtime already exists", async () => {
    const status = await getOmniStateVoiceRuntimeStatus();

    expect(status.state).toBe("ready");
    expect(status.managed).toBe(true);
    expect(status.pythonPath).toContain(".venv");
  });

  it("reports failed when a configured runtime is missing", async () => {
    process.env.OMNISTATE_VOICE_PYTHON = "/missing/python3";
    mockExistsSync.mockImplementation((value) => value === "/missing/python3" ? false : true);

    const status = await getOmniStateVoiceRuntimeStatus();

    expect(status.state).toBe("failed");
    expect(status.managed).toBe(false);
    expect(status.lastError).toContain("/missing/python3");
  });

  it("passes a reference speaker clip when a profile sample exists", async () => {
    makeExecFileSuccess();
    mockReaddir.mockResolvedValue(["sample-new.wav", "sample-old.wav"] as any);
    mockStat
      .mockResolvedValueOnce({ mtimeMs: 10 } as any)
      .mockResolvedValueOnce({ mtimeMs: 1 } as any);
    mockReadFile.mockResolvedValue(Buffer.from("omnistate-voice-audio") as any);

    const result = await synthesizeOmniStateVoiceSpeech({
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

  it("bootstraps a managed runtime when no custom python exists", async () => {
    makeExecFileSuccess();
    mockExistsSync.mockReturnValue(false);
    mockReaddir.mockRejectedValue(new Error("missing profile"));
    mockReadFile.mockResolvedValue(Buffer.from("omnistate-voice-audio") as any);

    await synthesizeOmniStateVoiceSpeech({ text: "hello world" });

    expect(mockMkdir).toHaveBeenCalled();
    expect(mockExecFile.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(mockExecFile.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["-m", "venv"]));
    expect(mockExecFile.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(["-m", "pip", "install", "--upgrade", "pip"]));
    expect(mockExecFile.mock.calls[2]?.[1]).toEqual(expect.arrayContaining(["-m", "pip", "install", "torch", "torchaudio", "soundfile", "omnivoice"]));
  });

  it("emits installing and ready status updates during managed runtime install", async () => {
    makeExecFileSuccess();
    mockExistsSync.mockReturnValue(false);
    const states: string[] = [];

    const status = await installOmniStateVoiceRuntime({
      force: true,
      onStatus: (next) => {
        states.push(next.state);
      },
    });

    expect(states).toContain("installing");
    expect(status.state).toBe("ready");
    expect(status.progress).toBe(100);
  });

  it("falls back to auto voice when no speaker profile is available", async () => {
    makeExecFileSuccess();
    mockReaddir.mockRejectedValue(new Error("missing profile"));
    mockReadFile.mockResolvedValue(Buffer.from("omnistate-voice-audio") as any);

    await synthesizeOmniStateVoiceSpeech({
      text: "hello world",
      profileId: "missing-profile",
    });

    const [, args] = mockExecFile.mock.calls.at(-1)!;
    expect(args).not.toContain("--ref-audio");
  });

  it("cleans up the temp output file after synthesis", async () => {
    makeExecFileSuccess();
    mockReaddir.mockRejectedValue(new Error("missing profile"));
    mockReadFile.mockResolvedValue(Buffer.from("omnistate-voice-audio") as any);

    await synthesizeOmniStateVoiceSpeech({ text: "hello world" });

    expect(mockUnlink).toHaveBeenCalledOnce();
    const [unlinkedPath] = mockUnlink.mock.calls[0];
    expect(unlinkedPath).toMatch(/omnistate-voice-.*\.wav$/);
  });
});
