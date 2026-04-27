import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

// Mock node builtins before importing the module under test
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  resolve: vi.fn((p: string) => p),
}));
vi.mock("node:path", () => ({
  resolve: (...args: string[]) => args.join("/"),
}));
vi.mock("../utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import AFTER mocks are set up
const { WakeManager } = await import("../voice/wake-manager.js");

const BASE_OPTIONS = {
  config: {
    enabled: true,
    phrase: "mimi",
    cooldownMs: 1300,
    commandWindowSec: 7,
  },
  endpoint: "http://127.0.0.1:9999/voice",
  token: "test-token",
};

function makeFakeChild() {
  return {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  };
}

beforeEach(() => {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(spawn).mockReturnValue(makeFakeChild() as unknown as ReturnType<typeof spawn>);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("WakeManager — engine routing", () => {
  it("spawns wake_listener_oww.py when engine=oww and modelPath is set", () => {
    const manager = new WakeManager();
    manager.start({
      ...BASE_OPTIONS,
      config: { ...BASE_OPTIONS.config, engine: "oww", modelPath: "/models/hey_mimi.onnx" },
    });

    expect(spawn).toHaveBeenCalledOnce();
    const [, spawnArgs] = vi.mocked(spawn).mock.calls[0]!;
    const scriptArg = (spawnArgs as string[])[0]!;
    expect(scriptArg).toContain("wake_listener_oww.py");
  });

  it("spawns wake_listener.py when engine=legacy", () => {
    const manager = new WakeManager();
    manager.start({ ...BASE_OPTIONS, config: { ...BASE_OPTIONS.config, engine: "legacy" } });

    expect(spawn).toHaveBeenCalledOnce();
    const [, spawnArgs] = vi.mocked(spawn).mock.calls[0]!;
    const scriptArg = (spawnArgs as string[])[0]!;
    expect(scriptArg).toContain("wake_listener.py");
    expect(scriptArg).not.toContain("_oww");
  });

  it("refuses to start (no spawn) when engine=oww but no model is available", () => {
    const manager = new WakeManager();
    manager.start(BASE_OPTIONS); // no modelPath, no env var → logger.error + return
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("WakeManager — oww arg passing", () => {
  const OWW_OPTIONS = {
    ...BASE_OPTIONS,
    config: { ...BASE_OPTIONS.config, engine: "oww" as const, modelPath: "/models/hey_mimi.onnx" },
  };

  it("passes --aliases JSON to oww script", () => {
    const manager = new WakeManager();
    const aliases = ["mimi", "hey mimi", "ok mimi"];
    manager.start({ ...OWW_OPTIONS, config: { ...OWW_OPTIONS.config, aliases } });

    const [, spawnArgs] = vi.mocked(spawn).mock.calls[0]!;
    const args = spawnArgs as string[];
    const aliasIdx = args.indexOf("--aliases");
    expect(aliasIdx).toBeGreaterThan(-1);
    expect(JSON.parse(args[aliasIdx + 1]!)).toEqual(aliases);
  });

  it("passes --threshold to oww script", () => {
    const manager = new WakeManager();
    manager.start({ ...OWW_OPTIONS, config: { ...OWW_OPTIONS.config, threshold: 0.7 } });

    const [, spawnArgs] = vi.mocked(spawn).mock.calls[0]!;
    const args = spawnArgs as string[];
    const idx = args.indexOf("--threshold");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("0.7");
  });

  it("passes --model-path when modelPath is set", () => {
    const manager = new WakeManager();
    manager.start(OWW_OPTIONS);

    const [, spawnArgs] = vi.mocked(spawn).mock.calls[0]!;
    const args = spawnArgs as string[];
    const idx = args.indexOf("--model-path");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("/models/hey_mimi.onnx");
  });

  it("omits --model-path when engine=oww without modelPath (refuses to start)", () => {
    const manager = new WakeManager();
    // no modelPath → engine=oww refuses to start; spawn never called
    manager.start({ ...BASE_OPTIONS, config: { ...BASE_OPTIONS.config, engine: "oww" } });
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("WakeManager — legacy arg passing", () => {
  it("passes --aliases (comma-separated) to legacy script", () => {
    const manager = new WakeManager();
    const aliases = ["mimi", "hey mimi", "ok mimi"];
    manager.start({
      ...BASE_OPTIONS,
      config: { ...BASE_OPTIONS.config, engine: "legacy", aliases },
    });

    const [, spawnArgs] = vi.mocked(spawn).mock.calls[0]!;
    const args = spawnArgs as string[];
    const aliasIdx = args.indexOf("--aliases");
    expect(aliasIdx).toBeGreaterThan(-1);
    expect(args[aliasIdx + 1]).toBe(aliases.join(","));
  });

  it("does not pass --threshold to legacy script", () => {
    const manager = new WakeManager();
    manager.start({
      ...BASE_OPTIONS,
      config: { ...BASE_OPTIONS.config, engine: "legacy", threshold: 0.6 },
    });

    const [, spawnArgs] = vi.mocked(spawn).mock.calls[0]!;
    const args = spawnArgs as string[];
    expect(args.includes("--threshold")).toBe(false);
  });
});

describe("WakeManager — lifecycle", () => {
  it("does not spawn when enabled=false", () => {
    const manager = new WakeManager();
    manager.start({ ...BASE_OPTIONS, config: { ...BASE_OPTIONS.config, enabled: false } });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("starts in dry-run mode when token is empty (does not skip)", () => {
    const manager = new WakeManager();
    // Use engine=legacy so spawn is reached even without a model path
    manager.start({ ...BASE_OPTIONS, token: "", config: { ...BASE_OPTIONS.config, engine: "legacy" } });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("does not spawn when script is missing", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const manager = new WakeManager();
    manager.start(BASE_OPTIONS);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("stop() sends SIGTERM to child", () => {
    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as unknown as ReturnType<typeof spawn>);

    const manager = new WakeManager();
    // Use legacy engine so spawn is reached without needing a model file
    manager.start({ ...BASE_OPTIONS, config: { ...BASE_OPTIONS.config, engine: "legacy" } });
    manager.stop();

    expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
