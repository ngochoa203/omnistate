import {
  addFallbackProvider,
  clearSessionData,
  createSession,
  getLlmRuntimeConfigPath,
  loadLlmRuntimeConfig,
  removeFallbackProvider,
  setActiveModel,
  setActiveProvider,
  setFallbackOrder,
  setSiriField,
  setWakeField,
  setTokenBudgetField,
  setVoiceField,
  setVoiceProviderChain,
  switchSession,
  updateCurrentSessionMeta,
  updateActiveProviderField,
  upsertProvider,
  type LlmRuntimeConfig,
} from "../llm/runtime-config.js";

interface CommandContext {
  clearTaskHistory: () => number;
  connectedClients: () => number;
  uptimeMs: () => number;
  taskHistorySize: () => number;
}

export interface CommandOutput {
  handled: boolean;
  output: string;
  data?: Record<string, unknown>;
}

function formatConfig(config: LlmRuntimeConfig): string {
  const providerLines = config.providers.map(
    (p) =>
      `- ${p.id} [${p.kind}] ${p.enabled ? "enabled" : "disabled"} model=${p.model} base=${p.baseURL}`,
  );
  const currentSession =
    config.session.sessions.find((s) => s.id === config.session.currentSessionId) ??
    config.session.sessions[0];

  return [
    `active_provider=${config.activeProviderId}`,
    `active_model=${config.activeModel}`,
    `fallback=${config.fallbackProviderIds.join(",") || "(none)"}`,
    `token.compact_prompt=${config.tokenBudget.compactPrompt}`,
    `token.intent_max_tokens=${config.tokenBudget.intentMaxTokens}`,
    `token.decompose_max_tokens=${config.tokenBudget.decomposeMaxTokens}`,
    `token.max_input_chars=${config.tokenBudget.maxInputChars}`,
    `voice.low_latency=${config.voice.lowLatency}`,
    `voice.auto_execute_transcript=${config.voice.autoExecuteTranscript}`,
    `voice.provider_chain=${[
      config.voice.primaryProvider,
      ...config.voice.fallbackProviders,
    ].join(",")}`,
    `voice.chunk_ms=${config.voice.chunkMs}`,
    `siri.enabled=${config.voice.siri.enabled}`,
    `siri.mode=${config.voice.siri.mode}`,
    `siri.shortcut=${config.voice.siri.shortcutName}`,
    `siri.endpoint=${config.voice.siri.endpoint}`,
    `wake.enabled=${config.voice.wake.enabled}`,
    `wake.phrase=${config.voice.wake.phrase}`,
    `wake.cooldown_ms=${config.voice.wake.cooldownMs}`,
    `wake.command_window_sec=${config.voice.wake.commandWindowSec}`,
    `session.current=${currentSession?.id ?? "default"}`,
    `session.messages=${currentSession?.messageCount ?? 0}`,
    `config_path=${getLlmRuntimeConfigPath()}`,
    "providers:",
    ...providerLines,
  ].join("\n");
}

function commandHelpText(): string {
  return [
    "OmniState commands:",
    "/help, /commands",
    "/status, /whoami",
    "/model [name]",
    "/session [list|new <name>|use <id>]",
    "/new [name] (alias /session new)",
    "/clear, /reset",
    "/think [low|medium|high]",
    "/fast [on|off]",
    "/verbose [on|off]",
    "/voice [show|providers <p1,p2,...>|siri <on|off>]",
    "/wake [show|on|off|phrase <text>]",
    "/config ...",
    "omnistate config ...",
  ].join("\n");
}

