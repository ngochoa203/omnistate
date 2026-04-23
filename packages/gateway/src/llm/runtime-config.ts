import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

export type LlmProviderKind = "anthropic" | "openai-compatible";

export interface LlmProviderConfig {
  id: string;
  kind: LlmProviderKind;
  baseURL: string;
  apiKey: string;
  model: string;
  models?: string[];
  enabled: boolean;
}

export interface TokenBudgetConfig {
  compactPrompt: boolean;
  intentMaxTokens: number;
  decomposeMaxTokens: number;
  maxInputChars: number;
}

export type VoiceProvider = "native" | "whisper-local" | "whisper-cloud";

export interface SiriBridgeConfig {
  enabled: boolean;
  mode: "handoff" | "command";
  shortcutName: string;
  endpoint: string;
  token: string;
}

export type WakeEngine = "legacy" | "oww";

export interface VoiceRuntimeConfig {
  lowLatency: boolean;
  autoExecuteTranscript: boolean;
  primaryProvider: VoiceProvider;
  fallbackProviders: VoiceProvider[];
  chunkMs: number;
  siri: SiriBridgeConfig;
  wake: {
    enabled: boolean;
    phrase: string;
    cooldownMs: number;
    commandWindowSec: number;
    engine: WakeEngine;
    aliases: string[];
    modelPath?: string;
    threshold: number;
  };
}

export interface SessionMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  thinkingLevel?: "low" | "medium" | "high";
  fastMode?: boolean;
  verboseMode?: boolean;
}

export interface LlmRuntimeConfig {
  activeProviderId: string;
  activeModel: string;
  fallbackProviderIds: string[];
  providers: LlmProviderConfig[];
  tokenBudget: TokenBudgetConfig;
  voice: VoiceRuntimeConfig;
  session: {
    currentSessionId: string;
    sessions: SessionMeta[];
  };
}

const CONFIG_PATH = resolve(homedir(), ".omnistate/llm.runtime.json");

function nowIso(): string {
  return new Date().toISOString();
}

function defaultSession(): SessionMeta {
  const now = nowIso();
  return {
    id: "default",
    name: "default",
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    thinkingLevel: "low",
    fastMode: false,
    verboseMode: false,
  };
}

function defaultConfig(): LlmRuntimeConfig {
  const anthropicProvider: LlmProviderConfig = {
    id: "anthropic",
    kind: "anthropic",
    baseURL: process.env.ANTHROPIC_BASE_URL ?? "https://chat.trollllm.xyz",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4.5",
    models: ["claude-haiku-4.5", "claude-sonnet-4.6", "claude-opus-4.6"],
    enabled: true,
  };

  const router9Provider: LlmProviderConfig = {
    id: "router9",
    kind: "openai-compatible",
    baseURL: process.env.OMNISTATE_ROUTER9_BASE_URL ?? "http://localhost:20128/v1",
    apiKey: process.env.OMNISTATE_ROUTER9_API_KEY ?? "",
    model: process.env.OMNISTATE_ROUTER9_MODEL ?? "cx/gpt-5.4",
    models: ["cx/gpt-5.4", "kr/deepseek-3.2"],
    enabled: true,
  };

  const session = defaultSession();

  return {
    activeProviderId: anthropicProvider.apiKey ? "anthropic" : "router9",
    activeModel: anthropicProvider.apiKey ? anthropicProvider.model : router9Provider.model,
    fallbackProviderIds: ["router9"],
    providers: [anthropicProvider, router9Provider],
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
        endpoint: "http://127.0.0.1:19801/siri/command",
        token: process.env.OMNISTATE_SIRI_TOKEN ?? "",
      },
      wake: {
        enabled: false,
        phrase: "hey omni",
        cooldownMs: 2500,
        commandWindowSec: 7,
        engine: "oww" as WakeEngine,
        aliases: ["mimi", "hey mimi", "ok mimi", "mimi ơi", "mimi oi", "mi mi"],
        threshold: 0.5,
      },
    },
    session: {
      currentSessionId: session.id,
      sessions: [session],
    },
  };
}

