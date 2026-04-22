/**
 * Intent parser — converts natural-language commands (Vietnamese/English) to
 * structured AutomationIntent objects using regex heuristics.
 */

import type { AutomationIntent, ActionType } from "./types";
import { AppManagerModule } from "../native/AppManagerModule";

interface Rule {
  pattern: RegExp;
  action: ActionType;
  confidence: number;
  extract?: (match: RegExpMatchArray) => Partial<AutomationIntent>;
}

const RULES: Rule[] = [
  // App open
  {
    pattern: /^(?:mở|open|launch|khởi động)\s+(.+)$/i,
    action: "app:open",
    confidence: 0.95,
    extract: (m) => {
      const name = m[1].trim();
      const app = AppManagerModule.findByName(name);
      return { target: app?.packageName ?? name, params: { name } };
    },
  },
  // Back / Home / Recents
  { pattern: /^(?:quay lại|back|trở về)$/i, action: "app:back", confidence: 1.0 },
  { pattern: /^(?:màn hình chính|home)$/i, action: "app:home", confidence: 1.0 },
  { pattern: /^(?:đa nhiệm|recents|task)$/i, action: "app:recents", confidence: 1.0 },
  { pattern: /^(?:khoá máy|lock)$/i, action: "system:lock", confidence: 1.0 },
  { pattern: /^(?:thông báo|notifications)$/i, action: "system:notifications", confidence: 1.0 },
  // Tap with coordinates
  {
    pattern: /^(?:tap|chạm|bấm)\s+(\d+)[,\s]+(\d+)$/i,
    action: "tap",
    confidence: 1.0,
    extract: (m) => ({ params: { x: Number(m[1]), y: Number(m[2]) } }),
  },
  // Tap on text
  {
    pattern: /^(?:tap|chạm|bấm|nhấn)\s+(?:vào\s+)?(.+)$/i,
    action: "find_element",
    confidence: 0.9,
    extract: (m) => ({ target: m[1].trim() }),
  },
  // Swipe direction
  {
    pattern: /^(?:vuốt|swipe)\s+(lên|xuống|trái|phải|up|down|left|right)$/i,
    action: "swipe",
    confidence: 0.9,
    extract: (m) => ({ params: { direction: normalizeDirection(m[1]) } }),
  },
  // Type text
  {
    pattern: /^(?:gõ|nhập|type|input)\s+(.+)$/i,
    action: "type",
    confidence: 1.0,
    extract: (m) => ({ params: { text: m[1].trim().replace(/^["']|["']$/g, "") } }),
  },
  // Wait
  {
    pattern: /^(?:đợi|chờ|wait|sleep)\s+(\d+)\s*(ms|s|giây)?$/i,
    action: "wait",
    confidence: 1.0,
    extract: (m) => {
      const value = Number(m[1]);
      const unit = (m[2] ?? "ms").toLowerCase();
      const ms = unit === "ms" ? value : value * 1000;
      return { params: { durationMs: ms } };
    },
  },
  // Scroll
  {
    pattern: /^(?:cuộn|scroll)\s+(lên|xuống|up|down)$/i,
    action: "scroll",
    confidence: 0.9,
    extract: (m) => ({ params: { direction: normalizeDirection(m[1]) } }),
  },
  // Screenshot
  { pattern: /^(?:chụp màn hình|screenshot|capture)$/i, action: "screenshot", confidence: 1.0 },
];

function normalizeDirection(s: string): string {
  const m: Record<string, string> = {
    "lên": "up", "up": "up",
    "xuống": "down", "down": "down",
    "trái": "left", "left": "left",
    "phải": "right", "right": "right",
  };
  return m[s.toLowerCase()] ?? "down";
}

export function parseCommand(text: string): AutomationIntent {
  const trimmed = text.trim();
  for (const rule of RULES) {
    const match = trimmed.match(rule.pattern);
    if (match) {
      const extracted = rule.extract ? rule.extract(match) : {};
      return {
        action: rule.action,
        confidence: rule.confidence,
        raw: trimmed,
        ...extracted,
      };
    }
  }
  return { action: "unknown", confidence: 0, raw: trimmed };
}

export function parseCommands(text: string): AutomationIntent[] {
  return text
    .split(/\s*(?:;|\n|->|→|then|rồi|sau đó)\s*/i)
    .filter((s) => s.trim().length > 0)
    .map(parseCommand);
}
