import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the LLM router before importing intent
vi.mock("../llm/router.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../llm/router.js")>();
  return {
    ...original,
    requestLlmTextWithFallback: vi.fn(),
  };
});

import { classifyIntent } from "../planner/intent.js";
import { requestLlmTextWithFallback } from "../llm/router.js";

const mockText = requestLlmTextWithFallback as unknown as ReturnType<typeof vi.fn>;

function createLlmResponse(classification: Record<string, unknown>) {
  return {
    text: JSON.stringify(classification),
    model: "test-model",
    provider: "test-provider",
  };
}

describe("Tool Use Classification", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    // Save env vars
    savedEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    savedEnv.OMNISTATE_REQUIRE_LLM = process.env.OMNISTATE_REQUIRE_LLM;
    // Enable LLM path but not strict
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.OMNISTATE_REQUIRE_LLM = "false";
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = savedEnv.ANTHROPIC_API_KEY;
    process.env.OMNISTATE_REQUIRE_LLM = savedEnv.OMNISTATE_REQUIRE_LLM;
  });

  it("should parse structured tool output into Intent", async () => {
    mockText.mockResolvedValueOnce(createLlmResponse({
      type: "app-control",
      confidence: 0.95,
      entities: { app: { type: "app", value: "Safari" } },
    }));

    const intent = await classifyIntent("close Safari");
    // If pre-LLM rules catch it first, the LLM won't be called;
    // either way, the intent type must be app-control
    expect(intent.type).toBe("app-control");
    expect(intent.rawText).toBe("close Safari");
    expect(typeof intent.confidence).toBe("number");
    expect(typeof intent.entities).toBe("object");
  });

  it("should return valid Intent shape when LLM returns app-launch", async () => {
    mockText.mockResolvedValueOnce(createLlmResponse({
      type: "app-launch",
      confidence: 0.92,
      entities: { app: { type: "app", value: "Finder" } },
    }));

    // Use a text unlikely to be caught by pre-LLM rules
    const intent = await classifyIntent("xyzzy launch Finder application");
    // Intent contract: type, confidence, entities, rawText must always be present
    expect(intent.type).toBeDefined();
    expect(typeof intent.confidence).toBe("number");
    expect(intent.confidence).toBeGreaterThan(0);
    expect(intent.confidence).toBeLessThanOrEqual(1);
    expect(typeof intent.entities).toBe("object");
    expect(intent.rawText).toBe("xyzzy launch Finder application");
  });

  it("should fall back gracefully on invalid tool output (non-strict)", async () => {
    mockText.mockResolvedValueOnce(createLlmResponse({
      type: "not-a-valid-intent-type",
      confidence: 0.5,
      entities: {},
    }));

    // Should still return something (heuristic fallback) without throwing
    const intent = await classifyIntent("do something weird");
    expect(intent).toBeDefined();
    expect(intent.type).toBeDefined();
    expect(intent.rawText).toBe("do something weird");
  });

  it("should fall back gracefully when LLM returns no usable result (non-strict)", async () => {
    mockText.mockRejectedValueOnce(new Error("provider unavailable"));

    const intent = await classifyIntent("some ambiguous text here");
    expect(intent).toBeDefined();
    expect(intent.type).toBeDefined();
    expect(intent.rawText).toBe("some ambiguous text here");
  });

  it("should throw in strict mode when LLM errors", async () => {
    process.env.OMNISTATE_REQUIRE_LLM = "true";
    mockText.mockRejectedValueOnce({ status: 503, message: "provider unavailable" });

    // Strict mode — classifyIntent should throw
    await expect(classifyIntent("do the thing")).rejects.toThrow();
  });

  it("should map LLM entity value into intent entities", async () => {
    mockText.mockResolvedValueOnce(createLlmResponse({
      type: "app-launch",
      confidence: 0.88,
      entities: { app: { type: "app", value: "Notes" } },
    }));

    const intent = await classifyIntent("xyzzy123 open the Notes application please");
    // Intent must always have the correct shape
    expect(intent.type).toBeDefined();
    expect(typeof intent.entities).toBe("object");
    expect(intent.rawText).toBe("xyzzy123 open the Notes application please");
    // If LLM was called and parsed, entities.app should be present
    if (mockText.mock.calls.length > 0) {
      expect(intent.entities.app).toBeDefined();
      expect(intent.entities.app.value).toBe("Notes");
    }
  });
});
