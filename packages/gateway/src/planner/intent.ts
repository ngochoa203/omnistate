import type { StatePlan, StateNode, FailureStrategy } from "../types/task.js";
import { requestLlmTextWithFallback } from "../llm/router.js";
import { loadLlmRuntimeConfig } from "../llm/runtime-config.js";

/**
 * Intent classification — convert natural language to structured intent.
 *
 * Uses Claude for LLM-based classification with a regex heuristic fallback
 * when no API key is present or the API call fails.
 */

export interface Intent {
  type: string;
  entities: Record<string, Entity>;
  confidence: number;
  rawText: string;
}

export interface Entity {
  type: "file" | "app" | "url" | "person" | "text" | "command";
  value: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Intent type constants
// ---------------------------------------------------------------------------

const INTENT_TYPES = [
  "shell-command",
  "app-launch",
  "app-control",
  "file-operation",
  "ui-interaction",
  "system-query",
  "multi-step",
  // ─── Domain B: Deep OS ─────────────────────────────────────────
  "process-management",
  "service-management",
  "package-management",
  "network-control",
  "os-config",
  "power-management",
  "hardware-control",
  "security-management",
  "container-management",
  "display-audio",
  "backup-restore",
  "update-management",
  // ─── Domain C: Self-Healing ────────────────────────────────────
  "health-check",
  "disk-cleanup",
  "network-diagnose",
  "security-scan",
  "self-healing",
  // ─── Domain D: Hybrid ─────────────────────────────────────────
  "voice-control",
  "script-generation",
  "automation-macro",
  "workflow-template",
  "file-organization",
  "debug-assist",
  "compliance-check",
  "resource-forecast",
  "multi-app-orchestration",
] as const;

type IntentType = (typeof INTENT_TYPES)[number];

function isLlmRequired(): boolean {
  // Default: required. Tests/dev can explicitly disable with OMINSTATE_REQUIRE_LLM=false.
  return process.env.OMNISTATE_REQUIRE_LLM !== "false";
}

function formatLlmError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err ?? "Unknown LLM error");
  const anyErr = err as {
    status?: number;
    message?: string;
    error?: { message?: string; type?: string; credits_remaining?: number };
  };

  const status = anyErr.status;
  const apiMessage = anyErr.error?.message || anyErr.message || "Unknown LLM API error";

  if (status === 402 || /insufficient_credits/i.test(apiMessage)) {
    return "LLM API error: Insufficient credits. Please top up your account and retry.";
  }
  if (status === 401 || /unauthorized|invalid api key/i.test(apiMessage)) {
    return "LLM API error: Invalid API credentials. Check ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL.";
  }

  return `LLM API error${status ? ` (${status})` : ""}: ${apiMessage}`;
}

// ---------------------------------------------------------------------------
// System prompt for intent classification
// ---------------------------------------------------------------------------

const CLASSIFICATION_SYSTEM_PROMPT = `You are an intent classifier for a computer-automation assistant.
Classify the user's natural-language command into exactly ONE intent type:

- "shell-command"   — run/execute a shell command or script
- "app-launch"      — open, launch, activate, switch to an application
- "app-control"     — control an app: close/stop/pause/mute/refresh/navigate tabs, windows, media
- "file-operation"  — read, write, copy, move, delete, rename files or folders
- "ui-interaction"  — click, type, scroll, navigate, interact with UI elements
- "system-query"    — check system info, list processes, disk/memory/CPU, network
- "multi-step"      — complex task requiring multiple different kinds of actions
- "process-management"  — kill, restart, renice processes, manage process lifecycle
- "service-management"  — start/stop/enable/disable system services and daemons
- "package-management"  — install, remove, upgrade, search packages (brew, apt, npm, etc.)
- "network-control"     — WiFi, firewall, VPN, DNS, proxy, routing, ping, traceroute
- "os-config"           — system preferences, dark mode, DNS, sleep, display, audio settings
- "power-management"    — sleep, shutdown, restart, battery, power schedule, hibernate
- "hardware-control"    — brightness, volume, Bluetooth, peripherals, printers, displays
- "security-management" — certificates, SSH keys, GPG, firewall rules, keychain
- "container-management"— Docker containers, images, VMs (VirtualBox, UTM)
- "display-audio"       — resolution, night shift, audio devices, volume per app
- "backup-restore"      — Time Machine, rsync, backup/restore operations
- "update-management"   — check/install OS updates, patches, software updates
- "health-check"        — system health, thermal, battery health, SMART disk, memory pressure
- "disk-cleanup"        — find large files, clean caches, free disk space, log rotation
- "network-diagnose"    — diagnose network issues, check layers, heal connectivity
- "security-scan"       — scan for suspicious processes/connections, security threats
- "self-healing"        — auto-diagnose, auto-repair, filesystem check, zombie cleanup
- "voice-control"       — voice command processing, text-to-speech
- "script-generation"   — generate bash/python/AppleScript from natural language
- "automation-macro"    — record, replay, create macros from repeated actions
- "workflow-template"   — run, create, manage reusable workflow templates
- "file-organization"   — auto-label, classify, organize, tag files and directories
- "debug-assist"        — analyze errors, crash logs, suggest fixes, debug processes
- "compliance-check"    — check encryption, firewall, Gatekeeper, SIP policies
- "resource-forecast"   — predict disk full, memory exhaustion, resource usage trends
- "multi-app-orchestration" — transfer data between apps, orchestrate multi-app workflows

Also extract relevant entities of these types: file, app, url, person, text, command.

Respond with ONLY valid JSON matching this schema (no markdown fences, no extra text):
{
  "type": "<intent-type>",
  "confidence": <0.0–1.0>,
  "entities": {
    "<entity-key>": { "type": "<entity-type>", "value": "<value>" }
  }
}`;

const CLASSIFICATION_SYSTEM_PROMPT_COMPACT = `Classify this automation request to exactly one intent type and return JSON only.
Allowed types: shell-command, app-launch, app-control, file-operation, ui-interaction, system-query, multi-step,
process-management, service-management, package-management, network-control, os-config, power-management,
hardware-control, security-management, container-management, display-audio, backup-restore, update-management,
health-check, disk-cleanup, network-diagnose, security-scan, self-healing, voice-control, script-generation,
automation-macro, workflow-template, file-organization, debug-assist, compliance-check, resource-forecast,
multi-app-orchestration.
Schema:
{"type":"<intent-type>","confidence":0.0,"entities":{"k":{"type":"file|app|url|person|text|command","value":"v"}}}`;

function resolveEffectiveBudget() {
  const runtime = loadLlmRuntimeConfig();
  const currentSession = runtime.session.sessions.find(
    (s) => s.id === runtime.session.currentSessionId,
  );

  let intentMax = runtime.tokenBudget.intentMaxTokens;
  let decomposeMax = runtime.tokenBudget.decomposeMaxTokens;
  let maxInputChars = runtime.tokenBudget.maxInputChars;
  let compactPrompt = runtime.tokenBudget.compactPrompt;

  if (currentSession?.fastMode) {
    intentMax = Math.max(80, Math.round(intentMax * 0.65));
    decomposeMax = Math.max(120, Math.round(decomposeMax * 0.65));
    maxInputChars = Math.max(500, Math.round(maxInputChars * 0.8));
    compactPrompt = true;
  }

  if (currentSession?.thinkingLevel === "medium") {
    intentMax = Math.max(intentMax, 260);
    decomposeMax = Math.max(decomposeMax, 440);
  }

  if (currentSession?.thinkingLevel === "high") {
    intentMax = Math.max(intentMax, 360);
    decomposeMax = Math.max(decomposeMax, 700);
    maxInputChars = Math.max(maxInputChars, 2400);
  }

  return { intentMax, decomposeMax, maxInputChars, compactPrompt };
}

// ---------------------------------------------------------------------------
// LLM-based classification
// ---------------------------------------------------------------------------

interface LLMClassificationResult {
  type: IntentType;
  confidence: number;
  entities: Record<string, Entity>;
}

