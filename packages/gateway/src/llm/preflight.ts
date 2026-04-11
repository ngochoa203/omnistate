import Anthropic from "@anthropic-ai/sdk";
import { getProviderChain, loadLlmRuntimeConfig } from "./runtime-config.js";

export interface LlmPreflightResult {
  ok: boolean;
  status: "ok" | "missing_key" | "auth_error" | "insufficient_credits" | "api_error";
  message: string;
  required: boolean;
  baseURL: string;
  providerId?: string;
  model?: string;
  checkedAt: string;
}

export function shouldRequireLlm(): boolean {
  return process.env.OMNISTATE_REQUIRE_LLM !== "false";
}

function formatLlmPreflightError(
  err: unknown,
  baseURL: string,
  providerId?: string,
  model?: string,
): LlmPreflightResult {
  const required = shouldRequireLlm();

  if (!err || typeof err !== "object") {
    return {
      ok: false,
      status: "api_error",
      message: `LLM API preflight failed: ${String(err ?? "Unknown LLM error")}`,
      required,
      baseURL,
      providerId,
      model,
      checkedAt: new Date().toISOString(),
    };
  }

  const anyErr = err as {
    status?: number;
    message?: string;
    error?: { message?: string };
  };

  const statusCode = anyErr.status;
  const apiMessage = anyErr.error?.message || anyErr.message || "Unknown LLM API error";

  if (statusCode === 402 || /insufficient_credits/i.test(apiMessage)) {
    return {
      ok: false,
      status: "insufficient_credits",
      message: "LLM API preflight failed: Insufficient credits. Please top up and retry.",
      required,
      baseURL,
      providerId,
      model,
      checkedAt: new Date().toISOString(),
    };
  }

  if (statusCode === 401 || /unauthorized|invalid api key/i.test(apiMessage)) {
    return {
      ok: false,
      status: "auth_error",
      message: "LLM API preflight failed: Invalid API credentials. Check ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL.",
      required,
      baseURL,
      providerId,
      model,
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    ok: false,
    status: "api_error",
    message: `LLM API preflight failed${statusCode ? ` (${statusCode})` : ""}: ${apiMessage}`,
    required,
    baseURL,
    providerId,
    model,
    checkedAt: new Date().toISOString(),
  };
}

async function preflightAnthropic(baseURL: string, apiKey: string, model: string): Promise<void> {
  const client = new Anthropic({ apiKey, baseURL });
  await client.messages.create({
    model,
    max_tokens: 1,
    system: "Connectivity preflight",
    messages: [{ role: "user", content: "ping" }],
  });
}

async function preflightOpenAICompatible(
  baseURL: string,
  apiKey: string,
  model: string,
): Promise<void> {
  const endpoint = `${baseURL.replace(/\/+$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Connectivity preflight" },
        { role: "user", content: "ping" },
      ],
      max_tokens: 1,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const err = new Error(text) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
}

export async function runLlmPreflight(): Promise<LlmPreflightResult> {
  const required = shouldRequireLlm();
  const runtime = loadLlmRuntimeConfig();
  const providers = getProviderChain(runtime);

  if (providers.length === 0) {
    return {
      ok: false,
      status: "missing_key",
      message:
        "LLM API preflight failed: no enabled provider with API key. Configure via `omnistate config` or env vars.",
      required,
      baseURL: "",
      checkedAt: new Date().toISOString(),
    };
  }

  let firstError: LlmPreflightResult | null = null;

  for (const provider of providers) {
    try {
      if (provider.kind === "anthropic") {
        await preflightAnthropic(provider.baseURL, provider.apiKey, provider.model);
      } else {
        await preflightOpenAICompatible(
          provider.baseURL,
          provider.apiKey,
          provider.model,
        );
      }

      return {
        ok: true,
        status: "ok",
        message: `LLM provider '${provider.id}' is reachable and credentials are valid.`,
        required,
        baseURL: provider.baseURL,
        providerId: provider.id,
        model: provider.model,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      const error = formatLlmPreflightError(
        err,
        provider.baseURL,
        provider.id,
        provider.model,
      );
      if (!firstError) firstError = error;
    }
  }

  return (
    firstError ?? {
      ok: false,
      status: "api_error",
      message: "LLM API preflight failed: all providers failed.",
      required,
      baseURL: providers[0]?.baseURL ?? "",
      providerId: providers[0]?.id,
      model: providers[0]?.model,
      checkedAt: new Date().toISOString(),
    }
  );
}
