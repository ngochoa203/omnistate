import Anthropic from "@anthropic-ai/sdk";
import {
  getProviderChain,
  loadLlmRuntimeConfig,
  type LlmProviderConfig,
} from "./runtime-config.js";
import { checkCircuit, recordSuccess, recordFailure } from "./circuit-breaker.js";
import type { AnthropicTool } from "./tools.js";
import { toOpenAITools } from "./tools.js";

export interface LlmTextRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface LlmTextResponse {
  text: string;
  providerId: string;
  model: string;
}

export interface LlmRouterErrorDetails {
  providerId: string;
  model: string;
  message: string;
  status?: number;
}

// ---------------------------------------------------------------------------
// Streaming event types
// ---------------------------------------------------------------------------

export type LlmStreamEvent =
  | { kind: "text"; delta: string }
  | { kind: "tool_use"; name: string; input: unknown };

export interface LlmStreamOptions {
  tools?: AnthropicTool[];
  toolChoice?: { type: "tool"; name: string } | { type: "auto" };
}

const PROVIDER_TIMEOUT_MS = 30_000;

function normalizeProviderError(
  provider: LlmProviderConfig,
  model: string,
  err: unknown,
): LlmRouterErrorDetails {
  if (!err || typeof err !== "object") {
    return {
      providerId: provider.id,
      model,
      message: String(err ?? "Unknown LLM error"),
    };
  }

  const anyErr = err as {
    status?: number;
    message?: string;
    error?: { message?: string };
  };

  return {
    providerId: provider.id,
    model,
    status: anyErr.status,
    message: anyErr.error?.message || anyErr.message || "Unknown LLM API error",
  };
}

// ---------------------------------------------------------------------------
// Anthropic streaming
// ---------------------------------------------------------------------------

