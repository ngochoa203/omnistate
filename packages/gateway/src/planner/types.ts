// ── Types & constants extracted from intent.ts ──────────────────────────────

import type { StateNode, FailureStrategy } from "../types/task.js";

// ============================================================================
// Intent interfaces
// ============================================================================

export interface Intent {
  type: string;
  entities: Record<string, Entity>;
  confidence: number;
  rawText: string;
  normalizedText?: string;
  is_valid?: boolean;
  missing_params?: string[];
  clarification_question?: string;
}

export interface Entity {
  type: "file" | "app" | "url" | "person" | "text" | "command";
  value: string;
  metadata?: Record<string, unknown>;
}

export interface IntentContext {
  source?: "voice" | "text" | "wake" | "siri-handoff";
  os?: unknown;
  transcriptProvider?: string;
  sessionId?: string;
}

export type IntentType = (typeof INTENT_TYPES)[number];

export interface LLMClassificationResult {
  type: IntentType;
  confidence: number;
  entities: Record<string, Entity>;
}

export interface DecomposedStep {
  description: string;
  type: IntentType;
  tool: string;
}

export interface FormField {
  key: string;
  value: string;
}

// ============================================================================
// Intent type constants
// ============================================================================

export const INTENT_TYPES = [
  "ask-clarification",
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
  "peripheral-management",
  "container-management",
  "display-audio",
  "backup-restore",
  "update-management",
  // ─── Domain B Extended: Granular hardware/media ────────────────
  "audio-management",
  "display-management",
  "media.play",
  "media.pause",
  "alarm.set",
  "file.search",
  "thermal-management",
  "disk-management",
  "memory-management",
  "clipboard-management",
  "font-locale-management",
  "printer-management",
  "user-acl-management",
  // ─── Domain C: Self-Healing ────────────────────────────────────
  "health-check",
  "disk-cleanup",
  "maint.clearBrowserCache",
  "maintenance.diskCleanup",
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
  // ─── Domain E: Deep Hardware & Kernel ────────────────────────────────
  "iokit-hardware",
  "kernel-control",
  "wifi-security",
] as const;

// ============================================================================
// LLM helpers
// ============================================================================

export function isLlmRequired(): boolean {
  return process.env.OMNISTATE_REQUIRE_LLM !== "false";
}

export function formatLlmError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err ?? "Unknown LLM error");
  const anyErr = err as {
    status?: number;
    message?: string;
    error?: { message?: string; type?: string; credits_remaining?: number };
  };

  const status = anyErr.status;
  const apiMessage = anyErr.error?.message || anyErr.message || "Unknown LLM API error";

  if (anyErr.message?.startsWith("Invalid JSON from LLM:")) {
    return anyErr.message;
  }

  if (status === 402 || /insufficient_credits/i.test(apiMessage)) {
    return "LLM API error: Insufficient credits. Please top up your account and retry.";
  }
  if (status === 401 || /unauthorized|invalid api key/i.test(apiMessage)) {
    return "LLM API error: Invalid API credentials. Check ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL.";
  }

  return `LLM API error${status ? ` (${status})` : ""}: ${apiMessage}`;
}

export function parseLlmJson<T>(rawInput: string): T {
  const raw = rawInput.trim();

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const unfenced = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(unfenced) as T;
  } catch {
    const firstBrace = unfenced.indexOf("{");
    const lastBrace = unfenced.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(unfenced.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        // continue to next fallback
      }
    }

    const firstBracket = unfenced.indexOf("[");
    const lastBracket = unfenced.lastIndexOf("]");
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      try {
        return JSON.parse(unfenced.slice(firstBracket, lastBracket + 1)) as T;
      } catch {
        // continue to error
      }
    }

    const preview = raw
      .replace(/\*\*([^*]*)\*\*/g, "$1")
      .replace(/[^\x20-\x7EÀ-ɏ]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    throw new Error(`Invalid JSON from LLM: ${preview}`);
  }
}

// ============================================================================
// Classification system prompts
// ============================================================================

