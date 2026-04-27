/**
 * Tests for the intent registry pattern (Phase 4).
 *
 * Covers:
 *  - register + dispatch happy path
 *  - unknown tool falls through (registry.has returns false)
 *  - timer.set + timer.cancel happy path with fake timers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IntentRegistry } from "../intents/types.js";
import { timerSet, timerCancel, timerList } from "../intents/timer.js";
import type { HandlerContext, StructuredResponse } from "../intents/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(sessionId = "test-session"): HandlerContext {
  return {
    sessionId,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as any,
    layers: {} as any,
  };
}

// ---------------------------------------------------------------------------
// IntentRegistry — basic contract
// ---------------------------------------------------------------------------

describe("IntentRegistry", () => {
  it("registers and dispatches a handler", async () => {
    const reg = new IntentRegistry();
    const handler = vi.fn(async (_args: Record<string, unknown>, _ctx: HandlerContext) => ({ speak: "hello" }));

    reg.register("test.ping", handler);
    expect(reg.has("test.ping")).toBe(true);

    const result = await reg.dispatch("test.ping", { foo: 1 }, makeCtx());
    expect(result).toMatchObject<StructuredResponse>({ speak: "hello" });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("has() returns false for unregistered tools", () => {
    const reg = new IntentRegistry();
    expect(reg.has("unknown.tool")).toBe(false);
  });

  it("dispatch throws for unregistered tool", async () => {
    const reg = new IntentRegistry();
    await expect(reg.dispatch("no.such.tool", {}, makeCtx())).rejects.toThrow(
      "No handler registered for tool: no.such.tool"
    );
  });

  it("StructuredResponse shape: speak required, rest optional", async () => {
    const reg = new IntentRegistry();
    reg.register("shape.test", async () => ({
      speak: "ok",
      ui: { widget: "label" },
      followup: ["what next?"],
      data: { x: 1 },
    }));

    const res = await reg.dispatch("shape.test", {}, makeCtx());
    expect(res.speak).toBe("ok");
    expect(res.ui).toEqual({ widget: "label" });
    expect(res.followup).toEqual(["what next?"]);
    expect(res.data).toEqual({ x: 1 });
  });
});

// ---------------------------------------------------------------------------
// timer handlers — happy path with fake timers
// ---------------------------------------------------------------------------

describe("timer handlers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("timer.set returns an id and a speak string", async () => {
    const ctx = makeCtx("sess-timer");
    const result = await timerSet({ durationMs: 5000, label: "Tea" }, ctx);

    expect(result.speak).toMatch(/5 second/i);
    expect(result.speak).toMatch(/Tea/);
    expect(result.data).toMatchObject({ durationMs: 5000, label: "Tea" });
    expect(typeof (result.data as any).id).toBe("string");
  });

  it("timer.cancel removes the timer and returns speak", async () => {
    const ctx = makeCtx("sess-cancel");
    const setResult = await timerSet({ durationMs: 10000, label: "Pasta" }, ctx);
    const { id } = setResult.data as { id: string };

    // Verify it's listed
    const listBefore = await timerList({}, ctx);
    expect((listBefore.data as any).timers).toHaveLength(1);

    const cancelResult = await timerCancel({ id }, ctx);
    expect(cancelResult.speak).toMatch(/Pasta/);
    expect(cancelResult.speak).toMatch(/cancelled/i);

    // Should now be gone
    const listAfter = await timerList({}, ctx);
    expect(listAfter.speak).toMatch(/no active/i);
  });

  it("timer.cancel with unknown id returns a not-found message", async () => {
    const ctx = makeCtx("sess-unknown");
    const result = await timerCancel({ id: "does-not-exist" }, ctx);
    expect(result.speak).toMatch(/No timer found/i);
  });

  it("timer fires after duration and is removed", async () => {
    const ctx = makeCtx("sess-fire");
    const setResult = await timerSet({ durationMs: 2000 }, ctx);
    void setResult; // id unused; we just verify the list empties

    const listBefore = await timerList({}, ctx);
    expect((listBefore.data as any).timers).toHaveLength(1);

    vi.advanceTimersByTime(2500);

    const listAfter = await timerList({}, ctx);
    expect(listAfter.speak).toMatch(/no active/i);
  });
});
