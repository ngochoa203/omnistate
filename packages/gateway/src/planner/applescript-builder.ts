// AppleScript builder utilities extracted from intent.ts

import type { Intent } from "./intent.js";

/**
 * Build a keyboard shortcut action for app-control.
 * Returns params for the ui.key orchestrator tool.
 */
export function buildKeyboardAction(intent: Intent): Record<string, unknown> | null {
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

  return null;
}
