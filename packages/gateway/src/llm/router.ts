import Anthropic from "@anthropic-ai/sdk";
import {
  getProviderChain,
  loadLlmRuntimeConfig,
  type LlmProviderConfig,
} from "./runtime-config.js";
import { checkCircuit, recordSuccess, recordFailure } from "./circuit-breaker.js";

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

async function callAnthropic(
  provider: LlmProviderConfig,
  req: LlmTextRequest,
): Promise<string> {
  const client = new Anthropic({
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    timeout: PROVIDER_TIMEOUT_MS,
  });

  const message = await client.messages.create({
    model: provider.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
  });

  return message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .trim();
}

async function callOpenAICompatible(
  provider: LlmProviderConfig,
  req: LlmTextRequest,
): Promise<string> {
  const base = provider.baseURL.replace(/\/+$/, "");
  const endpoint = `${base}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        max_tokens: req.maxTokens,
        temperature: 0,
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const timeoutErr = new Error(
        `Provider '${provider.id}' timed out after ${PROVIDER_TIMEOUT_MS}ms`,
      ) as Error & { status?: number };
      timeoutErr.status = 408;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
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

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function callProvider(
  provider: LlmProviderConfig,
  req: LlmTextRequest,
): Promise<string> {
  if (provider.kind === "anthropic") {
    return callAnthropic(provider, req);
  }
  return callOpenAICompatible(provider, req);
}

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
      const text = await callProvider(provider, req);
      if (text) {
        recordSuccess(provider.id);
        return {
          text,
          providerId: provider.id,
          model: provider.model,
        };
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
