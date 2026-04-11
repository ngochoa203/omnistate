import { beforeEach, describe, expect, it, vi } from "vitest";

const mockConfig = {
  activeProviderId: "router9",
  activeModel: "cx/gpt-5.4",
  fallbackProviderIds: ["router9"],
  providers: [
    {
      id: "router9",
      kind: "openai-compatible",
      baseURL: "http://localhost:20128/v1",
      apiKey: "test-key",
      model: "cx/gpt-5.4",
      enabled: true,
    },
  ],
  tokenBudget: {
    compactPrompt: true,
    intentMaxTokens: 220,
    decomposeMaxTokens: 360,
    maxInputChars: 1400,
  },
  session: {
    currentSessionId: "default",
    sessions: [
      {
        id: "default",
        name: "default",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        messageCount: 3,
        thinkingLevel: "medium",
        fastMode: false,
        verboseMode: true,
      },
    ],
  },
};

const runtimeConfigMocks = vi.hoisted(() => ({
  addFallbackProvider: vi.fn(),
  clearSessionData: vi.fn(() => mockConfig),
  createSession: vi.fn(() => mockConfig),
  getLlmRuntimeConfigPath: vi.fn(() => "/tmp/llm.runtime.json"),
  loadLlmRuntimeConfig: vi.fn(() => mockConfig),
  removeFallbackProvider: vi.fn(() => mockConfig),
  setActiveModel: vi.fn(() => mockConfig),
  setActiveProvider: vi.fn(() => mockConfig),
  setFallbackOrder: vi.fn((ids: string[]) => ({ ...mockConfig, fallbackProviderIds: ids })),
  setTokenBudgetField: vi.fn(() => mockConfig),
  switchSession: vi.fn(() => mockConfig),
  updateCurrentSessionMeta: vi.fn(() => mockConfig),
  updateActiveProviderField: vi.fn(() => mockConfig),
  upsertProvider: vi.fn(() => mockConfig),
}));

vi.mock("../llm/runtime-config.js", () => runtimeConfigMocks);

import { tryHandleGatewayCommand } from "../gateway/command-router.js";

describe("tryHandleGatewayCommand()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeConfigMocks.loadLlmRuntimeConfig.mockReturnValue(mockConfig);
  });

  const ctx = {
    clearTaskHistory: vi.fn(() => 7),
    connectedClients: vi.fn(() => 2),
    uptimeMs: vi.fn(() => 5000),
    taskHistorySize: vi.fn(() => 9),
  };

  it("returns null for non-command input", () => {
    const out = tryHandleGatewayCommand("open safari", ctx);
    expect(out).toBeNull();
  });

  it("supports /commands and returns help text", () => {
    const out = tryHandleGatewayCommand("/commands", ctx);
    expect(out?.handled).toBe(true);
    expect(out?.output).toContain("/status");
    expect(out?.output).toContain("/config");
  });

  it("updates thinking level via /think high", () => {
    const out = tryHandleGatewayCommand("/think high", ctx);
    expect(runtimeConfigMocks.updateCurrentSessionMeta).toHaveBeenCalledWith({
      thinkingLevel: "high",
    });
    expect(out?.output).toBe("thinking set to high");
  });

  it("sets fallback chain via omnistate config fallback set", () => {
    const out = tryHandleGatewayCommand("omnistate config fallback set anthropic,router9", ctx);
    expect(runtimeConfigMocks.setFallbackOrder).toHaveBeenCalledWith([
      "anthropic",
      "router9",
    ]);
    expect(out?.output).toContain("Fallback chain set: anthropic,router9");
  });

  it("clear command resets session and task history", () => {
    const out = tryHandleGatewayCommand("/clear", ctx);
    expect(ctx.clearTaskHistory).toHaveBeenCalledOnce();
    expect(runtimeConfigMocks.clearSessionData).toHaveBeenCalledOnce();
    expect(out?.output).toContain("Cleared 7 gateway task history items");
  });

  it("session list includes active marker and mode flags", () => {
    const out = tryHandleGatewayCommand("/session list", ctx);
    expect(out?.handled).toBe(true);
    expect(out?.output).toContain("* default (default)");
    expect(out?.output).toContain("think=medium");
    expect(out?.output).toContain("verbose=true");
  });
});