function mergeWithDefaults(raw: Partial<LlmRuntimeConfig>): LlmRuntimeConfig {
  const def = defaultConfig();
  const providers: LlmProviderConfig[] = Array.isArray(raw.providers)
    ? raw.providers.map((p) => ({
        id: p.id ?? "provider",
        kind: p.kind === "openai-compatible" ? "openai-compatible" : "anthropic",
        baseURL: p.baseURL ?? def.providers[0]!.baseURL,
        apiKey: p.apiKey ?? "",
        model: p.model ?? def.providers[0]!.model,
        models: Array.isArray(p.models)
          ? p.models.map((m) => String(m).trim()).filter(Boolean)
          : undefined,
        enabled: p.enabled !== false,
      }))
    : def.providers;

  const sessions: SessionMeta[] =
    Array.isArray(raw.session?.sessions) && raw.session.sessions.length > 0
    ? raw.session.sessions.map((s) => ({
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: typeof s.messageCount === "number" ? s.messageCount : 0,
        thinkingLevel:
          s.thinkingLevel === "high" || s.thinkingLevel === "medium"
            ? s.thinkingLevel
            : "low",
        fastMode: s.fastMode === true,
        verboseMode: s.verboseMode === true,
      }))
    : def.session.sessions;

  const currentSessionId =
    raw.session?.currentSessionId && sessions.some((s) => s.id === raw.session?.currentSessionId)
      ? raw.session.currentSessionId
      : sessions[0]!.id;

  const providerIds = providers.map((p) => p.id);
  const fallbackProviderIds = Array.isArray(raw.fallbackProviderIds)
    ? raw.fallbackProviderIds.filter((id): id is string => providerIds.includes(id))
    : def.fallbackProviderIds;

  const activeProviderId =
    typeof raw.activeProviderId === "string" && providerIds.includes(raw.activeProviderId)
      ? raw.activeProviderId
      : def.activeProviderId;

  const activeProvider = providers.find((p) => p.id === activeProviderId) ?? providers[0]!;

  return {
    activeProviderId,
    activeModel: raw.activeModel ?? activeProvider.model,
    fallbackProviderIds,
    providers,
    tokenBudget: {
      compactPrompt: raw.tokenBudget?.compactPrompt ?? def.tokenBudget.compactPrompt,
      intentMaxTokens: raw.tokenBudget?.intentMaxTokens ?? def.tokenBudget.intentMaxTokens,
      decomposeMaxTokens:
        raw.tokenBudget?.decomposeMaxTokens ?? def.tokenBudget.decomposeMaxTokens,
      maxInputChars: raw.tokenBudget?.maxInputChars ?? def.tokenBudget.maxInputChars,
    },
    voice: {
      lowLatency: raw.voice?.lowLatency ?? def.voice.lowLatency,
      autoExecuteTranscript:
        raw.voice?.autoExecuteTranscript ?? def.voice.autoExecuteTranscript,
      primaryProvider:
        raw.voice?.primaryProvider === "whisper-cloud" ||
        raw.voice?.primaryProvider === "whisper-local"
          ? raw.voice.primaryProvider
          : "native",
      fallbackProviders: Array.isArray(raw.voice?.fallbackProviders)
        ? raw.voice.fallbackProviders.filter(
            (p): p is VoiceProvider =>
              p === "native" || p === "whisper-local" || p === "whisper-cloud",
          )
        : def.voice.fallbackProviders,
      chunkMs:
        typeof raw.voice?.chunkMs === "number" && raw.voice.chunkMs >= 80
          ? Math.round(raw.voice.chunkMs)
          : def.voice.chunkMs,
      siri: {
        enabled: raw.voice?.siri?.enabled ?? def.voice.siri.enabled,
        mode:
          raw.voice?.siri?.mode === "command"
            ? "command"
            : def.voice.siri.mode,
        shortcutName: raw.voice?.siri?.shortcutName ?? def.voice.siri.shortcutName,
        endpoint: raw.voice?.siri?.endpoint ?? def.voice.siri.endpoint,
        token: raw.voice?.siri?.token ?? def.voice.siri.token,
      },
      wake: {
        enabled: raw.voice?.wake?.enabled ?? def.voice.wake.enabled,
        phrase: raw.voice?.wake?.phrase?.trim() || def.voice.wake.phrase,
        cooldownMs:
          typeof raw.voice?.wake?.cooldownMs === "number" && raw.voice.wake.cooldownMs >= 500
            ? Math.round(raw.voice.wake.cooldownMs)
            : def.voice.wake.cooldownMs,
        commandWindowSec:
          typeof raw.voice?.wake?.commandWindowSec === "number" &&
          raw.voice.wake.commandWindowSec >= 2
            ? Math.round(raw.voice.wake.commandWindowSec)
            : def.voice.wake.commandWindowSec,
        engine:
          raw.voice?.wake?.engine === "legacy" || raw.voice?.wake?.engine === "oww"
            ? raw.voice.wake.engine
            : def.voice.wake.engine,
        aliases: Array.isArray(raw.voice?.wake?.aliases) && raw.voice.wake.aliases.length > 0
          ? raw.voice.wake.aliases.map((a) => String(a)).filter(Boolean)
          : def.voice.wake.aliases,
        ...(raw.voice?.wake?.modelPath ? { modelPath: raw.voice.wake.modelPath } : {}),
        threshold:
          typeof raw.voice?.wake?.threshold === "number" &&
          raw.voice.wake.threshold > 0 &&
          raw.voice.wake.threshold <= 1
            ? raw.voice.wake.threshold
            : def.voice.wake.threshold,
      },
    },
    session: {
      currentSessionId,
      sessions,
    },
  };
}

