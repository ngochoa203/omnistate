import Anthropic from "@anthropic-ai/sdk";

export interface LlmPreflightResult {
  ok: boolean;
  status: "ok" | "missing_key" | "auth_error" | "insufficient_credits" | "api_error";
  message: string;
  required: boolean;
  baseURL: string;
  checkedAt: string;
}

export function shouldRequireLlm(): boolean {
  return process.env.OMNISTATE_REQUIRE_LLM !== "false";
}

function formatLlmPreflightError(err: unknown): LlmPreflightResult {
  const baseURL = process.env.ANTHROPIC_BASE_URL ?? "https://chat.trollllm.xyz";
  const required = shouldRequireLlm();

  if (!err || typeof err !== "object") {
    return {
      ok: false,
      status: "api_error",
      message: `LLM API preflight failed: ${String(err ?? "Unknown LLM error")}`,
      required,
      baseURL,
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
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    ok: false,
    status: "api_error",
    message: `LLM API preflight failed${statusCode ? ` (${statusCode})` : ""}: ${apiMessage}`,
    required,
    baseURL,
    checkedAt: new Date().toISOString(),
  };
}

export async function runLlmPreflight(): Promise<LlmPreflightResult> {
  const required = shouldRequireLlm();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.ANTHROPIC_BASE_URL ?? "https://chat.trollllm.xyz";

  if (!apiKey) {
    return {
      ok: false,
      status: "missing_key",
      message: "LLM API preflight failed: ANTHROPIC_API_KEY is missing.",
      required,
      baseURL,
      checkedAt: new Date().toISOString(),
    };
  }

  const client = new Anthropic({ apiKey, baseURL });

  try {
    await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1,
      system: "Connectivity preflight",
      messages: [{ role: "user", content: "ping" }],
    });

    return {
      ok: true,
      status: "ok",
      message: "LLM API is reachable and credentials are valid.",
      required,
      baseURL,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return formatLlmPreflightError(err);
  }
}