function handleWakeCommand(args: string[]): CommandOutput {
  const cfg = loadLlmRuntimeConfig();
  const sub = (args[0] ?? "show").toLowerCase();

  if (sub === "show") {
    return {
      handled: true,
      output: [
        `enabled=${cfg.voice.wake.enabled}`,
        `phrase=${cfg.voice.wake.phrase}`,
        `cooldown_ms=${cfg.voice.wake.cooldownMs}`,
        `command_window_sec=${cfg.voice.wake.commandWindowSec}`,
      ].join("\n"),
      data: { wake: cfg.voice.wake },
    };
  }

  if (sub === "on" || sub === "off") {
    const next = setWakeField("enabled", sub === "on");
    return {
      handled: true,
      output: `wake.enabled=${next.voice.wake.enabled}`,
      data: { wake: next.voice.wake },
    };
  }

  if (sub === "phrase") {
    const phrase = args.slice(1).join(" ").trim();
    if (!phrase) return { handled: true, output: "Usage: /wake phrase <text>" };
    const next = setWakeField("phrase", phrase);
    return {
      handled: true,
      output: `wake.phrase=${next.voice.wake.phrase}`,
      data: { wake: next.voice.wake },
    };
  }

  return { handled: true, output: "Usage: /wake [show|on|off|phrase <text>]" };
}

function handleVoiceCommand(args: string[]): CommandOutput {
  const config = loadLlmRuntimeConfig();
  const sub = (args[0] ?? "show").toLowerCase();

  if (sub === "show") {
    return {
      handled: true,
      output: [
        `low_latency=${config.voice.lowLatency}`,
        `auto_execute_transcript=${config.voice.autoExecuteTranscript}`,
        `provider_chain=${[
          config.voice.primaryProvider,
          ...config.voice.fallbackProviders,
        ].join(",")}`,
        `chunk_ms=${config.voice.chunkMs}`,
        `siri.enabled=${config.voice.siri.enabled}`,
        `siri.mode=${config.voice.siri.mode}`,
        `siri.shortcut=${config.voice.siri.shortcutName}`,
        `siri.endpoint=${config.voice.siri.endpoint}`,
      ].join("\n"),
      data: { voice: config.voice },
    };
  }

  if (sub === "providers") {
    const chain = args
      .slice(1)
      .join(" ")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => ["native", "whisper-local", "whisper-cloud"].includes(x));
    if (chain.length === 0) {
      return {
        handled: true,
        output: "Usage: /voice providers <native,whisper-local,whisper-cloud>",
      };
    }
    const [primary, ...fallback] = chain as Array<
      "native" | "whisper-local" | "whisper-cloud"
    >;
    const next = setVoiceProviderChain(primary, fallback);
    return {
      handled: true,
      output: `voice provider chain=${[
        next.voice.primaryProvider,
        ...next.voice.fallbackProviders,
      ].join(",")}`,
      data: { voice: next.voice },
    };
  }

  if (sub === "siri") {
    const flag = parseOnOff(args[1]);
    if (flag === null) {
      return { handled: true, output: "Usage: /voice siri <on|off>" };
    }
    const next = setSiriField("enabled", flag);
    return {
      handled: true,
      output: `siri.enabled=${next.voice.siri.enabled}`,
      data: { siri: next.voice.siri },
    };
  }

  return { handled: true, output: "Usage: /voice [show|providers <p1,p2,...>|siri <on|off>]" };
}

function handleModelCommand(args: string[]): CommandOutput {
  if (args.length === 0) {
    const config = loadLlmRuntimeConfig();
    return {
      handled: true,
      output: `Current model: ${config.activeModel} (provider: ${config.activeProviderId})`,
      data: { model: config.activeModel, provider: config.activeProviderId },
    };
  }

  const nextModel = args.join(" ").trim();
  const config = setActiveModel(nextModel);
  return {
    handled: true,
    output: `Model switched to: ${config.activeModel} (provider: ${config.activeProviderId})`,
    data: { model: config.activeModel, provider: config.activeProviderId },
  };
}

