// Consolidated pre-LLM classification rules — imported by classifyIntent and classifyIntentSpeculative

import type { IntentType } from "./parsed-command.js";

export interface PreLlmRule {
  pattern: RegExp;
  type: IntentType;
  confidence: number;
}

export const PRE_LLM_RULES: PreLlmRule[] = [
  // Specific patterns first to prevent generic Vietnamese verb rules from short-circuiting
  { pattern: /(?:\bopen\s+.+\s+on\s+youtube\b|(?:^|\s)(?:mở|phát|bật|xem).+?(?:trên|ở|tại)\s+youtube(?:\b|$))/i, type: "app-control", confidence: 0.95 },
  { pattern: /(?:^|\s)(?:đóng|tắt)\s+\S/i, type: "app-control", confidence: 0.94 },
  { pattern: /(?:^|\s)(?:mở|bật|khởi\s*chạy)\s+\S/i, type: "app-launch", confidence: 0.94 },
  { pattern: /(?:^|\s)(?:dừng|tạm\s*dừng)\s+\S/i, type: "app-control", confidence: 0.93 },
  { pattern: /\b(?:run|execute)\b.*\b(?:npm|pnpm|yarn|git|python|node|bash|sh|make|cargo)\b/i, type: "shell-command", confidence: 0.95 },
  { pattern: /\b(send\s+email|compose\s+email|write\s+email|open\s+mail|mail\s+app|g[iử]i\s*email|thư\s*điện\s*tử|(?:email|mail)\b(?!\s*:))\b/i, type: "app-control", confidence: 0.94 },
  { pattern: /\b(message|send\s+message|chat\s+with|nh[aắ]n\s*tin|g[iử]i\s*tin\s*nh[aắ]n|message\s+for)\b/i, type: "app-control", confidence: 0.94 },
  { pattern: /\b(split|tile|snap|arrange)\b.{0,30}\b(window|windows)\b/i, type: "app-control", confidence: 0.95 },
  { pattern: /\b(fill|autofill|form|đi[ềe]n\s*form|bi[ểe]u\s*m[ẫa]u)\b/i, type: "ui-interaction", confidence: 0.95 },
  { pattern: /\b(vault|bitwarden|1password|autofill\s+password|password\s+manager|điền\s+mật\s+khẩu)\b/i, type: "security-management", confidence: 0.95 },
  { pattern: /\b(?:on|in)\s+safari\b|(?:trên|ở|tại)\s+safari\b/i, type: "app-control", confidence: 0.92 },
  { pattern: /\b(?:switch|mirror|extend|external\s+display|monitor)\b.*\b(display|screen|monitor)\b/i, type: "display-audio", confidence: 0.93 },
  { pattern: /(?:\b(?:bluetooth|\bbt\b)\b.*\b(?:toggle|turn\s*off|disable|tắt)\b)|(?:\b(?:toggle|turn\s*off|disable|tắt)\b.*\b(?:bluetooth|\bbt\b)\b)/i, type: "peripheral-management", confidence: 0.94 },
  { pattern: /\b(bookmark|save\s+page|lưu\s+trang\s+dấu|d[ấa]u\s+trang)\b/i, type: "app-control", confidence: 0.95 },
  { pattern: /\b(open|show|view)\b.*\b(history)\b/i, type: "app-control", confidence: 0.94 },
  { pattern: /\b(clear|delete|x[oó]a|d[ọo]n)\b.*\b(history|cache|cookies|browsing data)\b/i, type: "app-control", confidence: 0.94 },
  { pattern: /\b(?:defrag|trimforce|trim\s*ssd|ssd\s*trim|disk\s*optimization|optimi[sz]e\s*disk|lên\s*lịch\s*tối\s*ưu\s*đĩa)\b/i, type: "disk-cleanup", confidence: 0.94 },
  { pattern: /\b(?:summari[sz]e\b.*\b(?:context|workspace|work)\b|context\s*summary|t[oó]m\s*tắt\b.*\b(?:ng[ữu]\s*cảnh|màn\s*hình|công\s*việc)\b)\b/i, type: "system-query", confidence: 0.94 },
  { pattern: /\b(?:connect|join|kết\s*nối)\b.*\b(?:wifi|wi-fi|wireless)\b/i, type: "network-control", confidence: 0.95 },
  { pattern: /\b(?:translate\s*(?:screen|this|selection|text)|dịch\s*(?:màn\s*hình|đoạn\s*này|văn\s*bản|nội\s*dung))\b/i, type: "ui-interaction", confidence: 0.95 },
  { pattern: /\b(?:screenshot|screen\s*capture|capture\s*screen|chụp\s*màn\s*hình|chup\s*man\s*hinh)\b/i, type: "ui-interaction", confidence: 0.95 },
];
