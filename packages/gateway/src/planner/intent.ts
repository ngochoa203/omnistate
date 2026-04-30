import type { StatePlan, StateNode, FailureStrategy } from "../types/task.js";
import type { OSContextPayload } from "../context/os-context.js";
import { summarizeForIntent } from "../context/os-context.js";
import { requestLlmTextWithFallback } from "../llm/router.js";
import { loadLlmRuntimeConfig } from "../llm/runtime-config.js";
import { EpisodicStore } from "../memory/episodic-store.js";
import { getEmbeddingProvider } from "../memory/embeddings.js";
import { getDb } from "../db/database.js";
import { logger } from "../utils/logger.js";
import { KnowledgeGraph } from "../memory/knowledge-graph.js";

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

export interface IntentContext {
  source?: "voice" | "text" | "wake" | "siri-handoff";
  os?: OSContextPayload;
  transcriptProvider?: string;
  sessionId?: string;
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
  "peripheral-management",
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

  // "Invalid JSON from LLM" is not an API/network error — propagate it as-is
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

function parseLlmJson<T>(rawInput: string): T {
  const raw = rawInput.trim();

  // Common model output: fenced JSON block (handles both inline and multiline)
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const unfenced = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(unfenced) as T;
  } catch {
    // Fallback 1: extract first JSON object {...} from mixed text
    const firstBrace = unfenced.indexOf("{");
    const lastBrace = unfenced.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(unfenced.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        // continue to next fallback
      }
    }

    // Fallback 2: extract first JSON array [...] from mixed text
    const firstBracket = unfenced.indexOf("[");
    const lastBracket = unfenced.lastIndexOf("]");
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      try {
        return JSON.parse(unfenced.slice(firstBracket, lastBracket + 1)) as T;
      } catch {
        // continue to error
      }
    }

    // Sanitize preview: strip markdown bold, emojis, newlines for cleaner error
    const preview = raw
      .replace(/\*\*([^*]*)\*\*/g, "$1")
      .replace(/[^\x20-\x7EÀ-ɏ]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    throw new Error(`Invalid JSON from LLM: ${preview}`);
  }
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

    const parsed = parseLlmJson<{
      type?: string;
      confidence?: number;
      entities?: Record<string, unknown>;
    }>(raw);

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

  // Developer tools
  "ssh": { type: "shell-command", confidence: 0.95 },
  "pip": { type: "package-management", confidence: 0.95 },
  "pip3": { type: "package-management", confidence: 0.95 },
  "git commit": { type: "shell-command", confidence: 0.95 },
  "git push": { type: "shell-command", confidence: 0.95 },
  "git pull": { type: "shell-command", confidence: 0.95 },
  "curl": { type: "shell-command", confidence: 0.90 },

  // Utilities
  "weather": { type: "system-query", confidence: 0.95 },
  "thời tiết": { type: "system-query", confidence: 0.95 },
  "tỷ giá": { type: "system-query", confidence: 0.95 },
  "exchange rate": { type: "system-query", confidence: 0.95 },
  "bản đồ": { type: "ui-interaction", confidence: 0.90 },
  "maps": { type: "ui-interaction", confidence: 0.90 },
  "stopwatch": { type: "app-control", confidence: 0.90 },
  "bấm giờ": { type: "app-control", confidence: 0.90 },
  "báo thức": { type: "app-control", confidence: 0.90 },
  "alarm": { type: "app-control", confidence: 0.90 },
  "wallpaper": { type: "os-config", confidence: 0.90 },
  "hình nền": { type: "os-config", confidence: 0.90 },
  "airdrop": { type: "os-config", confidence: 0.90 },
  "eject": { type: "file-operation", confidence: 0.90 },
  'zalo': { type: 'app-launch', confidence: 0.95 },
  'telegram': { type: 'app-launch', confidence: 0.95 },
  'slack': { type: 'app-launch', confidence: 0.95 },
  'zoom': { type: 'app-launch', confidence: 0.95 },
  'figma': { type: 'app-launch', confidence: 0.95 },
  'notion': { type: 'app-launch', confidence: 0.95 },
  'spotify': { type: 'app-launch', confidence: 0.95 },
  'discord': { type: 'app-launch', confidence: 0.95 },
  'whatsapp': { type: 'app-launch', confidence: 0.95 },
  'messenger': { type: 'app-launch', confidence: 0.95 },
};