function handleSessionCommand(args: string[]): CommandOutput {
  const sub = (args[0] ?? "show").toLowerCase();

  if (sub === "new") {
    const config = createSession(args.slice(1).join(" ").trim() || undefined);
    const current = config.session.sessions.find(
      (s) => s.id === config.session.currentSessionId,
    );
    return {
      handled: true,
      output: `Created and switched to session: ${current?.id}`,
      data: { session: current },
    };
  }

  if (sub === "use" && args[1]) {
    const config = switchSession(args[1]);
    if (config.session.currentSessionId !== args[1]) {
      return {
        handled: true,
        output: `Session not found: ${args[1]}`,
      };
    }
    return {
      handled: true,
      output: `Switched to session: ${config.session.currentSessionId}`,
      data: { currentSessionId: config.session.currentSessionId },
    };
  }

  if (sub === "list") {
    const config = loadLlmRuntimeConfig();
    const lines = config.session.sessions.map((s) => {
      const active = s.id === config.session.currentSessionId ? "*" : " ";
      return `${active} ${s.id} (${s.name}) messages=${s.messageCount} think=${s.thinkingLevel ?? "low"} fast=${s.fastMode === true} verbose=${s.verboseMode === true}`;
    });
    return {
      handled: true,
      output: lines.length > 0 ? lines.join("\n") : "No sessions",
      data: { sessions: config.session.sessions },
    };
  }

  const config = loadLlmRuntimeConfig();
  const current =
    config.session.sessions.find((s) => s.id === config.session.currentSessionId) ??
    config.session.sessions[0];

  return {
    handled: true,
    output: `Current session: ${current?.id} (${current?.name}) messages=${current?.messageCount ?? 0} think=${current?.thinkingLevel ?? "low"} fast=${current?.fastMode === true} verbose=${current?.verboseMode === true}`,
    data: { session: current },
  };
}

function handleThinkCommand(args: string[]): CommandOutput {
  if (args.length === 0) {
    const config = loadLlmRuntimeConfig();
    const current = config.session.sessions.find(
      (s) => s.id === config.session.currentSessionId,
    );
    return {
      handled: true,
      output: `thinking=${current?.thinkingLevel ?? "low"}`,
      data: { thinking: current?.thinkingLevel ?? "low" },
    };
  }

  const levelRaw = args[0]?.toLowerCase();
  const level =
    levelRaw === "high" || levelRaw === "medium" || levelRaw === "low"
      ? levelRaw
      : null;
  if (!level) {
    return {
      handled: true,
      output: "Usage: /think <low|medium|high>",
    };
  }

  updateCurrentSessionMeta({ thinkingLevel: level });
  return {
    handled: true,
    output: `thinking set to ${level}`,
    data: { thinking: level },
  };
}

function parseOnOff(raw: string | undefined): boolean | null {
  if (!raw) return null;
  const value = raw.toLowerCase();
  if (["on", "true", "1", "yes"].includes(value)) return true;
  if (["off", "false", "0", "no"].includes(value)) return false;
  return null;
}

function handleFastCommand(args: string[]): CommandOutput {
  if (args.length === 0) {
    const config = loadLlmRuntimeConfig();
    const current = config.session.sessions.find(
      (s) => s.id === config.session.currentSessionId,
    );
    return {
      handled: true,
      output: `fast=${current?.fastMode === true}`,
      data: { fast: current?.fastMode === true },
    };
  }

  const flag = parseOnOff(args[0]);
  if (flag === null) {
    return { handled: true, output: "Usage: /fast <on|off>" };
  }

  updateCurrentSessionMeta({ fastMode: flag });
  return { handled: true, output: `fast=${flag}`, data: { fast: flag } };
}

function handleVerboseCommand(args: string[]): CommandOutput {
  if (args.length === 0) {
    const config = loadLlmRuntimeConfig();
    const current = config.session.sessions.find(
      (s) => s.id === config.session.currentSessionId,
    );
    return {
      handled: true,
      output: `verbose=${current?.verboseMode === true}`,
      data: { verbose: current?.verboseMode === true },
    };
  }

  const flag = parseOnOff(args[0]);
  if (flag === null) {
    return { handled: true, output: "Usage: /verbose <on|off>" };
  }

  updateCurrentSessionMeta({ verboseMode: flag });
  return { handled: true, output: `verbose=${flag}`, data: { verbose: flag } };
}

