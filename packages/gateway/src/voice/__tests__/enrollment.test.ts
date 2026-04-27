
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  handleEnrollStart,
  handleEnrollSample,
  handleEnrollFinalize,
  handleEnrollCancel,
  ENROLLMENT_PHRASES,
} from "../enrollment.js";
import { loadProfile } from "../profile-store.js";

// Minimal WebSocket mock that captures sent messages
function makeMockWs() {
  const messages: Array<Record<string, unknown>> = [];
  const ws = {
    send: (raw: string) => messages.push(JSON.parse(raw) as Record<string, unknown>),
    messages,
    lastMessage: () => messages[messages.length - 1],
    findByType: (type: string) => messages.find((m) => m.type === type),
    allByType: (type: string) => messages.filter((m) => m.type === type),
  };
  return ws;
}

type MockWs = ReturnType<typeof makeMockWs>;

// Generate deterministic base64 audio that produces a stable mock embedding
function fakeAudio(seed: string): string {
  return Buffer.from(`fake-audio-${seed}`).toString("base64");
}

async function runFullEnrollment(ws: MockWs, userId: string): Promise<void> {
  handleEnrollStart(ws as never, userId);
  for (let i = 0; i < ENROLLMENT_PHRASES.length; i++) {
    await handleEnrollSample(ws as never, userId, fakeAudio(`${userId}-${i}`), "wav", i);
  }
  await handleEnrollFinalize(ws as never, userId);
}