// Regex patterns for common phrases
const PHRASE_PATTERNS: Array<[RegExp, string]> = [
  // ── Vietnamese browser + video/navigation commands ──
  [/\b(?:mở|xem|tìm|phát)\s+(?:video|bài\s*hát|bài|clip)\s+(?:đầu\s*tiên|mới\s*nhất|đầu)\b/i, "app-control"],
  [/\b(?:video\s*đầu\s*tiên|first\s*video|kết\s*quả\s*đầu\s*tiên|first\s*result)\b/i, "app-control"],
  [/\b(?:truy\s*cập|vào\s*trang|vào\s*web|mở\s*trang)\s+(?:youtube|google|facebook|tiktok|instagram|[\w-]+\.(?:com|vn|org|net))\b/i, "app-control"],
  [/\b(?:mở|open)\s+.+\s+(?:trên|bằng|qua|trong)\s+(?:safari|chrome|firefox|brave|arc|edge|trình\s*duyệt)\b/i, "app-control"],
  [/\b(?:mở|open|launch).+(?:safari|chrome|firefox).+(?:youtube|google|trang|web)\b/i, "multi-step"],
  // ── Message/chat ──
  [/\b(?:message|send\s+message|chat\s+with|nh[aắ]n\s*tin|g[iử]i\s*tin\s*nh[aắ]n)\b.*\b(?:zalo|telegram|discord|slack|messages|imessage)\b/i, "app-control"],
  [/\b(?:send\s+email|compose\s+email|write\s+email|open\s+mail|mail\s+app|g[iử]i\s*email|thư\s*điện\s*tử|(?:email|mail)\b(?!\s*:))\b/i, "app-control"],
  [/\b(?:calendar|schedule|meeting|appointment|event|lịch|lịch\s*hẹn|cuộc\s*họp)\b/i, "app-control"],
  [/\b(?:reminder|nhắc\s*nhở|alarm|báo\s*thức|timer|hẹn\s*giờ|đếm\s*ngược)\b/i, "app-control"],
  [/\b(?:split|tile|snap|arrange)\b.*\b(?:window|windows)\b/i, "app-control"],
  [/\b(?:data\s*entry|nh[ậa]p\s*li[ệe]u|đi[ềe]n\s*d[ữu]\s*li[ệe]u)\b/i, "multi-step"],
  [/\b(?:fill|autofill|form|đi[ềe]n\s*form|bi[ểe]u\s*m[ẫa]u)\b/i, "ui-interaction"],
  [/\b(?:password|vault|bitwarden|1password|autofill\s+password|điền\s+mật\s+khẩu)\b/i, "security-management"],
  [/\b(?:encrypt|decrypt|lock\s*folder|unlock\s*folder|secure\s*delete|secure\s*shred|shred\s*file|mã\s*hóa|giải\s*mã|khóa\s*thư\s*mục|xóa\s*an\s*toàn)\b/i, "security-management"],
  [/\b(?:webcam|camera|microphone|mic)\b.*\b(?:lock|unlock|block|allow|permission|quyền)\b/i, "security-management"],
  [/\b(?:wifi|wi-fi|wireless)\b/i, "network-control"],
  [/\b(?:battery|charging|power\s*level)\b/i, "power-management"],
  [/\b(?:disk|storage|space|drive)\b.*\b(?:usage|free|full|left|check)\b/i, "disk-management"],
  [/\b(?:process|pid|running|cpu\s*usage)\b/i, "process-management"],
  [/\b(?:health|diagnos|check.*system)\b/i, "health-check"],
  [/\b(?:volume|sound|audio|speaker|mute|unmute)\b/i, "audio-management"],
  [/\b(?:brew|homebrew|package|uninstall|upgrade)\b/i, "package-management"],
  [/\b(?:service|daemon|launchd|systemctl)\b/i, "service-management"],
  [/\b(?:network|internet|connection|bandwidth|ping|traceroute|dns)\b/i, "network-control"],
  [/\b(?:do\s*not\s*disturb|dnd|focus\s*mode|focus\s*status|turn\s*on\s*focus|turn\s*off\s*focus|bật\s*chế\s*độ\s*tập\s*trung|tắt\s*chế\s*độ\s*tập\s*trung)\b/i, "os-config"],
  [/\b(?:thermal|temperature|fan|cooling|heat)\b/i, "thermal-management"],
  [/\b(?:memory|ram|swap|heap)\b.*\b(?:usage|leak)\b/i, "memory-management"],
  [/\b(?:screenshot|screen\s*capture|screen\s*shot)\b/i, "ui-interaction"],
  [/\b(?:translate\s*(?:screen|this|selection|text)|dịch\s*(?:màn\s*hình|đoạn\s*này|văn\s*bản|nội\s*dung))\b/i, "ui-interaction"],
  [/\b(?:modal|popup|dialog|captcha|table|grid|accessibility|a11y|ui\s*language|screen\s*language|ocr)\b/i, "ui-interaction"],
  [/\b(?:clipboard|pasteboard|pbcopy|pbpaste)\b/i, "clipboard-management"],
  [/\b(?:display|monitor|screen|resolution|brightness)\b/i, "display-management"],
  [/\b(?:bluetooth|bt|pair|unpair)\b/i, "peripheral-management"],
  [/\b(?:docker|container|pod)\b/i, "container-management"],
  [/\b(?:firewall|security|malware)\b/i, "security-management"],
  [/\b(?:install|uninstall|remove\s+app|startup\s*apps?|login\s*items?|brew\s+install|brew\s+uninstall|software\s*update)\b/i, "update-management"],
  [/\b(?:update|upgrade|patch)\b/i, "update-management"],
  [/\b(?:backup|time\s*machine|snapshot)\b/i, "backup-restore"],
  [/\b(?:repair\s*(?:my\s*)?(?:network|internet)|fix\s*(?:network|internet)|flush\s*dns|renew\s*dhcp|optimi[sz]e\s*(?:system\s*)?performance|memory\s*leak|high\s*cpu|high\s*memory)\b/i, "self-healing"],
  [/\b(?:defrag|trimforce|trim\s*ssd|ssd\s*trim|disk\s*optimization|optimi[sz]e\s*disk|lên\s*lịch\s*tối\s*ưu\s*đĩa)\b/i, "disk-cleanup"],
  [/\b(?:summari[sz]e\s*(?:my\s*)?(?:context|workspace|work)|context\s*summary|t[oó]m\s*tắt\s*(?:ng[ữu]\s*cảnh|màn\s*hình|công\s*việc))\b/i, "system-query"],
  [/\b(?:zip|unzip|compress|extract\s+archive|giải\s*nén|nén\s*file)\b/i, "file-operation"],
  [/\b(?:git\s+status|git\s+add|git\s+commit|git\s+push|git\s+pull|checkout\s+branch|create\s+branch|merge\s+branch|rebase\s+branch|stash\b|commit\s+changes?)\b/i, "shell-command"],
  [/\b(?:organize\s*(?:desktop|workspace|downloads|files)|cleanup\s*(?:desktop|workspace)|sắp\s*xếp\s*(?:màn\s*hình|desktop|thư\s*mục|workspace)|dọn\s*dẹp\s*(?:desktop|workspace))\b/i, "file-organization"],
  [/\b(?:analy[sz]e\s*(?:error|logs?)|summari[sz]e\s*(?:error|logs?)|debug\s*log|crash\s*log|stack\s*trace|log\s*error\s*analysis|phân\s*tích\s*log\s*lỗi|t[oó]m\s*tắt\s*lỗi)\b/i, "debug-assist"],

  // Group 2: Zalo/Telegram/Chat extras
  [/\b(?:gửi\s*file|send\s*file|đính\s*kèm|attach\s*file)\b.*\b(?:zalo|telegram|slack|messages)\b/i, "app-control"],
  [/\b(?:zalo|telegram|messages)\b.*\b(?:gửi\s*file|send\s*file|attach)\b/i, "app-control"],
  [/\b(?:nhắn|nhắn\s*tin|gửi\s*tin\s*nhắn|gửi\s*message)\b/i, "app-control"],
  [/\b(?:sticker|nhãn\s*dán)\b.*\b(?:gửi|send)\b/i, "app-control"],
  [/\b(?:tự\s*động\s*trả\s*lời|auto\s*reply|trả\s*lời\s*tự\s*động)\b/i, "app-control"],
  [/\b(?:tìm\s*tin\s*nhắn|search\s*message|find\s*message)\b.*\b(?:zalo|telegram)\b/i, "app-control"],
  [/\b(?:tải\s*(?:tất\s*cả\s*)?ảnh|download\s*(?:all\s*)?images?|lưu\s*(?:tất\s*cả\s*)?hình)\b.*\b(?:zalo|chat|cuộc\s*trò\s*chuyện)\b/i, "app-control"],
  [/\b(?:tạo\s*nhóm|create\s*group|new\s*group)\b.*\b(?:zalo|telegram|slack)\b/i, "app-control"],
  [/\b(?:chụp\s*màn\s*hình|screenshot)\b.*\b(?:dán|paste)\b.*\b(?:zalo|chat|telegram)\b/i, "app-control"],

  // Group 3: Finder/System extras
  [/\b(?:rename|đổi\s*tên)\b.*\b(?:\w+\.\w{2,4})\b/i, "file-operation"],
  [/\b(?:hiển\s*thị|show)\b.*\b(?:file\s*ẩn|hidden\s*file|ẩn)\b/i, "os-config"],
  [/\b(?:eject|đẩy)\b.*\b(?:usb|ổ\s*cứng|disk|drive)\b/i, "file-operation"],
  [/\b(?:wallpaper|hình\s*nền|desktop\s*background|ảnh\s*nền)\b/i, "os-config"],
  [/\b(?:airdrop)\b/i, "os-config"],
  [/\b(?:dark\s*mode|chế\s*độ\s*tối|light\s*mode|chế\s*độ\s*sáng)\b/i, "os-config"],
  [/\b(?:night\s*shift|giảm\s*ánh\s*sáng\s*xanh)\b/i, "os-config"],
  [/\b(?:kiểm\s*tra\s*cập\s*nhật|check\s*updates?|software\s*update|cập\s*nhật\s*macos)\b/i, "update-management"],

  // Group 4: Developer tools extras
  [/\b(?:docker)\b.*\b(?:log|logs)\b/i, "container-management"],
  [/\b(?:curl|test\s*endpoint|gọi\s*api)\b.*\b(?:proxy)\b/i, "shell-command"],
  [/\b(?:ssh)\b.*\b(?:server|admin|user|vào)\b/i, "shell-command"],
  [/\b(?:pip3?)\b.*\b(?:install|cài)\b/i, "package-management"],
  [/\b(?:cài\s*(?:đặt\s*)?thư\s*viện|install\s*(?:python\s*)?package)\b/i, "package-management"],
  [/\b(?:kill|tắt|free)\b.*\b(?:port|cổng|localhost)\b/i, "shell-command"],
  [/\b(?:tìm|find|search)\b.*\b(?:TODO|FIXME|HACK)\b/i, "shell-command"],

  // Group 5: Utilities extras
  [/\b(?:thời\s*tiết|weather)\b/i, "system-query"],
  [/\b(?:tỷ\s*giá|exchange\s*rate)\b/i, "system-query"],
  [/\b(?:bản\s*đồ|maps?|chỉ\s*đường|directions?|tìm\s*đường)\b/i, "ui-interaction"],
  [/\b(?:bấm\s*giờ|stopwatch|đồng\s*hồ\s*bấm\s*giờ)\b/i, "app-control"],
  [/\b(?:đặt\s*báo\s*thức|set\s*alarm)\b/i, "app-control"],
  [/\b(?:xóa\s*(?:tất\s*cả\s*)?báo\s*thức|delete\s*(?:all\s*)?alarms?)\b/i, "app-control"],
  [/\b(?:checklist|danh\s*sách\s*(?:mua|việc)|shopping\s*list)\b/i, "app-control"],
  [/\b(?:dịch|translate)\b.*\b(?:clipboard|bộ\s*nhớ\s*tạm)\b/i, "ui-interaction"],

  // Group 6: Media extras
  [/\b(?:quay|record)\b.*\b(?:màn\s*hình|screen|desktop)\b/i, "ui-interaction"],
  [/\b(?:chụp|screenshot)\b.*\b(?:vùng|region|area)\b.*\b(?:clipboard)\b/i, "ui-interaction"],
  [/\b(?:crop|cắt)\b.*\b(?:ảnh|image|photo)\b/i, "app-control"],
  [/\b(?:mở\s*thư\s*mục|open\s*folder)\b.*\b(?:video|photo|ảnh|hình)\b/i, "file-operation"],

  // Group 7: Complex tasks
  [/\b(?:csv|data\.csv)\b.*\b(?:cột|column|email)\b/i, "file-operation"],
  [/\b(?:tự\s*động|auto|automatically)\b.*\b(?:chuyển|move)\b.*\b(?:downloads?|tải\s*về)\b/i, "multi-step"],
  [/\b(?:mở\s*tất\s*cả|open\s*all)\b.*\b(?:ứng\s*dụng|apps?)\b/i, "multi-step"],
  [/\b(?:so\s*sánh|compare|diff)\b.*\b(?:file|tập\s*tin)\b/i, "file-operation"],
  [/\b(?:file\s*nặng\s*hơn|larger?\s*than|nặng\s*hơn|>\s*1\s*GB|greater\s*than\s*1\s*GB)\b/i, "disk-cleanup"],
  [/\b(?:đóng\s*tất\s*cả|close\s*all)\b.*\b(?:trừ|except)\b/i, "app-control"],
  [/\b(?:pin|battery)\b.*\b(?:dưới|below|under)\s*\d+%/i, "power-management"],
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
    pattern: /\b(send\s+email|compose\s+email|write\s+email|open\s+mail|mail\s+app|g[iử]i\s*email|thư\s*điện\s*tử|(?:email|mail)\b(?!\s*:))\b/i,
    type: "app-control",
    entityExtractor: () => ({ app: { type: "app", value: "Mail" } }),
  },
  {
    pattern: /\b(calendar|schedule|meeting|appointment|event|lịch|lịch\s*hẹn|cuộc\s*họp)\b/i,
    type: "app-control",
    entityExtractor: () => ({ app: { type: "app", value: "Calendar" } }),
  },
  {
    pattern: /\b(reminder|nhắc\s*nhở|alarm|báo\s*thức|timer|hẹn\s*giờ|đếm\s*ngược)\b/i,
    type: "app-control",
    entityExtractor: () => ({ app: { type: "app", value: "Reminders" } }),
  },
  {
    pattern: /\b(split|tile|snap|arrange)\b.{0,30}\b(window|windows)\b/i,
    type: "app-control",
    entityExtractor: () => ({}),
  },
  {
    pattern: /\b(data\s*entry|nh[ậa]p\s*li[ệe]u|đi[ềe]n\s*d[ữu]\s*li[ệe]u)\b/i,
    type: "multi-step",
    entityExtractor: () => ({}),
  },
  {
    pattern: /\b(fill|autofill|form|đi[ềe]n\s*form|bi[ểe]u\s*m[ẫa]u)\b/i,
    type: "ui-interaction",
    entityExtractor: () => ({}),
  },
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
    pattern: /\b(commit\s+changes?|push\s+changes?|pull\s+latest|create\s+branch|checkout\s+branch|merge\s+branch|rebase\s+branch|git\s+status|stash\b)\b/i,
    type: "shell-command",
    entityExtractor: () => ({
      command: { type: "command", value: "git" },
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
    // Dev scaffolding request should route to shell-command.
    pattern: /\bcreate\b.*\b(project|app)\b.*\b(vite|react)\b/i,
    type: "shell-command",
    entityExtractor: () => ({
      command: { type: "command", value: "scaffold-project" },
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
      /\b(message|send\s+message|chat\s+with|nh[aắ]n\s*tin|g[iử]i\s*tin\s*nh[aắ]n)\b/i,
    type: "app-control",
    entityExtractor: () => ({}),
  },
  {
    // Browser media intent: "open <query> on youtube" should route to browser control
    pattern: /\bopen\s+(.+?)\s+on\s+youtube\b/i,
    type: "app-control",
    entityExtractor: (m) => ({
      action: { type: "command", value: "open" },
      app: { type: "app", value: "safari" },
      query: { type: "text", value: m[1]?.trim() ?? "" },
    }),
  },
  {
    pattern: /\b(password|vault|bitwarden|1password|autofill\s+password|điền\s+mật\s+khẩu)\b/i,
    type: "security-management",
    entityExtractor: () => ({}),
  },
  {
    pattern: /\b(webcam|camera|microphone|mic)\b.{0,40}\b(lock|unlock|block|allow|permission|quyền)\b/i,
    type: "security-management",
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
    // App launch — "open <AppName>" (case-insensitive, allows lowercase app names like "zalo")
    pattern: /\bopen\s+([a-zA-Z][a-zA-Z\s]{1,30}?)(?:\s*$|\s+(?:app|application)\b)/i,
    type: "app-launch",
    entityExtractor: (m) => ({
      app: { type: "app", value: m[1]?.trim() ?? m[0] },
    }),
  },
  {
    // Vietnamese: "mở <AppName>"
    pattern: /\bm[ởo]\s+([a-zA-Z][a-zA-Z\s]{1,30}?)(?:\s*$|\s+(?:app|ứng dụng)\b)/i,
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
export async function classifyIntent(text: string, context?: IntentContext): Promise<Intent> {
  const contextSummary = context?.os ? summarizeForIntent(context.os) : "";
  const effectiveText = contextSummary ? `${text}\n\n[OS context summary]\n${contextSummary}` : text;
  const forceUiInteraction = /\b(mouse|cursor|click|double\s*click|right\s*click|drag|drop|scroll|move\s+mouse|click\s+at|x\s*\d+\s*y\s*\d+|k[ée]o|nh[aá]p|chu[ộo]t|cu[ộo]n)\b/i.test(text);
  const strictLlm = isLlmRequired();
  const normalized = text.toLowerCase().trim();

  // Deterministic high-signal routing to keep critical planner paths stable
  // even when LLM output drifts or provider/network is unavailable.
  const preLlmRules: Array<{ pattern: RegExp; type: IntentType; confidence: number }> = [
    {
      // Multi-step: comma-separated or sequenced chains (sau đó/rồi/tiếp theo)
      // e.g. "Mở safari, truy cập youtube sau đó mở video đầu tiên"
      // Must come BEFORE app-launch to avoid misclassification.
      pattern: /^(?:mở|open|launch).+(?:,\s*(?:truy\s*cập|mở|vào|sau\s*đó|rồi|navigate|go\s+to)|sau\s*đó\s+(?:mở|truy|vào|click|nhấp)|rồi\s+(?:mở|truy|vào)|tiếp\s*(?:theo\s*)?(?:mở|truy|vào|click))/i,
      type: "multi-step",
      confidence: 0.95,
    },
    {
      // "mở/open X trên/bằng/qua/trong Safari/Chrome/Firefox" → app-control (browser + navigate)
      // e.g. "Mở video đầu tiên của youtube trên Safari"
      // e.g. "Mở youtube bằng safari"
      pattern: /^(?:mở|open)\s+.+\s+(?:trên|bằng|qua|trong)\s+(?:safari|chrome|firefox|brave|arc|edge|cốc\s*cốc|trình\s*duyệt)/i,
      type: "app-control",
      confidence: 0.96,
    },
    {
      // Vietnamese navigation: "truy cập X" / "vào trang X" / "vào web X"
      // e.g. "Truy cập youtube" / "Vào trang google"
      pattern: /^(?:truy\s*cập|vào\s*(?:trang|web|website)?)\s+(?:https?:\/\/|www\.|youtube|google|facebook|tiktok|instagram|twitter|github|[\w-]+\.(?:com|vn|org|net))/i,
      type: "app-control",
      confidence: 0.95,
    },
    {
      // Simple "open/launch/mở <AppName>" with no secondary verbs — always app-launch.
      // Matches before any LLM call to avoid JSON parse failures on trivial commands.
      // Excludes "open X on <platform>" patterns (those are app-control for media/browser).
      // Excludes Vietnamese contextual prepositions: trên, bằng, qua, tại, trong, sau đó, rồi
      // Excludes commas (compound/multi-step commands).
      pattern: /^(?:open|launch|start|activate|mở|khởi?\s*động)\s+(?!.*\b(?:trên|bằng|qua|tại|trong|sau\s*đó|rồi|tiếp\s*theo|truy\s*cập|video\s*đầu|kết\s*quả)\b)(?!.*\bon\s+(?:youtube|spotify|netflix|tiktok|soundcloud|apple\s*music)\b)(?!.*,)[a-zA-ZÀ-ỹ][a-zA-ZÀ-ỹ0-9\s\-\.]{0,40}?(?:\s+(?:app|application|ứng\s*dụng))?$/i,
      type: "app-launch",
      confidence: 0.97,
    },
    {
      // System info questions — "how long has X been running?", "what is the uptime?",
      // "how much RAM/CPU/disk?", "what version?", "system info", etc.
      // These must never fall through to ui-interaction (which would mouse-click something).
      pattern: /\b(?:how\s+long|how\s+much|how\s+many|what\s+is\s+(?:the\s+)?(?:uptime|cpu|ram|memory|disk|battery|version|os|system)|uptime|system\s+info|sysinfo|hệ\s*thống\s*đã\s*chạy|máy\s*đã\s*bật|đang\s*dùng\s*bao\s*nhiêu|máy\s*chạy\s*được\s*bao\s*lâu)\b/i,
      type: "system-query",
      confidence: 0.96,
    },
    {
      pattern: /\b(?:run|execute)\b.*\b(?:npm|pnpm|yarn|git|python|node|bash|sh|make|cargo)\b/i,
      type: "shell-command",
      confidence: 0.95,
    },
    {
      pattern: /\b(send\s+email|compose\s+email|write\s+email|open\s+mail|mail\s+app|g[iử]i\s*email|thư\s*điện\s*tử|(?:email|mail)\b(?!\s*:))\b/i,
      type: "app-control",
      confidence: 0.94,
    },
        {
          pattern: /\b(message|send\s+message|chat\s+with|nh[aắ]n\s*tin|g[iử]i\s*tin\s*nh[aắ]n|message\s+for)\b/i,
          type: "app-control",
          confidence: 0.94,
        },
    {
      pattern: /\b(split|tile|snap|arrange)\b.{0,30}\b(window|windows)\b/i,
      type: "app-control",
      confidence: 0.95,
    },
    {
      pattern: /\b(fill|autofill|form|đi[ềe]n\s*form|bi[ểe]u\s*m[ẫa]u)\b/i,
      type: "ui-interaction",
      confidence: 0.95,
    },
    {
      pattern: /\b(vault|bitwarden|1password|autofill\s+password|password\s+manager|điền\s+mật\s+khẩu)\b/i,
      type: "security-management",
      confidence: 0.95,
    },
    {
      pattern: /\bopen\s+.+\s+on\s+youtube\b/i,
      type: "app-control",
      confidence: 0.95,
    },
    {
      pattern: /\b(?:on|in)\s+safari\b/i,
      type: "app-control",
      confidence: 0.92,
    },
    {
      pattern: /\b(?:switch|mirror|extend|external\s+display|monitor)\b.*\b(display|screen|monitor)\b/i,
      type: "display-audio",
      confidence: 0.93,
    },
    {
      pattern: /(?:\b(?:bluetooth|\bbt\b)\b.*\b(?:toggle|turn\s*off|disable|tắt)\b)|(?:\b(?:toggle|turn\s*off|disable|tắt)\b.*\b(?:bluetooth|\bbt\b)\b)/i,
      type: "peripheral-management",
      confidence: 0.94,
    },
    {
      pattern: /\b(bookmark|save\s+page|lưu\s+trang\s+dấu|d[ấa]u\s+trang)\b/i,
      type: "app-control",
      confidence: 0.95,
    },
    {
      pattern: /\b(open|show|view)\b.*\b(history)\b/i,
      type: "app-control",
      confidence: 0.94,
    },
    {
      pattern: /\b(clear|delete|x[oó]a|d[ọo]n)\b.*\b(history|cache|cookies|browsing data)\b/i,
      type: "app-control",
      confidence: 0.94,
    },
    {
      pattern: /\b(?:defrag|trimforce|trim\s*ssd|ssd\s*trim|disk\s*optimization|optimi[sz]e\s*disk|lên\s*lịch\s*tối\s*ưu\s*đĩa)\b/i,
      type: "disk-cleanup",
      confidence: 0.94,
    },
    {
      pattern: /\b(?:summari[sz]e\b.*\b(?:context|workspace|work)\b|context\s*summary|t[oó]m\s*tắt\b.*\b(?:ng[ữu]\s*cảnh|màn\s*hình|công\s*việc)\b)\b/i,
      type: "system-query",
      confidence: 0.94,
    },
    {
      pattern: /\b(?:connect|join|kết\s*nối)\b.*\b(?:wifi|wi-fi|wireless)\b/i,
      type: "network-control",
      confidence: 0.95,
    },
    {
      pattern: /\b(?:translate\s*(?:screen|this|selection|text)|dịch\s*(?:màn\s*hình|đoạn\s*này|văn\s*bản|nội\s*dung))\b/i,
      type: "ui-interaction",
      confidence: 0.95,
    },
    {
      pattern: /\b(?:screenshot|screen\s*capture|capture\s*screen|chụp\s*màn\s*hình|chup\s*man\s*hinh)\b/i,
      type: "ui-interaction",
      confidence: 0.95,
    },
    // ── Vietnamese audio/media commands ──
    // NOTE: \b word boundary does NOT work with Vietnamese Unicode chars — use start-of-string anchor or no boundary
    {
      // "tắt nhạc", "phát nhạc", "dừng nhạc", "tua nhạc", "next bài" etc.
      // Uses (?:^|\s) instead of \b for Vietnamese-first words
      pattern: /(?:^|\s)(?:tắt\s*(?:nhạc|âm\s*thanh|tiếng)|phát\s*(?:nhạc|bài|video|clip)|dừng\s*(?:nhạc|phát)|tua\s*(?:nhạc|bài)|bài\s*(?:tiếp|kế\s*tiếp)|âm\s*lượng\s*(?:tối\s*đa|tối\s*thiểu|lên|xuống))(?:\s|$)/i,
      type: "audio-management",
      confidence: 0.95,
    },
    {
      // "tăng/giảm âm lượng" — volume control (must be audio-management not display-audio)
      pattern: /(?:tăng|giảm|chỉnh)\s*(?:âm\s*lượng|tiếng)|(?:âm\s*lượng|volume)\s*(?:tăng|giảm|lên|xuống|\d+%?)/i,
      type: "audio-management",
      confidence: 0.96,
    },
    {
      // English volume: "volume up/down", "increase/decrease volume", "raise/lower volume"
      pattern: /\b(?:volume\s+(?:up|down)|(?:increase|decrease|raise|lower|set|mute|unmute)\s+(?:volume|sound|audio))\b/i,
      type: "audio-management",
      confidence: 0.96,
    },
    // ── Vietnamese close/tab commands ──
    {
      // "đóng tất cả tab", "đóng tab này", "đóng cửa sổ", "tắt ứng dụng X"
      // No \b — Vietnamese words don't work with ASCII word boundaries
      pattern: /(?:đóng\s*(?:tất\s*cả\s*)?tab|đóng\s*(?:tab|cửa\s*sổ|window)|tắt\s*(?:ứng\s*dụng|app\b))/i,
      type: "app-control",
      confidence: 0.95,
    },
    // ── Vietnamese alarm/reminder commands ──
    {
      // "đặt báo thức X giờ", "set alarm 7am", "tạo nhắc nhở"
      pattern: /(?:đặt\s*(?:báo\s*thức|hẹn\s*giờ|nhắc\s*nhở)|tạo\s*(?:báo\s*thức|nhắc\s*nhở)|\bset\s*(?:alarm|timer|reminder)\b)/i,
      type: "app-control",
      confidence: 0.95,
    },
    // ── Vietnamese notes/notes-app commands ──
    {
      // "ghi chú: X", "tạo ghi chú", "thêm vào notes", "mở notes"
      pattern: /(?:ghi\s*chú|tạo\s*(?:ghi\s*chú|note)|thêm\s*(?:vào\s*)?notes?|\bcreate\s*note\b|\badd\s*note\b|\btake\s*note\b)/i,
      type: "app-control",
      confidence: 0.95,
    },
  ];

  for (const rule of preLlmRules) {
    if (rule.pattern.test(text)) {
      // For app-launch rules, extract the app name from the command text
      let entities: Record<string, Entity> = {};
      if (rule.type === "app-launch") {
        const appNameMatch = text.match(
          /^(?:open|launch|start|activate|mở|khởi?\s*động)\s+([a-zA-ZÀ-ỹ][a-zA-ZÀ-ỹ0-9\s\-\.]{0,40}?)(?:\s+(?:app|application|ứng\s*dụng))?$/i,
        );
        const appName = appNameMatch?.[1]?.trim();
        if (appName) {
          entities = { app: { type: "app", value: appName } };
        }
      } else if (rule.type === "app-control") {
        // Extract browser and query from "mở X trên Browser" / "truy cập X" patterns
        const browserMatch = text.match(/(?:trên|bằng|qua|trong)\s+(safari|chrome|firefox|brave|arc|edge|cốc\s*cốc)/i);
        const browser = browserMatch?.[1]?.trim();
        // Extract the target/query part: "mở <query> trên <browser>"
        const queryMatch = text.match(/^(?:mở|open)\s+(.+?)\s+(?:trên|bằng|qua|trong)\s+/i);
        // Extract URL/site from "truy cập X" / "vào X"
        const navMatch = text.match(/^(?:truy\s*cập|vào\s*(?:trang|web|website)?)\s+(.+)/i);
        const queryRaw = queryMatch?.[1]?.trim() ?? navMatch?.[1]?.trim();
        if (browser) entities.app = { type: "app", value: browser };
        if (queryRaw) entities.query = { type: "text", value: queryRaw };
      }
      return {
        type: rule.type,
        entities,
        confidence: rule.confidence,
        rawText: text,
      };
    }
  }

  // Quick match for single-word commands
  const quickMatch = QUICK_INTENT_MAP[normalized];
  if (!strictLlm && quickMatch) {
    return {
      type: quickMatch.type,
      entities: {},
      confidence: quickMatch.confidence,
      rawText: text,
    };
  }

  const llmResult = await classifyWithLLM(effectiveText, strictLlm);

  if (strictLlm) {
    if (!llmResult) {
      throw new Error("LLM API is required but no classification result was returned.");
    }
    if (forceUiInteraction && llmResult.type !== "ui-interaction") {
      return {
        type: "ui-interaction",
        entities: llmResult.entities,
        confidence: Math.max(llmResult.confidence, 0.92),
        rawText: text,
      };
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

  if (forceUiInteraction && result.type !== "ui-interaction") {
    return {
      type: "ui-interaction",
      entities: result.entities,
      confidence: Math.max(result.confidence, 0.92),
      rawText: text,
    };
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

const DECOMPOSE_SYSTEM_PROMPT = `You are a task planner for a macOS computer-automation assistant.
Break the user's complex task into an ordered list of concrete sub-steps.
Each step must be classifiable as one of: shell-command, app-launch, app-control, file-operation, ui-interaction, system-query.

IMPORTANT: The user may write in Vietnamese. Parse Vietnamese commands correctly:
- "mở" = open/launch  |  "truy cập" / "vào" = navigate to  |  "tìm" = search/find
- "nhấp" / "click" = click  |  "cuộn" = scroll  |  "gõ" / "nhập" = type
- "đóng" / "tắt" = close/quit  |  "sau đó" / "rồi" / "tiếp theo" = then (sequence)
- "video đầu tiên" = first video  |  "kết quả đầu tiên" = first result
- "trên" = on (platform)  |  "bằng" = using/with  |  "qua" = via

Semantic parsing rules:
- Extract: action verb, target object, platform/app, modifier (first/latest/etc.)
- "mở X trên Y" = navigate to X using browser Y
- "mở video đầu tiên của youtube trên Safari" = open Safari → go to YouTube → click first video

Tool mapping:
- app.launch   → launch an application
- app.activate → bring app to foreground
- app.script   → run AppleScript (browser navigation, YouTube click, UI automation)
- shell.exec   → run shell command
- ui.click     → click UI element
- ui.type      → type text
- ui.key       → keyboard shortcut

Example: "Mở safari, truy cập youtube sau đó mở video đầu tiên":
{
  "steps": [
    { "description": "Open Safari browser", "type": "app-launch", "tool": "app.launch" },
    { "description": "Navigate to https://www.youtube.com in Safari", "type": "app-control", "tool": "app.script" },
    { "description": "Click the first video on YouTube homepage", "type": "app-control", "tool": "app.script" }
  ]
}

Respond with ONLY valid JSON (no markdown, no commentary):
{
  "steps": [
    { "description": "<step text in English>", "type": "<intent-type>", "tool": "<tool.verb>" }
  ]
}`;

interface DecomposedStep {
  description: string;
  type: IntentType;
  tool: string;
}

const LEGACY_TOOL_ALIASES: Record<string, string> = {
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

const SUPPORTED_DECOMPOSED_TOOLS = new Set<string>([
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

function defaultToolForIntentType(type: IntentType): string {
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

function normalizeStepTool(rawTool: string, type: IntentType): string {
  const tool = rawTool.trim();
  const mapped = LEGACY_TOOL_ALIASES[tool] ?? tool;
  if (SUPPORTED_DECOMPOSED_TOOLS.has(mapped)) {
    return mapped;
  }
  return defaultToolForIntentType(type);
}

async function decomposeMultiStep(
  text: string,
  episodicContext?: string,
  kgContext?: string,
): Promise<DecomposedStep[] | null> {
  if (!isLlmRequired()) {
    return null;
  }

  const budget = resolveEffectiveBudget();

  try {
    let systemPrompt = DECOMPOSE_SYSTEM_PROMPT;
    if (episodicContext) systemPrompt += episodicContext;
    if (kgContext) systemPrompt += `\n\nKnown context:\n${kgContext}`;
    const response = await requestLlmTextWithFallback({
      system: systemPrompt,
      user: text.slice(0, budget.maxInputChars),
      maxTokens: budget.decomposeMax,
    });

    const raw = response.text;

    const parsed = parseLlmJson<{ steps?: unknown[] }>(raw);
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

function inferStepParamsForTool(
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

// ---------------------------------------------------------------------------
// NL → Shell command extraction
// ---------------------------------------------------------------------------

const NL_TO_COMMAND: Array<{ pattern: RegExp; command: string | ((m: RegExpMatchArray) => string) }> = [
  {
    pattern: /\bcreate\b.*\breact\b.*\bvite\b.*\bprojects\b/i,
    command: 'cd "$HOME/Projects" && npm create vite@latest react-vite-app -- --template react',
  },
  {
    pattern: /\bcreate\b.*\breact\b.*\bvite\b/i,
    command: "npm create vite@latest react-vite-app -- --template react",
  },
  { pattern: /\b(?:check|show|view|get|monitor)\s+(?:the\s+)?(?:cpu|processor)\b(?!\s+usage.*process)/i, command: "top -l 1 -s 0 | grep -E 'CPU usage|Load Avg'" },
  { pattern: /\b(?:check|show)\s+(?:ram|memory)\s+(?:usage)?\b/i, command: "vm_stat | head -10" },
  { pattern: /\bcpu\s+(?:and\s+)?memory\b|\bsystem\s+status\b/i, command: "top -l 1 -s 0 | grep -E 'CPU usage|Load Avg'" },
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
  {
    pattern: /\b(?:unzip|extract)\b(?:\s+(?:file|archive))?\s+([a-zA-Z0-9._~\/-]+\.zip)(?:\s+(?:to|into)\s+([a-zA-Z0-9._~\/-]+))?/i,
    command: (m) => {
      const zipFile = (m[1] ?? "").replace(/[^a-zA-Z0-9._~\/-]/g, "");
      const dest = (m[2] ?? "").replace(/[^a-zA-Z0-9._~\/-]/g, "");
      return dest ? `unzip -o "${zipFile}" -d "${dest}"` : `unzip -o "${zipFile}"`;
    },
  },
  {
    pattern: /\b(?:(?<!un)zip|compress)\b(?:\s+(?:folder|directory|dir|file))?\s+([a-zA-Z0-9._~\/-]+)(?:\s+(?:to|into|as)\s+([a-zA-Z0-9._-]+(?:\.zip)?))?/i,
    command: (m) => {
      const source = (m[1] ?? "").replace(/[^a-zA-Z0-9._~\/-]/g, "");
      const sourceBase = source.split("/").filter(Boolean).pop() || "archive";
      const archiveRaw = (m[2] ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
      const archive = archiveRaw
        ? (archiveRaw.endsWith(".zip") ? archiveRaw : `${archiveRaw}.zip`)
        : `${sourceBase}.zip`;
      return `zip -r "${archive}" "${source}"`;
    },
  },
  { pattern: /\b(?:git\s+)?status\b/i, command: "git status --short --branch" },
  {
    pattern: /\bcommit\b(?:\s+all\s+changes?)?(?:.*\bmessage\s*[:=]\s*["']?([^"']+)["']?)?/i,
    command: (m) => {
      const msg = (m[1] ?? "update from omnistate").replace(/"/g, '\\"').trim();
      return `git add -A && git commit -m "${msg || "update from omnistate"}"`;
    },
  },
  {
    pattern: /\b(?:git\s+)?push\b(?:\s+to\s+([a-zA-Z0-9._/-]+))?(?:\s+branch\s+([a-zA-Z0-9._/-]+))?/i,
    command: (m) => {
      const remote = (m[1] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      const branch = (m[2] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      if (remote && branch) return `git push ${remote} ${branch}`;
      if (branch) return `git push origin ${branch}`;
      return "git push";
    },
  },
  {
    pattern: /\b(?:git\s+)?pull\b(?:\s+from\s+([a-zA-Z0-9._/-]+))?(?:\s+branch\s+([a-zA-Z0-9._/-]+))?/i,
    command: (m) => {
      const remote = (m[1] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      const branch = (m[2] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      if (remote && branch) return `git pull ${remote} ${branch}`;
      if (branch) return `git pull origin ${branch}`;
      return "git pull --rebase";
    },
  },
  {
    pattern: /\b(?:create|new)\s+branch\s+([a-zA-Z0-9._/-]+)\b/i,
    command: (m) => {
      const branch = (m[1] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      return `git checkout -b ${branch}`;
    },
  },
  {
    pattern: /\b(?:checkout|switch\s+to)\s+branch\s+([a-zA-Z0-9._/-]+)\b/i,
    command: (m) => {
      const branch = (m[1] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      return `git checkout ${branch}`;
    },
  },
  {
    pattern: /\bmerge\s+branch\s+([a-zA-Z0-9._/-]+)\b/i,
    command: (m) => {
      const branch = (m[1] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      return `git merge ${branch}`;
    },
  },
  {
    pattern: /\brebase\s+branch\s+([a-zA-Z0-9._/-]+)\b/i,
    command: (m) => {
      const branch = (m[1] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      return `git rebase ${branch}`;
    },
  },
  { pattern: /\bstash\b/i, command: "git stash push -m 'omnistate-stash'" },

  // ── Developer extras (tasks 51-65) ──
  {
    // SSH to server (task 62): "ssh into server with username admin"
    pattern: /\bssh\b(?:\s+(?:into|to|vào))?\s+(?:server\s+)?(?:with\s+(?:username\s+)?)?([a-zA-Z0-9_.-]+)(?:@([a-zA-Z0-9._-]+))?/i,
    command: (m) => {
      const user = (m[1] ?? "admin").replace(/[^a-zA-Z0-9_.-]/g, "");
      const host = (m[2] ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
      const target = host ? `${user}@${host}` : user;
      return `osascript -e 'tell application "Terminal" to do script "ssh ${target}"' && tell application "Terminal" to activate`;
    },
  },
  {
    // curl with proxy (task 60): "curl endpoint with proxy" / "test API via proxy"
    pattern: /\b(curl|test\s+endpoint|gọi\s+api)\b.*\b(proxy)\b/i,
    command: (m) => {
      const input = m.input ?? "";
      const urlMatch = input.match(/\bhttps?:\/\/[^\s"']+/i);
      const url = urlMatch?.[0] ?? "https://httpbin.org/get";
      return `curl \${HTTPS_PROXY:+-x "$HTTPS_PROXY"} -s -H "Content-Type: application/json" "${url}" 2>&1 | head -200`;
    },
  },
  {
    // Kill port (task 61): "kill port 8080" / "tắt cổng localhost:8080"
    pattern: /\b(?:kill|free|release|tắt\s+cổng|giải\s+phóng\s+cổng)\b.*?\b(?:port|cổng|localhost:?)?(\d{4,5})\b/i,
    command: (m) => {
      const port = parseInt(m[1] ?? "8080", 10);
      if (port < 1024 || port > 65535) return "echo 'Invalid port number'";
      return `lsof -ti:${port} | xargs kill -9 2>/dev/null && echo 'Port ${port} freed' || echo 'Port ${port} is not in use'`;
    },
  },
  {
    // Find TODO/FIXME in code (task 65)
    pattern: /\b(?:find|search|tìm)\b.*\b(TODO|FIXME|HACK|BUG)\b/i,
    command: (m) => {
      const keyword = (m[1] ?? "TODO").toUpperCase();
      return `grep -rn "${keyword}" . --include="*.ts" --include="*.js" --include="*.py" --include="*.swift" --include="*.java" --include="*.go" 2>/dev/null | head -30 || echo "No ${keyword} found in current directory"`;
    },
  },
  {
    // Run shell script (task 54)
    pattern: /\b(?:run|chạy|execute)\b\s+(?:script\s+)?([a-zA-Z0-9_.-]+\.sh)\b/i,
    command: (m) => {
      const script = (m[1] ?? "").replace(/[^a-zA-Z0-9_.-]/g, "");
      return `bash ~/${script} 2>&1 || bash ./${script} 2>&1 || echo 'Script not found: ${script}'`;
    },
  },
  {
    // Open file in text editor (task 64)
    pattern: /\b(?:open|mở)\b.*?\b([\w.-]+\.(?:json|txt|md|yaml|yml|env|config|toml|ini|conf))\b.*\b(?:text\s+editor|editor|trình\s+soạn)\b/i,
    command: (m) => {
      const file = (m[1] ?? "").replace(/[^a-zA-Z0-9_.-]/g, "");
      return `open -t ~/${file} 2>/dev/null || open -t ./${file} 2>/dev/null || echo "File not found: ${file}"`;
    },
  },
  {
    // Open file in VSCode (task 52/64)
    pattern: /\b(?:open|mở)\b.*(?:(?:with|using|bằng)\s+(?:vscode|code|visual\s+studio)|in\s+(?:vscode|code))\b/i,
    command: (m) => {
      const input = m.input ?? "";
      const fileMatch = input.match(/\b([\w./~-]+\.[\w]{1,6})\b/);
      const file = fileMatch?.[1]?.replace(/[^a-zA-Z0-9_./~-]/g, "") ?? ".";
      return `code "${file}" || open -a "Visual Studio Code" "${file}"`;
    },
  },
  {
    // Rename file (task 36): "đổi tên file anh_meo_1.jpg thành calico_cat.jpg"
    pattern: /\b(?:rename|đổi\s+tên)\b\s+(?:file\s+)?([a-zA-Z0-9_\s.-]+?\.\w{2,5})\s+(?:thành|to|as|→)\s+([a-zA-Z0-9_\s.-]+?\.\w{2,5})\b/i,
    command: (m) => {
      const src = (m[1] ?? "").trim().replace(/[^a-zA-Z0-9_.@-]/g, "_");
      const dst = (m[2] ?? "").trim().replace(/[^a-zA-Z0-9_.@-]/g, "_");
      return `mv ~/"${src}" ~/"${dst}" 2>/dev/null || mv ./"${src}" ./"${dst}" 2>/dev/null || echo 'File not found: ${src}'`;
    },
  },
  {
    // Delete .tmp / .log files (task 37)
    pattern: /\b(?:xóa|delete|remove)\b.*?\*?\.(tmp|log|bak|cache|DS_Store)\b/i,
    command: (m) => {
      const ext = (m[1] ?? "tmp").replace(/[^a-zA-Z0-9_]/g, "");
      return `find . -name "*.${ext}" -delete 2>/dev/null && echo "All .${ext} files deleted from current directory"`;
    },
  },
  {
    // Eject USB (task 44)
    pattern: /\b(?:eject|đẩy|unmount)\b.*?\b(?:usb|ổ\s+cứng|disk|drive|external)\b/i,
    command: "diskutil list external && DISK=$(diskutil list external | grep -o 'disk[0-9]*' | head -1); if [ -n \"$DISK\" ]; then diskutil unmountDisk /dev/$DISK && echo \"Ejected /dev/$DISK\"; else echo 'No external disk found'; fi",
  },
  {
    // Auto-move Downloads (task 92): create a launchd watcher
    pattern: /\b(?:tự\s+động|auto|automatically)\b.*?\b(?:chuyển|move)\b.*?\b(?:downloads?|tải\s+về)\b.*?\b(?:To_Sort|to[\s_]sort)\b/i,
    command: `mkdir -p ~/To_Sort && cat > /tmp/omnistate-auto-move.sh << 'SHEOF'
#!/bin/bash
for f in ~/Downloads/*; do
  [ -f "$f" ] && mv "$f" ~/To_Sort/ 2>/dev/null
done
SHEOF
chmod +x /tmp/omnistate-auto-move.sh
cat > /tmp/com.omnistate.automove.plist << 'PEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.omnistate.automove</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>/tmp/omnistate-auto-move.sh</string></array>
  <key>WatchPaths</key><array><string>/Users/$USER/Downloads</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PEOF
cp /tmp/com.omnistate.automove.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.omnistate.automove.plist 2>/dev/null && echo 'Auto-move watcher installed for Downloads → To_Sort'`,
  },
  {
    // Open all work apps (task 93)
    pattern: /\b(?:mở\s+tất\s+cả|open\s+all)\b.*?\b(?:ứng\s+dụng|apps?|công\s+việc|work)\b/i,
    command: `open -a "Visual Studio Code" && open -a Terminal && open -a Safari && open -a Zalo && echo "Work apps launched: VSCode, Terminal, Safari, Zalo"`,
  },
  {
    // Find large files >1GB (task 99)
    pattern: /\b(?:file\s+nặng\s+hơn|tìm\s+file\s+lớn|find\s+large\s+files?|nặng\s+hơn|larger?\s+than)\b.*?\b(?:1\s*GB|1\s*gigabyte)\b/i,
    command: `find ~ -size +1G -not -path "*/Library/*" -not -path "*/.Trash/*" 2>/dev/null | xargs du -sh 2>/dev/null | sort -hr | head -20 || echo "No files larger than 1GB found (outside Library)"`,
  },
  {
    // Check macOS software updates (task 48)
    pattern: /\b(?:kiểm\s+tra\s+cập\s+nhật|check\s+(?:for\s+)?updates?|software\s+update|cập\s+nhật\s+macos)\b/i,
    command: "softwareupdate --list 2>&1 | head -30",
  },
  {
    // View disk usage (task 39)
    pattern: /\b(?:dung\s+lượng|disk\s+space|ổ\s+cứng\s+còn\s+trống|free\s+space|storage\s+left)\b/i,
    command: "df -h / && echo '---' && du -sh ~/Desktop ~/Downloads ~/Documents ~/Pictures 2>/dev/null | sort -hr | head -10",
  },
  {
    // Ping server (task 55)
    pattern: /\b(?:ping|kiểm\s+tra\s+kết\s+nối)\b.*\b(?:server|địa\s+chỉ|IP)\b\s+([a-zA-Z0-9._-]+)\b/i,
    command: (m) => {
      const host = (m[1] ?? "8.8.8.8").replace(/[^a-zA-Z0-9._-]/g, "");
      return `ping -c 5 ${host}`;
    },
  },
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
  const regex =
    /(?:\bx\s*[:=]?\s*(\d{1,5})\s*(?:[,;\s]+)?\by\s*[:=]?\s*(\d{1,5}))|(?:(\d{1,5})\s*[,x]\s*(\d{1,5}))|(?:(\d{1,5})\s+(\d{1,5}))/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const xRaw = match[1] ?? match[3] ?? match[5];
    const yRaw = match[2] ?? match[4] ?? match[6];
    const x = xRaw ? parseInt(xRaw, 10) : NaN;
    const y = yRaw ? parseInt(yRaw, 10) : NaN;
    if (!Number.isNaN(x) && !Number.isNaN(y)) {
      pairs.push({ x, y });
    }
  }

  return pairs;
}

function extractQuotedText(raw: string): string | null {
  const m = raw.match(/["'""](.+?)["'""]/);
  if (m?.[1]) return m[1].trim();

  const tail = raw.match(/\b(?:type|enter|input|write)\b\s+(.+)/i);
  if (tail?.[1]) return tail[1].trim();
  return null;
}

type UiActionKind = "move" | "click" | "scroll" | "type";

interface UiActionStep {
  kind: UiActionKind;
  sourceText: string;
  coordinate?: { x: number; y: number };
  button?: "left" | "right";
  isDoubleClick?: boolean;
  scrollAmount?: number;
  scrollUp?: boolean;
  typedText?: string;
  queryText?: string;
}

const UI_CHAIN_CONNECTOR =
  /\s*(?:->|\band\s+then\b|\bthen\b|\bafter\s+that\b|\bnext\b|\br(?:[ồo]i)?\b|\bxong(?:\s+r(?:[ồo]i)?)?\b|\bsau\s*(?:[đd][oó]|[đd][aá]y|do|day)\b|\bti[ếe]p(?:\s*theo|\s*[đd][oó])?\b)\s*/gi;
const UI_MOVE_KEYWORDS = ["move", "mouse", "cursor", "chuot", "con tro"];
const UI_SCROLL_KEYWORDS = ["scroll", "cuon"];
const UI_DOUBLE_CLICK_KEYWORDS = ["double click", "double tap", "nhap doi"];
const UI_RIGHT_CLICK_KEYWORDS = ["right click", "chuot phai", "nhap phai"];
const UI_CLICK_KEYWORDS = ["click", "tap", "nhap"];
const UI_TYPE_KEYWORDS = ["type", "enter", "input", "write", "go chu"];
const UI_NEGATION_PREFIXES = [
  "do not",
  "dont",
  "not",
  "no",
  "never",
  "khong duoc",
  "khong",
  "ko",
  "k",
  "dung",
  "cam",
];

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeUiPhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bdo\s+n['']?t\b/g, "dont")
    .replace(/\bdon['']?t\b/g, "dont")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[đ]/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findKeywordIndex(normalized: string, keywords: string[]): number {
  let best = -1;

  for (const keyword of keywords) {
    const phrase = escapeRegex(keyword).replace(/\s+/g, "\\s+");
    const regex = new RegExp(`(?:^|\\s)${phrase}(?=\\s|$)`);
    const match = normalized.match(regex);
    if (!match || typeof match.index !== "number") continue;

    const idx = normalized.indexOf(match[0], Math.max(0, match.index));
    if (idx < 0) continue;
    const start = idx + (match[0].startsWith(" ") ? 1 : 0);
    if (best === -1 || start < best) best = start;
  }

  return best;
}

function hasNegatedKeyword(normalized: string, keywords: string[]): boolean {
  for (const negation of UI_NEGATION_PREFIXES) {
    const negationPattern = escapeRegex(negation).replace(/\s+/g, "\\s+");

    for (const keyword of keywords) {
      const phrase = escapeRegex(keyword).replace(/\s+/g, "\\s+");
      const regex = new RegExp(
        `(?:^|\\s)${negationPattern}(?:\\s+\\w+){0,1}\\s+${phrase}(?=\\s|$)`,
      );
      if (regex.test(normalized)) return true;
    }
  }

  return false;
}

function isNegatedUiInstruction(raw: string): boolean {
  const normalized = normalizeUiPhrase(raw);
  const allKeywords = [
    ...UI_MOVE_KEYWORDS,
    ...UI_SCROLL_KEYWORDS,
    ...UI_DOUBLE_CLICK_KEYWORDS,
    ...UI_RIGHT_CLICK_KEYWORDS,
    ...UI_CLICK_KEYWORDS,
    ...UI_TYPE_KEYWORDS,
  ];
  return hasNegatedKeyword(normalized, allKeywords);
}

function splitUiInteractionSegments(raw: string): string[] {
  const normalized = raw.replace(/\s+/g, " ").trim();
  const quotedChunks: string[] = [];
  const masked = normalized.replace(/["'""][^"'""]*["'""]/g, (chunk) => {
    const token = `__Q${quotedChunks.length}__`;
    quotedChunks.push(chunk);
    return token;
  });

  const unmask = (segment: string): string =>
    segment.replace(/__Q(\d+)__/g, (_, index: string) => {
      const parsedIndex = parseInt(index, 10);
      return Number.isNaN(parsedIndex) ? _ : (quotedChunks[parsedIndex] ?? _);
    });

  return masked
    .split(UI_CHAIN_CONNECTOR)
    .map(unmask)
    .map(s => s.trim())
    .filter(Boolean);
}

function extractScrollAmountFromSegment(segment: string): number {
  const match = segment.match(
    /(?:scroll|cu[oộ]n)(?:\s+(?:up|down|l[eê]n|xu[oố]ng))?\s+(\d{1,4})/i,
  );
  return match ? parseInt(match[1], 10) : 250;
}

function parseUiActionChain(
  raw: string,
): UiActionStep[] {
  const segments = splitUiInteractionSegments(raw);
  const normalizedRaw = normalizeUiPhrase(raw);
  const hasChainConnectors = segments.length > 1;
  const allCoords = extractCoordinatePairs(raw);
  let globalCoordIndex = 0;
  let lastCoordinate: { x: number; y: number } | null = null;
  const steps: UiActionStep[] = [];

  for (const segment of segments) {
    const normalizedSegment = normalizeUiPhrase(segment);
    const localCoords = extractCoordinatePairs(segment);
    let localCoordIndex = 0;

    const resolveCoordinate = (
      preferLast: boolean,
      allowGlobalFallback: boolean,
    ): { x: number; y: number } | null => {
      if (localCoordIndex < localCoords.length) {
        const coord = localCoords[localCoordIndex];
        localCoordIndex += 1;
        return coord;
      }
      if (preferLast && lastCoordinate) return lastCoordinate;
      if (allowGlobalFallback && globalCoordIndex < allCoords.length) {
        const coord = allCoords[globalCoordIndex];
        globalCoordIndex += 1;
        return coord;
      }
      return null;
    };

    const orderedEvents: Array<{
      kind: UiActionKind;
      index: number;
      button?: "left" | "right";
      isDoubleClick?: boolean;
    }> = [];

    const moveIndex = findKeywordIndex(normalizedSegment, UI_MOVE_KEYWORDS);
    if (moveIndex >= 0) orderedEvents.push({ kind: "move", index: moveIndex });

    const scrollIndex = findKeywordIndex(normalizedSegment, UI_SCROLL_KEYWORDS);
    if (scrollIndex >= 0) orderedEvents.push({ kind: "scroll", index: scrollIndex });

    const doubleClickIndex = findKeywordIndex(normalizedSegment, UI_DOUBLE_CLICK_KEYWORDS);
    const rightClickIndex = findKeywordIndex(normalizedSegment, UI_RIGHT_CLICK_KEYWORDS);
    const clickIndex = findKeywordIndex(normalizedSegment, UI_CLICK_KEYWORDS);
    if (doubleClickIndex >= 0) {
      orderedEvents.push({ kind: "click", index: doubleClickIndex, button: "left", isDoubleClick: true });
    } else if (rightClickIndex >= 0) {
      orderedEvents.push({ kind: "click", index: rightClickIndex, button: "right" });
    } else if (clickIndex >= 0) {
      orderedEvents.push({ kind: "click", index: clickIndex, button: "left" });
    }

    const typeIndex = findKeywordIndex(normalizedSegment, UI_TYPE_KEYWORDS);
    if (typeIndex >= 0) orderedEvents.push({ kind: "type", index: typeIndex });

    orderedEvents.sort((a, b) => a.index - b.index);
    const hasMultipleEvents = orderedEvents.length > 1;

    for (const event of orderedEvents) {
      const isNegatedMove =
        event.kind === "move" && hasNegatedKeyword(normalizedSegment, UI_MOVE_KEYWORDS);
      const isNegatedScroll =
        event.kind === "scroll" && hasNegatedKeyword(normalizedSegment, UI_SCROLL_KEYWORDS);
      const isNegatedType =
        event.kind === "type" && hasNegatedKeyword(normalizedSegment, UI_TYPE_KEYWORDS);
      const clickNegationKeywords = event.isDoubleClick
        ? UI_DOUBLE_CLICK_KEYWORDS
        : event.button === "right"
          ? UI_RIGHT_CLICK_KEYWORDS
          : UI_CLICK_KEYWORDS;
      const isNegatedClick =
        event.kind === "click" && hasNegatedKeyword(normalizedSegment, clickNegationKeywords);

      if (isNegatedMove || isNegatedScroll || isNegatedType || isNegatedClick) {
        continue;
      }

      if (event.kind === "move") {
        const coordinate = resolveCoordinate(false, true);
        if (!coordinate) continue;
        lastCoordinate = coordinate;
        steps.push({
          kind: "move",
          sourceText: segment,
          coordinate,
        });
        continue;
      }

      if (event.kind === "click") {
        const coordinate = resolveCoordinate(true, false);
        if (coordinate) {
          lastCoordinate = coordinate;
          steps.push({
            kind: "click",
            sourceText: segment,
            coordinate,
            button: event.button ?? "left",
            isDoubleClick: event.isDoubleClick,
          });
          continue;
        }

        if (hasChainConnectors || hasMultipleEvents || event.isDoubleClick || event.button === "right") {
          steps.push({
            kind: "click",
            sourceText: segment,
            button: event.button ?? "left",
            isDoubleClick: event.isDoubleClick,
            queryText: segment,
          });
        }
        continue;
      }

      if (event.kind === "scroll") {
        steps.push({
          kind: "scroll",
          sourceText: segment,
          scrollAmount: extractScrollAmountFromSegment(segment),
          scrollUp: /\b(?:up|len)\b/.test(normalizedSegment),
        });
        continue;
      }

      if (event.kind === "type") {
        steps.push({
          kind: "type",
          sourceText: segment,
          typedText: extractQuotedText(segment) ?? segment,
        });
      }
    }
  }

  if (!steps.length &&
      findKeywordIndex(normalizedRaw, UI_TYPE_KEYWORDS) >= 0 &&
      !hasNegatedKeyword(normalizedRaw, UI_TYPE_KEYWORDS)) {
    steps.push({
      kind: "type",
      sourceText: raw,
      typedText: extractQuotedText(raw) ?? raw,
    });
  }

  if (!steps.length &&
      findKeywordIndex(normalizedRaw, UI_SCROLL_KEYWORDS) >= 0 &&
      !hasNegatedKeyword(normalizedRaw, UI_SCROLL_KEYWORDS)) {
    steps.push({
      kind: "scroll",
      sourceText: raw,
      scrollAmount: extractScrollAmountFromSegment(raw),
      scrollUp: /\b(?:up|len)\b/.test(normalizedRaw),
    });
  }

  if (!steps.length &&
      findKeywordIndex(normalizedRaw, UI_MOVE_KEYWORDS) >= 0 &&
      !hasNegatedKeyword(normalizedRaw, UI_MOVE_KEYWORDS)) {
    const coord = allCoords[0];
    if (coord) {
      steps.push({
        kind: "move",
        sourceText: raw,
        coordinate: coord,
      });
    }
  }

  if (!steps.length &&
      (findKeywordIndex(normalizedRaw, UI_DOUBLE_CLICK_KEYWORDS) >= 0 ||
        findKeywordIndex(normalizedRaw, UI_RIGHT_CLICK_KEYWORDS) >= 0 ||
        findKeywordIndex(normalizedRaw, UI_CLICK_KEYWORDS) >= 0) &&
      !hasNegatedKeyword(normalizedRaw, [
        ...UI_DOUBLE_CLICK_KEYWORDS,
        ...UI_RIGHT_CLICK_KEYWORDS,
        ...UI_CLICK_KEYWORDS,
      ]) &&
      allCoords[0]) {
    const isDoubleClick = findKeywordIndex(normalizedRaw, UI_DOUBLE_CLICK_KEYWORDS) >= 0;
    const isRightClick = findKeywordIndex(normalizedRaw, UI_RIGHT_CLICK_KEYWORDS) >= 0;
    steps.push({
      kind: "click",
      sourceText: raw,
      coordinate: allCoords[0],
      button: isRightClick ? "right" : "left",
      isDoubleClick,
    });
  }

  return steps;
}

function buildUiActionChainNodes(
  raw: string,
  steps: UiActionStep[],
  entities: Record<string, Entity>,
): StateNode[] {
  const nodes: StateNode[] = [];
  let previousId: string | null = null;
  let moveCount = 0;
  let interactCount = 0;
  let scrollCount = 0;

  const nextId = (kind: "move" | "interact" | "scroll"): string => {
    if (kind === "move") {
      moveCount += 1;
      return moveCount === 1 ? "move" : `move-${moveCount}`;
    }
    if (kind === "scroll") {
      scrollCount += 1;
      return scrollCount === 1 ? "scroll" : `scroll-${scrollCount}`;
    }
    interactCount += 1;
    return interactCount === 1 ? "interact" : `interact-${interactCount}`;
  };

  for (const step of steps) {
    const deps = previousId ? [previousId] : [];

    if (step.kind === "move" && step.coordinate) {
      const id = nextId("move");
      nodes.push(
        actionNode(
          id,
          `${raw} (move)`,
          "ui.move",
          "surface",
          { x: step.coordinate.x, y: step.coordinate.y },
          deps,
        ),
      );
      previousId = id;
      continue;
    }

    if (step.kind === "click") {
      const id = nextId("interact");
      const button = step.button ?? "left";

      if (step.coordinate) {
        const tool = step.isDoubleClick ? "ui.doubleClickAt" : "ui.clickAt";
        const params: Record<string, unknown> = {
          x: step.coordinate.x,
          y: step.coordinate.y,
        };
        if (!step.isDoubleClick) {
          params.button = button;
        }

        nodes.push(
          actionNode(
            id,
            `${raw} (click)`,
            tool,
            "surface",
            params,
            deps,
          ),
        );
      } else {
        nodes.push(
          actionNode(
            id,
            `${raw} (click)`,
            "ui.click",
            "surface",
            { query: step.queryText ?? raw, entities, button },
            deps,
          ),
        );

        if (step.isDoubleClick) {
          const secondId = nextId("interact");
          nodes.push(
            actionNode(
              secondId,
              `${raw} (double-click)`,
              "ui.click",
              "surface",
              { query: step.queryText ?? raw, entities, button },
              [id],
            ),
          );
          previousId = secondId;
          continue;
        }
      }

      previousId = id;
      continue;
    }

    if (step.kind === "scroll") {
      const id = nextId("scroll");
      const amount = step.scrollAmount ?? 250;
      nodes.push(
        actionNode(
          id,
          `${raw} (scroll)`,
          "ui.scroll",
          "surface",
          { dx: 0, dy: step.scrollUp ? amount : -amount },
          deps,
        ),
      );
      previousId = id;
      continue;
    }

    if (step.kind === "type") {
      const id = nextId("interact");
      nodes.push(
        actionNode(
          id,
          `${raw} (type)`,
          "ui.type",
          "surface",
          { text: step.typedText ?? raw },
          deps,
        ),
      );
      previousId = id;
    }
  }

  return nodes;
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
  "whatsapp",
  "messenger",
  "line",
  "android studio",
  "xcode",
  "calendar",
  "reminders",
  "photos",
  "maps",
  "clock",
  "calculator",
  "activity monitor",
];

/** Extract app name from intent entities or raw text. */
function extractAppName(intent: Intent): string | null {
  const raw = intent.rawText;

  // Web target flows should still control a browser app.
  if (/\bopen\b.+\bon\s+youtube\b/i.test(raw)) {
    return "safari";
  }

  const contextMatch = raw.match(/\b(?:on|in|from)\s+([a-zA-Z][\w\s.-]{1,40}?)(?=\s+(?:and|then|to|for)\b|$)/i);
  const contextCandidate = contextMatch?.[1]?.trim();
  const contextBrowser = contextCandidate
    ? BROWSERS.find((b) => contextCandidate.toLowerCase().includes(b))
    : null;

  // Prefer explicit app entity, except when sentence has explicit browser context
  // like "... on safari" and entity points to a media target like "youtube".
  const appEntity = Object.values(intent.entities).find(e => e.type === "app");
  if (appEntity?.value) {
    const entityLower = appEntity.value.toLowerCase();
    const entityIsBrowser = BROWSERS.some((b) => entityLower.includes(b));
    if (!entityIsBrowser && contextBrowser) return contextBrowser;
    return appEntity.value;
  }

  // Prefer explicit "on/in/from <app>" context anywhere in the sentence.
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
    "visual studio code": "Visual Studio Code",
    "terminal": "Terminal",
    "finder": "Finder",
    "slack": "Slack",
    "discord": "Discord",
    "notes": "Notes",
    "mail": "Mail",
    "messages": "Messages",
    "preview": "Preview",
    "zalo": "Zalo",
    "telegram": "Telegram",
    "whatsapp": "WhatsApp",
    "messenger": "Messenger",
    "line": "LINE",
    "android studio": "Android Studio",
    "xcode": "Xcode",
    "calendar": "Calendar",
    "reminders": "Reminders",
    "photos": "Photos",
    "maps": "Maps",
    "clock": "Clock",
    "calculator": "Calculator",
    "activity monitor": "Activity Monitor",
    "facetime": "FaceTime",
    "imovie": "iMovie",
    "garage band": "GarageBand",
    "garageband": "GarageBand",
    "keynote": "Keynote",
    "numbers": "Numbers",
    "pages": "Pages",
    "contacts": "Contacts",
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

interface FormField {
  key: string;
  value: string;
}

function extractFormFields(raw: string): FormField[] {
  const out: FormField[] = [];
  const re = /([\p{L}\p{N}_\s-]{2,30})\s*[:=]\s*("[^"]+"|'[^']+'|[^,;\n]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const key = m[1]?.trim().toLowerCase();
    const valueRaw = (m[2] ?? "").trim();
    const value = valueRaw.replace(/^['\"]|['\"]$/g, "").trim();
    if (key && value) out.push({ key, value });
  }
  return out;
}

function buildWebFormFillScript(intent: Intent): string | null {
  const appRaw = extractAppName(intent);
  const app = appRaw ? normalizeAppName(appRaw) : "Safari";
  const isBrowser = BROWSERS.some((b) => app.toLowerCase().includes(b));
  if (!isBrowser) return null;

  const fields = extractFormFields(intent.rawText);
  if (fields.length === 0) return null;

  const payload = JSON.stringify(fields).replace(/\\/g, "\\\\").replace(/\"/g, '\\\"');

  const js = [
    "(function(){",
    `const fields = JSON.parse(\"${payload}\");`,
    "const inputs = Array.from(document.querySelectorAll('input, textarea, select'))",
    "  .filter(el => el && !el.disabled && el.type !== 'hidden');",
    "let cursor = 0;",
    "const norm = (s) => (s || '').toLowerCase().trim();",
    "const labelTextFor = (el) => {",
    "  try {",
    "    const id = el.id ? document.querySelector(`label[for=\\\"${el.id}\\\"]`) : null;",
    "    const parent = el.closest('label');",
    "    return norm((id && id.innerText) || (parent && parent.innerText) || '');",
    "  } catch { return ''; }",
    "};",
    "const setValue = (el, value) => {",
    "  if (!el) return false;",
    "  try {",
    "    el.focus();",
    "    if (el.tagName === 'SELECT') {",
    "      const opt = Array.from(el.options).find(o => norm(o.textContent).includes(norm(value)) || norm(o.value) === norm(value));",
    "      if (opt) el.value = opt.value;",
    "    } else {",
    "      el.value = value;",
    "    }",
    "    el.dispatchEvent(new Event('input', { bubbles: true }));",
    "    el.dispatchEvent(new Event('change', { bubbles: true }));",
    "    return true;",
    "  } catch { return false; }",
    "};",
    "for (const f of fields) {",
    "  const k = norm(f.key);",
    "  const candidates = inputs.map((el, i) => ({ el, i, score: [",
    "    norm(el.name).includes(k) ? 5 : 0,",
    "    norm(el.id).includes(k) ? 5 : 0,",
    "    norm(el.placeholder).includes(k) ? 4 : 0,",
    "    norm(el.getAttribute('aria-label')).includes(k) ? 4 : 0,",
    "    labelTextFor(el).includes(k) ? 6 : 0,",
    "  ].reduce((a,b) => a+b, 0) }))",
    "  .sort((a,b) => b.score - a.score);",
    "  const pick = candidates.find(c => c.score > 0)?.el || inputs[cursor++] || null;",
    "  setValue(pick, f.value);",
    "}",
    "return true;",
    "})();",
  ].join("");

  const safeJs = escapeAppleScriptString(js);
  if (app === "Safari") {
    return `tell application \"Safari\"\nactivate\nif (count of windows) = 0 then make new document\ndo JavaScript \"${safeJs}\" in current tab of front window\nend tell`;
  }
  const safeApp = escapeAppleScriptString(app);
  return `tell application \"${safeApp}\"\nactivate\nexecute front window's active tab javascript \"${safeJs}\"\nend tell`;
}

function isDataEntryWorkflowText(text: string): boolean {
  return /\b(data\s*entry|nh[ậa]p\s*li[ệe]u|đi[ềe]n\s*d[ữu]\s*li[ệe]u)\b/i.test(text);
}

function buildDataEntryWorkflowNodes(intent: Intent): StateNode[] {
  const nodes: StateNode[] = [];
  const appRaw = extractAppName(intent);
  const app = appRaw ? normalizeAppName(appRaw) : null;
  const fields = extractFormFields(intent.rawText);

  if (app) {
    nodes.push(
      actionNode(
        "data-entry-activate",
        `Activate ${app}`,
        "app.activate",
        "deep",
        { name: app },
      ),
    );
  }

  if (fields.length > 0) {
    // Sequential keyboard data entry with explicit verify+retry for each field.
    let prevId = app ? "data-entry-activate" : null;
    fields.forEach((field, idx) => {
      const typeId = `data-entry-type-${idx}`;
      const verifyId = `data-entry-verify-${idx}`;
      nodes.push(
        actionNode(
          typeId,
          `Type ${field.key}`,
          "ui.type",
          "surface",
          { text: field.value },
          prevId ? [prevId] : [],
        ),
      );

      nodes.push({
        id: verifyId,
        type: "verify",
        layer: "surface",
        action: {
          description: `Verify field ${field.key}`,
          tool: "verify.screenshot",
          params: { field: field.key, expectedValue: field.value },
        },
        verify: {
          strategy: "screenshot",
          expected: `${field.key}:${field.value}`,
          timeoutMs: 10000,
        },
        dependencies: [typeId],
        onSuccess: null,
        onFailure: { strategy: "retry", maxRetries: 2 },
        estimatedDurationMs: 2500,
        priority: "normal",
      });

      prevId = verifyId;
      if (idx < fields.length - 1) {
        const tabId = `data-entry-tab-${idx}`;
        nodes.push(
          actionNode(
            tabId,
            "Move to next form field",
            "ui.key",
            "surface",
            { key: "Tab", modifiers: {} },
            [prevId],
          ),
        );
        prevId = tabId;
      }
    });
    return nodes;
  }

  // Fallback: type a quoted payload or the raw intent text.
  const payload = extractQuotedText(intent.rawText) ?? intent.rawText;
  nodes.push(
    actionNode(
      "data-entry-type",
      "Type provided data payload",
      "ui.type",
      "surface",
      { text: payload },
      app ? ["data-entry-activate"] : [],
    ),
  );

  return nodes;
}

function isMessagingIntentText(text: string): boolean {
  return /\b(message|send\s+message|chat\s+with|nh[aắ]n\s*tin|g[iử]i\s*tin\s*nh[aắ]n|message\s+for|nhắn|nhắn\s+tin|gửi\s+message|gửi\s+file|send\s+file|đính\s+kèm)\b/i.test(text);
}

async function buildMessagingScriptWithLLM(intent: Intent): Promise<string> {
  if (!isLlmRequired()) {
    throw new Error("No enabled LLM providers configured for messaging script generation.");
  }

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

    const parsed = parseLlmJson<{ script?: string }>(raw);
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

  // ── Quick email compose/send (UC6.2) ──
  if (/\b(send\s+email|compose\s+email|write\s+email|open\s+mail|mail\s+app|g[iử]i\s*email|thư\s*điện\s*tử|(?:email|mail)\b(?!\s*:))\b/i.test(text)) {
    const toMatch = intent.rawText.match(/\bto\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i)
      ?? intent.rawText.match(/\b(?:cho|tới)\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
    const subjectMatch = intent.rawText.match(/\bsubject\s*[:=]\s*(.+?)(?=\b(?:body|content|message)\b|$)/i)
      ?? intent.rawText.match(/\btiêu\s*đề\s*[:=]\s*(.+?)(?=\b(?:nội\s*dung|body|message)\b|$)/i);
    const bodyMatch = intent.rawText.match(/\b(?:body|content|message|nội\s*dung)\s*[:=]\s*(.+)$/i);
    const quoted = extractQuotedText(intent.rawText);
    const recipient = toMatch?.[1]?.trim();
    const subject = (subjectMatch?.[1] ?? "Quick note from OmniState").trim();
    const body = (bodyMatch?.[1] ?? quoted ?? "Sent from OmniState automation.").trim();
    const sendNow = /\b(send\s+now|send\b|g[iử]i\s*ngay|g[iử]i\b)\b/i.test(text);

    const safeSubject = escapeAppleScriptString(subject);
    const safeBody = escapeAppleScriptString(`${body}\n`);
    const recipientScript = recipient
      ? `make new to recipient at end of to recipients with properties {address:\"${escapeAppleScriptString(recipient)}\"}`
      : "";
    const sendScript = sendNow ? "send" : "";

    return [
      'tell application "Mail"',
      'activate',
      `set newMessage to make new outgoing message with properties {subject:\"${safeSubject}\", content:\"${safeBody}\", visible:true}`,
      'tell newMessage',
      recipientScript,
      sendScript,
      'end tell',
      'end tell',
    ].filter(Boolean).join("\n");
  }

  // ── Calendar scheduling (UC6.3) ──
  if (/\b(calendar|schedule|meeting|appointment|event|lịch|lịch\s*hẹn|cuộc\s*họp)\b/i.test(text)) {
    const title = extractQuotedText(intent.rawText)
      ?? intent.rawText.match(/\b(?:schedule|create|add|book)\s+(?:an?\s+)?(?:event|meeting)\s+(.+?)(?=\b(?:at|on|for|tomorrow|today)\b|$)/i)?.[1]?.trim()
      ?? intent.rawText.match(/\b(?:tạo|đặt)\s*(?:lịch|cuộc\s*họp|sự\s*kiện)\s+(.+?)(?=\b(?:lúc|vào|ngày\s*mai|hôm\s*nay|trong)\b|$)/i)?.[1]?.trim()
      ?? "OmniState Event";

    const hm = intent.rawText.match(/\b(?:at|lúc|vào)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    let hour = hm ? parseInt(hm[1], 10) : 9;
    const minute = hm?.[2] ? parseInt(hm[2], 10) : 0;
    const ampm = hm?.[3]?.toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;

    const durationMatch = intent.rawText.match(/\bfor\s+(\d{1,3})\s*(?:m|min|minutes?)\b/i)
      ?? intent.rawText.match(/\bfor\s+(\d{1,2})\s*(?:h|hours?)\b/i)
      ?? intent.rawText.match(/\btrong\s+(\d{1,3})\s*(?:phút|p)\b/i)
      ?? intent.rawText.match(/\btrong\s+(\d{1,2})\s*(?:giờ|h)\b/i);
    let durationMin = 60;
    if (durationMatch) {
      const v = parseInt(durationMatch[1], 10);
      durationMin = /h|hours?|giờ/i.test(durationMatch[0]) ? v * 60 : v;
    }

    const offsetDays = /\b(tomorrow|ngày\s*mai|mai)\b/i.test(text)
      ? 1
      : /\b(next\s+week|tuần\s*sau)\b/i.test(text)
        ? 7
        : 0;

    const safeTitle = escapeAppleScriptString(title);
    return [
      'set startDate to (current date)',
      offsetDays > 0 ? `set day of startDate to (day of startDate) + ${offsetDays}` : '',
      `set hours of startDate to ${Math.max(0, Math.min(23, hour))}`,
      `set minutes of startDate to ${Math.max(0, Math.min(59, minute))}`,
      `set endDate to startDate + ${Math.max(15, durationMin) * 60}`,
      'tell application "Calendar"',
      'activate',
      'tell calendar 1',
      `make new event with properties {summary:\"${safeTitle}\", start date:startDate, end date:endDate}`,
      'end tell',
      'end tell',
    ].filter(Boolean).join("\n");
  }

  // ── Reminder / alarm / timer (UC6.4) ──
  if (/\b(reminder|nhắc\s*nhở|alarm|báo\s*thức|timer|hẹn\s*giờ|đếm\s*ngược)\b/i.test(text)) {
    const title = extractQuotedText(intent.rawText)
      ?? intent.rawText.match(/\b(?:remind|reminder|nhắc\s*nhở)\s+(?:me\s+)?(?:to\s+)?(.+?)(?=\b(?:at|in|lúc|trong|on|vào)\b|$)/i)?.[1]?.trim()
      ?? "OmniState reminder";

    const inMinutesMatch = intent.rawText.match(/\b(?:in|trong)\s*(\d{1,3})\s*(?:m|min|minutes?|phút)\b/i);
    const inHoursMatch = intent.rawText.match(/\b(?:in|trong)\s*(\d{1,2})\s*(?:h|hours?|giờ)\b/i);
    const hm = intent.rawText.match(/\b(?:at|lúc|vào)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);

    if (/\b(timer|đếm\s*ngược)\b/i.test(text)) {
      const delaySeconds = inMinutesMatch
        ? parseInt(inMinutesMatch[1], 10) * 60
        : inHoursMatch
          ? parseInt(inHoursMatch[1], 10) * 3600
          : 300;
      const notifyMsg = escapeAppleScriptString(title);
      return [
        `do shell script \"nohup /bin/sh -c 'sleep ${Math.max(5, delaySeconds)}; osascript -e \\\"display notification \\\\\\\"${notifyMsg}\\\\\\\" with title \\\\\\\"OmniState Timer\\\\\\\"\\\"; afplay /System/Library/Sounds/Glass.aiff' >/dev/null 2>&1 &\"`,
        'display notification "Timer started" with title "OmniState"',
      ].join("\n");
    }

    let hour = hm ? parseInt(hm[1], 10) : 9;
    const minute = hm?.[2] ? parseInt(hm[2], 10) : 0;
    const ampm = hm?.[3]?.toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    const offsetSec = inMinutesMatch
      ? parseInt(inMinutesMatch[1], 10) * 60
      : inHoursMatch
        ? parseInt(inHoursMatch[1], 10) * 3600
        : 0;

    const safeTitle = escapeAppleScriptString(title);
    return [
      'set dueDate to (current date)',
      offsetSec > 0 ? `set dueDate to dueDate + ${offsetSec}` : '',
      offsetSec === 0 ? `set hours of dueDate to ${Math.max(0, Math.min(23, hour))}` : '',
      offsetSec === 0 ? `set minutes of dueDate to ${Math.max(0, Math.min(59, minute))}` : '',
      'tell application "Reminders"',
      'activate',
      'tell list "Reminders"',
      `set r to make new reminder with properties {name:\"${safeTitle}\"}`,
      'set due date of r to dueDate',
      'end tell',
      'end tell',
    ].filter(Boolean).join("\n");
  }

  // ── Auto-fill web form ──
  if (/\b(fill|autofill|form|đi[ềe]n\s*form|bi[ểe]u\s*m[ẫa]u)\b/i.test(text)) {
    const formScript = buildWebFormFillScript(intent);
    if (formScript) return formScript;
  }

  // ── Browser history/cache management (UC4.7) ──
  if (/\b(clear|delete|x[oó]a|d[ọo]n)\b.*\b(history|cache|cookies|browsing data)\b/i.test(text) && isBrowser && app) {
    if (app === "Safari") {
      return [
        'tell application "Safari" to activate',
        'tell application "System Events"',
        'tell process "Safari"',
        'click menu item "Clear History..." of menu "History" of menu bar 1',
        'delay 0.2',
        'keystroke return',
        'end tell',
        'end tell',
      ].join("\n");
    }

    const safeBrowser = escapeAppleScriptString(app);
    return [
      `tell application "${safeBrowser}" to activate`,
      'tell application "System Events" to key code 51 using {command down, shift down}',
    ].join("\n");
  }

  if (/\b(open|show|view)\b.*\b(history)\b/i.test(text) && isBrowser && app) {
    const safeBrowser = escapeAppleScriptString(app);
    return [
      `tell application "${safeBrowser}" to activate`,
      'tell application "System Events" to keystroke "y" using {command down}',
    ].join("\n");
  }

  // ── Vietnamese navigation: "truy cập X" / "vào trang X" ──
  // e.g. "Truy cập youtube" → navigate to youtube.com in current browser
  if (/^(?:truy\s*cập|vào\s*(?:trang|web|website)?)\s+/i.test(text)) {
    const navTarget = intent.rawText.match(/^(?:truy\s*cập|vào\s*(?:trang|web|website)?)\s+(.+)/i)?.[1]?.trim() ?? "";
    let navUrl = navTarget;
    if (!navUrl.startsWith("http")) {
      // Well-known sites
      const siteMap: Record<string, string> = {
        "youtube": "https://www.youtube.com",
        "google": "https://www.google.com",
        "facebook": "https://www.facebook.com",
        "tiktok": "https://www.tiktok.com",
        "instagram": "https://www.instagram.com",
        "github": "https://github.com",
        "gmail": "https://mail.google.com",
      };
      const lowerTarget = navUrl.toLowerCase();
      const known = Object.entries(siteMap).find(([k]) => lowerTarget.includes(k));
      navUrl = known ? known[1] : `https://${navUrl}`;
    }
    const safeNavUrl = escapeAppleScriptString(navUrl);
    const targetBrowser = app ?? "Safari";
    if (targetBrowser === "Safari") {
      return `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${safeNavUrl}"\nend tell`;
    }
    return `tell application "${escapeAppleScriptString(targetBrowser)}"\nactivate\nif (count of windows) = 0 then make new window\nset URL of active tab of front window to "${safeNavUrl}"\nend tell`;
  }

  // ── "Mở X trên Safari/Chrome" — navigate to X in specified browser ──
  // e.g. "Mở video đầu tiên của youtube trên Safari"
  // e.g. "Mở youtube bằng safari"
  if (/^(?:mở|open)\s+.+\s+(?:trên|bằng|qua|trong)\s+(?:safari|chrome|firefox|brave|arc|edge|cốc\s*cốc|trình\s*duyệt)/i.test(text)) {
    const browserFromText = text.match(/(?:trên|bằng|qua|trong)\s+(safari|chrome|firefox|brave|arc|edge)/i)?.[1] ?? "Safari";
    const targetBrowser2 = normalizeAppName(browserFromText);
    const queryPart = intent.rawText.match(/^(?:mở|open)\s+(.+?)\s+(?:trên|bằng|qua|trong)\s+/i)?.[1]?.trim() ?? "";
    const queryLower = queryPart.toLowerCase();

    // Check if it's a YouTube request
    if (/youtube/i.test(queryPart)) {
      const isFirstVideo = /\b(?:video\s*đầu\s*tiên|đầu\s*tiên|first\s*video|first\s*result)\b/i.test(queryPart);
      const ytUrl = "https://www.youtube.com";
      const safeYtUrl = escapeAppleScriptString(ytUrl);
      if (isFirstVideo && targetBrowser2 === "Safari") {
        const firstVideoJs = escapeAppleScriptString(
          'setTimeout(function(){' +
          'var sel="ytd-video-renderer a#video-title,ytd-rich-item-renderer a#video-title-link,ytd-compact-video-renderer a#video-title";' +
          'var l=document.querySelector(sel);' +
          'if(l){l.click();}' +
          'else{var links=document.querySelectorAll("a[href*=\\"/watch\\"]");if(links.length>0)links[0].click();}' +
          '},2000);'
        );
        return `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${safeYtUrl}"\ndelay 2.5\ndo JavaScript "${firstVideoJs}" in current tab of front window\nend tell`;
      }
      if (targetBrowser2 === "Safari") {
        return `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${safeYtUrl}"\nend tell`;
      }
      return `tell application "${escapeAppleScriptString(targetBrowser2)}"\nactivate\nif (count of windows) = 0 then make new window\nset URL of active tab of front window to "${safeYtUrl}"\nend tell`;
    }

    // Generic: try to construct a URL from the query
    const siteMap2: Record<string, string> = {
      "google": "https://www.google.com",
      "facebook": "https://www.facebook.com",
      "tiktok": "https://www.tiktok.com",
      "instagram": "https://www.instagram.com",
      "github": "https://github.com",
    };
    const knownSite = Object.entries(siteMap2).find(([k]) => queryLower.includes(k));
    const navigateUrl = knownSite
      ? knownSite[1]
      : `https://www.google.com/search?q=${encodeURIComponent(queryPart)}`;
    const safeNavigateUrl = escapeAppleScriptString(navigateUrl);
    if (targetBrowser2 === "Safari") {
      return `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${safeNavigateUrl}"\nend tell`;
    }
    return `tell application "${escapeAppleScriptString(targetBrowser2)}"\nactivate\nif (count of windows) = 0 then make new window\nset URL of active tab of front window to "${safeNavigateUrl}"\nend tell`;
  }

  // ── Browser + YouTube search flow ──
  // Example: "open youtube on safari and play video first in search '...'
  if (isBrowser && /\byoutube\b/i.test(text)) {
    const searchMatch = intent.rawText.match(/\bsearch\s+["'""]?(.+?)["'""]?$/i);
    const openOnYoutubeMatch = intent.rawText.match(/\bopen\s+(.+?)\s+on\s+youtube\b/i);
    // Vietnamese: "mở X trên youtube" / "tìm X trên youtube"
    const viYoutubeMatch = intent.rawText.match(/\b(?:mở|tìm|xem)\s+(.+?)\s+(?:trên|trong|của)\s+youtube\b/i)
      ?? intent.rawText.match(/\byoutube\b.*\b(?:tìm|search)\s+(.+?)(?:\s*$)/i);
    const query = searchMatch?.[1]?.trim() ?? openOnYoutubeMatch?.[1]?.trim() ?? viYoutubeMatch?.[1]?.trim();
    const url = query
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      : "https://www.youtube.com";
    const safeUrl = escapeAppleScriptString(url);

    if (app === "Safari") {
      // Extended: detect Vietnamese "video đầu tiên" in addition to English
      if (/\b(play|first video|video first|video\s*đầu\s*tiên|mở\s*video\s*đầu|xem\s*video\s*đầu|đầu\s*tiên)\b/i.test(text)) {
        const firstVideoJsYT = escapeAppleScriptString(
          'setTimeout(function(){' +
          'var sel="ytd-video-renderer a#video-title,ytd-rich-item-renderer a#video-title-link,ytd-compact-video-renderer a#video-title";' +
          'var l=document.querySelector(sel);' +
          'if(l){l.click();}' +
          'else{var links=document.querySelectorAll("a[href*=\\"/watch\\"]");if(links.length>0)links[0].click();}' +
          '},2000);'
        );
        return `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${safeUrl}"\ndelay 2.5\ndo JavaScript "${firstVideoJsYT}" in current tab of front window\nend tell`;
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

  // ── Split/tile window left/right ──
  if (/\b(split|tile|snap|arrange)\b/i.test(text) && /\b(left|right)\b/i.test(text)) {
    const sideKey = /\bleft\b/i.test(text) ? "left arrow" : "right arrow";
    return `tell application "System Events" to keystroke ${sideKey} using {control down, option down, command down}`;
  }

  // ── Volume ──
  if (/\bvolume\s*(up|down)\b/i.test(text)) {
    const dir = /\bup\b/i.test(text) ? "output volume of (get volume settings) + 10" : "output volume of (get volume settings) - 10";
    return `set volume output volume (${dir})`;
  }

  // ── Incognito/private tab (UC4.x) ──
  if (/\b(incognito|private|ẩn\s*danh|private\s*tab|tab\s*ẩn\s*danh)\b/i.test(text)) {
    if (app === "Safari") {
      return 'tell application "Safari"\nactivate\nend tell\ntell application "System Events" to keystroke "n" using {command down, shift down}';
    }
    if (app) {
      return `tell application "${safeApp}" to activate\ntell application "System Events" to keystroke "n" using {command down, shift down}`;
    }
    return 'tell application "System Events" to keystroke "n" using {command down, shift down}';
  }

  // ── Copy current tab URL to clipboard ──
  if (/\b(copy|sao\s*chép)\b.*\b(url|link|đường\s*link|địa\s*chỉ)\b/i.test(text)) {
    if (app === "Safari") {
      return 'tell application "Safari"\nset theURL to URL of current tab of front window\nend tell\nset the clipboard to theURL\ndisplay notification "URL copied to clipboard" with title "OmniState"';
    }
    if (app) {
      return `tell application "${safeApp}"\nset theURL to URL of active tab of front window\nend tell\nset the clipboard to theURL\ndisplay notification "URL copied to clipboard" with title "OmniState"`;
    }
  }

  // ── Find/search in page ──
  if (/\b(find\s+in\s+page|search\s+in\s+page|tìm\s+(?:trên\s+trang|từ|keyword|text))\b/i.test(text)) {
    if (app === "Safari") {
      return 'tell application "Safari" to activate\ntell application "System Events" to keystroke "f" using {command down}';
    }
    if (app) {
      return `tell application "${safeApp}" to activate\ntell application "System Events" to keystroke "f" using {command down}`;
    }
  }

  // ── Download first image on page ──
  if (/\b(download|tải)\b.*\b(first|đầu\s*tiên)\b.*\b(image|ảnh|hình)\b/i.test(text) && isBrowser && app) {
    const js = escapeAppleScriptString(
      'var imgs=document.querySelectorAll("img[src]");if(imgs.length>0){var a=document.createElement("a");a.href=imgs[0].src;a.download="image_"+(new Date().getTime());document.body.appendChild(a);a.click();document.body.removeChild(a);}else{alert("No images found on page");}'
    );
    if (app === "Safari") {
      return `tell application "Safari"\nactivate\ndo JavaScript "${js}" in current tab of front window\nend tell`;
    }
    return `tell application "${safeApp}"\nactivate\nexecute front window's active tab javascript "${js}"\nend tell`;
  }

  // ── Open Google Docs/Drive in browser ──
  if (/\b(google\s*docs?|google\s*drive)\b/i.test(text)) {
    const isNewDoc = /\b(new|tạo\s*mới|create)\b/i.test(text);
    const url = isNewDoc ? "https://docs.new" : (/\bdrive\b/i.test(text) ? "https://drive.google.com" : "https://docs.google.com");
    const targetApp = app ?? "Safari";
    if (targetApp === "Safari") {
      return `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${url}"\nend tell`;
    }
    return `tell application "${escapeAppleScriptString(targetApp)}"\nactivate\nif (count of windows) = 0 then make new window\nset URL of active tab of front window to "${url}"\nend tell`;
  }

  // ── Translate clipboard text in browser ──
  if (/\b(dịch|translate)\b.*\b(clipboard|bộ\s*nhớ\s*tạm)\b/i.test(text)) {
    const langMatch = intent.rawText.match(/\b(?:sang|to|into)\s+(?:tiếng\s*)?(\w+)\b/i);
    const targetLang = langMatch?.[1]?.toLowerCase() ?? "vi";
    const langCode = ({"vietnamese": "vi", "english": "en", "chinese": "zh-CN", "trung": "zh-CN", "anh": "en", "việt": "vi"} as Record<string, string>)[targetLang] ?? targetLang;
    return `set clipText to (the clipboard as string)\nset encodedURL to "https://translate.google.com/?sl=auto&tl=${langCode}&text=" & my encodeURL(clipText)\ntell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to encodedURL\nend tell\non encodeURL(str)\n  set theResult to do shell script "python3 -c \\"import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))\\" " & quoted form of str\n  return theResult\nend encodeURL`;
  }

  // ── Dark mode / Light mode toggle ──
  if (/\b(dark\s*mode|chế\s*độ\s*tối)\b/i.test(text)) {
    return 'tell application "System Events" to tell appearance preferences to set dark mode to true\ndisplay notification "Dark mode enabled" with title "OmniState"';
  }
  if (/\b(light\s*mode|chế\s*độ\s*sáng)\b/i.test(text)) {
    return 'tell application "System Events" to tell appearance preferences to set dark mode to false\ndisplay notification "Light mode enabled" with title "OmniState"';
  }

  // ── Night Shift ──
  if (/\b(night\s*shift|giảm\s*ánh\s*sáng\s*xanh)\b/i.test(text)) {
    return 'do shell script "defaults write com.apple.CoreBrightness.plist CBUser-0 -dict-add CBNightShiftEnabled -bool TRUE 2>/dev/null || true"\ntell application "System Preferences"\nactivate\nreveal anchor "displaysDisplayTab" of pane id "com.apple.preference.displays"\nend tell\ndisplay notification "Night Shift: open System Preferences to toggle" with title "OmniState"';
  }

  // ── Wallpaper change ──
  if (/\b(wallpaper|hình\s*nền|desktop\s*background|ảnh\s*nền)\b/i.test(text)) {
    return `do shell script "RAND=$(ls ~/Pictures/*.{jpg,png,jpeg,JPG,PNG} 2>/dev/null | shuf -n1 || ls ~/Desktop/*.{jpg,png,jpeg,JPG,PNG} 2>/dev/null | shuf -n1); if [ -n \\"$RAND\\" ]; then osascript -e \\"tell application \\\\\\\"System Events\\\\\\\" to tell every desktop to set picture to \\\\\\"$RAND\\\\\\"\\"; echo \\"Wallpaper changed to $RAND\\"; else echo \\"No images found. Add images to ~/Pictures\\"; fi"`;
  }

  // ── Show hidden files in Finder ──
  if (/\b(show|hiển\s*thị)\b.*\b(hidden\s*file|file\s*ẩn|ẩn)\b/i.test(text)) {
    return 'do shell script "defaults write com.apple.finder AppleShowAllFiles TRUE && killall Finder"\ndisplay notification "Hidden files are now visible" with title "OmniState"';
  }
  if (/\b(hide|ẩn)\b.*\b(hidden\s*file|file\s*ẩn)\b/i.test(text)) {
    return 'do shell script "defaults write com.apple.finder AppleShowAllFiles FALSE && killall Finder"\ndisplay notification "Hidden files are now hidden" with title "OmniState"';
  }

  // ── AirDrop mode ──
  if (/\bairdrop\b/i.test(text)) {
    const mode = /\b(everyone|mọi\s*người)\b/i.test(text) ? "3" : (/\b(contacts\s*only|chỉ\s*danh\s*bạ)\b/i.test(text) ? "2" : "1");
    return `do shell script "defaults write com.apple.NetworkBrowser BrowseAllInterfaces ${mode === "3" ? "1" : "0"}"\ntell application "Finder"\nactivate\nopen folder "AirDrop" of (path to desktop folder)\nend tell\ndisplay notification "AirDrop opened — set mode to ${mode === "3" ? "Everyone" : mode === "2" ? "Contacts Only" : "Receiving Off"}" with title "OmniState"`;
  }

  // ── Zalo file send via UI automation ──
  if (/\b(zalo)\b/i.test(text) && /\b(gửi\s*file|send\s*file|đính\s*kèm|attach|upload)\b/i.test(text)) {
    const fileMatch = intent.rawText.match(/\b([\w\s.-]+\.\w{2,5})\b/);
    const fileName = fileMatch?.[1]?.trim() ?? "";
    const targetMatch = intent.rawText.match(/\b(?:vào|to|cho|into|tới)\s+(.+?)(?:\s+(?:and|rồi|xong|then)|$)/i);
    const target = targetMatch?.[1]?.trim() ?? "Cloud của tôi";
    const safeTarget = escapeAppleScriptString(target);
    const safeFileName = escapeAppleScriptString(fileName);
    return [
      'tell application "Zalo" to activate',
      'delay 1',
      'tell application "System Events"',
      '  tell process "Zalo"',
      '    -- Search for target contact/group',
      '    keystroke "f" using {command down}',
      '    delay 0.5',
      `    keystroke "${safeTarget}"`,
      '    delay 0.8',
      '    key code 36',
      '    delay 0.8',
      '    -- Open file attach dialog',
      '    keystroke "o" using {command down, shift down}',
      '    delay 1',
      safeFileName ? `    -- Type filename in open dialog\n    keystroke "${safeFileName}"` : '',
      '  end tell',
      'end tell',
    ].filter(Boolean).join("\n");
  }

  // ── Zalo screenshot + paste ──
  if (/\b(chụp\s*màn\s*hình|screenshot)\b.*\b(dán|paste)\b.*\b(zalo|chat|telegram)\b/i.test(text)) {
    const targetApp = /\btelegram\b/i.test(text) ? "Telegram" : "Zalo";
    return [
      'do shell script "screencapture -c"',
      'delay 0.3',
      `tell application "${targetApp}" to activate`,
      'delay 0.5',
      'tell application "System Events" to keystroke "v" using {command down}',
      'display notification "Screenshot pasted into ' + targetApp + '" with title "OmniState"',
    ].join("\n");
  }

  // ── Zalo DND / status ──
  if (/\b(do\s*not\s*disturb|không\s*làm\s*phiền|dnd)\b.*\b(zalo|telegram|messages)\b/i.test(text)) {
    return 'do shell script "defaults write com.apple.notificationcenterui doNotDisturb -boolean true; killall NotificationCenter 2>/dev/null || true"\ndisplay notification "Do Not Disturb enabled" with title "OmniState"';
  }

  // ── Auto-reply Zalo ──
  if (/\b(tự\s*động\s*trả\s*lời|auto\s*reply|trả\s*lời\s*tự\s*động)\b.*\b(zalo)\b/i.test(text)) {
    return `display notification "Auto-reply for Zalo is not natively scriptable. Set up via Zalo settings or use Focus/DND mode." with title "OmniState"\ntell application "Zalo" to activate`;
  }

  // ── Sticker send ──
  if (/\b(sticker|nhãn\s*dán)\b.*\b(gửi|send)\b/i.test(text) || /\b(gửi|send)\b.*\b(sticker|nhãn\s*dán)\b/i.test(text)) {
    if (app) {
      return `tell application "${safeApp}" to activate\ntell application "System Events"\ntell process "${safeApp}"\nkeystroke "s" using {command down, shift down}\nend tell\nend tell\ndisplay notification "Sticker panel opened" with title "OmniState"`;
    }
  }

  // ── Close all apps except specified ──
  if (/\b(đóng\s*tất\s*cả|close\s*all)\b.*\b(trừ|except)\b/i.test(text)) {
    const exceptMatch = intent.rawText.match(/\b(?:trừ|except)\b(.+)$/i);
    const exceptApps = (exceptMatch?.[1] ?? "Terminal Safari")
      .split(/[\s,&]+/)
      .filter(Boolean)
      .map(a => escapeAppleScriptString(normalizeAppName(a)))
      .map(a => `"${a}"`)
      .join(", ");
    return [
      'set keepApps to {' + exceptApps + ', "Finder"}',
      'tell application "System Events"',
      '  set runningApps to name of every process whose background only is false',
      '  repeat with appName in runningApps',
      '    if keepApps does not contain appName then',
      '      try',
      '        tell application appName to quit',
      '      end try',
      '    end if',
      '  end repeat',
      'end tell',
    ].join("\n");
  }

  // ── Stopwatch in Terminal ──
  if (/\b(bấm\s*giờ|stopwatch|đồng\s*hồ\s*bấm\s*giờ|start.*count)\b/i.test(text)) {
    return 'tell application "Terminal"\nactivate\ndo script "echo Starting stopwatch...; START=$(date +%s); while true; do ELAPSED=$(($(date +%s)-START)); printf \"\\r%02d:%02d:%02d\" $((ELAPSED/3600)) $(((ELAPSED%3600)/60)) $((ELAPSED%60)); sleep 1; done"\nend tell';
  }

  // ── Multiple alarms via Reminders ──
  if (/\b(đặt\s*báo\s*thức|set\s*alarm)\b/i.test(text)) {
    const times = [...intent.rawText.matchAll(/\b(\d{1,2})(?:h|:(\d{2}))?\s*(sáng|tối|am|pm)?\b/gi)];
    if (times.length >= 2) {
      const lines = times.slice(0, 5).map((m, i) => {
        let h = parseInt(m[1], 10);
        const min = m[2] ? parseInt(m[2], 10) : 0;
        const ampm = m[3]?.toLowerCase();
        if ((ampm === "pm" || ampm === "tối") && h < 12) h += 12;
        if ((ampm === "am" || ampm === "sáng") && h === 12) h = 0;
        return [
          `set alarm${i} to (current date)`,
          `set hours of alarm${i} to ${h}`,
          `set minutes of alarm${i} to ${min}`,
          `set seconds of alarm${i} to 0`,
          `set r${i} to make new reminder with properties {name:"OmniState Alarm ${h}:${min.toString().padStart(2,"0")}", due date:alarm${i}}`,
        ].join("\n");
      });
      return ['tell application "Reminders"', 'activate', 'tell list "Reminders"', ...lines, 'end tell', 'end tell'].join("\n");
    }
  }

  // ── Delete all alarms ──
  if (/\b(xóa\s*(?:tất\s*cả\s*)?báo\s*thức|delete\s*(?:all\s*)?alarms?|xóa\s*báo\s*thức)\b/i.test(text)) {
    return 'tell application "Reminders"\nactivate\ntell list "Reminders"\ndelete (every reminder whose name starts with "OmniState Alarm" or name starts with "Alarm")\nend tell\nend tell\ndisplay notification "All alarms deleted" with title "OmniState"';
  }

  // ── Shopping checklist via Reminders ──
  if (/\b(checklist|danh\s*sách\s*(?:mua|việc|cần\s*mua)|shopping\s*list)\b/i.test(text)) {
    const title = extractQuotedText(intent.rawText) ?? "Shopping List";
    const safeTitle = escapeAppleScriptString(title);
    return `tell application "Reminders"\nactivate\nset newList to make new list with properties {name:"${safeTitle}"}\ntell newList\n  make new reminder with properties {name:"Item 1"}\n  make new reminder with properties {name:"Item 2"}\nend tell\nend tell\ndisplay notification "Checklist '${safeTitle}' created in Reminders" with title "OmniState"`;
  }

  // ── Weather lookup ──
  if (/\b(thời\s*tiết|weather)\b/i.test(text)) {
    const cityMatch = intent.rawText.match(/\b(?:tại|at|in|ở)\s+([A-Za-zÀ-ỹ\s]{2,30}?)(?=\s+(?:hôm\s*nay|today|ngày\s*mai|tomorrow)|$)/i);
    const city = cityMatch?.[1]?.trim() ?? "Ho Chi Minh City";
    const safeCity = city.replace(/\s+/g, "+");
    return `do shell script "curl -s 'wttr.in/${safeCity}?format=3' 2>/dev/null || echo 'Could not fetch weather'"\ndisplay notification "Weather fetched for ${city}" with title "OmniState"`;
  }

  // ── Maps/directions ──
  if (/\b(bản\s*đồ|maps?|chỉ\s*đường|directions?|tìm\s*đường)\b/i.test(text)) {
    const destMatch = intent.rawText.match(/\b(?:đến|to|tới|toward|at)\s+([A-Za-zÀ-ỹ\s0-9.,]+?)(?=\s*$)/i);
    const dest = destMatch?.[1]?.trim() ?? "";
    if (dest) {
      return `do shell script "open 'maps://?q=${encodeURIComponent(dest).replace(/'/g, "\\'")}'"`;
    }
    return 'tell application "Maps" to activate';
  }

  // ── Screen recording ──
  if (/\b(quay|record)\b.*\b(màn\s*hình|screen|desktop)\b/i.test(text)) {
    return 'tell application "System Events" to keystroke "5" using {command down, shift down}\ndisplay notification "Screen recording controls opened (Cmd+Shift+5)" with title "OmniState"';
  }

  // ── CSV column extract ──
  if (/\b(csv|\.csv)\b.*\b(cột|column|email)\b/i.test(text)) {
    const fileMatch = intent.rawText.match(/\b([\w.-]+\.csv)\b/i);
    const csvFile = fileMatch?.[1] ?? "data.csv";
    const colMatch = intent.rawText.match(/\b(?:cột|column)\s+(?:tên\s+)?["']?(\w+)["']?/i);
    const col = colMatch?.[1] ?? "email";
    return `do shell script "if [ -f ~/${csvFile} ]; then awk -F',' 'NR==1{for(i=1;i<=NF;i++) if(tolower($i)==\\"${col}\\") col=i} NR>1 && col{print $col}' ~/${csvFile} > ~/Desktop/${col}_export.txt && echo \\"Exported to ~/Desktop/${col}_export.txt\\" || echo \\"Column ${col} not found\\"; else echo \\"File ~/${csvFile} not found\\"; fi"`;
  }

  // ── Compare two files ──
  if (/\b(so\s*sánh|compare|diff)\b.*\b(file|tập\s*tin|văn\s*bản)\b/i.test(text)) {
    const files = [...intent.rawText.matchAll(/\b([\w.-]+\.\w{2,5})\b/g)].map(m => m[1]);
    if (files.length >= 2) {
      return `do shell script "diff ~/${files[0]} ~/${files[1]} 2>/dev/null | head -60 || echo 'Files not found'"`;
    }
    return `tell application "Terminal"\nactivate\ndo script "echo 'Usage: diff file1.txt file2.txt'"\nend tell`;
  }

  // ── Battery below threshold → power save ──
  if (/\b(pin|battery)\b.*\b(dưới|below|under)\s*\d+%/i.test(text)) {
    return 'do shell script "BATT=$(pmset -g batt | grep -o \'[0-9]*%\' | head -1 | tr -d \'%\'); if [ -n \\"$BATT\\" ] && [ \\"$BATT\\" -lt 20 ]; then pmset -a lowpowermode 1; osascript -e \'display notification \\"Battery below 20% — Power save mode enabled\\" with title \\"OmniState\\"\'; else echo \\"Battery at $BATT% — no action needed\\"; fi"';
  }

  // ── Find large files ──
  if (/\b(file\s*nặng\s*hơn|lớn\s*hơn|larger?\s*than|nặng\s*hơn|>\s*1\s*GB|greater\s*than\s*1\s*GB)\b/i.test(text)) {
    const sizeMatch = intent.rawText.match(/(\d+)\s*(?:GB|MB|gb|mb)/i);
    const size = sizeMatch ? `+${sizeMatch[1]}${sizeMatch[0].includes("G") || sizeMatch[0].includes("g") ? "G" : "M"}` : "+1G";
    return `do shell script "find ~ -size ${size} -not -path '*/Library/*' -not -path '*/.Trash/*' 2>/dev/null | head -20 | xargs du -sh 2>/dev/null | sort -hr | head -20"`;
  }

  // ── Exchange rate ──
  if (/\b(tỷ\s*giá|exchange\s*rate)\b/i.test(text)) {
    const saveToFile = /\b(lưu|save|excel|xlsx|csv)\b/i.test(text);
    if (saveToFile) {
      return 'do shell script "curl -s \'https://api.exchangerate-api.com/v4/latest/USD\' | python3 -c \\"import json,sys,csv; d=json.load(sys.stdin); w=csv.writer(open(os.path.expanduser(\'~/Desktop/exchange_rates.csv\'),\'w\')); [w.writerow([k,v]) for k,v in d[\'rates\'].items()]; print(\'Saved to Desktop/exchange_rates.csv\')\\" 2>/dev/null || echo \'Install python3 to use this feature\'"';
    }
    return 'do shell script "curl -s \'https://api.exchangerate-api.com/v4/latest/USD\' | python3 -c \\"import json,sys; d=json.load(sys.stdin); r=d.get(\'rates\',{}); print(\'USD/VND:\',r.get(\'VND\',\'N/A\')); print(\'USD/EUR:\',r.get(\'EUR\',\'N/A\')); print(\'USD/JPY:\',r.get(\'JPY\',\'N/A\'))\\" 2>/dev/null || open \'https://vietcombank.com.vn/KHCN/Cong-cu-tien-ich/Ty-gia\'"';
  }

  return null;
}

/**
 * Build a keyboard shortcut action for app-control.
 * Returns params for the ui.key orchestrator tool.
 */
function buildKeyboardAction(intent: Intent): Record<string, unknown> | null {
  const text = intent.rawText.toLowerCase();

  // Bookmark current page (UC4.6)
  if (/\b(bookmark|save\s+page|lưu\s+trang\s+dấu|d[ấa]u\s+trang)\b/i.test(text)) {
    return { key: "d", modifiers: { meta: true } };
  }

  // Open bookmarks view/manager (UC4.6)
  if (/\b(open|show|view)\b.*\b(bookmark|bookmarks)\b/i.test(text)) {
    return { key: "b", modifiers: { meta: true, shift: true } };
  }

  // History/cache management (UC4.7)
  if (/\b(open|show|view)\b.*\b(history)\b/i.test(text)) {
    return { key: "y", modifiers: { meta: true } };
  }
  if (/\b(clear|delete|x[oó]a|d[ọo]n)\b.*\b(history|cache|cookies|browsing data)\b/i.test(text)) {
    return { key: "backspace", modifiers: { meta: true, shift: true } };
  }

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

  // Split/tile window left/right → Ctrl+Option+Cmd+Arrow
  if (/\b(split|tile|snap|arrange)\b/i.test(text) && /\bleft\b/i.test(text)) {
    return { key: "left", modifiers: { meta: true, control: true, alt: true } };
  }
  if (/\b(split|tile|snap|arrange)\b/i.test(text) && /\bright\b/i.test(text)) {
    return { key: "right", modifiers: { meta: true, control: true, alt: true } };
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

  // Find in page → Cmd+F
  if (/\b(find\s+in\s+page|search\s+in\s+page|tìm\s+(?:trên\s+trang|từ|keyword)|tìm\s+kiếm.*trang)\b/i.test(text)) {
    return { key: "f", modifiers: { meta: true } };
  }

  // Incognito/private tab → Cmd+Shift+N
  if (/\b(incognito|private|ẩn\s*danh|private\s*tab|tab\s*ẩn\s*danh)\b/i.test(text)) {
    return { key: "n", modifiers: { meta: true, shift: true } };
  }

  // Copy URL → Cmd+L then Cmd+C (select address bar then copy)
  if (/\b(copy|sao\s*chép)\b.*\b(url|link|đường\s*link|địa\s*chỉ)\b/i.test(text)) {
    return { key: "l", modifiers: { meta: true } };
  }

  // Open history (Vietnamese) → Cmd+Y
  if (/\b(lịch\s*sử|history)\b/i.test(text)) {
    return { key: "y", modifiers: { meta: true } };
  }

  // Screen recording → Cmd+Shift+5
  if (/\b(quay|record)\b.*\b(màn\s*hình|screen)\b/i.test(text)) {
    return { key: "5", modifiers: { meta: true, shift: true } };
  }

  // Screenshot region to clipboard → Cmd+Ctrl+Shift+4
  if (/\b(chụp|screenshot)\b.*\b(vùng|region|area)\b.*\b(clipboard)\b/i.test(text)) {
    return { key: "4", modifiers: { meta: true, control: true, shift: true } };
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
      if (/airplane/.test(text)) {
        return {
          name: "shell.exec",
          params: {
            command:
              "networksetup -setairportpower en0 off && if command -v blueutil >/dev/null 2>&1; then blueutil --power 0; else echo 'Install blueutil to toggle Bluetooth from CLI'; fi && echo 'Airplane-like mode applied (Wi-Fi off, Bluetooth off if available). '",
          },
        };
      }

      if (/(turn\s*on|enable|bật).*(wifi|wi-fi|wireless)/.test(text)) {
        return { name: "shell.exec", params: { command: "networksetup -setairportpower en0 on && networksetup -getairportpower en0" } };
      }
      if (/(turn\s*off|disable|tắt).*(wifi|wi-fi|wireless)/.test(text)) {
        return { name: "shell.exec", params: { command: "networksetup -setairportpower en0 off && networksetup -getairportpower en0" } };
      }

      if (/(connect|join|kết\s*nối).*(wifi|wi-fi|wireless)/.test(text)) {
        const ssidMatch = intent.rawText.match(/\b(?:ssid|wifi|network)\s*[:=]\s*['\"]?([^'\"]+)['\"]?/i)
          ?? intent.rawText.match(/\b(?:to|vào)\s+['\"]([^'\"]+)['\"]/i);
        const passMatch = intent.rawText.match(/\b(?:password|pass|mật\s*khẩu)\s*[:=]\s*['\"]?([^'\"]+)['\"]?/i);
        const ssid = ssidMatch?.[1]?.trim();
        const password = passMatch?.[1]?.trim();

        if (ssid) {
          const escapedSsid = ssid.replace(/"/g, '\\"');
          const escapedPass = (password ?? "").replace(/"/g, '\\"');
          const command = password
            ? `networksetup -setairportnetwork en0 \"${escapedSsid}\" \"${escapedPass}\" && echo 'Connected to ${escapedSsid}'`
            : `networksetup -setairportnetwork en0 \"${escapedSsid}\" && echo 'Connected to ${escapedSsid}'`;
          return { name: "shell.exec", params: { command } };
        }

        return { name: "shell.exec", params: { command: "echo 'Specify SSID with: wifi: <name> (and optional password).'; networksetup -listpreferredwirelessnetworks en0 2>/dev/null | head -20" } };
      }

      if (/(disconnect|ngắt\s*kết\s*nối).*(wifi|wi-fi|wireless)/.test(text)) {
        return { name: "shell.exec", params: { command: "networksetup -setairportpower en0 off && sleep 1 && networksetup -setairportpower en0 on && echo 'Wi-Fi disconnected/recycled.'" } };
      }

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
      // pip/pip3 install (task 63)
      if (/\b(pip3?)\b.*\binstall\b/i.test(text) || /\b(cài\s*(?:đặt\s*)?thư\s*viện|install\s*(?:python\s*)?package)\b/i.test(text)) {
        const pkgMatch = intent.rawText.match(/\binstall\s+([a-zA-Z0-9_.-]+)\b/i)
          ?? intent.rawText.match(/\bthư\s*viện\s+([a-zA-Z0-9_.-]+)\b/i);
        const pkg = sanitizeToken(pkgMatch?.[1], SAFE_NAME_PATTERN) ?? "requests";
        return { name: "shell.exec", params: { command: `pip3 install ${pkg} 2>&1 | tail -20` } };
      }

      if (/startup\s*apps?|login\s*items?/.test(text)) {
        if (/list|show/.test(text)) {
          return {
            name: "shell.exec",
            params: {
              command:
                "osascript -e 'tell application \"System Events\" to get name of every login item' && echo '---' && ls ~/Library/LaunchAgents 2>/dev/null | head -30",
            },
          };
        }
        return {
          name: "shell.exec",
          params: {
            command:
              "open 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension' && echo 'Open Login Items settings for startup app management.'",
          },
        };
      }

      if (/list|installed|show/.test(text)) return { name: "package.list", params: {} };
      if (/search\b/.test(text)) {
        const q = text.match(/search\s+(\S+)/);
        const query = sanitizeToken(q?.[1], SAFE_NAME_PATTERN) ?? "";
        return { name: "package.search", params: { query } };
      }
      if (/\binstall\b/.test(text)) {
        const pkg = text.match(/install\s+(\S+)/);
        const name = sanitizeToken(pkg?.[1], SAFE_NAME_PATTERN) ?? "";
        if (/(brew|cask|homebrew)/.test(text) && name) {
          const normalizedName = name === "vscode" ? "visual-studio-code" : name;
          const asCask = /cask|chrome|firefox|slack|notion|docker|visual-studio-code/.test(text + " " + normalizedName);
          return {
            name: "shell.exec",
            params: {
              command: asCask ? `brew install --cask ${normalizedName}` : `brew install ${normalizedName}`,
            },
          };
        }
        return { name: "package.install", params: { name } };
      }
      if (/\b(?:remove|uninstall)\b/.test(text)) {
        const pkg = text.match(/(?:remove|uninstall)\s+(\S+)/);
        const name = sanitizeToken(pkg?.[1], SAFE_NAME_PATTERN) ?? "";
        if (name && /clean|leftover|residue|gỡ\s*cài\s*đặt|xóa\s*sạch/.test(text)) {
          return {
            name: "shell.exec",
            params: {
              command:
                `brew uninstall --zap --cask ${name} 2>/dev/null || brew uninstall ${name} 2>/dev/null || true; rm -rf ~/Library/Application\\ Support/${name} ~/Library/Preferences/*${name}* 2>/dev/null || true; echo 'Uninstall cleanup attempted for ${name}'`,
            },
          };
        }
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
      // Battery below threshold → enable power save (task 97)
      if (/\b(pin|battery)\b.*\b(dưới|below|under)\s*\d+%/i.test(intent.rawText)) {
        return { name: "shell.exec", params: { command: "BATT=$(pmset -g batt | grep -o '[0-9]*%' | head -1 | tr -d '%'); if [ -n \"$BATT\" ] && [ \"$BATT\" -lt 20 ]; then pmset -a lowpowermode 1; osascript -e 'display notification \"Battery below 20% — Power save mode enabled\" with title \"OmniState\"'; else echo \"Battery at $BATT% — no action needed\"; fi" } };
      }
      if (/low\s*power|power\s*save|tiết\s*kiệm\s*pin/.test(text)) {
        return { name: "shell.exec", params: { command: "pmset -a lowpowermode 1 && echo 'Low power mode enabled'" } };
      }
      if (/battery|charge|level|pin/.test(text)) return { name: "health.battery", params: {} };
      if (/sleep\b|ngủ\b/.test(text)) return { name: "shell.exec", params: { command: "pmset sleepnow" } };
      if (/shutdown|power off|tắt\s*máy/.test(text)) return { name: "shell.exec", params: { command: "osascript -e 'tell application \"System Events\" to shut down'" } };
      if (/restart|reboot|khởi\s*động\s*lại/.test(text)) return { name: "shell.exec", params: { command: "osascript -e 'tell application \"System Events\" to restart'" } };
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
      if (/defrag|trimforce|trim\s*ssd|ssd\s*trim|optimi[sz]e\s*disk/.test(text)) {
        if (/schedule|weekly|daily|cron|lên\s*lịch/.test(text)) {
          return {
            name: "shell.exec",
            params: {
              command:
                "(crontab -l 2>/dev/null; echo '0 3 * * 0 /usr/sbin/diskutil verifyVolume / >/tmp/omnistate-disk-verify.log 2>&1') | crontab - && echo 'Scheduled weekly disk verify at 03:00 Sunday.'",
            },
          };
        }
        if (/enable|bật/.test(text) && /trim/.test(text)) {
          return { name: "shell.exec", params: { command: "sudo trimforce enable" } };
        }
        return {
          name: "shell.exec",
          params: {
            command:
              "echo 'Checking APFS/SSD TRIM status and disk health...' && system_profiler SPNVMeDataType SPSerialATADataType 2>/dev/null | grep -i TRIM -A1 && echo '---' && diskutil verifyVolume /",
          },
        };
      }
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
      if (/switch|external|monitor|display\s*mode|mirror|extend/.test(text)) {
        if (/mirror/.test(text)) {
          return {
            name: "shell.exec",
            params: {
              command:
                "if command -v displayplacer >/dev/null 2>&1; then displayplacer list && echo 'Use displayplacer profile for mirroring.'; else open 'x-apple.systempreferences:com.apple.Displays-Settings.extension' && echo 'displayplacer not installed: opening Displays settings for mirror mode.'; fi",
            },
          };
        }

        if (/extend/.test(text)) {
          return {
            name: "shell.exec",
            params: {
              command:
                "if command -v displayplacer >/dev/null 2>&1; then displayplacer list && echo 'Use displayplacer profile for extended desktop.'; else open 'x-apple.systempreferences:com.apple.Displays-Settings.extension' && echo 'displayplacer not installed: opening Displays settings for extend mode.'; fi",
            },
          };
        }

        return {
          name: "shell.exec",
          params: {
            command:
              "open 'x-apple.systempreferences:com.apple.Displays-Settings.extension' && echo 'Use Displays settings or displayplacer profile to switch physical displays.'",
          },
        };
      }

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
      if (/(docker\s*compose|compose\s*up|start\s*compose)/.test(text)) {
        return { name: "shell.exec", params: { command: "docker compose up -d" } };
      }
      if (/(compose\s*down|stop\s*compose)/.test(text)) {
        return { name: "shell.exec", params: { command: "docker compose down" } };
      }
      if (/(compose\s*restart|restart\s*compose)/.test(text)) {
        return { name: "shell.exec", params: { command: "docker compose restart" } };
      }
      // Docker logs (task 59)
      if (/\b(log|logs)\b/i.test(text)) {
        const containerMatch = intent.rawText.match(/\blogs?\s+(?:of\s+)?([a-zA-Z0-9_.-]+)\b/i);
        const container = sanitizeToken(containerMatch?.[1], SAFE_DOCKER_TARGET_PATTERN);
        if (container) {
          return { name: "shell.exec", params: { command: `docker logs --tail=100 ${container} 2>&1` } };
        }
        return { name: "shell.exec", params: { command: "docker ps --format 'table {{.ID}}\\t{{.Names}}\\t{{.Status}}' | head -10; echo '---'; docker logs --tail=50 $(docker ps -q | head -1) 2>/dev/null || echo 'No running containers'" } };
      }
      if (/(create|setup|init).*(venv|virtual\s*env|python\s*env)/.test(text)) {
        const dirMatch = intent.rawText.match(/(?:in|at|path)\s+([~/\w./-]+)/i);
        const targetDir = (dirMatch?.[1] ?? ".").replace(/"/g, '\\"');
        return {
          name: "shell.exec",
          params: {
            command: `cd "${targetDir}" && python3 -m venv .venv && echo 'Virtual environment created at ${targetDir}/.venv'`,
          },
        };
      }
      if (/(activate|use).*(venv|virtual\s*env|python\s*env)/.test(text)) {
        return {
          name: "shell.exec",
          params: {
            command: "if [ -f .venv/bin/activate ]; then source .venv/bin/activate && python --version; else echo '.venv not found in current directory'; fi",
          },
        };
      }
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

      // UC9.3: webcam/microphone privacy permission control
      if (/(camera|webcam|microphone|mic)/.test(text)) {
        if (/(lock|block|disable|revoke|deny|off|kh[oó]a|ch[ặa]n|t[ắa]t)/.test(text)) {
          return {
            name: "shell.exec",
            params: {
              command:
                "tccutil reset Camera && tccutil reset Microphone && echo 'Camera/Microphone permissions reset. Apps must request permission again.'",
            },
          };
        }
        if (/(unlock|allow|enable|on|m[ởo])/.test(text)) {
          return {
            name: "shell.exec",
            params: {
              command:
                "open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera' && open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'",
            },
          };
        }
        return {
          name: "shell.exec",
          params: {
            command:
              "sqlite3 \"$HOME/Library/Application Support/com.apple.TCC/TCC.db\" \"select service,client,auth_value from access where service in ('kTCCServiceCamera','kTCCServiceMicrophone') order by service,client limit 60;\"",
          },
        };
      }

      // UC10.3: password vault / autofill via CLI tools
      if (/(password|vault|bitwarden|1password|autofill\s+password|điền\s*mật\s*khẩu)/.test(text)) {
        const itemMatch = text.match(/(?:for|item|entry|cho)\s+['\"]?([^'\"]+)['\"]?/i);
        const item = (itemMatch?.[1] ?? "").trim();
        const safeItem = item.replace(/[^a-zA-Z0-9 _.:@+-]/g, "").trim();

        if (/(bitwarden|\bbw\b)/.test(text)) {
          if (safeItem) {
            return {
              name: "shell.exec",
              params: {
                command: `bw get password \"${safeItem}\" | pbcopy && echo 'Password copied to clipboard from Bitwarden item: ${safeItem}'`,
              },
            };
          }
          return {
            name: "shell.exec",
            params: { command: "bw list items | head -20" },
          };
        }

        if (/(1password|\bop\b)/.test(text)) {
          if (safeItem) {
            return {
              name: "shell.exec",
              params: {
                command: `op item get \"${safeItem}\" --fields password | pbcopy && echo 'Password copied to clipboard from 1Password item: ${safeItem}'`,
              },
            };
          }
          return {
            name: "shell.exec",
            params: { command: "op item list | head -20" },
          };
        }

        return {
          name: "shell.exec",
          params: {
            command: "echo 'Specify vault provider and item name, e.g. bitwarden for github or 1password for aws'",
          },
        };
      }

      // UC10.4: folder encryption/decryption + secure shred
      if (/(encrypt|decrypt|lock\s*folder|unlock\s*folder|mã\s*hóa|giải\s*mã|khóa\s*thư\s*mục|mở\s*khóa\s*thư\s*mục)/.test(text)) {
        const pathMatch = intent.rawText.match(/(?:folder|dir|directory|thư\s*mục|path)\s*[:=]?\s*["']?([^"'\n]+)["']?/i);
        const folder = (pathMatch?.[1] ?? "").trim().replace(/"/g, '\\"');

        if (/decrypt|unlock|giải\s*mã|mở\s*khóa/.test(text)) {
          if (folder) {
            return {
              name: "shell.exec",
              params: {
                command: `hdiutil attach "${folder}" && echo 'Mounted encrypted volume: ${folder}'`,
              },
            };
          }
          return {
            name: "shell.exec",
            params: {
              command: "echo 'Provide encrypted dmg path, e.g. unlock folder path: ~/Secure/Docs.dmg'",
            },
          };
        }

        if (folder) {
          const base = folder.split("/").filter(Boolean).pop() || "secure-data";
          const dmg = `${base}.encrypted.dmg`;
          return {
            name: "shell.exec",
            params: {
              command:
                `echo 'You will be prompted for encryption password'; hdiutil create -encryption -stdinpass -srcfolder "${folder}" "${dmg}"`,
            },
          };
        }

        return {
          name: "shell.exec",
          params: {
            command: "echo 'Provide folder path to encrypt, e.g. encrypt folder path: ~/Documents/Secret'",
          },
        };
      }

      if (/(secure\s*delete|secure\s*shred|shred\s*file|xóa\s*an\s*toàn)/.test(text)) {
        const targetMatch = intent.rawText.match(/(?:file|folder|path|tệp|thư\s*mục)\s*[:=]?\s*["']?([^"'\n]+)["']?/i);
        const target = (targetMatch?.[1] ?? "").trim().replace(/"/g, '\\"');
        if (target) {
          return {
            name: "shell.exec",
            params: {
              command:
                `if command -v srm >/dev/null 2>&1; then srm -vz "${target}"; else rm -P "${target}" 2>/dev/null || rm -rf "${target}"; fi && echo 'Secure delete attempted for ${target}'`,
            },
          };
        }
        return {
          name: "shell.exec",
          params: {
            command: "echo 'Provide file/folder path for secure delete, e.g. secure shred file path: ~/Desktop/secret.txt'",
          },
        };
      }

      if (/cert/.test(text)) return { name: "shell.exec", params: { command: "security find-certificate -a /Library/Keychains/System.keychain | grep 'labl' | head -20" } };
      return { name: "shell.exec", params: { command: "sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate" } };
    }

    // ── Clipboard management ────────────────────────────────────────────
    case "clipboard-management": {
      return { name: "shell.exec", params: { command: "pbpaste | head -20" } };
    }

    // ── Peripheral management ───────────────────────────────────────────
    case "peripheral-management": {
      if (/(safe\s*eject|eject\s*(usb|drive|disk)|unmount\s*(usb|drive|disk)|th[aá]o\s*(usb|ổ\s*cứng))/i.test(text)) {
        const diskMatch = intent.rawText.match(/(?:disk|drive|usb)\s*[:=]?\s*(disk\d+)/i);
        const diskId = (diskMatch?.[1] ?? "").toLowerCase();
        if (diskId) {
          return {
            name: "shell.exec",
            params: {
              command: `diskutil unmountDisk /dev/${diskId} && echo 'Safely ejected /dev/${diskId}'`,
            },
          };
        }
        return {
          name: "shell.exec",
          params: {
            command: "diskutil list external && echo 'Specify target disk like: safe eject disk: disk2'",
          },
        };
      }

      if (/(turn\s*on|enable|bật).*(bluetooth|bt)/.test(text)) {
        return {
          name: "shell.exec",
          params: {
            command:
              "if command -v blueutil >/dev/null 2>&1; then blueutil --power 1 && echo 'Bluetooth enabled'; else open 'x-apple.systempreferences:com.apple.BluetoothSettings' && echo 'Install blueutil for CLI toggle.'; fi",
          },
        };
      }
      if (/(turn\s*off|disable|tắt).*(bluetooth|bt)/.test(text)) {
        return {
          name: "shell.exec",
          params: {
            command:
              "if command -v blueutil >/dev/null 2>&1; then blueutil --power 0 && echo 'Bluetooth disabled'; else open 'x-apple.systempreferences:com.apple.BluetoothSettings' && echo 'Install blueutil for CLI toggle.'; fi",
          },
        };
      }
      if (/(bluetooth|\bbt\b).*(toggle|switch)/.test(text)) {
        return {
          name: "shell.exec",
          params: {
            command:
              "if command -v blueutil >/dev/null 2>&1; then blueutil --power 0 && echo 'Bluetooth toggled off'; else open 'x-apple.systempreferences:com.apple.BluetoothSettings' && echo 'Install blueutil for CLI toggle.'; fi",
          },
        };
      }
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
      if (/(scanner|scan|máy\s*quét)/.test(text)) {
        return {
          name: "shell.exec",
          params: {
            command: "system_profiler SPPrintersDataType | sed -n '1,120p' && echo 'Use Image Capture/ICA-compatible tools for scan operations.'",
          },
        };
      }
      if (/(cancel|clear).*(print|job|queue)/.test(text)) {
        return { name: "shell.exec", params: { command: "cancel -a && lpstat -o" } };
      }
      if (/(print\s*queue|jobs?)/.test(text)) {
        return { name: "shell.exec", params: { command: "lpstat -o" } };
      }
      if (/(set|switch).*(default\s*printer|printer\s*default)/.test(text)) {
        const pMatch = intent.rawText.match(/(?:printer|to)\s*[:=]?\s*['\"]?([a-zA-Z0-9._ -]+)['\"]?/i);
        const printer = (pMatch?.[1] ?? "").trim().replace(/"/g, '\\"');
        if (printer) {
          return { name: "shell.exec", params: { command: `lpoptions -d "${printer}" && lpstat -d` } };
        }
      }
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
      if (/(do\s*not\s*disturb|\bdnd\b|focus\s*mode|chế\s*độ\s*tập\s*trung)/.test(text)) {
        if (/(turn\s*on|enable|bật)/.test(text)) {
          return {
            name: "shell.exec",
            params: {
              command:
                "shortcuts run 'Turn On Do Not Disturb' 2>/dev/null || open 'x-apple.systempreferences:com.apple.Focus-Settings.extension' && echo 'Requested Focus/DND ON (opened settings if shortcut unavailable). '",
            },
          };
        }
        if (/(turn\s*off|disable|tắt)/.test(text)) {
          return {
            name: "shell.exec",
            params: {
              command:
                "shortcuts run 'Turn Off Do Not Disturb' 2>/dev/null || open 'x-apple.systempreferences:com.apple.Focus-Settings.extension' && echo 'Requested Focus/DND OFF (opened settings if shortcut unavailable). '",
            },
          };
        }
        return {
          name: "shell.exec",
          params: {
            command:
              "defaults -currentHost read com.apple.controlcenter FocusModes 2>/dev/null || echo 'Focus status unavailable via defaults; open settings for details.'",
          },
        };
      }
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
      if (/repair\s*(?:my\s*)?(?:network|internet)|fix\s*(?:network|internet)|flush\s*dns|renew\s*dhcp/.test(text)) {
        return {
          name: "shell.exec",
          params: {
            command:
              "echo 'Running automatic network repair...' && networksetup -setairportpower en0 off && sleep 1 && networksetup -setairportpower en0 on && dscacheutil -flushcache && sudo killall -HUP mDNSResponder 2>/dev/null || true && ipconfig set en0 DHCP && ping -c 2 8.8.8.8",
          },
        };
      }

      if (/optimi[sz]e\s*(?:system\s*)?performance|memory\s*leak|high\s*cpu|high\s*memory/.test(text)) {
        return {
          name: "shell.exec",
          params: {
            command:
              "echo 'Collecting performance diagnostics...' && top -l 1 -o cpu | head -20 && echo '---' && vm_stat && echo '---' && ps aux --sort=-%mem | head -20 && echo '---' && memory_pressure",
          },
        };
      }

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
      if (/install|cask|brew\s+install/.test(text)) {
        const pkgMatch = intent.rawText.match(/(?:install|cài\s*đặt)\s+([a-zA-Z0-9@._+-]+)/i)
          ?? intent.rawText.match(/\b(?:app|package|gói)\s*[:=]\s*([a-zA-Z0-9@._+-]+)/i);
        const pkg = (pkgMatch?.[1] ?? "").trim();
        if (pkg) {
          const asCask = /(chrome|firefox|slack|notion|visual\s*studio\s*code|vscode|docker)/i.test(pkg);
          const normalizedPkg = pkg.toLowerCase() === "vscode" ? "visual-studio-code" : pkg;
          return {
            name: "shell.exec",
            params: { command: asCask ? `brew install --cask ${normalizedPkg}` : `brew install ${normalizedPkg}` },
          };
        }
        return { name: "shell.exec", params: { command: "brew search | head -30" } };
      }

      if (/uninstall|remove\s+app|gỡ\s*cài\s*đặt|brew\s+uninstall/.test(text)) {
        const pkgMatch = intent.rawText.match(/(?:uninstall|remove|gỡ\s*cài\s*đặt)\s+([a-zA-Z0-9@._+-]+)/i)
          ?? intent.rawText.match(/\b(?:app|package|gói)\s*[:=]\s*([a-zA-Z0-9@._+-]+)/i);
        const pkg = (pkgMatch?.[1] ?? "").trim();
        if (pkg) {
          const normalizedPkg = pkg.toLowerCase() === "vscode" ? "visual-studio-code" : pkg;
          return {
            name: "shell.exec",
            params: {
              command:
                `brew uninstall --zap --cask ${normalizedPkg} 2>/dev/null || brew uninstall ${normalizedPkg} 2>/dev/null || true; rm -rf ~/Library/Application\\ Support/${normalizedPkg} ~/Library/Preferences/*${normalizedPkg}* 2>/dev/null || true; echo 'Uninstall cleanup attempted for ${normalizedPkg}'`,
            },
          };
        }
        return { name: "shell.exec", params: { command: "brew list --cask && echo '---' && brew list --formula" } };
      }

      if (/startup\s*apps?|login\s*items?|launch\s*at\s*startup/.test(text)) {
        if (/list|show/.test(text)) {
          return {
            name: "shell.exec",
            params: {
              command:
                "osascript -e 'tell application \"System Events\" to get name of every login item' && echo '---' && ls ~/Library/LaunchAgents 2>/dev/null | head -30",
            },
          };
        }
        return {
          name: "shell.exec",
          params: {
            command:
              "open 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension' && echo 'Open Login Items settings for startup app management.'",
          },
        };
      }

      if (/update|upgrade|patch|software\s*update/.test(text)) {
        if (/all|everything|toàn\s*bộ/.test(text)) {
          return {
            name: "shell.exec",
            params: { command: "softwareupdate -l && echo '---' && brew update && brew upgrade" },
          };
        }
      }

      if (/brew/.test(text)) return { name: "shell.exec", params: { command: "brew outdated" } };
      return { name: "shell.exec", params: { command: "softwareupdate -l 2>&1 | head -20" } };
    }

    // ── Display/audio combined ──────────────────────────────────────────
    case "display-audio": {
      if (/switch|external|monitor|display\s*mode|mirror|extend/.test(text)) {
        return {
          name: "shell.exec",
          params: {
            command:
              "open 'x-apple.systempreferences:com.apple.Displays-Settings.extension' && echo 'Use Displays settings or displayplacer profile to switch physical displays.'",
          },
        };
      }
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
      if (/desktop/.test(text)) {
        return {
          name: "hybrid.organizeFiles",
          params: { dirPath: `${process.env.HOME ?? "~"}/Desktop`, strategy: "group-by-extension" },
        };
      }
      if (/downloads?/.test(text)) {
        return {
          name: "hybrid.organizeFiles",
          params: { dirPath: `${process.env.HOME ?? "~"}/Downloads`, strategy: "group-by-date" },
        };
      }
      return { name: "hybrid.organizeFiles", params: { dirPath: process.cwd(), strategy: "smart-workspace" } };
    }
    case "debug-assist": {
      if (/(log|error|crash|stack\s*trace|traceback|summari[sz]e\s*logs?|analy[sz]e\s*logs?)/.test(text)) {
        return {
          name: "shell.exec",
          params: {
            command:
              "echo '=== Recent Errors (24h) ===' && log show --last 24h --predicate 'eventMessage CONTAINS[c] \"error\" OR eventMessage CONTAINS[c] \"exception\" OR eventMessage CONTAINS[c] \"crash\"' --style compact 2>/dev/null | head -80 && echo '---' && echo '=== Error Summary ===' && log show --last 24h --style compact 2>/dev/null | grep -Ei 'error|exception|crash' | awk '{print tolower($0)}' | sed -E 's/.*(error|exception|crash).*/\\1/' | sort | uniq -c | sort -nr | head -10",
          },
        };
      }
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

let _episodicStore: EpisodicStore | null = null;
function getEpisodicStore(): EpisodicStore {
  if (!_episodicStore) {
    _episodicStore = new EpisodicStore(getDb(), getEmbeddingProvider());
  }
  return _episodicStore;
}

let _knowledgeGraph: KnowledgeGraph | null = null;
function getKnowledgeGraph(): KnowledgeGraph {
  if (!_knowledgeGraph) {
    _knowledgeGraph = new KnowledgeGraph(getDb());
  }
  return _knowledgeGraph;
}

/**
 * Build a StatePlan (DAG of StateNodes) from a classified intent.
 */
export async function planFromIntent(intent: Intent): Promise<StatePlan> {
  const taskId = `task-${Date.now()}`;
  const nodes: StateNode[] = [];

  // Inject episodic recall context into intent for downstream planning
  let episodicContext = "";
  try {
    const store = getEpisodicStore();
    const episodes = await store.recall(intent.rawText, { limit: 3 });
    if (episodes.length > 0) {
      episodicContext =
        "\n\nPast relevant experiences:\n" +
        episodes
          .map(
            (e) =>
              `- Goal: "${e.goal}" → ${e.success ? "succeeded" : "failed"} (tools: ${e.toolsUsed.join(", ")}). Summary: ${e.summary}`,
          )
          .join("\n");
      logger.debug({ count: episodes.length }, "[planFromIntent] injected episodic context");
    }
  } catch (err) {
    logger.warn({ err }, "[planFromIntent] episodic recall failed, continuing without context");
  }
  // episodicContext is threaded into decomposeMultiStep for the multi-step planning path

  // Inject KG entity context for downstream planning
  let kgContext = "";
  try {
    const kg = getKnowledgeGraph();
    const entity = kg.resolveReference(intent.rawText);
    if (entity) {
      const related = kg.getRelated(entity.id);
      kgContext = kg.toContextSnippet([entity, ...related.map((r) => r.entity)]);
      logger.debug({ entityId: entity.id, name: entity.name }, "[planFromIntent] resolved KG entity");
    }
  } catch (err) {
    logger.warn({ err }, "[planFromIntent] KG entity resolution failed, continuing without context");
  }

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

      // ── Pre-built plan: Vietnamese "mở X trên Safari" → direct browser navigate ──
      // Handles: "mở video đầu tiên của youtube trên Safari"
      //          "mở youtube trên safari"
      //          "mở youtube bằng safari"
      const viOnBrowserMatch = /^(?:mở|open)\s+(.+?)\s+(?:trên|bằng|qua|trong)\s+(safari|chrome|firefox|brave|arc|edge)/i.exec(intent.rawText);
      if (viOnBrowserMatch) {
        const queryPart3 = viOnBrowserMatch[1]?.trim() ?? "";
        const browserPart = viOnBrowserMatch[2]?.trim() ?? "safari";
        const browserNorm = normalizeAppName(browserPart);
        const isYouTube3 = /youtube/i.test(queryPart3);
        const isFirstVideo3 = /\b(?:video\s*đầu\s*tiên|đầu\s*tiên|first\s*video)\b/i.test(queryPart3);
        const ytScript = (() => {
          const ytUrl = "https://www.youtube.com";
          const safeYtUrl3 = escapeAppleScriptString(ytUrl);
          if (isYouTube3 && isFirstVideo3 && browserNorm === "Safari") {
            const js3 = escapeAppleScriptString(
              'setTimeout(function(){' +
              'var sel="ytd-video-renderer a#video-title,ytd-rich-item-renderer a#video-title-link";' +
              'var l=document.querySelector(sel);' +
              'if(l){l.click();}else{var lks=document.querySelectorAll("a[href*=\\"/watch\\"]");if(lks.length)lks[0].click();}' +
              '},2500);'
            );
            return `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${safeYtUrl3}"\ndelay 2.5\ndo JavaScript "${js3}" in current tab of front window\nend tell`;
          }
          if (isYouTube3 && browserNorm === "Safari") {
            return `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${safeYtUrl3}"\nend tell`;
          }
          return null;
        })();
        if (ytScript) {
          nodes.push(actionNode("launch-browser", `Launch ${browserNorm}`, "app.launch", "deep", { name: browserNorm }));
          nodes.push(actionNode("navigate-action", intent.rawText, "app.script", "deep", { script: ytScript, entities: intent.entities }, ["launch-browser"]));
          break;
        }
      }

      let appRaw = extractAppName(intent);
      if (!appRaw && /\b(?:on|in)\s+safari\b/i.test(intent.rawText)) {
        appRaw = "safari";
      }
      if (!appRaw && /\bopen\s+.+\s+on\s+youtube\b/i.test(intent.rawText)) {
        appRaw = "safari";
      }
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

      if (/\b(?:screenshot|screen\s*capture|capture\s*screen|chụp\s*màn\s*hình|chup\s*man\s*hinh)\b/i.test(raw)) {
        nodes.push(
          actionNode(
            "interact",
            raw,
            "screen.capture",
            "surface",
            { entities: intent.entities },
          ),
        );
        break;
      }

      if (/\b(translate\s*(?:screen|this|selection|text)|dịch\s*(?:màn\s*hình|đoạn\s*này|văn\s*bản|nội\s*dung))\b/i.test(raw)) {
        nodes.push(
          actionNode(
            "interact",
            raw,
            "shell.exec",
            "deep",
            {
              command:
                "TMP_IMG=/tmp/omnistate-screen-translate.png; screencapture -x \"$TMP_IMG\" && if command -v tesseract >/dev/null 2>&1; then OCR_TEXT=$(tesseract \"$TMP_IMG\" stdout 2>/dev/null | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-400); URL=\"https://translate.google.com/?sl=auto&tl=vi&text=$(python3 - <<'PY'\nimport os, urllib.parse\nprint(urllib.parse.quote(os.environ.get('OCR_TEXT','')))\nPY\n)&op=translate\"; open \"$URL\"; echo \"Opened translation overlay in browser\"; else echo 'Install tesseract first: brew install tesseract'; fi",
              entities: intent.entities,
            },
          ),
        );
        break;
      }

      if (/\b(fill|autofill|form|đi[ềe]n\s*form|bi[ểe]u\s*m[ẫa]u)\b/i.test(raw)) {
        const script = buildWebFormFillScript(intent);
        if (script) {
          nodes.push(
            actionNode(
              "interact",
              raw,
              "app.script",
              "deep",
              { script, entities: intent.entities },
            ),
          );
          break;
        }
      }

      if (isDataEntryWorkflowText(raw)) {
        nodes.push(...buildDataEntryWorkflowNodes(intent));
        break;
      }

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

      if (/\b(?:drag|drop|k[eé]o\s*th[aả])\b/i.test(raw) && coords.length >= 2) {
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

      const chainSteps = parseUiActionChain(raw);
      if (chainSteps.length) {
        nodes.push(...buildUiActionChainNodes(intent.rawText, chainSteps, intent.entities));
        break;
      }

      if (isNegatedUiInstruction(raw)) {
        nodes.push(
          actionNode(
            "no-op",
            "Negative UI instruction detected; skipping conflicting action",
            "ui.wait",
            "surface",
            { ms: 50, reason: raw },
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
          { query: intent.rawText, entities: intent.entities, button: "left" },
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
      // Weather query (task 74)
      if (/\b(thời\s*tiết|weather)\b/i.test(intent.rawText)) {
        const cityMatch = intent.rawText.match(/\b(?:tại|at|in|ở)\s+([A-Za-zÀ-ỹ\s]{2,30}?)(?=\s+(?:hôm\s*nay|today|ngày\s*mai|tomorrow)|$)/i);
        const city = cityMatch?.[1]?.trim().replace(/\s+/g, "+") ?? "Ho+Chi+Minh+City";
        nodes.push(actionNode("query", intent.rawText, "shell.exec", "deep", {
          command: `curl -s "wttr.in/${city}?format=3" 2>/dev/null || echo "Could not fetch weather for ${city.replace(/\+/g, " ")}"`,
          entities: intent.entities,
        }));
        break;
      }

      // Exchange rate (task 96)
      if (/\b(tỷ\s*giá|exchange\s*rate|tỉ\s*giá)\b/i.test(intent.rawText)) {
        nodes.push(actionNode("query", intent.rawText, "shell.exec", "deep", {
          command: `curl -s 'https://api.exchangerate-api.com/v4/latest/USD' | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('rates',{}); [print(f'{k}: {v}') for k,v in r.items() if k in ['VND','EUR','JPY','GBP','CNY','KRW','SGD']]" 2>/dev/null || open 'https://vietcombank.com.vn/KHCN/Cong-cu-tien-ich/Ty-gia' && echo 'Opening VietcomBank exchange rates'`,
          entities: intent.entities,
        }));
        break;
      }

      if (/\b(summari[sz]e\s*(?:my\s*)?(?:context|workspace|work)|context\s*summary|t[oó]m\s*tắt\s*(?:ng[ữu]\s*cảnh|màn\s*hình|công\s*việc))\b/i.test(intent.rawText.toLowerCase())) {
        nodes.push(
          actionNode(
            "query",
            intent.rawText,
            "shell.exec",
            "deep",
            {
              command:
                "echo '=== ACTIVE APP ===' && osascript -e 'tell application \"System Events\" to get name of first process whose frontmost is true' && echo '=== OPEN WINDOWS ===' && osascript -e 'tell application \"System Events\" to tell (name of first process whose frontmost is true) to get name of every window' && echo '=== TOP CPU ===' && ps aux --sort=-%cpu | head -6 && echo '=== TOP MEMORY ===' && ps aux --sort=-%mem | head -6 && echo '=== RECENT DOWNLOADS ===' && ls -lt ~/Downloads | head -6",
              entities: intent.entities,
            },
          ),
        );
        break;
      }

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
      if (isDataEntryWorkflowText(intent.rawText)) {
        nodes.push(...buildDataEntryWorkflowNodes(intent));
        break;
      }

      // ── Pre-built plan: Vietnamese browser + YouTube + first video chain ──
      // e.g. "Mở safari, truy cập youtube sau đó mở video đầu tiên"
      // e.g. "Mở safari, vào youtube, xem video đầu tiên"
      const isSafariYoutubeVideoChain =
        /(?:mở|open)\s+safari/i.test(intent.rawText) &&
        /youtube/i.test(intent.rawText) &&
        /(?:video\s*đầu\s*tiên|first\s*video|mở\s*video|xem\s*video\s*đầu)/i.test(intent.rawText);

      if (isSafariYoutubeVideoChain) {
        const ytHomeUrl = escapeAppleScriptString("https://www.youtube.com");
        const firstVideoJs4 = escapeAppleScriptString(
          'setTimeout(function(){' +
          'var sel="ytd-video-renderer a#video-title,ytd-rich-item-renderer a#video-title-link,ytd-compact-video-renderer a#video-title";' +
          'var l=document.querySelector(sel);' +
          'if(l){l.click();}else{var lks=document.querySelectorAll("a[href*=\\"/watch\\"]");if(lks.length)lks[0].click();}' +
          '},2500);'
        );
        const navigateScript = `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${ytHomeUrl}"\nend tell`;
        const clickFirstVideoScript = `tell application "Safari"\nactivate\ndelay 2.5\ndo JavaScript "${firstVideoJs4}" in current tab of front window\nend tell`;

        nodes.push(actionNode("step-0", "Open Safari", "app.launch", "deep", { name: "Safari" }));
        nodes.push(actionNode("step-1", "Navigate to YouTube", "app.script", "deep", { script: navigateScript }, ["step-0"]));
        nodes.push(actionNode("step-2", "Click first YouTube video", "app.script", "deep", { script: clickFirstVideoScript }, ["step-1"]));
        break;
      }

      // ── Pre-built plan: Vietnamese browser chain (non-YouTube) ──
      // e.g. "Mở safari rồi vào google.com"
      const isBrowserNavChain =
        /(?:mở|open)\s+(?:safari|chrome|firefox|brave|trình\s*duyệt)/i.test(intent.rawText) &&
        /(?:rồi|sau\s*đó|tiếp\s*theo|,)\s*(?:truy\s*cập|vào|navigate|go\s*to)/i.test(intent.rawText);

      if (isBrowserNavChain) {
        const browserNameMatch4 = intent.rawText.match(/(?:mở|open)\s+(safari|chrome|firefox|brave)/i);
        const browserName4 = normalizeAppName(browserNameMatch4?.[1] ?? "safari");
        const urlMatch4 = intent.rawText.match(/(?:truy\s*cập|vào|navigate\s+to|go\s+to)\s+(https?:\/\/[^\s]+|[\w-]+\.(?:com|vn|org|net|io)|youtube|google|facebook)/i);
        const rawUrl4 = urlMatch4?.[1]?.trim() ?? "";
        let navUrl4 = rawUrl4;
        if (rawUrl4 && !rawUrl4.startsWith("http")) {
          const siteMap4: Record<string, string> = { "youtube": "https://www.youtube.com", "google": "https://www.google.com", "facebook": "https://www.facebook.com" };
          navUrl4 = siteMap4[rawUrl4.toLowerCase()] ?? `https://${rawUrl4}`;
        }
        if (navUrl4) {
          const safeUrl4 = escapeAppleScriptString(navUrl4);
          let navScript4: string;
          if (browserName4 === "Safari") {
            navScript4 = `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${safeUrl4}"\nend tell`;
          } else {
            navScript4 = `tell application "${escapeAppleScriptString(browserName4)}"\nactivate\nif (count of windows) = 0 then make new window\nset URL of active tab of front window to "${safeUrl4}"\nend tell`;
          }
          nodes.push(actionNode("step-0", `Launch ${browserName4}`, "app.launch", "deep", { name: browserName4 }));
          nodes.push(actionNode("step-1", `Navigate to ${navUrl4}`, "app.script", "deep", { script: navScript4 }, ["step-0"]));
          break;
        }
      }

      const steps = await decomposeMultiStep(intent.rawText, episodicContext || undefined, kgContext || undefined);

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
          "peripheral-management": "deep",
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
          const normalizedTool = normalizeStepTool(step.tool, step.type);
          nodes.push(
            actionNode(
              nodeId,
              step.description,
              normalizedTool,
              layerFor[step.type],
              inferStepParamsForTool(normalizedTool, step.description, step.type),
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