function handleConfigCommand(args: string[]): CommandOutput {
  if (args.length === 0 || args[0] === "show") {
    const config = loadLlmRuntimeConfig();
    return { handled: true, output: formatConfig(config), data: { config } };
  }

  const [sub, ...rest] = args;

  if (sub === "set") {
    const key = (rest[0] ?? "").toLowerCase();
    const value = rest.slice(1).join(" ").trim();

    if (!key || !value) {
      return {
        handled: true,
        output: "Usage: omnistate config set <api_key|base_url|model|provider|intent_max_tokens|decompose_max_tokens|max_input_chars|compact_prompt|voice_low_latency|voice_auto_execute|voice_chunk_ms|voice_providers|siri_enabled|siri_mode|siri_shortcut|siri_endpoint|siri_token> <value>",
      };
    }

    if (key === "api_key" || key === "apikey") {
      const config = updateActiveProviderField("apiKey", value);
      return {
        handled: true,
        output: `Updated api_key for provider ${config.activeProviderId}`,
      };
    }

    if (key === "base_url" || key === "baseurl") {
      const config = updateActiveProviderField("baseURL", value);
      return {
        handled: true,
        output: `Updated base_url for provider ${config.activeProviderId}`,
      };
    }

    if (key === "model") {
      const config = setActiveModel(value);
      return {
        handled: true,
        output: `Model set to ${config.activeModel}`,
      };
    }

    if (key === "provider") {
      const config = setActiveProvider(value);
      if (config.activeProviderId !== value) {
        return { handled: true, output: `Provider not found: ${value}` };
      }
      return {
        handled: true,
        output: `Active provider set to ${config.activeProviderId}`,
      };
    }

    if (key === "intent_max_tokens") {
      const config = setTokenBudgetField("intentMaxTokens", Number(value));
      return { handled: true, output: `intent_max_tokens=${config.tokenBudget.intentMaxTokens}` };
    }

    if (key === "decompose_max_tokens") {
      const config = setTokenBudgetField("decomposeMaxTokens", Number(value));
      return { handled: true, output: `decompose_max_tokens=${config.tokenBudget.decomposeMaxTokens}` };
    }

    if (key === "max_input_chars") {
      const config = setTokenBudgetField("maxInputChars", Number(value));
      return { handled: true, output: `max_input_chars=${config.tokenBudget.maxInputChars}` };
    }

    if (key === "compact_prompt") {
      const boolValue = /^(1|true|yes|on)$/i.test(value);
      const config = setTokenBudgetField("compactPrompt", boolValue);
      return { handled: true, output: `compact_prompt=${config.tokenBudget.compactPrompt}` };
    }

    if (key === "voice_low_latency") {
      const boolValue = /^(1|true|yes|on)$/i.test(value);
      const config = setVoiceField("lowLatency", boolValue);
      return { handled: true, output: `voice_low_latency=${config.voice.lowLatency}` };
    }

    if (key === "voice_auto_execute") {
      const boolValue = /^(1|true|yes|on)$/i.test(value);
      const config = setVoiceField("autoExecuteTranscript", boolValue);
      return {
        handled: true,
        output: `voice_auto_execute=${config.voice.autoExecuteTranscript}`,
      };
    }

    if (key === "voice_chunk_ms") {
      const config = setVoiceField("chunkMs", Number(value));
      return { handled: true, output: `voice_chunk_ms=${config.voice.chunkMs}` };
    }

    if (key === "voice_providers") {
      const chain = value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((x) => ["native", "whisper-local", "whisper-cloud"].includes(x));
      if (chain.length === 0) {
        return {
          handled: true,
          output: "voice_providers expects comma list from native|whisper-local|whisper-cloud",
        };
      }
      const [primary, ...fallback] = chain as Array<
        "native" | "whisper-local" | "whisper-cloud"
      >;
      const config = setVoiceProviderChain(primary, fallback);
      return {
        handled: true,
        output: `voice_providers=${[
          config.voice.primaryProvider,
          ...config.voice.fallbackProviders,
        ].join(",")}`,
      };
    }

    if (key === "siri_enabled") {
      const boolValue = /^(1|true|yes|on)$/i.test(value);
      const config = setSiriField("enabled", boolValue);
      return { handled: true, output: `siri_enabled=${config.voice.siri.enabled}` };
    }

    if (key === "siri_mode") {
      const config = setSiriField("mode", value === "command" ? "command" : "handoff");
      return { handled: true, output: `siri_mode=${config.voice.siri.mode}` };
    }

    if (key === "siri_shortcut") {
      const config = setSiriField("shortcutName", value);
      return { handled: true, output: `siri_shortcut=${config.voice.siri.shortcutName}` };
    }

    if (key === "siri_endpoint") {
      const config = setSiriField("endpoint", value);
      return { handled: true, output: `siri_endpoint=${config.voice.siri.endpoint}` };
    }

    if (key === "siri_token") {
      setSiriField("token", value);
      return { handled: true, output: "siri_token=updated" };
    }

    if (key === "wake_enabled") {
      const boolValue = /^(1|true|yes|on)$/i.test(value);
      const config = setWakeField("enabled", boolValue);
      return { handled: true, output: `wake_enabled=${config.voice.wake.enabled}` };
    }

    if (key === "wake_phrase") {
      const config = setWakeField("phrase", value);
      return { handled: true, output: `wake_phrase=${config.voice.wake.phrase}` };
    }

    if (key === "wake_cooldown_ms") {
      const config = setWakeField("cooldownMs", Number(value));
      return { handled: true, output: `wake_cooldown_ms=${config.voice.wake.cooldownMs}` };
    }

    if (key === "wake_command_window_sec") {
      const config = setWakeField("commandWindowSec", Number(value));
      return {
        handled: true,
        output: `wake_command_window_sec=${config.voice.wake.commandWindowSec}`,
      };
    }

    return {
      handled: true,
      output: `Unsupported config key: ${key}`,
    };
  }

  if (sub === "proxy" && rest[0] === "add") {
    const id = rest[1]?.trim();
    const baseURL = rest[2]?.trim();
    const apiKey = rest[3]?.trim();
    const model = rest.slice(4).join(" ").trim();
    if (!id || !baseURL || !apiKey || !model) {
      return {
        handled: true,
        output:
          "Usage: omnistate config proxy add <id> <base_url> <api_key> <model>",
      };
    }

    upsertProvider({
      id,
      kind: "openai-compatible",
      baseURL,
      apiKey,
      model,
      enabled: true,
    });
    addFallbackProvider(id);
    return {
      handled: true,
      output: `Added proxy provider '${id}' and appended to fallback chain`,
    };
  }

  if (sub === "fallback") {
    const op = rest[0];
    const value = rest.slice(1).join(" ").trim();

    if (op === "set") {
      const providerIds = value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const config = setFallbackOrder(providerIds);
      return {
        handled: true,
        output: `Fallback chain set: ${config.fallbackProviderIds.join(",") || "(none)"}`,
      };
    }

    if (op === "add" && value) {
      const config = addFallbackProvider(value);
      return {
        handled: true,
        output: `Fallback chain: ${config.fallbackProviderIds.join(",") || "(none)"}`,
      };
    }

    if (op === "remove" && value) {
      const config = removeFallbackProvider(value);
      return {
        handled: true,
        output: `Fallback chain: ${config.fallbackProviderIds.join(",") || "(none)"}`,
      };
    }

    return {
      handled: true,
      output: "Usage: omnistate config fallback <set id1,id2|add id|remove id>",
    };
  }

  return {
    handled: true,
    output: "Unsupported config command",
  };
}

