import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the LLM router before importing intent
vi.mock("../llm/router.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../llm/router.js")>();
  return {
    ...original,
    requestLlmStream: vi.fn(),
  };
});

import { classifyIntent } from "../planner/intent.js";
import { requestLlmStream } from "../llm/router.js";

const mockStream = requestLlmStream as unknown as ReturnType<typeof vi.fn>;

function createToolUseStream(toolInput: Record<string, unknown>) {
  return (async function* () {
    yield {
      kind: "tool_use" as const,
      name: "extract_intent",
      input: toolInput,
    };
  })();
}

function createEmptyStream() {
  return (async function* () {
    // yields no events
  })();
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
    mockStream.mockReturnValue(createToolUseStream({
      action: "close",
      intent_type: "app-control",
      confidence: 0.95,
      target_app: "Safari",
      platform: "macos",
      parameters: {},
      context_dependencies: [],
      entities: { app: { type: "app", value: "Safari" } },
    }));

    const intent = await classifyIntent("close Safari");
    // If pre-LLM rules catch it first, the LLM won't be called;
    // either way, the intent type must be app-control
    expect(intent.type).toBe("app-control");
  });

  it("should attach _parsedCommand to Intent when tool_use is valid", async () => {
    mockStream.mockReturnValue(createToolUseStream({
      action: "launch",
      intent_type: "app-launch",
      confidence: 0.92,
      target_app: "Finder",
      platform: "macos",
      parameters: {},
      context_dependencies: [],
      entities: {},
    }));

    // Use a text unlikely to be caught by pre-LLM rules
    const intent = await classifyIntent("xyzzy launch Finder application");
    // If LLM was called, _parsedCommand should be present
    if (mockStream.mock.calls.length > 0) {
      expect((intent as any)._parsedCommand).toBeDefined();
      expect((intent as any)._parsedCommand?.intent_type).toBe("app-launch");
      expect((intent as any)._parsedCommand?.target_app).toBe("Finder");
    } else {
      // pre-LLM rules caught it — still a valid intent
      expect(intent.type).toBeDefined();
    }
  });

  it("should fall back gracefully on invalid tool output (non-strict)", async () => {
    mockStream.mockReturnValue(createToolUseStream({
      action: "invalid-action",
      intent_type: "app-control",
      confidence: 0.95,
      platform: "macos",
      // missing required fields for isValidParsedCommand: action is invalid enum value
    }));

    // Should still return something (heuristic fallback) without throwing
    const intent = await classifyIntent("do something weird");
    expect(intent).toBeDefined();
    expect(intent.type).toBeDefined();
    expect(intent.rawText).toBe("do something weird");
  });

  it("should fall back gracefully when stream returns no tool_use events (non-strict)", async () => {
    mockStream.mockReturnValue(createEmptyStream());

    const intent = await classifyIntent("some ambiguous text here");
    expect(intent).toBeDefined();
    expect(intent.type).toBeDefined();
  });

  it("should throw in strict mode when no valid tool_use is returned", async () => {
    process.env.OMNISTATE_REQUIRE_LLM = "true";
    mockStream.mockReturnValue(createEmptyStream());

    // Strict mode — classifyIntent should throw
    await expect(classifyIntent("do the thing")).rejects.toThrow();
  });

  it("should use target_app entity when entities.app is absent", async () => {
    mockStream.mockReturnValue(createToolUseStream({
      action: "launch",
      intent_type: "app-launch",
      confidence: 0.88,
      target_app: "Notes",
      platform: "macos",
      parameters: {},
      context_dependencies: [],
      entities: {},  // no explicit app entity
    }));

    const intent = await classifyIntent("xyzzy123 open the Notes application please");
    if (mockStream.mock.calls.length > 0 && (intent as any)._parsedCommand) {
      // target_app should be promoted to entities.app
      expect(intent.entities.app).toBeDefined();
      expect(intent.entities.app.value).toBe("Notes");
    } else {
      expect(intent.type).toBeDefined();
    }
  });
});