describe("enrollment handlers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "omnistate-enroll-test-"));
    process.env.OMNISTATE_RTC_PROFILE_DIR = tmpDir;
    process.env.OMNISTATE_ENROLL_MOCK = "1";
  });

  afterEach(() => {
    delete process.env.OMNISTATE_RTC_PROFILE_DIR;
    delete process.env.OMNISTATE_ENROLL_MOCK;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ──────────────────────────────────────────────
  // Happy path: full 5-sample enrollment
  // ──────────────────────────────────────────────
  it("happy path: start → 5 samples → finalize → done", async () => {
    const ws = makeMockWs();
    const userId = "happy-user";

    handleEnrollStart(ws as never, userId);
    // Should receive ready for phraseIndex=0
    expect(ws.lastMessage()).toMatchObject({ type: "voice.enroll.ready", phraseIndex: 0 });

    for (let i = 0; i < ENROLLMENT_PHRASES.length; i++) {
      ws.messages.length = 0; // clear to inspect each step
      await handleEnrollSample(ws as never, userId, fakeAudio(`h-${i}`), "wav", i);
      const progress = ws.findByType("voice.enroll.progress");
      expect(progress).toBeDefined();
      expect(progress!.accepted).toBe(true);
    }

    ws.messages.length = 0;
    await handleEnrollFinalize(ws as never, userId);
    const done = ws.findByType("voice.enroll.done");
    expect(done).toBeDefined();
    expect(done!.userId).toBe(userId);
    expect(done!.sampleCount).toBe(5);
  });

  it("profile file is written after finalize", async () => {
    const ws = makeMockWs();
    const userId = "profile-written";
    await runFullEnrollment(ws, userId);

    const profile = await loadProfile(userId);
    expect(profile).not.toBeNull();
    expect(profile!.userId).toBe(userId);
    expect(profile!.sampleCount).toBe(5);
    expect(profile!.embedding).toHaveLength(256);
  });

  it("ENROLLMENT_PHRASES has exactly 5 phrases", () => {
    expect(ENROLLMENT_PHRASES).toHaveLength(5);
  });

  // ──────────────────────────────────────────────
  // Duplicate finalize rejected
  // ──────────────────────────────────────────────
  it("duplicate finalize after done emits error (session is gone)", async () => {
    const ws = makeMockWs();
    const userId = "double-finalize";
    await runFullEnrollment(ws, userId);

    // Session is deleted after finalize; second finalize should get NO_SESSION
    ws.messages.length = 0;
    await handleEnrollFinalize(ws as never, userId);
    const error = ws.findByType("voice.enroll.error");
    expect(error).toBeDefined();
    expect(error!.code).toBe("NO_SESSION");
  });

  // ──────────────────────────────────────────────
  // Cancel removes in-memory state; no file written
  // ──────────────────────────────────────────────
  it("cancel removes session; no file written", async () => {
    const ws = makeMockWs();
    const userId = "cancel-user";

    handleEnrollStart(ws as never, userId);
    // Send 2 samples
    await handleEnrollSample(ws as never, userId, fakeAudio("c-0"), "wav", 0);
    await handleEnrollSample(ws as never, userId, fakeAudio("c-1"), "wav", 1);

    handleEnrollCancel(ws as never, userId);

    // No profile file should exist
    const profile = await loadProfile(userId);
    expect(profile).toBeNull();
  });

  it("finalize after cancel emits NO_SESSION error", async () => {
    const ws = makeMockWs();
    const userId = "cancel-then-finalize";

    handleEnrollStart(ws as never, userId);
    handleEnrollCancel(ws as never, userId);

    ws.messages.length = 0;
    await handleEnrollFinalize(ws as never, userId);
    const error = ws.findByType("voice.enroll.error");
    expect(error).toBeDefined();
    expect(error!.code).toBe("NO_SESSION");
  });

  // ──────────────────────────────────────────────
  // Sample with bad phraseIndex rejected
  // ──────────────────────────────────────────────
  it("sample with wrong phraseIndex emits WRONG_PHRASE error", async () => {
    const ws = makeMockWs();
    const userId = "wrong-phrase";

    handleEnrollStart(ws as never, userId);
    ws.messages.length = 0;

    // Send phraseIndex=2 instead of expected 0
    await handleEnrollSample(ws as never, userId, fakeAudio("wp-0"), "wav", 2);
    const error = ws.findByType("voice.enroll.error");
    expect(error).toBeDefined();
    expect(error!.code).toBe("WRONG_PHRASE");
  });

  it("sample without prior start emits NO_SESSION error", async () => {
    const ws = makeMockWs();
    await handleEnrollSample(ws as never, "no-session-user", fakeAudio("x"), "wav", 0);
    const error = ws.findByType("voice.enroll.error");
    expect(error).toBeDefined();
    expect(error!.code).toBe("NO_SESSION");
  });

  it("finalize with insufficient samples emits INSUFFICIENT_SAMPLES error", async () => {
    const ws = makeMockWs();
    const userId = "insuff-user";

    handleEnrollStart(ws as never, userId);
    // Only send 3 samples
    for (let i = 0; i < 3; i++) {
      await handleEnrollSample(ws as never, userId, fakeAudio(`is-${i}`), "wav", i);
    }

    ws.messages.length = 0;
    await handleEnrollFinalize(ws as never, userId);
    const error = ws.findByType("voice.enroll.error");
    expect(error).toBeDefined();
    expect(error!.code).toBe("INSUFFICIENT_SAMPLES");
  });

  // ──────────────────────────────────────────────
  // ready message contains correct prompt text
  // ──────────────────────────────────────────────
  it("start sends ready with correct phraseIndex=0 and prompt", () => {
    const ws = makeMockWs();
    handleEnrollStart(ws as never, "prompt-check");
    const ready = ws.findByType("voice.enroll.ready");
    expect(ready).toBeDefined();
    expect(ready!.phraseIndex).toBe(0);
    expect(ready!.prompt).toBe(ENROLLMENT_PHRASES[0]);
  });

  it("progress after each sample includes correct next phraseIndex", async () => {
    const ws = makeMockWs();
    const userId = "progress-check";
    handleEnrollStart(ws as never, userId);

    for (let i = 0; i < ENROLLMENT_PHRASES.length; i++) {
      ws.messages.length = 0;
      await handleEnrollSample(ws as never, userId, fakeAudio(`pc-${i}`), "wav", i);
      const progress = ws.findByType("voice.enroll.progress");
      expect(progress!.phraseIndex).toBe(i + 1);
    }
  });
});