export function tryHandleGatewayCommand(
  goal: string,
  ctx: CommandContext,
): CommandOutput | null {
  const trimmed = goal.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.toLowerCase();

  if (first === "/model") {
    return handleModelCommand(parts.slice(1));
  }

  if (first === "/help" || first === "/commands") {
    return { handled: true, output: commandHelpText() };
  }

  if (first === "/whoami") {
    const config = loadLlmRuntimeConfig();
    const provider = config.providers.find((p) => p.id === config.activeProviderId);
    return {
      handled: true,
      output: `provider=${config.activeProviderId} model=${config.activeModel} base=${provider?.baseURL ?? ""}`,
      data: {
        provider: config.activeProviderId,
        model: config.activeModel,
        baseURL: provider?.baseURL,
      },
    };
  }

  if (first === "/status") {
    const uptimeSec = Math.floor(ctx.uptimeMs() / 1000);
    return {
      handled: true,
      output: `clients=${ctx.connectedClients()} history=${ctx.taskHistorySize()} uptime=${uptimeSec}s`,
      data: {
        clients: ctx.connectedClients(),
        history: ctx.taskHistorySize(),
        uptimeMs: ctx.uptimeMs(),
      },
    };
  }

  if (first === "/think") {
    return handleThinkCommand(parts.slice(1));
  }

  if (first === "/fast") {
    return handleFastCommand(parts.slice(1));
  }

  if (first === "/verbose") {
    return handleVerboseCommand(parts.slice(1));
  }

  if (first === "/voice") {
    return handleVoiceCommand(parts.slice(1));
  }

  if (first === "/wake") {
    return handleWakeCommand(parts.slice(1));
  }

  if (first === "/new") {
    return handleSessionCommand(["new", ...parts.slice(1)]);
  }

  if (first === "/clear") {
    const removed = ctx.clearTaskHistory();
    clearSessionData();
    return {
      handled: true,
      output: `Cleared ${removed} gateway task history items and reset current session counters`,
      data: { cleared: removed },
    };
  }

  if (first === "/reset") {
    const removed = ctx.clearTaskHistory();
    clearSessionData();
    return {
      handled: true,
      output: `Session reset completed. Cleared ${removed} history item(s).`,
      data: { cleared: removed },
    };
  }

  if (first === "/session") {
    return handleSessionCommand(parts.slice(1));
  }

  if (first === "/config") {
    return handleConfigCommand(parts.slice(1));
  }

  if (first === "omnistate" && parts[1]?.toLowerCase() === "config") {
    return handleConfigCommand(parts.slice(2));
  }

  if (first === "omnistate" && parts[1]?.toLowerCase() === "model") {
    return handleModelCommand(parts.slice(2));
  }

  if (first === "omnistate" && parts[1]?.toLowerCase() === "status") {
    const uptimeSec = Math.floor(ctx.uptimeMs() / 1000);
    return {
      handled: true,
      output: `clients=${ctx.connectedClients()} history=${ctx.taskHistorySize()} uptime=${uptimeSec}s`,
    };
  }

  if (first === "omnistate" && ["help", "commands"].includes(parts[1]?.toLowerCase() ?? "")) {
    return { handled: true, output: commandHelpText() };
  }

  if (first === "omnistate" && parts[1]?.toLowerCase() === "whoami") {
    const config = loadLlmRuntimeConfig();
    const provider = config.providers.find((p) => p.id === config.activeProviderId);
    return {
      handled: true,
      output: `provider=${config.activeProviderId} model=${config.activeModel} base=${provider?.baseURL ?? ""}`,
    };
  }

  if (first === "omnistate" && parts[1]?.toLowerCase() === "think") {
    return handleThinkCommand(parts.slice(2));
  }

  if (first === "omnistate" && parts[1]?.toLowerCase() === "fast") {
    return handleFastCommand(parts.slice(2));
  }

  if (first === "omnistate" && parts[1]?.toLowerCase() === "verbose") {
    return handleVerboseCommand(parts.slice(2));
  }

  if (first === "omnistate" && parts[1]?.toLowerCase() === "voice") {
    return handleVoiceCommand(parts.slice(2));
  }

  if (first === "omnistate" && parts[1]?.toLowerCase() === "wake") {
    return handleWakeCommand(parts.slice(2));
  }

  if (first === "omnistate" && parts[1]?.toLowerCase() === "new") {
    return handleSessionCommand(["new", ...parts.slice(2)]);
  }

  if (first === "omnistate" && parts[1]?.toLowerCase() === "reset") {
    const removed = ctx.clearTaskHistory();
    clearSessionData();
    return {
      handled: true,
      output: `Session reset completed. Cleared ${removed} history item(s).`,
      data: { cleared: removed },
    };
  }

  if (first === "omnistate" && parts[1]?.toLowerCase() === "clear") {
    const removed = ctx.clearTaskHistory();
    clearSessionData();
    return {
      handled: true,
      output: `Cleared ${removed} gateway task history items and reset current session counters`,
      data: { cleared: removed },
    };
  }

  if (first === "omnistate" && parts[1]?.toLowerCase() === "session") {
    return handleSessionCommand(parts.slice(2));
  }

  return null;
}