export function loadLlmRuntimeConfig(): LlmRuntimeConfig {
  if (!existsSync(CONFIG_PATH)) {
    const conf = defaultConfig();
    saveLlmRuntimeConfig(conf);
    return conf;
  }

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<LlmRuntimeConfig>;
    const conf = mergeWithDefaults(raw);
    saveLlmRuntimeConfig(conf);
    return conf;
  } catch {
    const conf = defaultConfig();
    saveLlmRuntimeConfig(conf);
    return conf;
  }
}

export function saveLlmRuntimeConfig(config: LlmRuntimeConfig): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  chmodSync(CONFIG_PATH, 0o600);
}

export function setActiveModel(model: string): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  const trimmed = model.trim();
  if (!trimmed) return conf;
  conf.activeModel = trimmed;
  const provider = conf.providers.find((p) => p.id === conf.activeProviderId);
  if (provider) provider.model = trimmed;
  saveLlmRuntimeConfig(conf);
  return conf;
}

export function setActiveProvider(providerId: string): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  const provider = conf.providers.find((p) => p.id === providerId);
  if (!provider) return conf;
  conf.activeProviderId = providerId;
  conf.activeModel = provider.model || provider.models?.[0] || conf.activeModel;
  saveLlmRuntimeConfig(conf);
  return conf;
}

export function upsertProvider(provider: LlmProviderConfig): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  const idx = conf.providers.findIndex((p) => p.id === provider.id);
  if (idx >= 0) {
    conf.providers[idx] = provider;
  } else {
    conf.providers.push(provider);
  }
  if (!conf.fallbackProviderIds.includes("router9") && provider.id === "router9") {
    conf.fallbackProviderIds.push("router9");
  }
  saveLlmRuntimeConfig(conf);
  return conf;
}

export function setFallbackOrder(providerIds: string[]): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  const validIds = new Set(conf.providers.map((p) => p.id));
  conf.fallbackProviderIds = providerIds.filter((id) => validIds.has(id));
  saveLlmRuntimeConfig(conf);
  return conf;
}

export function addFallbackProvider(providerId: string): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  if (!conf.providers.some((p) => p.id === providerId)) return conf;
  if (!conf.fallbackProviderIds.includes(providerId)) {
    conf.fallbackProviderIds.push(providerId);
    saveLlmRuntimeConfig(conf);
  }
  return conf;
}

export function removeFallbackProvider(providerId: string): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  conf.fallbackProviderIds = conf.fallbackProviderIds.filter((id) => id !== providerId);
  saveLlmRuntimeConfig(conf);
  return conf;
}

export function setTokenBudgetField(
  key: keyof TokenBudgetConfig,
  value: number | boolean,
): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  if (key === "compactPrompt") {
    conf.tokenBudget.compactPrompt = Boolean(value);
  } else {
    const num = Number(value);
    if (!Number.isNaN(num) && Number.isFinite(num) && num > 0) {
      conf.tokenBudget[key] = Math.round(num);
    }
  }
  saveLlmRuntimeConfig(conf);
  return conf;
}

export function setVoiceField(
  key: keyof Omit<VoiceRuntimeConfig, "siri" | "fallbackProviders" | "primaryProvider" | "wake">,
  value: number | boolean,
): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  if (key === "lowLatency" || key === "autoExecuteTranscript") {
    conf.voice[key] = Boolean(value);
  } else if (key === "chunkMs") {
    const num = Number(value);
    if (!Number.isNaN(num) && Number.isFinite(num) && num >= 80) {
      conf.voice.chunkMs = Math.round(num);
    }
  }
  saveLlmRuntimeConfig(conf);
  return conf;
}

export function setWakeField(
  key: "enabled" | "phrase" | "cooldownMs" | "commandWindowSec",
  value: string | number | boolean,
): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  if (key === "enabled") {
    conf.voice.wake.enabled = Boolean(value);
  } else if (key === "phrase") {
    const phrase = String(value).trim();
    if (phrase.length >= 3) conf.voice.wake.phrase = phrase;
  } else if (key === "cooldownMs") {
    const n = Number(value);
    if (!Number.isNaN(n) && Number.isFinite(n) && n >= 500) {
      conf.voice.wake.cooldownMs = Math.round(n);
    }
  } else if (key === "commandWindowSec") {
    const n = Number(value);
    if (!Number.isNaN(n) && Number.isFinite(n) && n >= 2) {
      conf.voice.wake.commandWindowSec = Math.round(n);
    }
  }
  saveLlmRuntimeConfig(conf);
  return conf;
}

