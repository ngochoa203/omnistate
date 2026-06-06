import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { WakeManager } from "../wake-manager.js";

function makeChildProcessMock() {
  return {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  };
}

describe("WakeManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnMock.mockReturnValue(makeChildProcessMock());
  });

  it("uses the configured command window for in-process validation", () => {
    const manager = new WakeManager();
    manager.start({
      endpoint: "http://127.0.0.1:19801/api/wake/event",
      token: "test-token",
      config: {
        enabled: true,
        phrase: "hey omni",
        cooldownMs: 2500,
        commandWindowSec: 7,
        engine: "legacy",
      },
    });

    const now = Date.now();
    expect(manager.isCommandWithinWindow(now - 6_000)).toBe(true);
    expect(manager.isCommandWithinWindow(now - 8_000)).toBe(false);
  });

  it("extends the command window from the configured base", () => {
    const manager = new WakeManager();
    manager.start({
      endpoint: "http://127.0.0.1:19801/api/wake/event",
      token: "test-token",
      config: {
        enabled: true,
        phrase: "hey omni",
        cooldownMs: 2500,
        commandWindowSec: 5,
        engine: "legacy",
      },
    });

    manager.extendWindowIfStillSpeaking();
    const now = Date.now();
    expect(manager.isCommandWithinWindow(now - 6_000)).toBe(true);
    expect(manager.isCommandWithinWindow(now - 8_500)).toBe(false);
  });
});
