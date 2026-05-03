// ── App control & domain-specific planning ────────────────────────────────────

import type { StatePlan, StateNode } from "../types/task.js";
import type { Intent, IntentType } from "./types.js";
import {
  actionNode,
  verifyNode,
} from "./types.js";
import { isLlmRequired, formatLlmError, parseLlmJson } from "./types.js";
import { loadLlmRuntimeConfig } from "../llm/runtime-config.js";
import { requestLlmTextWithFallback } from "../llm/router.js";
import { parseUiActionChain, buildUiActionChainNodes, extractCoordinatePairs, isNegatedUiInstruction } from "./ui-chain.js";
import { extractShellCommand } from "./shell.js";

// ============================================================================
// Known app registries
// ============================================================================

/** Known browser apps that support tab control via AppleScript. */
export const BROWSERS = ["safari", "google chrome", "chrome", "firefox", "brave", "arc", "edge"];

/** Known apps with media control. */
export const MEDIA_APPS = ["spotify", "music", "youtube", "vlc", "quicktime"];

export const KNOWN_APPS = [
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

// ============================================================================
// Pattern constants
// ============================================================================

export const SAFE_HOST_PATTERN = /^[a-zA-Z0-9.-]{1,253}$/;
export const SAFE_NAME_PATTERN = /^[a-zA-Z0-9._:@+-]{1,128}$/;
export const SAFE_DOCKER_TARGET_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

// ============================================================================
// String utilities
// ============================================================================

export function escapeAppleScriptString(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

export function sanitizeToken(value: string | undefined, pattern: RegExp): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return pattern.test(trimmed) ? trimmed : null;
}

// ============================================================================
// App name utilities
// ============================================================================

/** Extract app name from intent entities or raw text. */
export function extractAppName(intent: Intent): string | null {
  const raw = intent.rawText;

  if (/\bopen\b.+\bon\s+youtube\b/i.test(raw)) {
    return "safari";
  }

  const contextMatch = raw.match(/\b(?:on|in|from)\s+([a-zA-Z][\w\s.-]{1,40}?)(?=\s+(?:and|then|to|for)\b|$)/i);
  const contextCandidate = contextMatch?.[1]?.trim();
  const contextBrowser = contextCandidate
    ? BROWSERS.find((b) => contextCandidate.toLowerCase().includes(b))
    : null;

  const appEntity = Object.values(intent.entities).find(e => e.type === "app");
  if (appEntity?.value) {
    const entityLower = appEntity.value.toLowerCase();
    const entityIsBrowser = BROWSERS.some((b) => entityLower.includes(b));
    if (!entityIsBrowser && contextBrowser) return contextBrowser;
    return appEntity.value;
  }

  if (contextMatch?.[1]) {
    const candidate = contextMatch[1].trim();
    const candidateLower = candidate.toLowerCase();
    for (const app of KNOWN_APPS) {
      if (candidateLower.includes(app)) return app;
    }
    return candidate;
  }

  const launchMatch = raw.match(/\b(?:open|launch|start|activate)\s+([a-zA-Z][\w\s.-]{1,30}?)(?=\s+(?:and|then|to|for|with)\b|$)/i);
  if (launchMatch?.[1]) {
    const candidate = launchMatch[1].trim();
    const candidateLower = candidate.toLowerCase();
    for (const app of KNOWN_APPS) {
      if (candidateLower.includes(app)) return app;
    }
  }

  const match = intent.rawText.match(/\b(?:on|in|from)\s+(\w+)\s*$/i);
  if (match) return match[1];

  const lower = intent.rawText.toLowerCase();
  for (const app of KNOWN_APPS) {
    if (lower.includes(app)) return app;
  }

  return null;
}

/** Normalize app name for AppleScript tell blocks. */
export function normalizeAppName(name: string): string {
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

// ============================================================================
// Target & form utilities
// ============================================================================

/** Extract a search/target term from the intent text. */
export function extractTarget(intent: Intent): string | null {
  const text = intent.rawText.toLowerCase();

  const match = text.match(/\b(?:stop|close|pause|mute|play|resume)\s+(.+?)\s+(?:on|in|from)\s+/i);
  if (match) return match[1].trim();

  const tabMatch = text.match(/\b(?:close|stop)\s+(.+?)\s+tab/i);
  if (tabMatch) return tabMatch[1].trim();

  const tabMatch2 = text.match(/\bclose\s+tab\s+(.+)/i);
  if (tabMatch2) return tabMatch2[1].trim();

  return null;
}

export interface FormField {
  key: string;
  value: string;
}

export function extractFormFields(raw: string): FormField[] {
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

export function extractQuotedTextAppControl(raw: string): string | null {
  const m = raw.match(/["'""](.+?)["'""]/);
  if (m?.[1]) return m[1].trim();

  const tail = raw.match(/\b(?:type|enter|input|write)\b\s+(.+)/i);
  if (tail?.[1]) return tail[1].trim();
  return null;
}

// ============================================================================
// Web form fill AppleScript
// ============================================================================

export function buildWebFormFillScript(intent: Intent): string | null {
  const appRaw = extractAppName(intent);
  const app = appRaw ? normalizeAppName(appRaw) : "Safari";
  const isBrowser = BROWSERS.some((b) => app.toLowerCase().includes(b));
  if (!isBrowser) return null;

  const fields = extractFormFields(intent.rawText);
  if (fields.length === 0) return null;

  const payload = JSON.stringify(fields).replace(/\\/g, "\\\\").replace(/\"/g, '\\"');

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
    return `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\ndo JavaScript "${safeJs}" in current tab of front window\nend tell`;
  }
  const safeApp = escapeAppleScriptString(app);
  return `tell application "${safeApp}"\nactivate\nexecute front window's active tab javascript "${safeJs}"\nend tell`;
}

// ============================================================================
// Data entry workflow
// ============================================================================

export function isDataEntryWorkflowText(text: string): boolean {
  return /\b(data\s*entry|nh[ậa]p\s*li[ệe]u|đi[ềe]n\s*d[ữu]\s*li[ệe]u)\b/i.test(text);
}

export function buildDataEntryWorkflowNodes(intent: Intent): StateNode[] {
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

  const payload = extractQuotedTextAppControl(intent.rawText) ?? intent.rawText;
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

// ============================================================================
// Messaging intent detection
// ============================================================================

export function isMessagingIntentText(text: string): boolean {
  return /\b(message|send\s+message|chat\s+with|nh[aắ]n\s*tin|g[iử]i\s*tin\s*nh[aắ]n|message\s+for|nhắn|nhắn\s*tin|gửi\s+message|gửi\s*file|send\s*file|đính\s*kèm)\b/i.test(text);
}

// ============================================================================
// LLM-based messaging script
// ============================================================================

export async function buildMessagingScriptWithLLM(intent: Intent): Promise<string | null> {
  if (!isLlmRequired()) {
    return null; // Graceful fallback when LLM unavailable
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

// ============================================================================
// Main AppleScript builder
// ============================================================================

/**
 * Build an AppleScript for app-control actions.
 * Returns null if no script can be generated (fallback to keyboard shortcuts).
 */
export function buildAppControlScript(intent: Intent): string | null {
  const text = intent.rawText.toLowerCase();
  const appRaw = extractAppName(intent);
  const app = appRaw ? normalizeAppName(appRaw) : null;
  const safeApp = app ? escapeAppleScriptString(app) : null;
  const target = extractTarget(intent);
  const safeTarget = target ? escapeAppleScriptString(target) : null;
  const isBrowser = app ? BROWSERS.includes(app.toLowerCase()) || BROWSERS.some(b => app.toLowerCase().includes(b)) : false;

  // ── Email compose/send ──
  if (/\b(send\s+email|compose\s+email|write\s+email|open\s+mail|mail\s+app|g[iử]i\s*email|thư\s*điện\s*tử|(?:email|mail)\b(?!\s*:))\b/i.test(text)) {
    const toMatch = intent.rawText.match(/\bto\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i)
      ?? intent.rawText.match(/\b(?:cho|tới)\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
    const subjectMatch = intent.rawText.match(/\bsubject\s*[:=]\s*(.+?)(?=\b(?:body|content|message)\b|$)/i)
      ?? intent.rawText.match(/\btiêu\s*đề\s*[:=]\s*(.+?)(?=\b(?:nội\s*dung|body|message)\b|$)/i);
    const bodyMatch = intent.rawText.match(/\b(?:body|content|message|nội\s*dung)\s*[:=]\s*(.+)$/i);
    const quoted = extractQuotedTextAppControl(intent.rawText);
    const recipient = toMatch?.[1]?.trim();
    const subject = (subjectMatch?.[1] ?? "Quick note from OmniState").trim();
    const body = (bodyMatch?.[1] ?? quoted ?? "Sent from OmniState automation.").trim();
    const sendNow = /\b(send\s+now|send\b|g[iử]i\s*ngay|g[iử]i\b)\b/i.test(text);

    const safeSubject = escapeAppleScriptString(subject);
    const safeBody = escapeAppleScriptString(`${body}\n`);
    const recipientScript = recipient
      ? `make new to recipient at end of to recipients with properties {address:"${escapeAppleScriptString(recipient)}"}`
      : "";
    const sendScript = sendNow ? "send" : "";

    return [
      'tell application "Mail"',
      'activate',
      `set newMessage to make new outgoing message with properties {subject:"${safeSubject}", content:"${safeBody}", visible:true}`,
      'tell newMessage',
      recipientScript,
      sendScript,
      'end tell',
      'end tell',
    ].filter(Boolean).join("\n");
  }

  // ── Calendar scheduling ──
  if (/\b(calendar|schedule|meeting|appointment|event|lịch|lịch\s*hẹn|cuộc\s*họp)\b/i.test(text)) {
    const title = extractQuotedTextAppControl(intent.rawText)
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
      `make new event with properties {summary:"${safeTitle}", start date:startDate, end date:endDate}`,
      'end tell',
      'end tell',
    ].filter(Boolean).join("\n");
  }

  // ── Reminder / alarm / timer ──
  if (/\b(reminder|nhắc\s*nhở|alarm|báo\s*thức|timer|hẹn\s*giờ|đếm\s*ngược)\b/i.test(text)) {
    const title = extractQuotedTextAppControl(intent.rawText)
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
        `do shell script "nohup /bin/sh -c 'sleep ${Math.max(5, delaySeconds)}; osascript -e \\\"display notification \\\\\\\"${notifyMsg}\\\\\\\" with title \\\\\\\"OmniState Timer\\\\\\\"\\\"; afplay /System/Library/Sounds/Glass.aiff' >/dev/null 2>&1 &"`,
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
      `set r to make new reminder with properties {name:"${safeTitle}"}`,
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

  // ── Browser history/cache management ──
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
  if (/^(?:truy\s*cập|vào\s*(?:trang|web|website)?)\s+/i.test(text)) {
    const navTarget = intent.rawText.match(/^(?:truy\s*cập|vào\s*(?:trang|web|website)?)\s+(.+)/i)?.[1]?.trim() ?? "";
    let navUrl = navTarget;
    if (!navUrl.startsWith("http")) {
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
  if (/^(?:mở|open)\s+.+\s+(?:trên|bằng|qua|trong)\s+(?:safari|chrome|firefox|brave|arc|edge|cốc\s*cốc|trình\s*duyệt)/i.test(text)) {
    const browserFromText = text.match(/(?:trên|bằng|qua|trong)\s+(safari|chrome|firefox|brave|arc|edge)/i)?.[1] ?? "Safari";
    const targetBrowser2 = normalizeAppName(browserFromText);
    const queryPart = intent.rawText.match(/^(?:mở|open)\s+(.+?)\s+(?:trên|bằng|qua|trong)\s+/i)?.[1]?.trim() ?? "";
    const queryLower = queryPart.toLowerCase();

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
  if (isBrowser && /\byoutube\b/i.test(text)) {
    const searchMatch = intent.rawText.match(/\bsearch\s+["'""]?(.+?)["'""]?$/i);
    const openOnYoutubeMatch = intent.rawText.match(/\bopen\s+(.+?)\s+on\s+youtube\b/i);
    const viYoutubeMatch = intent.rawText.match(/\b(?:mở|tìm|xem)\s+(.+?)\s+(?:trên|trong|của)\s+youtube\b/i)
      ?? intent.rawText.match(/\byoutube\b.*\b(?:tìm|search)\s+(.+?)(?:\s*$)/i);
    const query = searchMatch?.[1]?.trim() ?? openOnYoutubeMatch?.[1]?.trim() ?? viYoutubeMatch?.[1]?.trim();
    const url = query
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      : "https://www.youtube.com";
    const safeUrl = escapeAppleScriptString(url);

    if (app === "Safari") {
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
      return `tell application "${safeApp}"\nrepeat with w in windows\nrepeat with t in tabs of w\nif name of t contains "${safeTarget}" then close t\nend repeat\nend repeat\nend tell`;
    }
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
    return null;
  }

  // ── Mute/unmute ──
  if (/\b(mute|unmute)\b/i.test(text)) {
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

  // ── Incognito/private tab ──
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
    return `do shell script "RAND=$(ls ~/Pictures/*.{jpg,png,jpeg,JPG,PNG} 2>/dev/null | shuf -n1 || ls ~/Desktop/*.{jpg,png,jpeg,JPG,PNG} 2>/dev/null | shuf -n1); if [ -n \\"$RAND\\" ]; then osascript -e \\"tell application \\\\\\"System Events\\\\\\" to tell every desktop to set picture to \\\\\\"$RAND\\\\\\"\\"; echo \\"Wallpaper changed to $RAND\\"; else echo \\"No images found. Add images to ~/Pictures\\"; fi"`;
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
      '    keystroke "f" using {command down}',
      '    delay 0.5',
      `    keystroke "${safeTarget}"`,
      '    delay 0.8',
      '    key code 36',
      '    delay 0.8',
      '    keystroke "o" using {command down, shift down}',
      '    delay 1',
      safeFileName ? `    keystroke "${safeFileName}"` : '',
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
      `display notification "Screenshot pasted into ${targetApp}" with title "OmniState"`,
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
    return 'tell application "Terminal"\nactivate\ndo script "echo Starting stopwatch...; START=$(date +%s); while true; do ELAPSED=$(($(date +%s)-START)); printf "\\r%02d:%02d:%02d" $((ELAPSED/3600)) $(((ELAPSED%3600)/60)) $((ELAPSED%60)); sleep 1; done"\nend tell';
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
    const title = extractQuotedTextAppControl(intent.rawText) ?? "Shopping List";
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

// ============================================================================
// Keyboard shortcut builder
// ============================================================================

/**
 * Build a keyboard shortcut action for app-control.
 * Returns params for the ui.key orchestrator tool.
 */
export function buildKeyboardAction(intent: Intent): Record<string, unknown> | null {
  const text = intent.rawText.toLowerCase();

  if (/\b(bookmark|save\s*page|lưu\s*trang\s*dấu|d[ấa]u\s*trang)\b/i.test(text)) {
    return { key: "d", modifiers: { meta: true } };
  }
  if (/\b(open|show|view)\b.*\b(bookmark|bookmarks)\b/i.test(text)) {
    return { key: "b", modifiers: { meta: true, shift: true } };
  }
  if (/\b(open|show|view)\b.*\b(history)\b/i.test(text)) {
    return { key: "y", modifiers: { meta: true } };
  }
  if (/\b(clear|delete|x[oó]a|d[ọo]n)\b.*\b(history|cache|cookies|browsing data)\b/i.test(text)) {
    return { key: "backspace", modifiers: { meta: true, shift: true } };
  }
  if (/\b(refresh|reload)\b/i.test(text)) {
    return { key: "r", modifiers: { meta: true } };
  }
  if (/\bgo back\b/i.test(text)) {
    return { key: "[", modifiers: { meta: true } };
  }
  if (/\bgo forward\b/i.test(text)) {
    return { key: "]", modifiers: { meta: true } };
  }
  if (/\bnext tab\b/i.test(text)) {
    return { key: "Tab", modifiers: { control: true } };
  }
  if (/\bprev(?:ious)? tab\b/i.test(text)) {
    return { key: "Tab", modifiers: { control: true, shift: true } };
  }
  if (/\bfull ?screen\b/i.test(text)) {
    return { key: "f", modifiers: { meta: true, control: true } };
  }
  if (/\b(split|tile|snap|arrange)\b/i.test(text) && /\bleft\b/i.test(text)) {
    return { key: "left", modifiers: { meta: true, control: true, alt: true } };
  }
  if (/\b(split|tile|snap|arrange)\b/i.test(text) && /\bright\b/i.test(text)) {
    return { key: "right", modifiers: { meta: true, control: true, alt: true } };
  }
  if (/\b(pause|play|resume)\b/i.test(text)) {
    return { key: "space", modifiers: {} };
  }
  if (/\bnew tab\b/i.test(text)) {
    return { key: "t", modifiers: { meta: true } };
  }
  if (/\bclose tab\b/i.test(text)) {
    return { key: "w", modifiers: { meta: true } };
  }
  if (/\b(find\s+in\s+page|search\s+in\s+page|tìm\s+(?:trên\s+trang|từ|keyword)|tìm\s*kiếm.*trang)\b/i.test(text)) {
    return { key: "f", modifiers: { meta: true } };
  }
  if (/\b(incognito|private|ẩn\s*danh|private\s*tab|tab\s*ẩn\s*danh)\b/i.test(text)) {
    return { key: "n", modifiers: { meta: true, shift: true } };
  }
  if (/\b(copy|sao\s*chép)\b.*\b(url|link|đường\s*link|địa\s*chỉ)\b/i.test(text)) {
    return { key: "l", modifiers: { meta: true } };
  }
  if (/\b(lịch\s*sử|history)\b/i.test(text)) {
    return { key: "y", modifiers: { meta: true } };
  }
  if (/\b(quay|record)\b.*\b(màn\s*hình|screen)\b/i.test(text)) {
    return { key: "5", modifiers: { meta: true, shift: true } };
  }
  if (/\b(chụp|screenshot)\b.*\b(vùng|region|area)\b.*\b(clipboard)\b/i.test(text)) {
    return { key: "4", modifiers: { meta: true, control: true, shift: true } };
  }

  return null;
}

// ============================================================================
// Domain B/C/D → tool mapping
// ============================================================================

export function mapIntentToTool(intent: Intent): { name: string; params: Record<string, unknown> } | null {
  const text = intent.rawText.toLowerCase();
  const type = intent.type as IntentType;

  switch (type) {
    // ── Network ──────────────────────────────────────────────────────────
    case "network-control": {
      if (/airplane/.test(text)) {
        return { name: "shell.exec", params: { command: "networksetup -setairportpower en0 off && if command -v blueutil >/dev/null 2>&1; then blueutil --power 0; else echo 'Install blueutil to toggle Bluetooth from CLI'; fi && echo 'Airplane-like mode applied (Wi-Fi off, Bluetooth off if available). '" } };
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
            ? `networksetup -setairportnetwork en0 "${escapedSsid}" "${escapedPass}" && echo 'Connected to ${escapedSsid}'`
            : `networksetup -setairportnetwork en0 "${escapedSsid}" && echo 'Connected to ${escapedSsid}'`;
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
      if (/\b(pip3?)\b.*\binstall\b/i.test(text) || /\b(cài\s*(?:đặt\s*)?thư\s*viện|install\s*(?:python\s*)?package)\b/i.test(text)) {
        const pkgMatch = intent.rawText.match(/\binstall\s+([a-zA-Z0-9_.-]+)\b/i)
          ?? intent.rawText.match(/\bthư\s*viện\s+([a-zA-Z0-9_.-]+)\b/i);
        const pkg = sanitizeToken(pkgMatch?.[1], SAFE_NAME_PATTERN) ?? "requests";
        return { name: "shell.exec", params: { command: `pip3 install ${pkg} 2>&1 | tail -20` } };
      }
      if (/startup\s*apps?|login\s*items?/.test(text)) {
        if (/list|show/.test(text)) {
          return { name: "shell.exec", params: { command: "osascript -e 'tell application \"System Events\" to get name of every login item' && echo '---' && ls ~/Library/LaunchAgents 2>/dev/null | head -30" } };
        }
        return { name: "shell.exec", params: { command: "open 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension' && echo 'Open Login Items settings for startup app management.'" } };
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
          return { name: "shell.exec", params: { command: asCask ? `brew install --cask ${normalizedName}` : `brew install ${normalizedName}` } };
        }
        return { name: "package.install", params: { name } };
      }
      if (/\b(?:remove|uninstall)\b/.test(text)) {
        const pkg = text.match(/(?:remove|uninstall)\s+(\S+)/);
        const name = sanitizeToken(pkg?.[1], SAFE_NAME_PATTERN) ?? "";
        if (name && /clean|leftover|residue|gỡ\s*cài\s*đặt|xóa\s*sạch/.test(text)) {
          return { name: "shell.exec", params: { command: `brew uninstall --zap --cask ${name} 2>/dev/null || brew uninstall ${name} 2>/dev/null || true; rm -rf ~/Library/Application\\ Support/${name} ~/Library/Preferences/*${name}* 2>/dev/null || true; echo 'Uninstall cleanup attempted for ${name}'` } };
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
      if (/fsck|filesystem|file\s*system|integrity|chkdsk/.test(text)) return { name: "health.filesystem", params: { volume: "/", autoRepair: false } };
      if (/disk|storage/.test(text)) return { name: "health.filesystem", params: { volume: "/" } };
      if (/network/.test(text)) return { name: "health.networkDiagnose", params: {} };
      if (/cert|certificate|tls|ssl|expiry|expires/.test(text)) {
        const hostMatch = text.match(/(?:for|host|domain)\s+([a-z0-9.-]+\.[a-z]{2,})/i);
        return { name: "health.certExpiry", params: { host: hostMatch?.[1] || "google.com", port: 443 } };
      }
      if (/log|anomal|spike|error pattern/.test(text)) return { name: "health.logAnomalies", params: {} };
      if (/port exhaustion|socket|connection pool/.test(text)) return { name: "health.socketStats", params: {} };
      if (/security/.test(text)) return { name: "health.securityScan", params: {} };
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
          return { name: "shell.exec", params: { command: "(crontab -l 2>/dev/null; echo '0 3 * * 0 /usr/sbin/diskutil verifyVolume / >/tmp/omnistate-disk-verify.log 2>&1') | crontab - && echo 'Scheduled weekly disk verify at 03:00 Sunday.'" } };
        }
        if (/enable|bật/.test(text) && /trim/.test(text)) {
          return { name: "shell.exec", params: { command: "sudo trimforce enable" } };
        }
        return { name: "shell.exec", params: { command: "echo 'Checking APFS/SSD TRIM status and disk health...' && system_profiler SPNVMeDataType SPSerialATADataType 2>/dev/null | grep -i TRIM -A1 && echo '---' && diskutil verifyVolume /" } };
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

    // ── Display management ─────────────────────────────────────────────
    case "display-management": {
      if (/switch|external|monitor|display\s*mode|mirror|extend/.test(text)) {
        if (/mirror/.test(text)) {
          return { name: "shell.exec", params: { command: "if command -v displayplacer >/dev/null 2>&1; then displayplacer list && echo 'Use displayplacer profile for mirroring.'; else open 'x-apple.systempreferences:com.apple.Displays-Settings.extension' && echo 'displayplacer not installed: opening Displays settings for mirror mode.'; fi" } };
        }
        if (/extend/.test(text)) {
          return { name: "shell.exec", params: { command: "if command -v displayplacer >/dev/null 2>&1; then displayplacer list && echo 'Use displayplacer profile for extended desktop.'; else open 'x-apple.systempreferences:com.apple.Displays-Settings.extension' && echo 'displayplacer not installed: opening Displays settings for extend mode.'; fi" } };
        }
        return { name: "shell.exec", params: { command: "open 'x-apple.systempreferences:com.apple.Displays-Settings.extension' && echo 'Use Displays settings or displayplacer profile to switch physical displays.'" } };
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
        return { name: "shell.exec", params: { command: `cd "${targetDir}" && python3 -m venv .venv && echo 'Virtual environment created at ${targetDir}/.venv'` } };
      }
      if (/(activate|use).*(venv|virtual\s*env|python\s*env)/.test(text)) {
        return { name: "shell.exec", params: { command: "if [ -f .venv/bin/activate ]; then source .venv/bin/activate && python --version; else echo '.venv not found in current directory'; fi" } };
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
      if (/(camera|webcam|microphone|mic)/.test(text)) {
        if (/(lock|block|disable|revoke|deny|off|kh[oó]a|ch[ặa]n|t[ắa]t)/.test(text)) {
          return { name: "shell.exec", params: { command: "tccutil reset Camera && tccutil reset Microphone && echo 'Camera/Microphone permissions reset. Apps must request permission again.'" } };
        }
        if (/(unlock|allow|enable|on|m[ởo])/.test(text)) {
          return { name: "shell.exec", params: { command: "open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera' && open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'" } };
        }
        return { name: "shell.exec", params: { command: "sqlite3 \"$HOME/Library/Application Support/com.apple.TCC/TCC.db\" \"select service,client,auth_value from access where service in ('kTCCServiceCamera','kTCCServiceMicrophone') order by service,client limit 60;\"" } };
      }
      if (/(password|vault|bitwarden|1password|autofill\s*password|điền\s*mật\s*khẩu)/.test(text)) {
        const itemMatch = text.match(/(?:for|item|entry|cho)\s+['\"]?([^'\"]+)['\"]?/i);
        const item = (itemMatch?.[1] ?? "").trim();
        const safeItem = item.replace(/[^a-zA-Z0-9 _.:@+-]/g, "").trim();
        if (/(bitwarden|\bbw\b)/.test(text)) {
          if (safeItem) {
            return { name: "shell.exec", params: { command: `bw get password "${safeItem}" | pbcopy && echo 'Password copied to clipboard from Bitwarden item: ${safeItem}'` } };
          }
          return { name: "shell.exec", params: { command: "bw list items | head -20" } };
        }
        if (/(1password|\bop\b)/.test(text)) {
          if (safeItem) {
            return { name: "shell.exec", params: { command: `op item get "${safeItem}" --fields password | pbcopy && echo 'Password copied to clipboard from 1Password item: ${safeItem}'` } };
          }
          return { name: "shell.exec", params: { command: "op item list | head -20" } };
        }
        return { name: "shell.exec", params: { command: "echo 'Specify vault provider and item name, e.g. bitwarden for github or 1password for aws'" } };
      }
      if (/(encrypt|decrypt|lock\s*folder|unlock\s*folder|mã\s*hóa|giải\s*mã|khóa\s*thư\s*mục|mở\s*khóa\s*thư\s*mục)/.test(text)) {
        const pathMatch = intent.rawText.match(/(?:folder|dir|directory|thư\s*mục|path)\s*[:=]?\s*["']?([^"'\n]+)["']?/i);
        const folder = (pathMatch?.[1] ?? "").trim().replace(/"/g, '\\"');
        if (/decrypt|unlock|giải\s*mã|mở\s*khóa/.test(text)) {
          if (folder) {
            return { name: "shell.exec", params: { command: `hdiutil attach "${folder}" && echo 'Mounted encrypted volume: ${folder}'` } };
          }
          return { name: "shell.exec", params: { command: "echo 'Provide encrypted dmg path, e.g. unlock folder path: ~/Secure/Docs.dmg'" } };
        }
        if (folder) {
          const base = folder.split("/").filter(Boolean).pop() || "secure-data";
          const dmg = `${base}.encrypted.dmg`;
          return { name: "shell.exec", params: { command: `echo 'You will be prompted for encryption password'; hdiutil create -encryption -stdinpass -srcfolder "${folder}" "${dmg}"` } };
        }
        return { name: "shell.exec", params: { command: "echo 'Provide folder path to encrypt, e.g. encrypt folder path: ~/Documents/Secret'" } };
      }
      if (/(secure\s*delete|secure\s*shred|shred\s*file|xóa\s*an\s*toàn)/.test(text)) {
        const targetMatch = intent.rawText.match(/(?:file|folder|path|tệp|thư\s*mục)\s*[:=]?\s*["']?([^"'\n]+)["']?/i);
        const target = (targetMatch?.[1] ?? "").trim().replace(/"/g, '\\"');
        if (target) {
          return { name: "shell.exec", params: { command: `if command -v srm >/dev/null 2>&1; then srm -vz "${target}"; else rm -P "${target}" 2>/dev/null || rm -rf "${target}"; fi && echo 'Secure delete attempted for ${target}'` } };
        }
        return { name: "shell.exec", params: { command: "echo 'Provide file/folder path for secure delete, e.g. secure shred file path: ~/Desktop/secret.txt'" } };
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
          return { name: "shell.exec", params: { command: `diskutil unmountDisk /dev/${diskId} && echo 'Safely ejected /dev/${diskId}'` } };
        }
        return { name: "shell.exec", params: { command: "diskutil list external && echo 'Specify target disk like: safe eject disk: disk2'" } };
      }
      if (/(turn\s*on|enable|bật).*(bluetooth|bt)/.test(text)) {
        return { name: "shell.exec", params: { command: "if command -v blueutil >/dev/null 2>&1; then blueutil --power 1 && echo 'Bluetooth enabled'; else open 'x-apple.systempreferences:com.apple.BluetoothSettings' && echo 'Install blueutil for CLI toggle.'; fi" } };
      }
      if (/(turn\s*off|disable|tắt).*(bluetooth|bt)/.test(text)) {
        return { name: "shell.exec", params: { command: "if command -v blueutil >/dev/null 2>&1; then blueutil --power 0 && echo 'Bluetooth disabled'; else open 'x-apple.systempreferences:com.apple.BluetoothSettings' && echo 'Install blueutil for CLI toggle.'; fi" } };
      }
      if (/(bluetooth|\bbt\b).*(toggle|switch)/.test(text)) {
        return { name: "shell.exec", params: { command: "if command -v blueutil >/dev/null 2>&1; then blueutil --power 0 && echo 'Bluetooth toggled off'; else open 'x-apple.systempreferences:com.apple.BluetoothSettings' && echo 'Install blueutil for CLI toggle.'; fi" } };
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
        return { name: "shell.exec", params: { command: "system_profiler SPPrintersDataType | sed -n '1,120p' && echo 'Use Image Capture/ICA-compatible tools for scan operations.'" } };
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
          return { name: "shell.exec", params: { command: "shortcuts run 'Turn On Do Not Disturb' 2>/dev/null || open 'x-apple.systempreferences:com.apple.Focus-Settings.extension' && echo 'Requested Focus/DND ON (opened settings if shortcut unavailable). '" } };
        }
        if (/(turn\s*off|disable|tắt)/.test(text)) {
          return { name: "shell.exec", params: { command: "shortcuts run 'Turn Off Do Not Disturb' 2>/dev/null || open 'x-apple.systempreferences:com.apple.Focus-Settings.extension' && echo 'Requested Focus/DND OFF (opened settings if shortcut unavailable). '" } };
        }
        return { name: "shell.exec", params: { command: "defaults -currentHost read com.apple.controlcenter FocusModes 2>/dev/null || echo 'Focus status unavailable via defaults; open settings for details.'" } };
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

    // ── Self-healing ───────────────────────────────────────────────────
    case "self-healing": {
      if (/repair\s*(?:my\s*)?(?:network|internet)|fix\s*(?:network|internet)|flush\s*dns|renew\s*dhcp/.test(text)) {
        return { name: "shell.exec", params: { command: "echo 'Running automatic network repair...' && networksetup -setairportpower en0 off && sleep 1 && networksetup -setairportpower en0 on && dscacheutil -flushcache && sudo killall -HUP mDNSResponder 2>/dev/null || true && ipconfig set en0 DHCP && ping -c 2 8.8.8.8" } };
      }
      if (/optimi[sz]e\s*(?:system\s*)?performance|memory\s*leak|high\s*cpu|high\s*memory/.test(text)) {
        return { name: "shell.exec", params: { command: "echo 'Collecting performance diagnostics...' && top -l 1 -o cpu | head -20 && echo '---' && vm_stat && echo '---' && ps aux --sort=-%mem | head -20 && echo '---' && memory_pressure" } };
      }
      if (/network|dns|internet|connect/.test(text)) return { name: "health.networkDiagnose", params: {} };
      if (/fsck|filesystem|file\s*system|integrity|chkdsk/.test(text)) return { name: "health.filesystem", params: { volume: "/", autoRepair: false } };
      if (/cert|certificate|tls|ssl|expiry|expires/.test(text)) {
        const hostMatch = text.match(/(?:for|host|domain)\s+([a-z0-9.-]+\.[a-z]{2,})/i);
        return { name: "health.certExpiry", params: { host: hostMatch?.[1] || "google.com", port: 443 } };
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
          return { name: "shell.exec", params: { command: asCask ? `brew install --cask ${normalizedPkg}` : `brew install ${normalizedPkg}` } };
        }
        return { name: "shell.exec", params: { command: "brew search | head -30" } };
      }
      if (/uninstall|remove\s+app|gỡ\s*cài\s*đặt|brew\s+uninstall/.test(text)) {
        const pkgMatch = intent.rawText.match(/(?:uninstall|remove|gỡ\s*cài\s*đặt)\s+([a-zA-Z0-9@._+-]+)/i)
          ?? intent.rawText.match(/\b(?:app|package|gói)\s*[:=]\s*([a-zA-Z0-9@._+-]+)/i);
        const pkg = (pkgMatch?.[1] ?? "").trim();
        if (pkg) {
          const normalizedPkg = pkg.toLowerCase() === "vscode" ? "visual-studio-code" : pkg;
          return { name: "shell.exec", params: { command: `brew uninstall --zap --cask ${normalizedPkg} 2>/dev/null || brew uninstall ${normalizedPkg} 2>/dev/null || true; rm -rf ~/Library/Application\\ Support/${normalizedPkg} ~/Library/Preferences/*${normalizedPkg}* 2>/dev/null || true; echo 'Uninstall cleanup attempted for ${normalizedPkg}'` } };
        }
        return { name: "shell.exec", params: { command: "brew list --cask && echo '---' && brew list --formula" } };
      }
      if (/startup\s*apps?|login\s*items?|launch\s*at\s*startup/.test(text)) {
        if (/list|show/.test(text)) {
          return { name: "shell.exec", params: { command: "osascript -e 'tell application \"System Events\" to get name of every login item' && echo '---' && ls ~/Library/LaunchAgents 2>/dev/null | head -30" } };
        }
        return { name: "shell.exec", params: { command: "open 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension' && echo 'Open Login Items settings for startup app management.'" } };
      }
      if (/update|upgrade|patch|software\s*update/.test(text)) {
        if (/all|everything|toàn\s*bộ/.test(text)) {
          return { name: "shell.exec", params: { command: "softwareupdate -l && echo '---' && brew update && brew upgrade" } };
        }
      }
      if (/brew/.test(text)) return { name: "shell.exec", params: { command: "brew outdated" } };
      return { name: "shell.exec", params: { command: "softwareupdate -l 2>&1 | head -20" } };
    }

    // ── Display/audio combined ──────────────────────────────────────────
    case "display-audio": {
      if (/switch|external|monitor|display\s*mode|mirror|extend/.test(text)) {
        return { name: "shell.exec", params: { command: "open 'x-apple.systempreferences:com.apple.Displays-Settings.extension' && echo 'Use Displays settings or displayplacer profile to switch physical displays.'" } };
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
      return { name: "hybrid.generateScript", params: { description: intent.rawText, language } };
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
        return { name: "hybrid.organizeFiles", params: { dirPath: `${process.env.HOME ?? "~"}/Desktop`, strategy: "group-by-extension" } };
      }
      if (/downloads?/.test(text)) {
        return { name: "hybrid.organizeFiles", params: { dirPath: `${process.env.HOME ?? "~"}/Downloads`, strategy: "group-by-date" } };
      }
      return { name: "hybrid.organizeFiles", params: { dirPath: process.cwd(), strategy: "smart-workspace" } };
    }

    case "debug-assist": {
      if (/(log|error|crash|stack\s*trace|traceback|summari[sz]e\s*logs?|analy[sz]e\s*logs?)/.test(text)) {
        return { name: "shell.exec", params: { command: "echo '=== Recent Errors (24h) ===' && log show --last 24h --predicate 'eventMessage CONTAINS[c] \"error\" OR eventMessage CONTAINS[c] \"exception\" OR eventMessage CONTAINS[c] \"crash\"' --style compact 2>/dev/null | head -80 && echo '---' && echo '=== Error Summary ===' && log show --last 24h --style compact 2>/dev/null | grep -Ei 'error|exception|crash' | awk '{print tolower($0)}' | sed -E 's/.*(error|exception|crash).*/\\1/' | sort | uniq -c | sort -nr | head -10" } };
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

    // ── Domain E: IOKit / kernel / WiFi security (no tool mapping) ──────
    case "iokit-hardware":
    case "kernel-control":
    case "wifi-security":
      return null;

    default:
      return null;
  }
}

// ============================================================================
// planFromIntent — app-control, ui-interaction, system-query, domain B/C/D
// This function is called from planning.ts for these intent types.
// ============================================================================

export async function planFromIntentDomain(
  intent: Intent,
): Promise<StatePlan> {
  const taskId = `task-${Date.now()}`;
  const nodes: StateNode[] = [];
  const type = intent.type as IntentType;

  switch (type) {
    // ── app-control ──────────────────────────────────────────────────────
    case "app-control": {
      const branchStartLen = nodes.length;

      // Pre-built: Vietnamese "mở X trên Safari"
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
      if (!appRaw && /\b(?:on|in)\s+safari\b/i.test(intent.rawText)) appRaw = "safari";
      if (!appRaw && /\bopen\s+.+\s+on\s+youtube\b/i.test(intent.rawText)) appRaw = "safari";
      const app = appRaw ? normalizeAppName(appRaw) : null;
      const text = intent.rawText.toLowerCase();
      const isQuit = /\b(quit|exit)\b/i.test(text);
      const isMessaging = isMessagingIntentText(intent.rawText);

      if (isQuit && app) {
        nodes.push(actionNode("app-quit", `Quit ${app}`, "app.quit", "deep", { name: app }));
        break;
      }

      if (app) {
        nodes.push(actionNode("activate", `Activate ${app}`, "app.activate", "deep", { name: app }, [], "action"));
      }

      const script = isMessaging
        ? await buildMessagingScriptWithLLM(intent)
        : buildAppControlScript(intent);
      const keyAction = buildKeyboardAction(intent);

      if (script) {
        nodes.push(actionNode("action", intent.rawText, "app.script", "deep", { script, entities: intent.entities }, app ? ["activate"] : []));
      } else if (keyAction) {
        nodes.push(actionNode("action", intent.rawText, "ui.key", "surface", keyAction, app ? ["activate"] : []));
      } else if (app) {
        nodes.push(actionNode("action", intent.rawText, "app.quit", "deep", { name: app }, ["activate"]));
      }

      if (nodes.length === branchStartLen) {
        nodes.push(actionNode("action", intent.rawText, "generic.execute", "deep", { intent: intent.rawText, entities: intent.entities }));
      }
      break;
    }

    // ── ui-interaction ───────────────────────────────────────────────────
    case "ui-interaction": {
      const raw = intent.rawText;
      const coords = extractCoordinatePairs(intent.rawText);

      if (/\b(?:screenshot|screen\s*capture|capture\s*screen|chụp\s*màn\s*hình|chup\s*man\s*hinh)\b/i.test(raw)) {
        nodes.push(actionNode("interact", raw, "screen.capture", "surface", { entities: intent.entities }));
        break;
      }

      if (/\b(translate\s*(?:screen|this|selection|text)|dịch\s*(?:màn\s*hình|đoạn\s*này|văn\s*bản|nội\s*dung))\b/i.test(raw)) {
        nodes.push(actionNode("interact", raw, "shell.exec", "deep", { command: "TMP_IMG=/tmp/omnistate-screen-translate.png; screencapture -x \"$TMP_IMG\" && if command -v tesseract >/dev/null 2>&1; then OCR_TEXT=$(tesseract \"$TMP_IMG\" stdout 2>/dev/null | tr '\\n' ' ' | sed 's/  */ /g' | cut -c1-400); URL=\"https://translate.google.com/?sl=auto&tl=vi&text=$(python3 - <<'PY'\\nimport os, urllib.parse\\nprint(urllib.parse.quote(os.environ.get('OCR_TEXT','')))\\nPY\\n)&op=translate\"; open \"$URL\"; echo \"Opened translation overlay in browser\"; else echo 'Install tesseract first: brew install tesseract'; fi", entities: intent.entities }));
        break;
      }

      if (/\b(fill|autofill|form|đi[ềe]n\s*form|bi[ểe]u\s*m[ẫa]u)\b/i.test(raw)) {
        const script = buildWebFormFillScript(intent);
        if (script) {
          nodes.push(actionNode("interact", raw, "app.script", "deep", { script, entities: intent.entities }));
          break;
        }
      }

      if (isDataEntryWorkflowText(raw)) {
        nodes.push(...buildDataEntryWorkflowNodes(intent));
        break;
      }

      if (/\b(modal|popup|dialog)\b/i.test(raw)) {
        if (/\b(dismiss|close|cancel|escape)\b/i.test(raw)) {
          nodes.push(actionNode("interact", raw, "vision.modal.dismiss", "surface", { action: "dismiss" }));
          break;
        }
        if (/\b(accept|ok|confirm)\b/i.test(raw)) {
          nodes.push(actionNode("interact", raw, "vision.modal.dismiss", "surface", { action: "accept" }));
          break;
        }
        nodes.push(actionNode("interact", raw, "vision.modal.detect", "surface", {}));
        break;
      }

      if (/\b(captcha|recaptcha|hcaptcha|verification challenge)\b/i.test(raw)) {
        nodes.push(actionNode("interact", raw, "vision.captcha.detect", "surface", {}));
        break;
      }

      if (/\b(table|grid|spreadsheet|extract\s+table)\b/i.test(raw)) {
        nodes.push(actionNode("interact", raw, "vision.table.extract", "surface", coords.length >= 1 ? { x: coords[0].x, y: coords[0].y, width: coords[1]?.x ?? 600, height: coords[1]?.y ?? 400 } : {}));
        break;
      }

      if (/\b(accessibility|a11y|wcag|contrast)\b/i.test(raw)) {
        nodes.push(actionNode("interact", raw, "vision.a11y.audit", "surface", {}));
        break;
      }

      if (/\b(ui\s*language|screen\s*language|detect\s+language|ng[oô]n\s*ng[uữ])\b/i.test(raw)) {
        nodes.push(actionNode("interact", raw, "vision.language.detect", "surface", {}));
        break;
      }

      if (/\b(?:drag|drop|k[eé]o\s*th[aả])\b/i.test(raw) && coords.length >= 2) {
        nodes.push(actionNode("interact", intent.rawText, "ui.drag", "surface", { fromX: coords[0].x, fromY: coords[0].y, toX: coords[1].x, toY: coords[1].y }));
        break;
      }

      const chainSteps = parseUiActionChain(raw);
      if (chainSteps.length) {
        nodes.push(...buildUiActionChainNodes(intent.rawText, chainSteps, intent.entities));
        break;
      }

      if (isNegatedUiInstruction(raw)) {
        nodes.push(actionNode("no-op", "Negative UI instruction detected; skipping conflicting action", "ui.wait", "surface", { ms: 50, reason: raw }));
        break;
      }

      nodes.push(
        actionNode("capture", "Capture current screen state", "screen.capture", "surface", {}, [], "find-element"),
        actionNode("find-element", `Locate target element for: ${intent.rawText}`, "ui.find", "surface", { query: intent.rawText, entities: intent.entities }, ["capture"], "interact"),
        actionNode("interact", intent.rawText, "ui.click", "surface", { query: intent.rawText, entities: intent.entities, button: "left" }, ["find-element"], "verify-ui"),
        verifyNode("verify-ui", "Verify UI interaction had expected effect", "UI state updated as expected", ["interact"]),
      );
      break;
    }

    // ── system-query ──────────────────────────────────────────────────────
    case "system-query": {
      if (/\b(thời\s*tiết|weather)\b/i.test(intent.rawText)) {
        const cityMatch = intent.rawText.match(/\b(?:tại|at|in|ở)\s+([A-Za-zÀ-ỹ\s]{2,30}?)(?=\s+(?:hôm\s*nay|today|ngày\s*mai|tomorrow)|$)/i);
        const city = cityMatch?.[1]?.trim().replace(/\s+/g, "+") ?? "Ho+Chi+Minh+City";
        nodes.push(actionNode("query", intent.rawText, "shell.exec", "deep", { command: `curl -s "wttr.in/${city}?format=3" 2>/dev/null || echo "Could not fetch weather for ${city.replace(/\+/g, " ")}"`, entities: intent.entities }));
        break;
      }
      if (/\b(tỷ\s*giá|exchange\s*rate|tỉ\s*giá)\b/i.test(intent.rawText)) {
        nodes.push(actionNode("query", intent.rawText, "shell.exec", "deep", { command: `curl -s 'https://api.exchangerate-api.com/v4/latest/USD' | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('rates',{}); [print(f'{k}: {v}') for k,v in r.items() if k in ['VND','EUR','JPY','GBP','CNY','KRW','SGD']]" 2>/dev/null || open 'https://vietcombank.com.vn/KHCN/Cong-cu-tien-ich/Ty-gia' && echo 'Opening VietcomBank exchange rates'`, entities: intent.entities }));
        break;
      }
      if (/\b(summari[sz]e\s*(?:my\s*)?(?:context|workspace|work)|context\s*summary|t[oó]m\s*tắt\s*(?:ng[ữu]\s*cảnh|màn\s*hình|công\s*việc))\b/i.test(intent.rawText.toLowerCase())) {
        nodes.push(actionNode("query", intent.rawText, "shell.exec", "deep", { command: "echo '=== ACTIVE APP ===' && osascript -e 'tell application \"System Events\" to get name of first process whose frontmost is true' && echo '=== OPEN WINDOWS ===' && osascript -e 'tell application \"System Events\" to tell (name of first process whose frontmost is true) to get name of every window' && echo '=== TOP CPU ===' && ps aux --sort=-%cpu | head -6 && echo '=== TOP MEMORY ===' && ps aux --sort=-%mem | head -6 && echo '=== RECENT DOWNLOADS ===' && ls -lt ~/Downloads | head -6", entities: intent.entities }));
        break;
      }
      const cmd = extractShellCommand(intent);
      const tool = cmd !== intent.rawText ? "shell.exec" : "system.info";
      nodes.push(actionNode("query", intent.rawText, tool, "deep", { command: cmd, entities: intent.entities }));
      break;
    }

    // ── Domain B/C/D — delegate to mapIntentToTool ─────────────────────────
    default: {
      const tool = mapIntentToTool(intent);
      if (tool) {
        nodes.push(actionNode("execute", intent.rawText, tool.name, "deep", { ...tool.params, goal: intent.rawText, entities: intent.entities }));
      } else {
        const cmd = extractShellCommand(intent);
        const isRealCommand = cmd !== intent.rawText;
        nodes.push(actionNode("execute", intent.rawText, isRealCommand ? "shell.exec" : "generic.execute", isRealCommand ? "deep" : "auto", isRealCommand ? { command: cmd } : { goal: intent.rawText }));
      }
    }
  }

  const totalMs = nodes.reduce((sum, n) => sum + n.estimatedDurationMs, 0);
  return { taskId, goal: intent.rawText, estimatedDuration: `${Math.round(totalMs / 1000)}s`, nodes };
}
