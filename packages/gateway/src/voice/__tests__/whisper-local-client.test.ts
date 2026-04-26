/**
 * Unit tests for whisper-local-client.ts.
 *
 * Mocks child_process.spawn — no real Python is invoked.
 */

import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (hoisted — vi.mock calls are hoisted to top of file automatically)
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock("../../llm/runtime-config.js", () => ({
  loadLlmRuntimeConfig: vi.fn().mockReturnValue({
    voice: { whisperLocalModel: "small" },
  }),
}));

// ---------------------------------------------------------------------------
// Fake subprocess factory
// ---------------------------------------------------------------------------

interface FakeProc2 {
  stdin: { write: ReturnType<typeof vi.fn> };
  stdout: Readable;
  stderr: Readable;
  on: ReturnType<typeof vi.fn>;
  pushLine: (line: string) => void;
  emitClose: (code?: number) => void;
}

function makeFakeProc(): FakeProc2 {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const closeHandlers: Array<(code: number) => void> = [];

  return {
    stdin: { write: vi.fn() },
    stdout,
    stderr,
    on: vi.fn((event: string, handler: (code: number) => void) => {
      if (event === "close") closeHandlers.push(handler);
    }),
    pushLine(line: string) {
      stdout.push(line + "\n");
    },
    emitClose(code = 1) {
      for (const h of closeHandlers) h(code);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers: import a fresh module instance per test via resetModules
// ---------------------------------------------------------------------------

async function loadFreshClient() {
  vi.resetModules();
  // Re-apply mocks after resetModules (they are re-registered on next import)
  vi.doMock("../../llm/runtime-config.js", () => ({
    loadLlmRuntimeConfig: vi.fn().mockReturnValue({
      voice: { whisperLocalModel: "small" },
    }),
  }));
  const { spawn } = await import("node:child_process");
  const { existsSync } = await import("node:fs");
  const mod = await import("../whisper-local-client.js");
  return {
    client: mod.whisperLocalClient,
    mockSpawn: vi.mocked(spawn),
    mockExistsSync: vi.mocked(existsSync),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("whisper-local-client", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("multiplexes two concurrent requests and resolves them independently", async () => {
    const { client, mockSpawn, mockExistsSync } = await loadFreshClient();
    mockExistsSync.mockReturnValue(true);
    const fakeProc = makeFakeProc();
    mockSpawn.mockReturnValue(fakeProc as any);

    const p1 = client.transcribe("/tmp/a.wav", "vi");
    const p2 = client.transcribe("/tmp/b.wav", "en");

    // Allow spawn + readline setup to tick
    await new Promise((r) => setTimeout(r, 10));

    fakeProc.pushLine(JSON.stringify({ ready: true, model: "small", device: "cpu" }));
    await new Promise((r) => setTimeout(r, 10));

    // Respond to request 2 first, then 1 — proves independent multiplexing
    fakeProc.pushLine(JSON.stringify({ id: "2", text: "hello", durationMs: 40 }));
    fakeProc.pushLine(JSON.stringify({ id: "1", text: "xin chao", durationMs: 55 }));

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.text).toBe("xin chao");
    expect(r1.durationMs).toBe(55);
    expect(r2.text).toBe("hello");
    expect(r2.durationMs).toBe(40);
  });

  it("rejects pending requests and restarts when the process crashes", async () => {
    const { client, mockSpawn, mockExistsSync } = await loadFreshClient();
    mockExistsSync.mockReturnValue(true);
    const fakeProc = makeFakeProc();
    const fakeProc2 = makeFakeProc();
    mockSpawn.mockReturnValueOnce(fakeProc as any).mockReturnValue(fakeProc2 as any);

    const p = client.transcribe("/tmp/c.wav", "vi");

    await new Promise((r) => setTimeout(r, 10));
    fakeProc.pushLine(JSON.stringify({ ready: true, model: "small", device: "cpu" }));
    await new Promise((r) => setTimeout(r, 10));

    // Crash before responding to the in-flight request
    fakeProc.emitClose(1);

    await expect(p).rejects.toThrow(/exited with code 1/);

    // A second spawn should be issued (restart)
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it("rejects immediately when script path does not exist", async () => {
    const { client, mockSpawn, mockExistsSync } = await loadFreshClient();
    mockExistsSync.mockReturnValue(false);

    await expect(client.transcribe("/tmp/d.wav", "vi")).rejects.toThrow(
      /whisper_server\.py not found/
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("propagates error responses from the server as rejections", async () => {
    const { client, mockSpawn, mockExistsSync } = await loadFreshClient();
    mockExistsSync.mockReturnValue(true);
    const fakeProc = makeFakeProc();
    mockSpawn.mockReturnValue(fakeProc as any);

    const p = client.transcribe("/tmp/e.wav", "vi");

    await new Promise((r) => setTimeout(r, 10));
    fakeProc.pushLine(JSON.stringify({ ready: true, model: "small", device: "cpu" }));
    await new Promise((r) => setTimeout(r, 10));

    fakeProc.pushLine(JSON.stringify({ id: "1", error: "audio file not found" }));

    await expect(p).rejects.toThrow("audio file not found");
  });
});