export function setVoiceProviderChain(
  primary: VoiceProvider,
  fallback: VoiceProvider[],
): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  conf.voice.primaryProvider = primary;
  const deduped: VoiceProvider[] = [];
  for (const p of fallback) {
    if (p !== primary && !deduped.includes(p)) deduped.push(p);
  }
  conf.voice.fallbackProviders = deduped;
  saveLlmRuntimeConfig(conf);
  return conf;
}

export function setSiriField(
  key: keyof SiriBridgeConfig,
  value: string | boolean,
): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  if (key === "enabled") {
    conf.voice.siri.enabled = Boolean(value);
  } else if (key === "mode") {
    conf.voice.siri.mode = value === "command" ? "command" : "handoff";
  } else if (key === "shortcutName") {
    conf.voice.siri.shortcutName = String(value);
  } else if (key === "endpoint") {
    conf.voice.siri.endpoint = String(value);
  } else if (key === "token") {
    conf.voice.siri.token = String(value);
  }
  saveLlmRuntimeConfig(conf);
  return conf;
}

export function getProviderChain(config: LlmRuntimeConfig): LlmProviderConfig[] {
  const providerMap = new Map(config.providers.map((p) => [p.id, p]));
  const orderedIds = [config.activeProviderId, ...config.fallbackProviderIds];
  const deduped: string[] = [];

  for (const id of orderedIds) {
    if (!deduped.includes(id)) deduped.push(id);
  }

  return deduped
    .map((id) => providerMap.get(id))
    .filter((p): p is LlmProviderConfig => !!p && p.enabled && !!p.apiKey);
}

export function incrementSessionUsage(): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  const current = conf.session.sessions.find(
    (s) => s.id === conf.session.currentSessionId,
  );
  if (current) {
    current.messageCount += 1;
    current.updatedAt = nowIso();
  }
  saveLlmRuntimeConfig(conf);
  return conf;
}

export function createSession(name?: string): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  const now = nowIso();
  const id = `session-${Date.now()}`;
  const session: SessionMeta = {
    id,
    name: name?.trim() || id,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    thinkingLevel: "low",
    fastMode: false,
    verboseMode: false,
  };
  conf.session.sessions.unshift(session);
  conf.session.currentSessionId = id;
  saveLlmRuntimeConfig(conf);
  return conf;
}

export function switchSession(sessionId: string): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  const exists = conf.session.sessions.some((s) => s.id === sessionId);
  if (exists) {
    conf.session.currentSessionId = sessionId;
    saveLlmRuntimeConfig(conf);
  }
  return conf;
}

export function clearSessionData(): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  const current = conf.session.sessions.find(
    (s) => s.id === conf.session.currentSessionId,
  );
  if (current) {
    current.messageCount = 0;
    current.updatedAt = nowIso();
  }
  saveLlmRuntimeConfig(conf);
  return conf;
}

export function updateCurrentSessionMeta(
  updates: Partial<Pick<SessionMeta, "thinkingLevel" | "fastMode" | "verboseMode">>,
): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  const current = conf.session.sessions.find(
    (s) => s.id === conf.session.currentSessionId,
  );
  if (current) {
    if (updates.thinkingLevel) current.thinkingLevel = updates.thinkingLevel;
    if (typeof updates.fastMode === "boolean") current.fastMode = updates.fastMode;
    if (typeof updates.verboseMode === "boolean") {
      current.verboseMode = updates.verboseMode;
    }
    current.updatedAt = nowIso();
    saveLlmRuntimeConfig(conf);
  }
  return conf;
}

export function updateActiveProviderField(
  field: "apiKey" | "baseURL" | "model",
  value: string,
): LlmRuntimeConfig {
  const conf = loadLlmRuntimeConfig();
  const provider = conf.providers.find((p) => p.id === conf.activeProviderId);
  if (!provider) return conf;
  if (field === "apiKey") provider.apiKey = value;
  if (field === "baseURL") provider.baseURL = value;
  if (field === "model") {
    provider.model = value;
    conf.activeModel = value;
  }
  saveLlmRuntimeConfig(conf);
  return conf;
}

export function getLlmRuntimeConfigPath(): string {
  return CONFIG_PATH;
}
