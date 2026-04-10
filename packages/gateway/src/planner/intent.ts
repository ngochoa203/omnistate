import Anthropic from "@anthropic-ai/sdk";
import type { StatePlan, StateNode, FailureStrategy } from "../types/task.js";

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
] as const;

type IntentType = (typeof INTENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Anthropic client (lazy singleton)
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  if (!_client) {
    const baseURL =
      process.env.ANTHROPIC_BASE_URL ?? "https://chat.trollllm.xyz";
    _client = new Anthropic({ apiKey, baseURL });
  }
  return _client;
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

Also extract relevant entities of these types: file, app, url, person, text, command.

Respond with ONLY valid JSON matching this schema (no markdown fences, no extra text):
{
  "type": "<intent-type>",
  "confidence": <0.0–1.0>,
  "entities": {
    "<entity-key>": { "type": "<entity-type>", "value": "<value>" }
  }
}`;

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
): Promise<LLMClassificationResult | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: CLASSIFICATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    });

    const raw = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

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
  } catch {
    return null;
  }
}

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
    pattern: /\b(click|tap|type|scroll|navigate|fill in|select|drag|focus)\b/i,
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
  const llmResult = await classifyWithLLM(text);
  const result = llmResult ?? classifyWithHeuristics(text);

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
  const client = getClient();
  if (!client) return null;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: DECOMPOSE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    });

    const raw = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

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

// ---------------------------------------------------------------------------
// App control helpers — AppleScript generation for app-level automation
// ---------------------------------------------------------------------------

/** Known browser apps that support tab control via AppleScript. */
const BROWSERS = ["safari", "google chrome", "chrome", "firefox", "brave", "arc", "edge"];

/** Known apps with media control. */
const MEDIA_APPS = ["spotify", "music", "youtube", "vlc", "quicktime"];

/** Extract app name from intent entities or raw text. */
function extractAppName(intent: Intent): string | null {
  // From entities
  const appEntity = Object.values(intent.entities).find(e => e.type === "app");
  if (appEntity?.value) return appEntity.value;

  // From "X on/in Y" pattern
  const match = intent.rawText.match(/\b(?:on|in|from)\s+(\w+)\s*$/i);
  if (match) return match[1];

  // From known app names in text
  const lower = intent.rawText.toLowerCase();
  const knownApps = [...BROWSERS, ...MEDIA_APPS, "finder", "terminal", "vscode", "slack", "discord", "telegram", "notes", "mail", "messages", "preview"];
  for (const app of knownApps) {
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
  };
  return map[name.toLowerCase()] ?? name;
}

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

/**
 * Build an AppleScript for app-control actions.
 * Returns null if no script can be generated (fallback to keyboard shortcuts).
 */
function buildAppControlScript(intent: Intent): string | null {
  const text = intent.rawText.toLowerCase();
  const appRaw = extractAppName(intent);
  const app = appRaw ? normalizeAppName(appRaw) : null;
  const target = extractTarget(intent);
  const isBrowser = app ? BROWSERS.includes(app.toLowerCase()) || BROWSERS.some(b => app.toLowerCase().includes(b)) : false;

  // ── Quit app ──
  if (/\b(quit|exit)\b/i.test(text) && app) {
    return `tell application "${app}" to quit`;
  }

  // ── Close tab (browser) ──
  if (/\b(close|stop)\b/i.test(text) && isBrowser && app) {
    if (target) {
      // Close specific tab by title match
      return `tell application "${app}"\nrepeat with w in windows\nrepeat with t in tabs of w\nif name of t contains "${target}" then close t\nend repeat\nend repeat\nend tell`;
    }
    // Close current tab
    return `tell application "${app}" to close current tab of front window`;
  }

  // ── Close window ──
  if (/\bclose\b/i.test(text) && app) {
    return `tell application "${app}" to close front window`;
  }

  // ── New tab (browser) ──
  if (/\bnew tab\b/i.test(text) && isBrowser && app) {
    if (app === "Safari") {
      return `tell application "Safari" to make new tab in front window`;
    }
    return `tell application "${app}"\nmake new tab at end of tabs of front window\nend tell`;
  }

  // ── Navigate to URL ──
  const urlMatch = intent.rawText.match(/\b(?:go to|navigate to|open)\s+(https?:\/\/\S+|[\w.-]+\.\w{2,}(?:\/\S*)?)/i);
  if (urlMatch && isBrowser && app) {
    let url = urlMatch[1];
    if (!url.startsWith("http")) url = `https://${url}`;
    if (app === "Safari") {
      return `tell application "Safari" to set URL of current tab of front window to "${url}"`;
    }
    return `tell application "${app}" to set URL of active tab of front window to "${url}"`;
  }

  // ── Pause/play media (Spotify, Music) ──
  if (/\b(pause|play|resume)\b/i.test(text)) {
    if (app?.toLowerCase() === "spotify" || app?.toLowerCase() === "music") {
      const action = /\bpause\b/i.test(text) ? "pause" : "play";
      return `tell application "${app}" to ${action}`;
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
    return `tell application "System Events" to set miniaturized of front window of process "${app}" to true`;
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
      const appRaw = extractAppName(intent);
      const app = appRaw ? normalizeAppName(appRaw) : null;
      const text = intent.rawText.toLowerCase();
      const isQuit = /\b(quit|exit)\b/i.test(text);

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
      const script = buildAppControlScript(intent);
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
      break;
    }

    // ── ui-interaction ───────────────────────────────────────────────────────
    case "ui-interaction": {
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
            isRealCommand ? { command: cmd } : { intent },
          ),
        );
      }
      break;
    }

    // ── unknown fallback ─────────────────────────────────────────────────────
    default: {
      nodes.push(
        actionNode(
          "execute",
          intent.rawText,
          "generic.execute",
          "auto",
          { intent },
        ),
      );
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
