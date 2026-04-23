import { describe, expect, it } from "vitest";
import { getProviderChain, type LlmRuntimeConfig } from "../llm/runtime-config.js";

function makeConfig(): LlmRuntimeConfig {
  return {
    activeProviderId: "anthropic",
    activeModel: "claude-haiku-4-5",
    fallbackProviderIds: ["router9", "anthropic", "disabled-provider", "no-key-provider"],
    providers: [
      {
        id: "anthropic",
        kind: "anthropic",
        baseURL: "https://chat.trollllm.xyz",
        apiKey: "anth-key",
        model: "claude-haiku-4-5",
        enabled: true,
      },
      {
        id: "router9",
        kind: "openai-compatible",
        baseURL: "http://localhost:20128/v1",
        apiKey: "router-key",
        model: "cx/gpt-5.4",
        enabled: true,
      },
      {
        id: "disabled-provider",
        kind: "openai-compatible",
        baseURL: "http://disabled.local/v1",
        apiKey: "disabled-key",
        model: "x",
        enabled: false,
      },
      {
        id: "no-key-provider",
        kind: "openai-compatible",
        baseURL: "http://no-key.local/v1",
        apiKey: "",
        model: "x",
        enabled: true,
      },
    ],
    tokenBudget: {
      compactPrompt: true,
      intentMaxTokens: 220,
      decomposeMaxTokens: 360,
      maxInputChars: 1400,
    },
    voice: {
      lowLatency: true,
      autoExecuteTranscript: true,
      primaryProvider: "native",
      fallbackProviders: ["whisper-local", "whisper-cloud"],
      chunkMs: 220,
      siri: {
        enabled: false,
        mode: "handoff",
        shortcutName: "OmniState Bridge",
        endpoint: "http://127.0.0.1:19800",
        token: "",
      },
      wake: {
        enabled: false,
        phrase: "hey omni",
        cooldownMs: 2500,
        commandWindowSec: 7,
        engine: "oww" as const,
        aliases: ["mimi", "hey mimi", "ok mimi", "mimi ơi", "mimi oi", "mi mi"],
        threshold: 0.5,
      },
    },
    session: {
      currentSessionId: "default",
      sessions: [
        {
          id: "default",
          name: "default",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          messageCount: 0,
        },
      ],
    },
  };
}

describe("getProviderChain()", () => {
  it("keeps active provider first and deduplicates fallback order", () => {
    const chain = getProviderChain(makeConfig());
    expect(chain.map((p) => p.id)).toEqual(["anthropic", "router9"]);
  });

  it("filters providers that are disabled or missing API key", () => {
    const chain = getProviderChain(makeConfig());
    expect(chain.some((p) => p.id === "disabled-provider")).toBe(false);
    expect(chain.some((p) => p.id === "no-key-provider")).toBe(false);
  });

  it("returns empty chain when no enabled providers have credentials", () => {
    const cfg = makeConfig();
    cfg.providers = cfg.providers.map((p) => ({ ...p, apiKey: "" }));
    const chain = getProviderChain(cfg);
    expect(chain).toHaveLength(0);
  });
});