export const CLASSIFICATION_SYSTEM_PROMPT = `You are an intent classifier for a computer-automation assistant.
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
- "iokit-hardware"    — read hardware sensors directly via IOKit: thermals, SMC keys, battery health, GPU info, NVRAM, USB/PCI device tree
- "kernel-control"    — deep kernel operations: sysctl params, kext load/unload/list, VM statistics, dtrace/dtruss syscall tracing, Spotlight indexing, launchd/launchctl
- "wifi-security"     — WiFi security & monitoring: packet capture, handshake capture, aircrack-ng, deauth attacks, channel hopping, airport deep scan

Also extract relevant entities of these types: file, app, url, person, text, command.

Respond with ONLY valid JSON matching this schema (no markdown fences, no extra text):
{
  "type": "<intent-type>",
  "confidence": <0.0–1.0>,
  "entities": {
    "<entity-key>": { "type": "<entity-type>", "value": "<value>" }
  }
}`;

export const CLASSIFICATION_SYSTEM_PROMPT_COMPACT = `Classify this automation request to exactly one intent type and return JSON only.
Allowed types: shell-command, app-launch, app-control, file-operation, ui-interaction, system-query, multi-step,
process-management, service-management, package-management, network-control, os-config, power-management,
hardware-control, security-management, container-management, display-audio, backup-restore, update-management,
health-check, disk-cleanup, network-diagnose, security-scan, self-healing, voice-control, script-generation,
automation-macro, workflow-template, file-organization, debug-assist, compliance-check, resource-forecast,
multi-app-orchestration, iokit-hardware, kernel-control, wifi-security.
Schema:
{"type":"<intent-type>","confidence":0.0,"entities":{"k":{"type":"file|app|url|person|text|command","value":"v"}}}`;

// ============================================================================
// Token budget resolution
// ============================================================================

export function resolveEffectiveBudget() {
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

// ============================================================================
// Node factory helpers
// ============================================================================

export const FAILURE: FailureStrategy = { strategy: "escalate" };
export const FAILURE_RETRY: FailureStrategy = { strategy: "retry", maxRetries: 2 };

export function actionNode(
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

export function verifyNode(
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

export function inferStepParamsForTool(
  tool: string,
  description: string,
  type: IntentType,
): Record<string, unknown> {
  const text = description.trim();

  if (tool === "shell.exec") {
    return { command: text || "echo 'No command provided'", stepType: type };
  }

  if (tool === "generic.execute") {
    return { goal: text, stepType: type };
  }

  if (tool === "ui.click" || tool === "ui.find") {
    return { query: text, stepType: type };
  }

  if (tool === "ui.type") {
    return { text: text || "", stepType: type };
  }

  if (tool === "app.launch" || tool === "app.activate" || tool === "app.quit") {
    return { name: text, stepType: type };
  }

  if (tool === "file.read" || tool === "file.write") {
    return { path: text, stepType: type };
  }

  return { stepType: type, query: text };
}

// ============================================================================
// Tool normalization
// ============================================================================

export const LEGACY_TOOL_ALIASES: Record<string, string> = {
  "app.control": "app.script",
  "keyboard.shortcut": "ui.key",
  "keyboard.press": "ui.key",
  "keyboard.type": "ui.type",
  "mouse.click": "ui.click",
  "mouse.move": "ui.move",
  "mouse.scroll": "ui.scroll",
  "screen.screenshot": "screen.capture",
  "screen.shot": "screen.capture",
  "ui.prompt": "generic.execute",
  "system.query": "generic.execute",
};

export const SUPPORTED_DECOMPOSED_TOOLS = new Set<string>([
  "shell.exec",
  "app.launch",
  "app.activate",
  "app.quit",
  "app.script",
  "file.read",
  "file.write",
  "ui.find",
  "ui.move",
  "ui.click",
  "ui.type",
  "ui.key",
  "ui.scroll",
  "screen.capture",
  "system.info",
  "generic.execute",
]);

export function defaultToolForIntentType(type: IntentType): string {
  switch (type) {
    case "shell-command":
      return "shell.exec";
    case "app-launch":
      return "app.launch";
    case "app-control":
      return "app.script";
    case "file-operation":
      return "file.read";
    case "ui-interaction":
      return "ui.click";
    case "system-query":
      return "system.info";
    default:
      return "generic.execute";
  }
}

export function normalizeStepTool(rawTool: string, type: IntentType): string {
  const tool = rawTool.trim();
  const mapped = LEGACY_TOOL_ALIASES[tool] ?? tool;
  if (SUPPORTED_DECOMPOSED_TOOLS.has(mapped)) {
    return mapped;
  }
  return defaultToolForIntentType(type);
}

// Import at bottom to avoid forward-reference issues
import { loadLlmRuntimeConfig } from "../llm/runtime-config.js";