async function* callAnthropicStream(
  provider: LlmProviderConfig,
  req: LlmTextRequest,
  opts: LlmStreamOptions = {},
): AsyncIterable<LlmStreamEvent> {
  const client = new Anthropic({
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    timeout: PROVIDER_TIMEOUT_MS,
  });

  const params: Anthropic.MessageStreamParams = {
    model: provider.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
    ...(opts.tools && opts.tools.length > 0
      ? { tools: opts.tools as Anthropic.Tool[] }
      : {}),
    ...(opts.toolChoice ? { tool_choice: opts.toolChoice } : {}),
  };

  const stream = client.messages.stream(params);

  // Accumulate tool input JSON per block index
  const toolAccum: Map<number, { name: string; inputRaw: string }> = new Map();

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block.type === "tool_use") {
        toolAccum.set(event.index, { name: block.name, inputRaw: "" });
      }
    } else if (event.type === "content_block_delta") {
      const delta = event.delta;
      if (delta.type === "text_delta") {
        yield { kind: "text", delta: delta.text };
      } else if (delta.type === "input_json_delta") {
        const acc = toolAccum.get(event.index);
        if (acc) acc.inputRaw += delta.partial_json;
      }
    } else if (event.type === "content_block_stop") {
      const acc = toolAccum.get(event.index);
      if (acc) {
        let input: unknown = {};
        try {
          input = JSON.parse(acc.inputRaw);
        } catch {
          input = { raw: acc.inputRaw };
        }
        yield { kind: "tool_use", name: acc.name, input };
        toolAccum.delete(event.index);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible SSE streaming
// ---------------------------------------------------------------------------

interface OaiDelta {
  content?: string | null;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

async function* callOpenAICompatibleStream(
  provider: LlmProviderConfig,
  req: LlmTextRequest,
  opts: LlmStreamOptions = {},
): AsyncIterable<LlmStreamEvent> {
  const base = provider.baseURL.replace(/\/+$/, "");
  const endpoint = `${base}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  const hasTools = opts.tools && opts.tools.length > 0;

  const body: Record<string, unknown> = {
    model: provider.model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    max_tokens: req.maxTokens,
    temperature: 0,
    stream: true,
    // Ask model to return valid JSON when no tools are in use (supported by most
    // OpenAI-compatible providers including MiniMax). Avoids plain-text responses
    // that cause "Invalid JSON from LLM" errors.
    ...(!hasTools ? { response_format: { type: "json_object" } } : {}),
  };

  if (hasTools) {
    body.tools = toOpenAITools(opts.tools!);
    if (opts.toolChoice?.type === "tool") {
      body.tool_choice = { type: "function", function: { name: opts.toolChoice.name } };
    } else {
      body.tool_choice = "auto";
    }
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      const timeoutErr = new Error(
        `Provider '${provider.id}' timed out after ${PROVIDER_TIMEOUT_MS}ms`,
      ) as Error & { status?: number };
      timeoutErr.status = 408;
      throw timeoutErr;
    }
    throw err;
  }

  if (!response.ok) {
    clearTimeout(timer);
    let text = "";
    try {
      text = await response.text();
    } catch {
      text = "Unknown provider error";
    }
    const err = new Error(text) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  // Accumulate tool call fragments per index
  const toolAccum: Map<number, { name: string; argsRaw: string }> = new Map();

  try {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") break outer;
        if (!data) continue;

        let chunk: { choices?: Array<{ delta?: OaiDelta; finish_reason?: string | null }> };
        try {
          chunk = JSON.parse(data) as typeof chunk;
        } catch {
          continue;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (typeof delta.content === "string" && delta.content) {
          yield { kind: "text", delta: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (tc.function?.name) {
              if (!toolAccum.has(idx)) {
                toolAccum.set(idx, { name: tc.function.name, argsRaw: "" });
              } else {
                // name fragment (rare but handle gracefully)
                toolAccum.get(idx)!.name += tc.function.name;
              }
            }
            if (tc.function?.arguments) {
              const acc = toolAccum.get(idx);
              if (acc) acc.argsRaw += tc.function.arguments;
            }
          }
        }

        if (chunk.choices?.[0]?.finish_reason === "tool_calls") {
          for (const [, acc] of toolAccum) {
            let input: unknown = {};
            try {
              input = JSON.parse(acc.argsRaw);
            } catch {
              input = { raw: acc.argsRaw };
            }
            yield { kind: "tool_use", name: acc.name, input };
          }
          toolAccum.clear();
        }
      }
    }

    // Flush any remaining tool calls (finish_reason may have been missed)
    for (const [, acc] of toolAccum) {
      let input: unknown = {};
      try {
        input = JSON.parse(acc.argsRaw);
      } catch {
        input = { raw: acc.argsRaw };
      }
      yield { kind: "tool_use", name: acc.name, input };
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Provider dispatch (stream)
// ---------------------------------------------------------------------------

function callProviderStream(
  provider: LlmProviderConfig,
  req: LlmTextRequest,
  opts: LlmStreamOptions = {},
): AsyncIterable<LlmStreamEvent> {
  if (provider.kind === "anthropic") {
    return callAnthropicStream(provider, req, opts);
  }
  return callOpenAICompatibleStream(provider, req, opts);
}

// ---------------------------------------------------------------------------
// Collect helper (stream -> string)
// ---------------------------------------------------------------------------

async function collectStream(iter: AsyncIterable<LlmStreamEvent>): Promise<string> {
  let text = "";
  for await (const event of iter) {
    if (event.kind === "text") text += event.delta;
  }
  return text.trim();
}

// ---------------------------------------------------------------------------
// Public API: streaming variant
// ---------------------------------------------------------------------------

export async function* requestLlmStream(
  req: LlmTextRequest,
  opts: LlmStreamOptions = {},
): AsyncIterable<LlmStreamEvent> {
  const config = loadLlmRuntimeConfig();
  const providers = getProviderChain(config);

  if (providers.length === 0) {
    throw new Error(
      "No enabled LLM providers with API key. Use `omnistate config set api_key ...` or add a proxy provider.",
    );
  }

  const errors: LlmRouterErrorDetails[] = [];

  for (const provider of providers) {
    try {
      checkCircuit(provider.id);
      let hadOutput = false;

      for await (const event of callProviderStream(provider, req, opts)) {
        if (!hadOutput) {
          if (event.kind === "text" && event.delta) hadOutput = true;
          if (event.kind === "tool_use") hadOutput = true;
        }
        yield event;
      }

      if (hadOutput) {
        recordSuccess(provider.id);
        return;
      }

      recordFailure(provider.id);
      errors.push({ providerId: provider.id, model: provider.model, message: "Empty model response" });
    } catch (err) {
      recordFailure(provider.id);
      errors.push(normalizeProviderError(provider, provider.model, err));
    }
  }

  const formatted = errors
    .map(
      (e) =>
        `${e.providerId}/${e.model}${e.status ? ` (${e.status})` : ""}: ${e.message}`,
    )
    .join(" | ");

  throw new Error(`All LLM providers failed. ${formatted}`);
}

// ---------------------------------------------------------------------------
// Public API: non-streaming (backward-compatible wrapper)
// ---------------------------------------------------------------------------

export async function requestLlmTextWithFallback(
  req: LlmTextRequest,
): Promise<LlmTextResponse> {
  const config = loadLlmRuntimeConfig();
  const providers = getProviderChain(config);

  if (providers.length === 0) {
    throw new Error(
      "No enabled LLM providers with API key. Use `omnistate config set api_key ...` or add a proxy provider.",
    );
  }

  const errors: LlmRouterErrorDetails[] = [];

  for (const provider of providers) {
    try {
      checkCircuit(provider.id);
      const text = await collectStream(callProviderStream(provider, req));
      if (text) {
        recordSuccess(provider.id);
        return { text, providerId: provider.id, model: provider.model };
      }

      recordFailure(provider.id);
      errors.push({
        providerId: provider.id,
        model: provider.model,
        message: "Empty model response",
      });
    } catch (err) {
      recordFailure(provider.id);
      errors.push(normalizeProviderError(provider, provider.model, err));
    }
  }

  const formatted = errors
    .map(
      (e) =>
        `${e.providerId}/${e.model}${e.status ? ` (${e.status})` : ""}: ${e.message}`,
    )
    .join(" | ");

  throw new Error(`All LLM providers failed. ${formatted}`);
}