async function classifyWithLLM(
  text: string,
  strict: boolean,
): Promise<LLMClassificationResult | null> {
  const budget = resolveEffectiveBudget();
  const userText = text.slice(0, budget.maxInputChars);

  try {
    const response = await requestLlmTextWithFallback({
      system: budget.compactPrompt
        ? CLASSIFICATION_SYSTEM_PROMPT_COMPACT
        : CLASSIFICATION_SYSTEM_PROMPT,
      user: userText,
      maxTokens: budget.intentMax,
    });

    const raw = response.text;

    const parsed = JSON.parse(raw) as {
      type?: string;
      confidence?: number;
      entities?: Record<string, unknown>;
    };

    const type = INTENT_TYPES.includes(parsed.type as IntentType)
      ? (parsed.type as IntentType)
      : "multi-step";

    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.7;

    const entities: Record<string, Entity> = {};
    for (const [key, val] of Object.entries(parsed.entities ?? {})) {
      const v = val as { type?: string; value?: string };
      entities[key] = {
        type: (v.type as Entity["type"]) ?? "text",
        value: v.value ?? "",
      };
    }

    return { type, confidence, entities };
  } catch (err) {
    if (strict) {
      throw new Error(formatLlmError(err));
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Quick intent map for single-word / short-phrase commands
// ---------------------------------------------------------------------------

const QUICK_INTENT_MAP: Record<string, { type: string; confidence: number }> = {
  // Network
  "wifi": { type: "network-control", confidence: 0.95 },
  "network": { type: "network-control", confidence: 0.95 },
  "ip": { type: "network-control", confidence: 0.90 },
  "ping": { type: "network-control", confidence: 0.90 },
  "dns": { type: "network-control", confidence: 0.90 },

  // System info
  "battery": { type: "power-management", confidence: 0.95 },
  "power": { type: "power-management", confidence: 0.90 },
  "cpu": { type: "system-query", confidence: 0.90 },
  "memory": { type: "memory-management", confidence: 0.90 },
  "ram": { type: "memory-management", confidence: 0.90 },
  "disk": { type: "disk-management", confidence: 0.90 },
  "storage": { type: "disk-management", confidence: 0.90 },

  // Processes
  "processes": { type: "process-management", confidence: 0.95 },
  "top": { type: "process-management", confidence: 0.90 },
  "kill": { type: "process-management", confidence: 0.90 },

  // Packages & services
  "packages": { type: "package-management", confidence: 0.95 },
  "brew": { type: "package-management", confidence: 0.95 },
  "services": { type: "service-management", confidence: 0.95 },

  // Health
  "health": { type: "health-check", confidence: 0.95 },
  "thermal": { type: "thermal-management", confidence: 0.95 },
  "temperature": { type: "thermal-management", confidence: 0.90 },

  // Volume/display
  "volume": { type: "audio-management", confidence: 0.95 },
  "mute": { type: "audio-management", confidence: 0.90 },
  "brightness": { type: "display-management", confidence: 0.90 },
  "display": { type: "display-management", confidence: 0.90 },

  // Other
  "clipboard": { type: "clipboard-management", confidence: 0.90 },
  "bluetooth": { type: "peripheral-management", confidence: 0.90 },
  "firewall": { type: "security-management", confidence: 0.90 },
  "vpn": { type: "network-control", confidence: 0.90 },
  "docker": { type: "container-management", confidence: 0.90 },
  "containers": { type: "container-management", confidence: 0.90 },
  "updates": { type: "update-management", confidence: 0.90 },
  "backup": { type: "backup-restore", confidence: 0.90 },
  "fonts": { type: "font-locale-management", confidence: 0.90 },
  "printers": { type: "printer-management", confidence: 0.90 },
  "users": { type: "user-acl-management", confidence: 0.90 },
  "captcha": { type: "ui-interaction", confidence: 0.90 },
  "modal": { type: "ui-interaction", confidence: 0.90 },
  "table": { type: "ui-interaction", confidence: 0.90 },
  "accessibility": { type: "ui-interaction", confidence: 0.90 },
  "language": { type: "ui-interaction", confidence: 0.90 },
};

// Regex patterns for common phrases
const PHRASE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:message|send\s+message|chat\s+with|nh[aắ]n\s*tin|g[iử]i\s*tin\s*nh[aắ]n)\b.*\b(?:zalo|telegram|discord|slack|messages|imessage)\b/i, "app-control"],
  [/\b(?:wifi|wi-fi|wireless)\b/i, "network-control"],
  [/\b(?:battery|charging|power\s*level)\b/i, "power-management"],
  [/\b(?:disk|storage|space|drive)\b.*\b(?:usage|free|full|left|check)\b/i, "disk-management"],
  [/\b(?:process|pid|running|cpu\s*usage)\b/i, "process-management"],
  [/\b(?:health|diagnos|check.*system)\b/i, "health-check"],
  [/\b(?:volume|sound|audio|speaker|mute|unmute)\b/i, "audio-management"],
  [/\b(?:brew|homebrew|package|uninstall|upgrade)\b/i, "package-management"],
  [/\b(?:service|daemon|launchd|systemctl)\b/i, "service-management"],
  [/\b(?:network|internet|connection|bandwidth|ping|traceroute|dns)\b/i, "network-control"],
  [/\b(?:thermal|temperature|fan|cooling|heat)\b/i, "thermal-management"],
  [/\b(?:memory|ram|swap|heap)\b.*\b(?:usage|leak)\b/i, "memory-management"],
  [/\b(?:screenshot|screen\s*capture|screen\s*shot)\b/i, "ui-interaction"],
  [/\b(?:modal|popup|dialog|captcha|table|grid|accessibility|a11y|ui\s*language|screen\s*language|ocr)\b/i, "ui-interaction"],
  [/\b(?:clipboard|pasteboard|pbcopy|pbpaste)\b/i, "clipboard-management"],
  [/\b(?:display|monitor|screen|resolution|brightness)\b/i, "display-management"],
  [/\b(?:bluetooth|bt|pair|unpair)\b/i, "peripheral-management"],
  [/\b(?:docker|container|pod)\b/i, "container-management"],
  [/\b(?:firewall|security|malware)\b/i, "security-management"],
  [/\b(?:update|upgrade|patch)\b/i, "update-management"],
  [/\b(?:backup|time\s*machine|snapshot)\b/i, "backup-restore"],
];

// ---------------------------------------------------------------------------
// Regex heuristic fallback
// ---------------------------------------------------------------------------

const HEURISTIC_RULES: Array<{
  pattern: RegExp;
  type: IntentType;
  entityExtractor?: (m: RegExpMatchArray) => Record<string, Entity>;
}> = [
  {
    // Shell commands: run, execute, bash, npm, git, python, etc.
    pattern:
      /\b(run|execute|bash|sh|npm|yarn|pnpm|git|python|node|make|cargo)\b/i,
    type: "shell-command",
    entityExtractor: (m) => ({
      command: { type: "command", value: m[0] },
    }),
  },
  {
    // Bare shell commands that users might type directly
    pattern:
      /^(ls|cd|cat|echo|grep|find|ps|df|du|top|kill|rm|cp|mv|mkdir|chmod|curl|wget|whoami|hostname|pwd|uptime|date|which|env|printenv|uname|id|ifconfig|ping|traceroute|dig|nslookup)\b/i,
    type: "shell-command",
    entityExtractor: (m) => ({
      command: { type: "command", value: m.input ?? m[0] },
    }),
  },
  {
    // App control: stop, close, quit, pause, mute, refresh, tab management
    // Must come BEFORE app-launch so "close Safari" → app-control, not app-launch
    pattern:
      /\b(stop|close|quit|exit|pause|mute|unmute|resume|refresh|reload|go back|go forward|next tab|prev(?:ious)? tab|close tab|new tab|full ?screen|minimize|maximize|play|volume)\b/i,
    type: "app-control",
    entityExtractor: (m) => {
      const text = m.input ?? "";
      // Try to extract app name from "X on/in Y" or "X Y" patterns
      const appMatch = text.match(/\b(?:on|in|from)\s+(\w+)\s*$/i)
        ?? text.match(/\b(safari|chrome|firefox|slack|vscode|terminal|finder|spotify|music|youtube|discord|telegram|brave)\b/i);
      return {
        action: { type: "command", value: m[1] },
        ...(appMatch ? { app: { type: "app", value: appMatch[1] } } : {}),
      };
    },
  },
  {
    // Messaging actions in chat apps
    pattern:
      /\b(message|send\s+message|chat\s+with|text\s+to|nh[aắ]n\s*tin|g[iử]i\s*tin\s*nh[aắ]n)\b/i,
    type: "app-control",
    entityExtractor: () => ({}),
  },
  {
    pattern:
      /\b(open|launch|start|activate|switch to)\b.{0,40}\b(app|application|browser|terminal|vscode|slack|chrome|safari|finder|xcode)\b/i,
    type: "app-launch",
    entityExtractor: (m) => ({
      app: { type: "app", value: m[0] },
    }),
  },
  {
    // App launch — shorter form "open <AppName>"
    pattern: /\bopen\s+([A-Z][a-zA-Z\s]+)/,
    type: "app-launch",
    entityExtractor: (m) => ({
      app: { type: "app", value: m[1]?.trim() ?? m[0] },
    }),
  },
  {
    // File operations
    pattern:
      /\b(read|write|copy|move|rename|delete|remove|mkdir|create file|touch|cat|ls|list)\b/i,
    type: "file-operation",
    entityExtractor: () => ({}),
  },
  {
    // UI interaction: click, type, scroll, navigate, fill
    pattern: /\b(click|double\s*click|right\s*click|tap|type|scroll|navigate|fill in|select|drag|drop|focus|mouse|cursor|move)\b/i,
    type: "ui-interaction",
    entityExtractor: () => ({}),
  },
  {
    // System queries
    pattern:
      /\b(disk|memory|ram|cpu|process|processes|network|uptime|battery|who is running|system info|ps aux|top|htop|hostname|whoami|who am i|current dir|where am i|what time|date and time)\b/i,
    type: "system-query",
    entityExtractor: () => ({}),
  },
];

