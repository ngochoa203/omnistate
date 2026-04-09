/**
 * E2E tests for VisionEngine.
 *
 * All tests use mock providers — no screen capture permissions or API keys needed.
 */

import { describe, it, expect, vi } from "vitest";
import { VisionEngine } from "../vision/engine.js";
import type { VisionProvider, VerifyResult } from "../vision/engine.js";
import type { DetectedElement } from "../layers/surface.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMockProvider(
  name: string,
  elements: DetectedElement[],
  verifyResult: VerifyResult
): VisionProvider {
  return {
    name,
    detectElements: vi.fn().mockResolvedValue(elements),
    verifyState: vi.fn().mockResolvedValue(verifyResult),
  };
}

function makeDetectedElement(
  text: string,
  confidence: number
): DetectedElement {
  return {
    id: text,
    type: "button",
    text,
    confidence,
    bounds: { x: 0, y: 0, width: 100, height: 30 },
  };
}

const EMPTY_SCREENSHOT = Buffer.alloc(0);

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("VisionEngine — empty (no providers)", () => {
  it("detectElements returns an empty array", async () => {
    const engine = new VisionEngine();
    const results = await engine.detectElements(EMPTY_SCREENSHOT, "button");
    expect(results).toEqual([]);
  });

  it('verifyState returns "No vision providers registered"', async () => {
    const engine = new VisionEngine();
    const result = await engine.verifyState(EMPTY_SCREENSHOT, "some state");
    expect(result.passed).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.description).toBe("No vision providers registered");
  });
});

describe("VisionEngine — single mock provider", () => {
  it("calls the registered provider with the correct args", async () => {
    const engine = new VisionEngine();
    const provider = makeMockProvider(
      "mock-a",
      [makeDetectedElement("Save", 0.9)],
      { passed: true, confidence: 0.9, description: "looks good" }
    );
    engine.registerProvider(provider);

    await engine.detectElements(EMPTY_SCREENSHOT, "save button");

    expect(provider.detectElements).toHaveBeenCalledOnce();
    expect(provider.detectElements).toHaveBeenCalledWith(
      EMPTY_SCREENSHOT,
      "save button"
    );
  });

  it("returns elements from the provider", async () => {
    const engine = new VisionEngine();
    const el = makeDetectedElement("OK", 0.8);
    engine.registerProvider(
      makeMockProvider("mock-b", [el], {
        passed: true,
        confidence: 0.8,
        description: "ok",
      })
    );

    const results = await engine.detectElements(EMPTY_SCREENSHOT, "ok button");
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("OK");
  });

  it("verifyState calls provider and returns its result", async () => {
    const engine = new VisionEngine();
    engine.registerProvider(
      makeMockProvider("mock-c", [], {
        passed: true,
        confidence: 0.95,
        description: "verified",
      })
    );

    const result = await engine.verifyState(EMPTY_SCREENSHOT, "dialog open");
    expect(result.passed).toBe(true);
    expect(result.confidence).toBeCloseTo(0.95);
    expect(result.description).toContain("verified");
  });
});

describe("VisionEngine — multiple providers, sorted by confidence", () => {
  it("merges and sorts detectElements results by confidence descending", async () => {
    const engine = new VisionEngine();

    engine.registerProvider(
      makeMockProvider("low", [makeDetectedElement("Low", 0.3)], {
        passed: false,
        confidence: 0.3,
        description: "low",
      })
    );
    engine.registerProvider(
      makeMockProvider("high", [makeDetectedElement("High", 0.95)], {
        passed: true,
        confidence: 0.95,
        description: "high",
      })
    );
    engine.registerProvider(
      makeMockProvider("mid", [makeDetectedElement("Mid", 0.6)], {
        passed: true,
        confidence: 0.6,
        description: "mid",
      })
    );

    const results = await engine.detectElements(EMPTY_SCREENSHOT, "any");

    expect(results).toHaveLength(3);
    // First element should have highest confidence
    expect(results[0].confidence).toBeGreaterThanOrEqual(results[1].confidence);
    expect(results[1].confidence).toBeGreaterThanOrEqual(results[2].confidence);
    expect(results[0].text).toBe("High");
  });

  it("verifyState: passes when majority of providers pass", async () => {
    const engine = new VisionEngine();

    engine.registerProvider(
      makeMockProvider("p1", [], { passed: true, confidence: 0.9, description: "p1 ok" })
    );
    engine.registerProvider(
      makeMockProvider("p2", [], { passed: true, confidence: 0.8, description: "p2 ok" })
    );
    engine.registerProvider(
      makeMockProvider("p3", [], { passed: false, confidence: 0.4, description: "p3 nok" })
    );

    const result = await engine.verifyState(EMPTY_SCREENSHOT, "some state");
    expect(result.passed).toBe(true); // 2 out of 3 passed
    expect(result.confidence).toBeCloseTo((0.9 + 0.8 + 0.4) / 3, 5);
  });

  it("verifyState: fails when majority of providers fail", async () => {
    const engine = new VisionEngine();

    engine.registerProvider(
      makeMockProvider("p1", [], { passed: false, confidence: 0.2, description: "fail1" })
    );
    engine.registerProvider(
      makeMockProvider("p2", [], { passed: false, confidence: 0.3, description: "fail2" })
    );
    engine.registerProvider(
      makeMockProvider("p3", [], { passed: true, confidence: 0.8, description: "ok" })
    );

    const result = await engine.verifyState(EMPTY_SCREENSHOT, "some state");
    expect(result.passed).toBe(false);
  });
});

describe("VisionEngine — provider failure handling (Promise.allSettled)", () => {
  it("detectElements: ignores rejected provider, returns results from healthy ones", async () => {
    const engine = new VisionEngine();

    const failingProvider: VisionProvider = {
      name: "failing",
      detectElements: vi.fn().mockRejectedValue(new Error("provider crashed")),
      verifyState: vi.fn().mockRejectedValue(new Error("provider crashed")),
    };

    const workingProvider = makeMockProvider(
      "working",
      [makeDetectedElement("Submit", 0.85)],
      { passed: true, confidence: 0.85, description: "fine" }
    );

    engine.registerProvider(failingProvider);
    engine.registerProvider(workingProvider);

    const results = await engine.detectElements(EMPTY_SCREENSHOT, "submit");
    // Failing provider is swallowed; working provider's result is returned
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("Submit");
  });

  it("verifyState: all providers fail → returns failure with description", async () => {
    const engine = new VisionEngine();

    engine.registerProvider({
      name: "bad",
      detectElements: vi.fn().mockRejectedValue(new Error("boom")),
      verifyState: vi.fn().mockRejectedValue(new Error("boom")),
    });

    const result = await engine.verifyState(EMPTY_SCREENSHOT, "anything");
    expect(result.passed).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.description).toBe("All vision providers failed");
  });

  it("verifyState: one fails, one passes → still returns a result", async () => {
    const engine = new VisionEngine();

    engine.registerProvider({
      name: "bad",
      detectElements: vi.fn().mockRejectedValue(new Error("boom")),
      verifyState: vi.fn().mockRejectedValue(new Error("boom")),
    });
    engine.registerProvider(
      makeMockProvider("good", [], {
        passed: true,
        confidence: 0.7,
        description: "good",
      })
    );

    const result = await engine.verifyState(EMPTY_SCREENSHOT, "anything");
    expect(result.passed).toBe(true);
    expect(result.confidence).toBeCloseTo(0.7);
  });
});