function classifyWithHeuristics(text: string): LLMClassificationResult {
  for (const rule of HEURISTIC_RULES) {
    const m = text.match(rule.pattern);
    if (m) {
      return {
        type: rule.type,
        confidence: 0.55,
        entities: rule.entityExtractor ? rule.entityExtractor(m) : {},
      };
    }
  }
  // Default: treat as multi-step with low confidence
  return {
    type: "multi-step",
    confidence: 0.3,
    entities: { text: { type: "text", value: text } },
  };
}

// ---------------------------------------------------------------------------
// Public: classifyIntent
// ---------------------------------------------------------------------------

/**
 * Classify a natural language command into a structured intent.
 *
 * Attempts LLM classification first; falls back to regex heuristics if the
 * API key is absent or the call fails.
 */
export async function classifyIntent(text: string): Promise<Intent> {
  const strictLlm = isLlmRequired();

  // Quick match for single-word commands
  const normalized = text.toLowerCase().trim();
  const quickMatch = QUICK_INTENT_MAP[normalized];
  if (!strictLlm && quickMatch) {
    return {
      type: quickMatch.type,
      entities: {},
      confidence: quickMatch.confidence,
      rawText: text,
    };
  }

  const llmResult = await classifyWithLLM(text, strictLlm);

  if (strictLlm) {
    if (!llmResult) {
      throw new Error("LLM API is required but no classification result was returned.");
    }
    return {
      type: llmResult.type,
      entities: llmResult.entities,
      confidence: llmResult.confidence,
      rawText: text,
    };
  }

  // Prefer heuristic routing before phrase shortcuts to avoid broad regex
  // overriding command and file-operation intents.
  const heuristicResult = classifyWithHeuristics(text);
  const result = llmResult ?? heuristicResult;

  if (!llmResult && result.type === "multi-step") {
    for (const [regex, intentType] of PHRASE_PATTERNS) {
      if (regex.test(normalized)) {
        return { type: intentType, confidence: 0.85, entities: {}, rawText: text };
      }
    }
  }

  return {
    type: result.type,
    entities: result.entities,
    confidence: result.confidence,
    rawText: text,
  };
}

// ---------------------------------------------------------------------------
// Multi-step decomposition via LLM
// ---------------------------------------------------------------------------

const DECOMPOSE_SYSTEM_PROMPT = `You are a task planner for a computer-automation assistant.
Break the user's complex task into an ordered list of concrete sub-steps.
Each step must be classifiable as one of: shell-command, app-launch, app-control, file-operation, ui-interaction, system-query.

Respond with ONLY valid JSON (no markdown, no commentary):
{
  "steps": [
    { "description": "<step text>", "type": "<intent-type>", "tool": "<tool.verb>" }
  ]
}`;

interface DecomposedStep {
  description: string;
  type: IntentType;
  tool: string;
}

async function decomposeMultiStep(
  text: string,
): Promise<DecomposedStep[] | null> {
  const budget = resolveEffectiveBudget();

  try {
    const response = await requestLlmTextWithFallback({
      system: DECOMPOSE_SYSTEM_PROMPT,
      user: text.slice(0, budget.maxInputChars),
      maxTokens: budget.decomposeMax,
    });

    const raw = response.text;

    const parsed = JSON.parse(raw) as { steps?: unknown[] };
    if (!Array.isArray(parsed.steps)) return null;

    return parsed.steps
      .filter(
        (s): s is Record<string, unknown> =>
          typeof s === "object" && s !== null,
      )
      .map((s) => ({
        description: String(s["description"] ?? ""),
        type: INTENT_TYPES.includes(s["type"] as IntentType)
          ? (s["type"] as IntentType)
          : "shell-command",
        tool: String(s["tool"] ?? "generic.execute"),
      }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Node factory helpers
// ---------------------------------------------------------------------------

const FAILURE: FailureStrategy = { strategy: "escalate" };
const FAILURE_RETRY: FailureStrategy = { strategy: "retry", maxRetries: 2 };

function actionNode(
  id: string,
  description: string,
  tool: string,
  layer: StateNode["layer"],
  params: Record<string, unknown> = {},
  deps: string[] = [],
  onSuccess: string | null = null,
): StateNode {
  return {
    id,
    type: "action",
    layer,
    action: { description, tool, params },
    dependencies: deps,
    onSuccess,
    onFailure: FAILURE_RETRY,
    estimatedDurationMs: 5000,
    priority: "normal",
  };
}

function verifyNode(
  id: string,
  description: string,
  expected: string,
  deps: string[],
  onSuccess: string | null = null,
): StateNode {
  return {
    id,
    type: "verify",
    layer: "surface",
    action: { description, tool: "verify.screenshot", params: {} },
    verify: {
      strategy: "screenshot",
      expected,
      timeoutMs: 10000,
    },
    dependencies: deps,
    onSuccess,
    onFailure: FAILURE,
    estimatedDurationMs: 3000,
    priority: "normal",
  };
}

// ---------------------------------------------------------------------------
// NL → Shell command extraction
// ---------------------------------------------------------------------------

const NL_TO_COMMAND: Array<{ pattern: RegExp; command: string | ((m: RegExpMatchArray) => string) }> = [
  { pattern: /\blist (?:all )?files?\b/i, command: "ls -la" },
  { pattern: /\blist (?:all )?director(?:y|ies)\b/i, command: "ls -d */" },
  { pattern: /\bdisk ?(?:space|usage)\b/i, command: "df -h /" },
  { pattern: /\btop (\d+) process/i, command: (m) => `ps -eo pid,pcpu,pmem,comm -r | head -${parseInt(m[1]) + 1}` },
  { pattern: /\bprocess(?:es)?\b.*\bcpu\b/i, command: "ps -eo pid,pcpu,pmem,comm -r | head -11" },
  { pattern: /\bmemory\b.*\busage\b/i, command: "vm_stat" },
  { pattern: /\bwho(?:ami| am i)\b/i, command: "whoami" },
  { pattern: /\bhostname\b/i, command: "hostname" },
  { pattern: /\buptime\b/i, command: "uptime" },
  { pattern: /\bcurrent dir(?:ectory)?\b/i, command: "pwd" },
  { pattern: /\bwhat dir/i, command: "pwd" },
  { pattern: /\bwhere am i\b/i, command: "pwd" },
  { pattern: /\bfree (?:disk )?space\b/i, command: "df -h /" },
  { pattern: /\bnetwork\b.*\binterface/i, command: "ifconfig | head -30" },
  { pattern: /\bip addr/i, command: "ifconfig | grep 'inet ' | grep -v 127.0.0.1" },
  { pattern: /\bdate\b.*\btime\b|\bwhat time\b|\bcurrent date\b/i, command: "date" },
  { pattern: /\bshow (?:all )?env/i, command: "env | head -30" },
];

/**
 * Extract a real shell command from an intent.
 * If the raw text looks like an actual command (starts with known binary), use it directly.
 * Otherwise, try NL→command mapping. Falls back to raw text.
 */
function extractShellCommand(intent: Intent): string {
  const text = intent.rawText.trim();

  // If it already looks like a command (starts with known binary or path)
  if (/^[.\/~]|^(ls|cd|cat|echo|grep|find|ps|df|du|top|kill|rm|cp|mv|mkdir|chmod|curl|wget|git|npm|pnpm|yarn|cargo|python|node|make)\b/.test(text)) {
    return text;
  }

  // Try NL → command mapping
  for (const rule of NL_TO_COMMAND) {
    const match = text.match(rule.pattern);
    if (match) {
      return typeof rule.command === "function" ? rule.command(match) : rule.command;
    }
  }

  // Entity-based: if we have a command entity, use it
  const cmdEntity = Object.values(intent.entities).find(e => e.type === "command");
  if (cmdEntity?.value) return cmdEntity.value;

  return text; // Fallback to raw text
}

function extractCoordinatePairs(text: string): Array<{ x: number; y: number }> {
  const pairs: Array<{ x: number; y: number }> = [];
  const regex = /(\d{1,5})\s*[,x]\s*(\d{1,5})|(\d{1,5})\s+(\d{1,5})/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const xRaw = match[1] ?? match[3];
    const yRaw = match[2] ?? match[4];
    const x = xRaw ? parseInt(xRaw, 10) : NaN;
    const y = yRaw ? parseInt(yRaw, 10) : NaN;
    if (!Number.isNaN(x) && !Number.isNaN(y)) {
      pairs.push({ x, y });
    }
  }

  return pairs;
}

function extractQuotedText(raw: string): string | null {
  const m = raw.match(/["'“”](.+?)["'“”]/);
  if (m?.[1]) return m[1].trim();

  const tail = raw.match(/\b(?:type|enter|input|write)\b\s+(.+)/i);
  if (tail?.[1]) return tail[1].trim();
  return null;
}

// ---------------------------------------------------------------------------
// App control helpers — AppleScript generation for app-level automation
// ---------------------------------------------------------------------------

/** Known browser apps that support tab control via AppleScript. */
const BROWSERS = ["safari", "google chrome", "chrome", "firefox", "brave", "arc", "edge"];

/** Known apps with media control. */
const MEDIA_APPS = ["spotify", "music", "youtube", "vlc", "quicktime"];
const KNOWN_APPS = [
  ...BROWSERS,
  ...MEDIA_APPS,
  "zalo",
  "finder",
  "terminal",
  "vscode",
  "slack",
  "discord",
  "telegram",
  "notes",
  "mail",
  "messages",
  "preview",
];

/** Extract app name from intent entities or raw text. */
function extractAppName(intent: Intent): string | null {
  const raw = intent.rawText;

  // Prefer explicit "on/in/from <app>" context anywhere in the sentence.
  const contextMatch = raw.match(/\b(?:on|in|from)\s+([a-zA-Z][\w\s.-]{1,40}?)(?=\s+(?:and|then|to|for)\b|$)/i);
  if (contextMatch?.[1]) {
    const candidate = contextMatch[1].trim();
    const candidateLower = candidate.toLowerCase();
    for (const app of KNOWN_APPS) {
      if (candidateLower.includes(app)) return app;
    }
    return candidate;
  }

  // From explicit launch verbs: "open/launch/start/activate <app> ..."
  const launchMatch = raw.match(/\b(?:open|launch|start|activate)\s+([a-zA-Z][\w\s.-]{1,30}?)(?=\s+(?:and|then|to|for|with)\b|$)/i);
  if (launchMatch?.[1]) {
    const candidate = launchMatch[1].trim();
    const candidateLower = candidate.toLowerCase();
    for (const app of KNOWN_APPS) {
      if (candidateLower.includes(app)) return app;
    }
  }

  // From entities
  const appEntity = Object.values(intent.entities).find(e => e.type === "app");
  if (appEntity?.value) return appEntity.value;

  // From "X on/in Y" pattern
  const match = intent.rawText.match(/\b(?:on|in|from)\s+(\w+)\s*$/i);
  if (match) return match[1];

  // From known app names in text
  const lower = intent.rawText.toLowerCase();
  for (const app of KNOWN_APPS) {
    if (lower.includes(app)) return app;
  }

  return null;
}

/** Normalize app name for AppleScript tell blocks. */
function normalizeAppName(name: string): string {
  const map: Record<string, string> = {
    "chrome": "Google Chrome",
    "safari": "Safari",
    "firefox": "Firefox",
    "brave": "Brave Browser",
    "arc": "Arc",
    "edge": "Microsoft Edge",
    "spotify": "Spotify",
    "music": "Music",
    "vscode": "Visual Studio Code",
    "terminal": "Terminal",
    "finder": "Finder",
    "slack": "Slack",
    "discord": "Discord",
    "notes": "Notes",
    "mail": "Mail",
    "messages": "Messages",
    "preview": "Preview",
    "zalo": "Zalo",
  };
  return map[name.toLowerCase()] ?? name;
}

function escapeAppleScriptString(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function sanitizeToken(value: string | undefined, pattern: RegExp): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return pattern.test(trimmed) ? trimmed : null;
}

const SAFE_HOST_PATTERN = /^[a-zA-Z0-9.-]{1,253}$/;
const SAFE_NAME_PATTERN = /^[a-zA-Z0-9._:@+-]{1,128}$/;
const SAFE_DOCKER_TARGET_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

/** Extract a search/target term from the intent text (e.g., "youtube" from "close youtube on safari"). */
function extractTarget(intent: Intent): string | null {
  const text = intent.rawText.toLowerCase();

  // "stop/close/pause X on/in Y" → X is the target
  const match = text.match(/\b(?:stop|close|pause|mute|play|resume)\s+(.+?)\s+(?:on|in|from)\s+/i);
  if (match) return match[1].trim();

  // "close X tab" → X is the target
  const tabMatch = text.match(/\b(?:close|stop)\s+(.+?)\s+tab/i);
  if (tabMatch) return tabMatch[1].trim();

  // "close tab X" → X is the target
  const tabMatch2 = text.match(/\bclose\s+tab\s+(.+)/i);
  if (tabMatch2) return tabMatch2[1].trim();

  return null;
}

function isMessagingIntentText(text: string): boolean {
  return /\b(message|send\s+message|chat\s+with|text\s+to|nh[aắ]n\s*tin|g[iử]i\s*tin\s*nh[aắ]n)\b/i.test(text);
}

async function buildMessagingScriptWithLLM(intent: Intent): Promise<string> {
  const runtime = loadLlmRuntimeConfig();

  const appRaw = extractAppName(intent) ?? "Zalo";
  const app = normalizeAppName(appRaw);

  const system = `You are generating safe AppleScript for macOS chat-app automation.
Task: send a message in a desktop chat app.
Rules:
- Output ONLY valid JSON: {"script":"..."}
- Script must activate the app first.
- Do not include shell commands.
- Keep script concise and deterministic.
- Use System Events keystrokes only when necessary.
- Do not add markdown fences.`;

  const user = JSON.stringify({
    app,
    rawText: intent.rawText,
    entities: intent.entities,
  });

  try {
    const response = await requestLlmTextWithFallback({
      system,
      user,
      maxTokens: Math.max(runtime.tokenBudget.intentMaxTokens, 320),
    });

    const raw = response.text.trim();

    const parsed = JSON.parse(raw) as { script?: string };
    const script = parsed.script?.trim();
    if (!script) {
      throw new Error("LLM did not return a valid AppleScript for messaging task");
    }
    return script;
  } catch (err) {
    throw new Error(formatLlmError(err));
  }
}

/**
 * Build an AppleScript for app-control actions.
 * Returns null if no script can be generated (fallback to keyboard shortcuts).
 */
function buildAppControlScript(intent: Intent): string | null {
  const text = intent.rawText.toLowerCase();
  const appRaw = extractAppName(intent);
  const app = appRaw ? normalizeAppName(appRaw) : null;
  const safeApp = app ? escapeAppleScriptString(app) : null;
  const target = extractTarget(intent);
  const safeTarget = target ? escapeAppleScriptString(target) : null;
  const isBrowser = app ? BROWSERS.includes(app.toLowerCase()) || BROWSERS.some(b => app.toLowerCase().includes(b)) : false;

  // ── Browser + YouTube search flow ──
  // Example: "open youtube on safari and play video first in search '...'
  if (isBrowser && /\byoutube\b/i.test(text)) {
    const searchMatch = intent.rawText.match(/\bsearch\s+["'“”]?(.+?)["'“”]?$/i);
    const query = searchMatch?.[1]?.trim();
    const url = query
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      : "https://www.youtube.com";
    const safeUrl = escapeAppleScriptString(url);

    if (app === "Safari") {
      if (/\b(play|first video|video first)\b/i.test(text) && query) {
        const js = escapeAppleScriptString("setTimeout(function(){var l=document.querySelector('ytd-video-renderer a#thumbnail, ytd-video-renderer a#video-title'); if(l){l.click();}}, 1000);");
        return `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${safeUrl}"\ndelay 1.2\ndo JavaScript "${js}" in current tab of front window\nend tell`;
      }
      return `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${safeUrl}"\nend tell`;
    }

    return `tell application "${safeApp}"\nactivate\nif (count of windows) = 0 then make new window\nset URL of active tab of front window to "${safeUrl}"\nend tell`;
  }

  // ── Quit app ──
  if (/\b(quit|exit)\b/i.test(text) && app) {
    return `tell application "${safeApp}" to quit`;
  }

  // ── Close tab (browser) ──
  if (/\b(close|stop)\b/i.test(text) && /\btab\b/i.test(text) && isBrowser && app) {
    if (target) {
      // Close specific tab by title match
      return `tell application "${safeApp}"\nrepeat with w in windows\nrepeat with t in tabs of w\nif name of t contains "${safeTarget}" then close t\nend repeat\nend repeat\nend tell`;
    }
    // Close current tab
    return `tell application "${safeApp}" to close current tab of front window`;
  }

  // ── Close window ──
  if (/\bclose\b/i.test(text) && app) {
    return `tell application "${safeApp}" to close front window`;
  }

  // ── New tab (browser) ──
  if (/\bnew tab\b/i.test(text) && isBrowser && app) {
    if (app === "Safari") {
      return `tell application "Safari" to make new tab in front window`;
    }
    return `tell application "${safeApp}"\nmake new tab at end of tabs of front window\nend tell`;
  }

  // ── Navigate to URL ──
  const urlMatch = intent.rawText.match(/\b(?:go to|navigate to|open)\s+(https?:\/\/\S+|[\w.-]+\.\w{2,}(?:\/\S*)?)/i);
  if (urlMatch && isBrowser && app) {
    let url = urlMatch[1];
    if (!url.startsWith("http")) url = `https://${url}`;
    const safeUrl = escapeAppleScriptString(url);
    if (app === "Safari") {
      return `tell application "Safari" to set URL of current tab of front window to "${safeUrl}"`;
    }
    return `tell application "${safeApp}" to set URL of active tab of front window to "${safeUrl}"`;
  }

  // ── Pause/play media (Spotify, Music) ──
  if (/\b(pause|play|resume)\b/i.test(text)) {
    if (app?.toLowerCase() === "spotify" || app?.toLowerCase() === "music") {
      const action = /\bpause\b/i.test(text) ? "pause" : "play";
      return `tell application "${safeApp}" to ${action}`;
    }
    // For browsers (e.g., "pause youtube"), we can't directly control media via AppleScript
    // Return null to fall through to keyboard shortcut (space bar)
    return null;
  }

  // ── Mute/unmute ──
  if (/\b(mute|unmute)\b/i.test(text)) {
    // System-level mute via AppleScript
    const mute = /\bunmute\b/i.test(text) ? "false" : "true";
    return `set volume output muted ${mute}`;
  }

  // ── Minimize/maximize ──
  if (/\bminimize\b/i.test(text) && app) {
    return `tell application "System Events" to set miniaturized of front window of process "${safeApp}" to true`;
  }

  // ── Volume ──
  if (/\bvolume\s*(up|down)\b/i.test(text)) {
    const dir = /\bup\b/i.test(text) ? "output volume of (get volume settings) + 10" : "output volume of (get volume settings) - 10";
    return `set volume output volume (${dir})`;
  }

  return null;
}

/**
 * Build a keyboard shortcut action for app-control.
 * Returns params for the ui.key orchestrator tool.
 */
function buildKeyboardAction(intent: Intent): Record<string, unknown> | null {
  const text = intent.rawText.toLowerCase();

  // Refresh → Cmd+R
  if (/\b(refresh|reload)\b/i.test(text)) {
    return { key: "r", modifiers: { meta: true } };
  }

  // Go back → Cmd+[
  if (/\bgo back\b/i.test(text)) {
    return { key: "[", modifiers: { meta: true } };
  }

  // Go forward → Cmd+]
  if (/\bgo forward\b/i.test(text)) {
    return { key: "]", modifiers: { meta: true } };
  }

  // Next tab → Ctrl+Tab
  if (/\bnext tab\b/i.test(text)) {
    return { key: "Tab", modifiers: { control: true } };
  }

  // Previous tab → Ctrl+Shift+Tab
  if (/\bprev(?:ious)? tab\b/i.test(text)) {
    return { key: "Tab", modifiers: { control: true, shift: true } };
  }

  // Full screen → Ctrl+Cmd+F
  if (/\bfull ?screen\b/i.test(text)) {
    return { key: "f", modifiers: { meta: true, control: true } };
  }

  // Pause/play media → Space (for video players in browser)
  if (/\b(pause|play|resume)\b/i.test(text)) {
    return { key: "space", modifiers: {} };
  }

  // New tab → Cmd+T
  if (/\bnew tab\b/i.test(text)) {
    return { key: "t", modifiers: { meta: true } };
  }

  // Close tab → Cmd+W
  if (/\bclose tab\b/i.test(text)) {
    return { key: "w", modifiers: { meta: true } };
  }

  return null;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Map Domain B/C/D intent types to specific tool calls
// ---------------------------------------------------------------------------

function mapIntentToTool(intent: Intent): { name: string; params: Record<string, unknown> } | null {
  const text = intent.rawText.toLowerCase();
  const type = intent.type;

  switch (type) {
    // ── Network ─────────────────────────────────────────────────────────
    case "network-control": {
      if (/wifi|wi-fi|wireless|ssid/.test(text)) return { name: "network.wifi", params: {} };
      if (/ping\b/.test(text)) {
        const hostMatch = text.match(/ping\s+(\S+)/);
        const host = sanitizeToken(hostMatch?.[1], SAFE_HOST_PATTERN) ?? "8.8.8.8";
        return { name: "network.ping", params: { host } };
      }
      if (/traceroute/.test(text)) {
        const hostMatch = text.match(/traceroute\s+(\S+)/);
        const host = sanitizeToken(hostMatch?.[1], SAFE_HOST_PATTERN) ?? "8.8.8.8";
        return { name: "network.traceroute", params: { host } };
      }
      if (/vpn/.test(text)) return { name: "network.vpn", params: {} };
      if (/firewall/.test(text)) return { name: "network.firewall", params: {} };
      if (/port/.test(text)) return { name: "network.openPorts", params: {} };
      if (/connection|active/.test(text)) return { name: "network.connections", params: {} };
      if (/route|routing/.test(text)) return { name: "network.routes", params: {} };
      if (/dns/.test(text)) return { name: "os.dns", params: {} };
      if (/interface/.test(text)) return { name: "network.interfaces", params: {} };
      // Default: show wifi status
      return { name: "network.wifi", params: {} };
    }

    // ── Process management ──────────────────────────────────────────────
    case "process-management": {
      if (/kill|terminate|stop/.test(text)) {
        const pidMatch = text.match(/\b(\d{2,})\b/);
        return { name: "shell.exec", params: { command: pidMatch ? `kill ${pidMatch[1]}` : "ps aux --sort=-%cpu | head -10" } };
      }
      if (/top|cpu|sort/.test(text)) {
        const nMatch = text.match(/top\s+(\d+)|(\d+)\s+process/);
        const n = nMatch?.[1] || nMatch?.[2] || "10";
        return { name: "shell.exec", params: { command: `ps aux --sort=-%cpu | head -${parseInt(n) + 1}` } };
      }
      return { name: "shell.exec", params: { command: "ps aux --sort=-%cpu | head -15" } };
    }

    // ── Service management ──────────────────────────────────────────────
    case "service-management": {
      if (/list|show|all/.test(text)) return { name: "service.list", params: {} };
      const nameMatch = text.match(/(?:start|stop|restart|status|enable|disable)\s+(\S+)/);
      const serviceName = sanitizeToken(nameMatch?.[1], SAFE_NAME_PATTERN);
      if (/start\b/.test(text) && serviceName) return { name: "service.start", params: { name: serviceName } };
      if (/stop\b/.test(text) && serviceName) return { name: "service.stop", params: { name: serviceName } };
      if (/restart\b/.test(text) && serviceName) return { name: "service.restart", params: { name: serviceName } };
      if (/status\b/.test(text) && serviceName) return { name: "service.status", params: { name: serviceName } };
      return { name: "service.list", params: {} };
    }

    // ── Package management ──────────────────────────────────────────────
    case "package-management": {
      if (/list|installed|show/.test(text)) return { name: "package.list", params: {} };
      if (/search\b/.test(text)) {
        const q = text.match(/search\s+(\S+)/);
        const query = sanitizeToken(q?.[1], SAFE_NAME_PATTERN) ?? "";
        return { name: "package.search", params: { query } };
      }
      if (/install\b/.test(text)) {
        const pkg = text.match(/install\s+(\S+)/);
        const name = sanitizeToken(pkg?.[1], SAFE_NAME_PATTERN) ?? "";
        return { name: "package.install", params: { name } };
      }
      if (/(?:remove|uninstall)\b/.test(text)) {
        const pkg = text.match(/(?:remove|uninstall)\s+(\S+)/);
        const name = sanitizeToken(pkg?.[1], SAFE_NAME_PATTERN) ?? "";
        return { name: "package.remove", params: { name } };
      }
      if (/upgrade\s+all/.test(text)) return { name: "package.upgradeAll", params: {} };
      if (/upgrade\b/.test(text)) {
        const pkg = text.match(/upgrade\s+(\S+)/);
        const name = sanitizeToken(pkg?.[1], SAFE_NAME_PATTERN) ?? "";
        return { name: "package.upgrade", params: { name } };
      }
      return { name: "package.list", params: {} };
    }

    // ── Power management ────────────────────────────────────────────────
    case "power-management": {
      if (/battery|charge|level/.test(text)) return { name: "health.battery", params: {} };
      if (/sleep\b/.test(text)) return { name: "shell.exec", params: { command: "pmset sleepnow" } };
      if (/shutdown|power off/.test(text)) return { name: "shell.exec", params: { command: "sudo shutdown -h now" } };
      if (/restart|reboot/.test(text)) return { name: "shell.exec", params: { command: "sudo shutdown -r now" } };
      return { name: "health.battery", params: {} };
    }

    // ── Health check ────────────────────────────────────────────────────
    case "health-check": {
      if (/thermal|temperature|heat|fan/.test(text)) return { name: "health.thermal", params: {} };
      if (/battery/.test(text)) return { name: "health.battery", params: {} };
      if (/fsck|filesystem|file\s*system|integrity|chkdsk/.test(text)) {
        return { name: "health.filesystem", params: { volume: "/", autoRepair: false } };
      }
      if (/disk|storage/.test(text)) return { name: "health.filesystem", params: { volume: "/" } };
      if (/network/.test(text)) return { name: "health.networkDiagnose", params: {} };
      if (/cert|certificate|tls|ssl|expiry|expires/.test(text)) {
        const hostMatch = text.match(/(?:for|host|domain)\s+([a-z0-9.-]+\.[a-z]{2,})/i);
        return {
          name: "health.certExpiry",
          params: { host: hostMatch?.[1] || "google.com", port: 443 },
        };
      }
      if (/log|anomal|spike|error pattern/.test(text)) return { name: "health.logAnomalies", params: {} };
      if (/port exhaustion|socket|connection pool/.test(text)) return { name: "health.socketStats", params: {} };
      if (/security/.test(text)) return { name: "health.securityScan", params: {} };
      // Full health: run thermal + battery + disk
      return { name: "health.thermal", params: {} };
    }

    // ── Thermal management ──────────────────────────────────────────────
    case "thermal-management": {
      return { name: "health.thermal", params: {} };
    }

    // ── Disk management ─────────────────────────────────────────────────
    case "disk-management": {
      if (/usage|space|free/.test(text)) return { name: "shell.exec", params: { command: "df -h" } };
      if (/larg|big/.test(text)) return { name: "shell.exec", params: { command: "find / -xdev -type f -size +100M 2>/dev/null | head -20" } };
      return { name: "shell.exec", params: { command: "df -h" } };
    }

    // ── Disk cleanup ────────────────────────────────────────────────────
    case "disk-cleanup": {
      return { name: "health.diskRescue", params: {} };
    }

    // ── Memory management ───────────────────────────────────────────────
    case "memory-management": {
      return { name: "shell.exec", params: { command: "vm_stat && echo '---' && top -l 1 -s 0 | head -12" } };
    }

    // ── Audio management ────────────────────────────────────────────────
    case "audio-management": {
      if (/unmute/.test(text)) return { name: "shell.exec", params: { command: "osascript -e 'set volume without output muted'" } };
      if (/\bmute\b/.test(text)) return { name: "shell.exec", params: { command: "osascript -e 'set volume with output muted'" } };
      if (/volume/.test(text)) {
        const levelMatch = text.match(/(\d+)/);
        if (levelMatch) return { name: "audio.volume", params: { level: parseInt(levelMatch[1]) } };
        return { name: "audio.volume", params: {} };
      }
      if (/device/.test(text)) return { name: "audio.devices", params: {} };
      return { name: "audio.volume", params: {} };
    }

    // ── Display management ──────────────────────────────────────────────
    case "display-management": {
      if (/brightness/.test(text)) {
        const levelMatch = text.match(/(\d+)/);
        if (levelMatch) return { name: "display.brightness", params: { level: parseInt(levelMatch[1]) } };
        return { name: "display.brightness", params: {} };
      }
      if (/resolution/.test(text)) return { name: "display.list", params: {} };
      return { name: "display.list", params: {} };
    }

    // ── Container management ────────────────────────────────────────────
    case "container-management": {
      if (/list|running|ps/.test(text)) return { name: "shell.exec", params: { command: "docker ps" } };
      if (/image/.test(text)) return { name: "shell.exec", params: { command: "docker images" } };
      if (/stop\b/.test(text)) {
        const c = text.match(/stop\s+(\S+)/);
        const container = sanitizeToken(c?.[1], SAFE_DOCKER_TARGET_PATTERN);
        return { name: "shell.exec", params: { command: container ? `docker stop ${container}` : "docker ps" } };
      }
      return { name: "shell.exec", params: { command: "docker ps -a" } };
    }

    // ── Security management ─────────────────────────────────────────────
    case "security-management": {
      if (/firewall/.test(text)) return { name: "network.firewall", params: {} };
      if (/cert/.test(text)) return { name: "shell.exec", params: { command: "security find-certificate -a /Library/Keychains/System.keychain | grep 'labl' | head -20" } };
      return { name: "shell.exec", params: { command: "sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate" } };
    }

    // ── Clipboard management ────────────────────────────────────────────
    case "clipboard-management": {
      return { name: "shell.exec", params: { command: "pbpaste | head -20" } };
    }

    // ── Peripheral management ───────────────────────────────────────────
    case "peripheral-management": {
      if (/bluetooth|bt/.test(text)) return { name: "shell.exec", params: { command: "system_profiler SPBluetoothDataType 2>/dev/null | head -30" } };
      if (/usb/.test(text)) return { name: "shell.exec", params: { command: "system_profiler SPUSBDataType | head -40" } };
      return { name: "shell.exec", params: { command: "system_profiler SPBluetoothDataType SPUSBDataType 2>/dev/null | head -40" } };
    }

    // ── Font / locale management ───────────────────────────────────────
    case "font-locale-management": {
      if (/locale|language|lang/.test(text)) return { name: "shell.exec", params: { command: "defaults read -g AppleLocale 2>/dev/null || echo unknown" } };
      return { name: "shell.exec", params: { command: "system_profiler SPFontsDataType 2>/dev/null | head -40" } };
    }

    // ── Printer management ─────────────────────────────────────────────
    case "printer-management": {
      if (/default/.test(text)) return { name: "shell.exec", params: { command: "lpstat -d" } };
      return { name: "shell.exec", params: { command: "lpstat -p -d" } };
    }

    // ── User ACL management ────────────────────────────────────────────
    case "user-acl-management": {
      if (/list|show|users?/.test(text)) return { name: "shell.exec", params: { command: "dscl . list /Users | head -30" } };
      return { name: "shell.exec", params: { command: "id && groups" } };
    }

    // ── OS config ───────────────────────────────────────────────────────
    case "os-config": {
      if (/dark\s*mode/.test(text)) return { name: "os.darkMode", params: {} };
      if (/dns/.test(text)) return { name: "os.dns", params: {} };
      if (/proxy/.test(text)) return { name: "os.proxy", params: {} };
      return { name: "system.info", params: {} };
    }

    // ── Hardware control ────────────────────────────────────────────────
    case "hardware-control": {
      if (/brightness/.test(text)) return { name: "display.brightness", params: {} };
      if (/volume/.test(text)) return { name: "audio.volume", params: {} };
      if (/bluetooth/.test(text)) return { name: "shell.exec", params: { command: "system_profiler SPBluetoothDataType" } };
      return { name: "system.info", params: {} };
    }

    // ── Network diagnose ────────────────────────────────────────────────
    case "network-diagnose": {
      return { name: "shell.exec", params: { command: "ping -c 3 8.8.8.8 && echo '---' && networksetup -getairportnetwork en0 && echo '---' && curl -s -o /dev/null -w '%{http_code}' https://www.google.com" } };
    }

    // ── Security scan ───────────────────────────────────────────────────
    case "security-scan": {
      return { name: "shell.exec", params: { command: "sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate && echo '---' && security list-keychains" } };
    }

    // ── Self-healing ────────────────────────────────────────────────────
    case "self-healing": {
      if (/network|dns|internet|connect/.test(text)) return { name: "health.networkDiagnose", params: {} };
      if (/fsck|filesystem|file\s*system|integrity|chkdsk/.test(text)) {
        return { name: "health.filesystem", params: { volume: "/", autoRepair: false } };
      }
      if (/cert|certificate|tls|ssl|expiry|expires/.test(text)) {
        const hostMatch = text.match(/(?:for|host|domain)\s+([a-z0-9.-]+\.[a-z]{2,})/i);
        return {
          name: "health.certExpiry",
          params: { host: hostMatch?.[1] || "google.com", port: 443 },
        };
      }
      if (/log|anomal|error pattern/.test(text)) return { name: "health.logAnomalies", params: {} };
      if (/port exhaustion|socket|connection pool/.test(text)) return { name: "health.socketStats", params: {} };
      if (/security|attack|suspicious|malware/.test(text)) return { name: "health.securityScan", params: {} };
      if (/disk|storage|full|cleanup/.test(text)) return { name: "health.diskRescue", params: {} };
      if (/battery/.test(text)) return { name: "health.battery", params: {} };
      return { name: "health.thermal", params: {} };
    }

    // ── Backup/restore ──────────────────────────────────────────────────
    case "backup-restore": {
      if (/status|check/.test(text)) return { name: "shell.exec", params: { command: "tmutil status" } };
      if (/list/.test(text)) return { name: "shell.exec", params: { command: "tmutil listbackups 2>/dev/null | tail -5" } };
      return { name: "shell.exec", params: { command: "tmutil status" } };
    }

    // ── Update management ───────────────────────────────────────────────
    case "update-management": {
      if (/brew/.test(text)) return { name: "shell.exec", params: { command: "brew outdated" } };
      return { name: "shell.exec", params: { command: "softwareupdate -l 2>&1 | head -20" } };
    }

    // ── Display/audio combined ──────────────────────────────────────────
    case "display-audio": {
      if (/audio|volume|sound/.test(text)) return { name: "audio.volume", params: {} };
      return { name: "display.list", params: {} };
    }

    // ── Domain D: Hybrid intent types ───────────────────────────────────
    case "script-generation": {
      const language = /python|py script/.test(text)
        ? "python"
        : /applescript|apple script/.test(text)
          ? "applescript"
          : "bash";
      return {
        name: "hybrid.generateScript",
        params: { description: intent.rawText, language },
      };
    }
    case "voice-control": {
      return { name: "hybrid.speak", params: { text: intent.rawText } };
    }
    case "automation-macro": {
      if (/list|show/.test(text)) return { name: "hybrid.macro.list", params: {} };
      if (/stop/.test(text)) return { name: "hybrid.macro.stop", params: {} };
      if (/\bstart\b|\brecord\b/.test(text)) return { name: "hybrid.macro.start", params: {} };
      return { name: "hybrid.macro.list", params: {} };
    }
    case "workflow-template": {
      return { name: "hybrid.templates", params: {} };
    }
    case "file-organization": {
      return { name: "hybrid.organizeFiles", params: { dirPath: process.cwd() } };
    }
    case "debug-assist": {
      return { name: "hybrid.analyzeError", params: { error: { message: intent.rawText } } };
    }
    case "compliance-check": {
      return { name: "hybrid.compliance", params: {} };
    }
    case "resource-forecast": {
      const metric = /disk|storage/.test(text)
        ? "disk"
        : /memory|ram/.test(text)
          ? "memory"
          : "cpu";
      return { name: "hybrid.forecast", params: { metric, days: 7 } };
    }
    case "multi-app-orchestration": {
      return { name: "hybrid.suggestAction", params: {} };
    }

    default:
      return null;
  }
}

// Public: planFromIntent
// ---------------------------------------------------------------------------

/**
 * Build a StatePlan (DAG of StateNodes) from a classified intent.
 */
export async function planFromIntent(intent: Intent): Promise<StatePlan> {
  const taskId = `task-${Date.now()}`;
  const nodes: StateNode[] = [];

  switch (intent.type as IntentType) {
    // ── shell-command ────────────────────────────────────────────────────────
    case "shell-command": {
      const cmd = extractShellCommand(intent);
      nodes.push(
        actionNode(
          "exec",
          intent.rawText,
          "shell.exec",
          "deep",
          { command: cmd, entities: intent.entities },
        ),
      );
      break;
    }

    // ── app-launch ───────────────────────────────────────────────────────────
    case "app-launch": {
      const appEntity = Object.values(intent.entities).find(
        (e) => e.type === "app",
      );
      const appName = appEntity?.value ?? intent.rawText;

      nodes.push(
        actionNode(
          "launch",
          `Launch ${appName}`,
          "app.launch",
          "deep",
          { name: appName, entities: intent.entities },
          [],
          "verify-launch",
        ),
      );
      nodes.push(
        verifyNode(
          "verify-launch",
          `Verify ${appName} is open and focused`,
          `${appName} window visible and active`,
          ["launch"],
        ),
      );
      break;
    }

    // ── file-operation ───────────────────────────────────────────────────────
    case "file-operation": {
      // Extract actual shell command from entities, or infer from NL
      const cmd = extractShellCommand(intent);
      nodes.push(
        actionNode(
          "file-op",
          intent.rawText,
          "shell.exec",
          "deep",
          { command: cmd, entities: intent.entities },
        ),
      );
      break;
    }

    // ── app-control ─────────────────────────────────────────────────────────
    case "app-control": {
      const branchStartLen = nodes.length;
      const appRaw = extractAppName(intent);
      const app = appRaw ? normalizeAppName(appRaw) : null;
      const text = intent.rawText.toLowerCase();
      const isQuit = /\b(quit|exit)\b/i.test(text);
      const isMessaging = isMessagingIntentText(intent.rawText);

      // Quit is simple — use app.quit directly
      if (isQuit && app) {
        nodes.push(
          actionNode(
            "app-quit",
            `Quit ${app}`,
            "app.quit",
            "deep",
            { name: app },
          ),
        );
        break;
      }

      // For all other app-control actions:
      // Step 1: Activate the target app (bring to front)
      // Step 2: Use keyboard shortcut OR AppleScript
      //
      // Keyboard shortcuts are more reliable because they don't need
      // Automation permission — they just need Accessibility permission.
      // AppleScript needs per-app Automation permission (often blocked).

      if (app) {
        nodes.push(
          actionNode(
            "activate",
            `Activate ${app}`,
            "app.activate",
            "deep",
            { name: app },
            [],
            "action",
          ),
        );
      }

      // Try AppleScript first (more precise), keyboard shortcut as fallback
      const script = isMessaging
        ? await buildMessagingScriptWithLLM(intent)
        : buildAppControlScript(intent);
      const keyAction = buildKeyboardAction(intent);

      if (script) {
        // Use AppleScript with keyboard fallback via onFailure
        nodes.push(
          actionNode(
            "action",
            intent.rawText,
            "app.script",
            "deep",
            { script, entities: intent.entities },
            app ? ["activate"] : [],
          ),
        );
      } else if (keyAction) {
        nodes.push(
          actionNode(
            "action",
            intent.rawText,
            "ui.key",
            "surface",
            keyAction,
            app ? ["activate"] : [],
          ),
        );
      } else {
        // No specific action recognized — try closing the app
        if (app) {
          nodes.push(
            actionNode(
              "action",
              intent.rawText,
              "app.quit",
              "deep",
              { name: app },
              ["activate"],
            ),
          );
        }
      }

      if (nodes.length === branchStartLen) {
        nodes.push(
          actionNode(
            "action",
            intent.rawText,
            "generic.execute",
            "deep",
            { intent: intent.rawText, entities: intent.entities },
          ),
        );
      }
      break;
    }

    // ── ui-interaction ───────────────────────────────────────────────────────
    case "ui-interaction": {
      const raw = intent.rawText;
      const coords = extractCoordinatePairs(intent.rawText);

      if (/\b(modal|popup|dialog)\b/i.test(raw)) {
        if (/\b(dismiss|close|cancel|escape)\b/i.test(raw)) {
          nodes.push(
            actionNode(
              "interact",
              raw,
              "vision.modal.dismiss",
              "surface",
              { action: "dismiss" },
            ),
          );
          break;
        }
        if (/\b(accept|ok|confirm)\b/i.test(raw)) {
          nodes.push(
            actionNode(
              "interact",
              raw,
              "vision.modal.dismiss",
              "surface",
              { action: "accept" },
            ),
          );
          break;
        }
        nodes.push(
          actionNode(
            "interact",
            raw,
            "vision.modal.detect",
            "surface",
            {},
          ),
        );
        break;
      }

      if (/\b(captcha|recaptcha|hcaptcha|verification challenge)\b/i.test(raw)) {
        nodes.push(
          actionNode(
            "interact",
            raw,
            "vision.captcha.detect",
            "surface",
            {},
          ),
        );
        break;
      }

      if (/\b(table|grid|spreadsheet|extract\s+table)\b/i.test(raw)) {
        nodes.push(
          actionNode(
            "interact",
            raw,
            "vision.table.extract",
            "surface",
            coords.length >= 1
              ? {
                  x: coords[0].x,
                  y: coords[0].y,
                  width: coords[1]?.x ?? 600,
                  height: coords[1]?.y ?? 400,
                }
              : {},
          ),
        );
        break;
      }

      if (/\b(accessibility|a11y|wcag|contrast)\b/i.test(raw)) {
        nodes.push(
          actionNode(
            "interact",
            raw,
            "vision.a11y.audit",
            "surface",
            {},
          ),
        );
        break;
      }

      if (/\b(ui\s*language|screen\s*language|detect\s+language|ng[oô]n\s*ng[uữ])\b/i.test(raw)) {
        nodes.push(
          actionNode(
            "interact",
            raw,
            "vision.language.detect",
            "surface",
            {},
          ),
        );
        break;
      }

      if (/\bdrag|drop|k[eé]o\s*th[aả]\b/i.test(raw) && coords.length >= 2) {
        nodes.push(
          actionNode(
            "interact",
            intent.rawText,
            "ui.drag",
            "surface",
            {
              fromX: coords[0].x,
              fromY: coords[0].y,
              toX: coords[1].x,
              toY: coords[1].y,
            },
          ),
        );
        break;
      }

      if (/\bmove|mouse|cursor|chu[oộ]t|con\s*tr[oỏ]\b/i.test(raw) && coords.length >= 1) {
        nodes.push(
          actionNode(
            "interact",
            intent.rawText,
            "ui.move",
            "surface",
            { x: coords[0].x, y: coords[0].y },
          ),
        );
        break;
      }

      if (/\bdouble\s*click|nh[aá]p\s*[đd][oô]i\b/i.test(raw) && coords.length >= 1) {
        nodes.push(
          actionNode(
            "interact",
            intent.rawText,
            "ui.doubleClickAt",
            "surface",
            { x: coords[0].x, y: coords[0].y },
          ),
        );
        break;
      }

      if (/\bright\s*click|chu[oộ]t\s*ph[aả]i|nh[aá]p\s*ph[aả]i\b/i.test(raw) && coords.length >= 1) {
        nodes.push(
          actionNode(
            "interact",
            intent.rawText,
            "ui.clickAt",
            "surface",
            { x: coords[0].x, y: coords[0].y, button: "right" },
          ),
        );
        break;
      }

      if (/\bclick|tap|nh[aá]p\b/i.test(raw) && coords.length >= 1) {
        nodes.push(
          actionNode(
            "interact",
            intent.rawText,
            "ui.clickAt",
            "surface",
            { x: coords[0].x, y: coords[0].y, button: "left" },
          ),
        );
        break;
      }

      if (/\bscroll|cu[oộ]n\b/i.test(raw)) {
        const amountMatch = raw.match(/(\d{1,4})/);
        const amount = amountMatch ? parseInt(amountMatch[1], 10) : 250;
        const isUp = /\bup|l[eê]n\b/i.test(raw);

        nodes.push(
          actionNode(
            "interact",
            intent.rawText,
            "ui.scroll",
            "surface",
            { dx: 0, dy: isUp ? amount : -amount },
          ),
        );
        break;
      }

      if (/\btype|enter|input|write|g[oõ]\s*(ch[uữ])?\b/i.test(raw)) {
        const typed = extractQuotedText(raw) ?? raw;
        nodes.push(
          actionNode(
            "interact",
            intent.rawText,
            "ui.type",
            "surface",
            { text: typed },
          ),
        );
        break;
      }

      nodes.push(
        actionNode(
          "capture",
          "Capture current screen state",
          "screen.capture",
          "surface",
          {},
          [],
          "find-element",
        ),
        actionNode(
          "find-element",
          `Locate target element for: ${intent.rawText}`,
          "ui.find",
          "surface",
          { query: intent.rawText, entities: intent.entities },
          ["capture"],
          "interact",
        ),
        actionNode(
          "interact",
          intent.rawText,
          "ui.click",
          "surface",
          { entities: intent.entities },
          ["find-element"],
          "verify-ui",
        ),
        verifyNode(
          "verify-ui",
          "Verify UI interaction had expected effect",
          "UI state updated as expected",
          ["interact"],
        ),
      );
      break;
    }

    // ── system-query ─────────────────────────────────────────────────────────
    case "system-query": {
      const cmd = extractShellCommand(intent);
      // If we extracted a real command, use shell.exec; otherwise use system.info
      const tool = cmd !== intent.rawText ? "shell.exec" : "system.info";
      nodes.push(
        actionNode(
          "query",
          intent.rawText,
          tool,
          "deep",
          { command: cmd, entities: intent.entities },
        ),
      );
      break;
    }

    // ── multi-step ───────────────────────────────────────────────────────────
    case "multi-step": {
      const steps = await decomposeMultiStep(intent.rawText);

      if (steps && steps.length > 0) {
        const layerFor: Record<IntentType, StateNode["layer"]> = {
          "shell-command": "deep",
          "app-launch": "deep",
          "app-control": "deep",
          "file-operation": "deep",
          "ui-interaction": "surface",
          "system-query": "deep",
          "multi-step": "auto",
          // Domain B
          "process-management": "deep",
          "service-management": "deep",
          "package-management": "deep",
          "network-control": "deep",
          "os-config": "deep",
          "power-management": "deep",
          "hardware-control": "deep",
          "security-management": "deep",
          "container-management": "deep",
          "display-audio": "deep",
          "backup-restore": "deep",
          "update-management": "deep",
          // Domain C
          "health-check": "deep",
          "disk-cleanup": "deep",
          "network-diagnose": "deep",
          "security-scan": "deep",
          "self-healing": "deep",
          // Domain D
          "voice-control": "surface",
          "script-generation": "deep",
          "automation-macro": "surface",
          "workflow-template": "deep",
          "file-organization": "deep",
          "debug-assist": "deep",
          "compliance-check": "deep",
          "resource-forecast": "deep",
          "multi-app-orchestration": "auto",
        };

        let prevId: string | null = null;
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const nodeId = `step-${i}`;
          const nextId = i < steps.length - 1 ? `step-${i + 1}` : null;
          nodes.push(
            actionNode(
              nodeId,
              step.description,
              step.tool,
              layerFor[step.type],
              { stepType: step.type },
              prevId ? [prevId] : [],
              nextId,
            ),
          );
          prevId = nodeId;
        }
      } else {
        // Fallback: try to extract a shell command; use generic.execute as last resort
        const cmd = extractShellCommand(intent);
        const isRealCommand = cmd !== intent.rawText;
        nodes.push(
          actionNode(
            "execute",
            intent.rawText,
            isRealCommand ? "shell.exec" : "generic.execute",
            "deep",
            isRealCommand ? { command: cmd } : { goal: intent.rawText },
          ),
        );
      }
      break;
    }

    // ── unknown fallback ─────────────────────────────────────────────────────
    default: {
      // ── Domain B/C/D intent mapping ──────────────────────────────────────
      const tool = mapIntentToTool(intent);
      if (tool) {
        nodes.push(
          actionNode(
            "execute",
            intent.rawText,
            tool.name,
            "deep",
            { ...tool.params, goal: intent.rawText, entities: intent.entities },
          ),
        );
      } else {
        // True fallback
        const cmd = extractShellCommand(intent);
        const isRealCommand = cmd !== intent.rawText;
        nodes.push(
          actionNode(
            "execute",
            intent.rawText,
            isRealCommand ? "shell.exec" : "generic.execute",
            isRealCommand ? "deep" : "auto",
            isRealCommand ? { command: cmd } : { goal: intent.rawText },
          ),
        );
      }
    }
  }

  const totalMs = nodes.reduce((sum, n) => sum + n.estimatedDurationMs, 0);

  return {
    taskId,
    goal: intent.rawText,
    estimatedDuration: `${Math.round(totalMs / 1000)}s`,
    nodes,
  };
}
