// ── Intent classification extracted from intent.ts ───────────────────────────

import type { Intent, Entity, IntentContext, IntentType, LLMClassificationResult } from "./types.js";
import {
  INTENT_TYPES,
  isLlmRequired,
  formatLlmError,
  parseLlmJson,
  CLASSIFICATION_SYSTEM_PROMPT,
  CLASSIFICATION_SYSTEM_PROMPT_COMPACT,
  resolveEffectiveBudget,
} from "./types.js";
import { requestLlmTextWithFallback } from "../llm/router.js";
import { summarizeForIntent } from "../context/os-context.js";

// ============================================================================
// Quick intent map for single-word / short-phrase commands
// ============================================================================

export const QUICK_INTENT_MAP: Record<string, { type: string; confidence: number }> = {
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

  // Non-tech user aliases
  "mở app": { type: "app-launch", confidence: 0.90 },
  "bật app": { type: "app-launch", confidence: 0.90 },
  "khởi động": { type: "app-launch", confidence: 0.90 },
  "tắt app": { type: "app-control", confidence: 0.90 },
  "đóng app": { type: "app-control", confidence: 0.90 },
  "dừng app": { type: "app-control", confidence: 0.90 },
  "kiểm tra pin": { type: "power-management", confidence: 0.95 },
  "xem pin": { type: "power-management", confidence: 0.95 },
  "bật wifi": { type: "network-control", confidence: 0.95 },
  "tắt wifi": { type: "network-control", confidence: 0.95 },
  "bật bluetooth": { type: "peripheral-management", confidence: 0.95 },
  "tắt bluetooth": { type: "peripheral-management", confidence: 0.95 },
  "tăng volume": { type: "audio-management", confidence: 0.95 },
  "giảm volume": { type: "audio-management", confidence: 0.95 },
  "tắt tiếng": { type: "audio-management", confidence: 0.95 },
  "bật tiếng": { type: "audio-management", confidence: 0.95 },
  "tối": { type: "os-config", confidence: 0.90 },
  "sáng": { type: "os-config", confidence: 0.90 },
  "chế độ tối": { type: "os-config", confidence: 0.90 },
  "chế độ sáng": { type: "os-config", confidence: 0.90 },
  "máy nóng": { type: "thermal-management", confidence: 0.95 },
  "quạt kêu": { type: "thermal-management", confidence: 0.90 },
  "dung lượng": { type: "disk-management", confidence: 0.90 },
  "bộ nhớ": { type: "memory-management", confidence: 0.90 },
  "bật đèn": { type: "os-config", confidence: 0.85 },
  "tắt đèn": { type: "os-config", confidence: 0.85 },
  "mở spotlight": { type: "system-query", confidence: 0.90 },
};

// Regex patterns for common phrases
export const PHRASE_PATTERNS: Array<[RegExp, string]> = [
  // ── Vietnamese browser + video/navigation commands ──
  [/\b(?:mở|xem|tìm|phát)\s+(?:video|bài\s*hát|bài|clip)\s+(?:đầu\s*tiên|mới\s*nhất|đầu)\b/i, "app-control"],
  [/\b(?:video\s*đầu\s*tiên|first\s*video|kết\s*quả\s*đầu\s*tiên|first\s*result)\b/i, "app-control"],
  [/\b(?:truy\s*cập|vào\s*trang|vào\s*web|mở\s*trang)\s+(?:youtube|google|facebook|tiktok|instagram|[\w-]+\.(?:com|vn|org|net))\b/i, "app-control"],
  [/\b(?:mở|open)\s+.+\s+(?:trên|bằng|qua|trong)\s+(?:safari|chrome|firefox|brave|arc|edge|trình\s*duyệt)\b/i, "app-control"],
  [/\b(?:mở|open|launch).+(?:safari|chrome|firefox).+(?:youtube|google|trang|web)\b/i, "multi-step"],
  [/\byoutube\b.*(?:video|bài\s*hát|bài|clip|nhạc|10\s*ngàn\s*năm)/i, "multi-step"],
  [/(?:video|bài\s*hát|bài|clip|nhạc|10\s*ngàn\s*năm).*\byoutube\b/i, "multi-step"],
  [/\b(?:mở|xem|tìm|phát|play)\s+(?:video|bài\s*hát|bài|clip)\s+(?:trên\s*)?youtube\b/i, "multi-step"],
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

  // Group 6b: Zip/Compress (before organize to avoid conflict with nén)
  [/\b(?:nén|compress|zip)\s+file/i, "file-operation"],
  [/\b(?:giải\s*nén|unzip|extract)\s+(?:file|folder|archive)/i, "file-operation"],
  [/\b(?:zip|unzip|compress|extract\s+archive|giải\s*nén|nén\s*file)\b/i, "file-operation"],

  // Group 7: Complex tasks
  [/\b(?:csv|data\.csv)\b.*\b(?:cột|column|email)\b/i, "file-operation"],
  [/\b(?:tự\s*động|auto|automatically)\b.*\b(?:chuyển|move)\b.*\b(?:downloads?|tải\s*về)\b/i, "multi-step"],
  [/\b(?:mở\s*tất\s*cả|open\s*all)\b.*\b(?:ứng\s*dụng|apps?)\b/i, "multi-step"],
  [/\b(?:so\s*sánh|compare|diff)\b.*\b(?:file|tập\s*tin)\b/i, "file-operation"],
  [/\b(?:file\s*nặng\s*hơn|larger?\s*than|nặng\s*hơn|>\s*1\s*GB|greater\s*than\s*1\s*GB)\b/i, "disk-cleanup"],
  [/\b(?:đóng\s*tất\s*cả|close\s*all)\b.*\b(?:trừ|except)\b/i, "app-control"],
  [/\b(?:pin|battery)\b.*\b(?:dưới|below|under)\s*\d+%/i, "power-management"],
  // IOKit hardware deep reads
  [/\b(?:iokit|smc\s*key|thermal\s*sensor|gpu\s*temp|battery\s*health|nvram|usb\s*tree|pci\s*device|hardware\s*sensor)\b/i, 'iokit-hardware'],
  // Kernel control
  [/\b(?:sysctl|kext(?:stat|load|unload)?|kernel\s*extension|vm\s*stat|dtrace|dtruss|syscall\s*trace|spotlight\s*index|launchctl|launchd|purge\s*memory|kernel\s*param)\b/i, 'kernel-control'],
  // WiFi security
  [/\b(?:aircrack|airodump|aireplay|handshake\s*capture|wifi\s*(?:monitor|capture|packet|deauth|attack|crack)|packet\s*capture|deauth(?:entication)?|wpa\s*(?:crack|handshake)|channel\s*hop)\b/i, 'wifi-security'],

  // Non-technical user phrases
  [/\b(?:mở|bật|tắt|đóng|dừng)\s+(?:ứng\s*dụng|app|app\s*)\b/i, "app-control"],
  [/\b(?:máy\s*(?:tôi\s*)?|thiết\s*bị\s*(?:của\s*)?(?:tôi\s*)?|chiếc\s*(?:máy\s*)?)\b/i, "system-query"],
  [/\b(?:chạy\s*(?:ổn\s*định|êm|tốt|mượt|tốt\s*không))\b/i, "system-query"],
  [/\b(?:làm\s*gì|xoay\s*sở|giúp\s*được\s*gì|dùng\s*được\s*gì)\b/i, "system-query"],
  [/\b(?:bật|tắt)\s*(?:wifi|wi-fi|wifi|bluetooth|bt|âm\s*lượng|volume|màn\s*hình|screen|brightness)\b/i, "multi-step"],
];

// ============================================================================
// LLM-based classification
// ============================================================================

export async function classifyWithLLM(
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

// ============================================================================
// Regex heuristic fallback
// ============================================================================

export const HEURISTIC_RULES: Array<{
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
    pattern:
      /^(ls|cd|cat|echo|grep|find|ps|df|du|top|kill|rm|cp|mv|mkdir|chmod|curl|wget|whoami|hostname|pwd|uptime|date|which|env|printenv|uname|id|ifconfig|ping|traceroute|dig|nslookup)\b/i,
    type: "shell-command",
    entityExtractor: (m) => ({
      command: { type: "command", value: m.input ?? m[0] },
    }),
  },
  {
    pattern: /\bcreate\b.*\b(project|app)\b.*\b(vite|react)\b/i,
    type: "shell-command",
    entityExtractor: () => ({
      command: { type: "command", value: "scaffold-project" },
    }),
  },
  {
    pattern:
      /\b(stop|close|quit|exit|pause|mute|unmute|resume|refresh|reload|go back|go forward|next tab|prev(?:ious)? tab|close tab|new tab|full ?screen|minimize|maximize|play|volume)\b/i,
    type: "app-control",
    entityExtractor: (m) => {
      const text = m.input ?? "";
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
      /\b(message|send\s+message|chat\s+with|nh[aắ]n\s*tin|g[iử]i\s*tin\s*nh[aắ]n)\b/i,
    type: "app-control",
    entityExtractor: () => ({}),
  },
  {
    pattern: /\bopen\s+(.+?)\s+on\s+youtube\b/i,
    type: "app-control",
    entityExtractor: (m) => ({
      action: { type: "command", value: "open" },
      app: { type: "app", value: "safari" },
      query: { type: "text", value: m[1]?.trim() ?? "" },
    }),
  },
  {
    pattern: /\b(password|vault|bitwarden|1password|autofill\s+password|điền\s+mật\s*khẩu)\b/i,
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
    pattern: /\bopen\s+([a-zA-Z][a-zA-Z\s]{1,30}?)(?:\s*$|\s+(?:app|application)\b)/i,
    type: "app-launch",
    entityExtractor: (m) => ({
      app: { type: "app", value: m[1]?.trim() ?? m[0] },
    }),
  },
  {
    pattern: /\bm[ởo]\s+([a-zA-Z][a-zA-Z\s]{1,30}?)(?:\s*$|\s+(?:app|ứng dụng)\b)/i,
    type: "app-launch",
    entityExtractor: (m) => ({
      app: { type: "app", value: m[1]?.trim() ?? m[0] },
    }),
  },
  {
    pattern:
      /\b(read|write|copy|move|rename|delete|remove|mkdir|create file|touch|cat|ls|list)\b/i,
    type: "file-operation",
    entityExtractor: () => ({}),
  },
  {
    pattern: /\b(click|double\s*click|right\s*click|tap|type|scroll|navigate|fill in|select|drag|drop|focus|mouse|cursor|move)\b/i,
    type: "ui-interaction",
    entityExtractor: () => ({}),
  },
  {
    pattern:
      /\b(disk|memory|ram|cpu|process|processes|network|uptime|battery|who is running|system info|ps aux|top|htop|hostname|whoami|who am i|current dir|where am i|what time|date and time)\b/i,
    type: "system-query",
    entityExtractor: () => ({}),
  },
  // ── Non-technical Vietnamese app open/close ──
  {
    pattern: /\b(?:mở|bật|khởi\s*động)\s+([a-zA-ZÀ-ỹ][a-zA-ZÀ-ỹ0-9\s]{0,30}?)(?:\s+(?:app|ứng\s*dụng))?$/i,
    type: "app-launch",
    entityExtractor: (m) => ({ app: { type: "app", value: m[1]?.trim() ?? "" } }),
  },
  {
    pattern: /\b(?:tắt|đóng|dừng|thoát)\s+([a-zA-ZÀ-ỹ][a-zA-ZÀ-ỹ0-9\s]{0,30}?)(?:\s+(?:app|ứng\s*dụng))?$/i,
    type: "app-control",
    entityExtractor: (m) => ({ app: { type: "app", value: m[1]?.trim() ?? "" } }),
  },
];

export function classifyWithHeuristics(text: string): LLMClassificationResult {
  // ── Check for missing params first ──────────────────────────────────
  const missing = detectMissingParams(text);
  if (missing) {
    return {
      type: missing.type as IntentType,
      confidence: missing.confidence,
      entities: missing.entities,
    };
  }

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

// ============================================================================
// Public: classifyIntent
// ============================================================================

export interface AskClarificationIntent {
  type: "ask-clarification";
  is_valid: false;
  missing_params: string[];
  clarification_question: string;
  entities: Record<string, Entity>;
  confidence: number;
  rawText: string;
}

function detectMissingParams(text: string): AskClarificationIntent | null {
  const isVietnamese = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(text);
  const ask = (q: string, missing: string[]): AskClarificationIntent => ({
    type: "ask-clarification",
    is_valid: false,
    missing_params: missing,
    clarification_question: q,
    entities: {},
    confidence: 0.98,
    rawText: text,
  });

  // ── Global multi-step guard ─────────────────────────────────────────────
  // Skip greedy single-action rules for complex multi-step phrases
  // e.g. "Bật nhạc lên, đợi 10 phút sau thì tắt máy" or "gom vào...rồi nén lại gửi email"
  // Multi-step indicator: comma + subsequent action OR "rồi" (then/after) in the text
  const isMultiStep = /,(?=\s*(?:rồi|sau|đợi|và|gửi|xong))/i.test(text)
    || /rồi\b/i.test(text) && /,(?=\s*\S)/i.test(text);

  // Security-blocked
  if (/\b(bỏ\s*qua|bỏ)\s+(xác\s*thực|auth|quyền|permission|root|admin|privilege)\b/i.test(text)) {
    return isVietnamese
      ? ask("Đây là yêu cầu bảo mật. Bạn có muốn tiếp tục không?", ["security_blocked"])
      : ask("This appears to be a security-related request. Do you want to proceed?", ["security_blocked"]);
  }

  // Alarm without time
  if (/\b(đặt\s*báo\s*thức|báo\s*thức|set\s*alarm|create\s*alarm|reminder|nhắc\s*nhở)\b/i.test(text)) {
    if (!/\b\d{1,2}\s*[hg:]|sáng|chiều|tối|am\b|\d+\s*(?:giờ|h|hours?|phút|minutes?|mins?|giây|seconds?|s)\b/i.test(text)) {
      return isVietnamese
        ? ask("Bạn muốn đặt báo thức lúc mấy giờ?", ["time"])
        : ask("What time should I set the alarm for?", ["time"]);
    }
  }

  // Send file without recipient
  if (/^(?:gửi|send)\s*(?:file\s*)?(?:đó|nay|that|this|đi)?\s*đi?\b/i.test(text)) {
    return isVietnamese
      ? ask("Bạn muốn gửi file nào và gửi cho ai?", ["file_path", "recipient"])
      : ask("Which file do you want to send, and who should receive it?", ["file_path", "recipient"]);
  }

  // Close app without name
  if (/^(đóng|dừng)\b/i.test(text)) {
    if (/\b(lại|đi)\b/i.test(text) || /^(đóng|dừng)\s*$/i.test(text.trim())) {
      return isVietnamese
        ? ask("Bạn muốn đóng ứng dụng nào?", ["app_name"])
        : ask("Which application should I close?", ["app_name"]);
    }
  }

  // Ping without target
  if (/^ping\s*(thử\s*)?xem\s*(mạng|network|internet)\b/i.test(text)) {
    return isVietnamese
      ? ask("Ping đến host nào?", ["target_host"])
      : ask("Which host should I ping?", ["target_host"]);
  }

  // Delete ambiguous — require pronoun after "delete/remove" too (not just Vietnamese)
// Note: \b doesn't work reliably with Unicode diacritics + /i flag, so we use (?=\s|$) lookahead
  if (/\b(?:X|x)(óa|oa)\b.*?(?:nó|that|it)(?=\s|$)|\b(?:delete|remove)\b.*?\b(?:nó|that|it)(?=\s|$)/i.test(text)) {
    if (!/\bfile\b|\bthư\s*mục\b|\bfolder\b|\bđoạn\b|\bdòng\b/i.test(text)) {
      return isVietnamese
        ? ask("Bạn muốn xóa gì?", ["target"])
        : ask("What would you like me to delete?", ["target"]);
    }
  }

  // Shutdown dangerous — skip for multi-step phrases (including "rồi" compound)
  const isShutdownMultiStep = isMultiStep || /rồi\b/i.test(text);
  if (!isShutdownMultiStep && /\b(tắt\s*máy|shutdown|power\s+off|turn\s+off\s+computer)\b/i.test(text)) {
    return isVietnamese
      ? ask("Bạn có chắc muốn tắt máy không?", ["confirmation"])
      : ask("Are you sure you want to shut down the computer?", ["confirmation"]);
  }

  // Format disk dangerous
  if (/\b(fomát|format)\b.*\b(cứng|ổ|disk)\b/i.test(text)) {
    return isVietnamese
      ? ask("Bạn muốn format ổ nào?", ["confirmation"])
      : ask("Which disk should I format?", ["confirmation"]);
  }

  // Copy without destination
  if (/\b(copy|chép|sao\s*chép)\b/i.test(text)) {
    if (!/\b(vào|sang|to|đến|để|into)\s+\S/i.test(text)) {
      return isVietnamese
        ? ask("Bạn muốn copy vào đâu?", ["destination"])
        : ask("Where should I copy this to?", ["destination"]);
    }
  }

  // Translate without target language (NOT screen translate) — skip for multi-step
  if (!isMultiStep && /\b(dịch|translate)\b/i.test(text) && !/\b(màn\s*hình|screen)\b/i.test(text)) {
    const hasTargetLang = /\b(sang|to|in)\s+(?:tiếng\s+)?(anh|việt|pháp|nhật|trung|hàn|đức|ý|english|vietnamese|french|japanese|chinese|korean|german|italian)\b/i.test(text);
    // Ask if: no target language given, OR text only has generic reference (no actual content to translate)
    const stripped = text.trim().replace(/^(?:dịch|translate)\s+(?:(?:câu|nội\s*dung|văn\s*bản|đoạn)\s*(?:này|đó|kia|text|sentence|content)?\s*)+/i, "").trim();
    const isOnlyTargetLang = /^$/.test(stripped) || /^(?:sang|to|in)\s+(?:tiếng\s+)?\S+/i.test(stripped);
    if (!hasTargetLang || isOnlyTargetLang) {
      return isVietnamese
        ? ask("Bạn muốn dịch sang ngôn ngữ nào?", ["text", "target_language"])
        : ask("What text should I translate and to which language?", ["text", "target_language"]);
    }
  }

  // Create project without name
  if (/^tạo\s*một\s*project\b/i.test(text)) {
    return isVietnamese
      ? ask("Tên project là gì và tạo ở đâu?", ["project_name", "location", "framework"])
      : ask("What is the project name, where should I create it, and what framework?", ["project_name", "location", "framework"]);
  }

  // Clone without URL
  if (/^clone\s*(cái\s*)?project\b/i.test(text)) {
    return isVietnamese
      ? ask("URL của repo là gì?", ["repo_url"])
      : ask("What is the repository URL?", ["repo_url"]);
  }

  // Schedule meeting without time
  if (/^lên\s*lịch\s*họp\b/i.test(text)) {
    return isVietnamese
      ? ask("Bạn muốn đặt lịch họp vào lúc nào và có những ai tham dự?", ["time", "attendees"])
      : ask("What time is the meeting and who should attend?", ["time", "attendees"]);
  }

  // Money transfer
  if (/^chuyển\s*tiền\b/i.test(text)) {
    return isVietnamese
      ? ask("Chuyển bao nhiêu tiền và qua app nào?", ["amount", "app"])
      : ask("How much money should I transfer and through which app?", ["amount", "app"]);
  }

  // Compress — skip for multi-step phrases (e.g. "gom vào...rồi nén lại gửi email")
  // Skip only when compress is generic (no specific target file)
  if (!isMultiStep && /\b(nén|compress|zip)\b/i.test(text)) {
    if (!/^nén\s+file\s+/i.test(text) && !/^(?:giải\s*nén|unzip)\s+/i.test(text)) {
      return isVietnamese
        ? ask("Những file nào cần nén và nén ra file gì?", ["file_paths"])
        : ask("Which files should I compress and what should the output be named?", ["file_paths"]);
    }
  }

  // Play music — skip for multi-step phrases or specific fixed patterns
  // Also skip when "bật nhạc lên" is exactly the phrase (handed by preLlmRules → media.play)
  if (!isMultiStep && /^bật\s*(bài\s*)?nhạc\b.*lên\b/i.test(text)) {
    // Skip only when phrase is generic (no app mentioned after "lên")
    // But "bật nhạc lên" alone should be allowed through to preLlmRules
    if (!/^bật\s*(?:bài\s*)?nhạc\s+lên$/i.test(text)) {
      return isVietnamese
        ? ask("Bạn muốn bật bài nào và trên app nào?", ["song_name", "app"])
        : ask("Which song should I play and on which app?", ["song_name", "app"]);
    }
  }

  // Rename file without new name
  if (/^đổi\s*tên\s*file\s*này\b/i.test(text)) {
    return isVietnamese
      ? ask("Bạn muốn đổi tên thành gì?", ["source_file", "new_name"])
      : ask("What should I rename it to?", ["source_file", "new_name"]);
  }

  // Open log without path
  if (/^mở\s*(file\s*)?log\b/i.test(text)) {
    return isVietnamese
      ? ask("Đường dẫn đến file log là gì?", ["log_path"])
      : ask("What is the path to the log file?", ["log_path"]);
  }

  // Find folder without name
  if (/^tìm\s*cái\s*thư\s*mục\b/i.test(text)) {
    return isVietnamese
      ? ask("Tên thư mục cần tìm là gì?", ["folder_name"])
      : ask("What is the name of the folder you are looking for?", ["folder_name"]);
  }

  // Run script without path
  if (/^chạy\s*(cái\s*)?script\b/i.test(text)) {
    return isVietnamese
      ? ask("Đường dẫn script là gì?", ["script_path"])
      : ask("What is the path to the script?", ["script_path"]);
  }

  // Send email without recipient
  if (/^gửi\s*email\b/i.test(text)) {
    return isVietnamese
      ? ask("Email sẽ được gửi đến địa chỉ nào?", ["recipient_email"])
      : ask("What email address should I send this to?", ["recipient_email"]);
  }

  // Create repo without name
  if (/^tạo\s*một\s*repo\b/i.test(text)) {
    return isVietnamese
      ? ask("Tên repo là gì và visibility (public/private) là gì?", ["repo_name", "visibility"])
      : ask("What is the repo name and should it be public or private?", ["repo_name", "visibility"]);
  }

  // Reminder/alarm (broader check for cases like "Đặt báo thức giúp tôi")
  if (/\b(báo\s*thức|alarm|reminder)\b/i.test(text)) {
    if (!/\b\d{1,2}\s*[hg:]|sáng|chiều|tối|am\b|\d+\s*(?:giờ|h|hours?|phút|minutes?|mins?|giây|seconds?|s)\b/i.test(text)) {
      return isVietnamese
        ? ask("Bạn muốn đặt báo thức lúc mấy giờ?", ["time"])
        : ask("What time should I set the alarm for?", ["time"]);
    }
  }

  return null;
}
export async function classifyIntent(text: string, context?: IntentContext): Promise<Intent> {
  // ── Missing-param detection (highest priority) ──
  const missingParamsResult = detectMissingParams(text);
  if (missingParamsResult) {
    return missingParamsResult;
  }

  const contextSummary = context?.os ? summarizeForIntent(context.os as Parameters<typeof summarizeForIntent>[0]) : "";
  const effectiveText = contextSummary ? `${text}\n\n[OS context summary]\n${contextSummary}` : text;
  const forceUiInteraction = /\b(mouse|cursor|click|double\s*click|right\s*click|drag|drop|scroll|move\s+mouse|click\s+at|x\s*\d+\s*y\s*\d+|k[ée]o|nh[aá]p|chu[ộo]t|cu[ộo]n)\b/i.test(text);
  const strictLlm = isLlmRequired();
  const normalized = text.toLowerCase().trim();

  // Deterministic high-signal routing to keep critical planner paths stable
  const preLlmRules: Array<{ pattern: RegExp; type: IntentType; confidence: number; entityExtractor?: (m: RegExpMatchArray) => Record<string, Entity> }> = [
    // Fix: "Đặt báo thức sau X giây/phút/giờ" → alarm.set
    {
      pattern: /(?:đặt\s*báo\s*thức|set\s*alarm|cài\s*báo\s*thức|báo\s*thức)\b.*(?:sau|trong|in|after)\s*\d+\s*(?:giây|s|phút|p|giờ|h)\b/i,
      type: "alarm.set",
      confidence: 0.97,
    },
    {
      pattern: /(?:đặt\s*báo\s*thức|set\s*alarm|cài\s*báo\s*thức)\b.*\d+\s*(?:giây|s|phút|p|giờ|h)\b/i,
      type: "alarm.set",
      confidence: 0.96,
    },
    // Fix: "đợi 20 giây" / "wait 1 minute" → alarm.set
    {
      pattern: /^(?:đợi|chờ|wait)\s+\d+\s*(?:giây|giay|s|seconds?|second|phút|phut|p|minutes?|minute|giờ|gio|h|hours?)\b/i,
      type: "alarm.set",
      confidence: 0.97,
    },
    // Fix: "notify me in 30 seconds" → alarm.set
    {
      pattern: /^(?:notify\s*me|remind\s*me|timer|set\s*timer|đặt\s*timer|hẹn\s*giờ)\b.*\d+\s*(?:second|sec|s|minute|min|m|hour|hr|h)\b/i,
      type: "alarm.set",
      confidence: 0.96,
    },
    // Fix: "bật/tắt wifi" → network-control (before app-launch)
    {
      pattern: /^open\s+ports?$/i,
      type: "network-control",
      confidence: 0.98,
    },
    // Fix: "battery health" → power-management (before iokit-hardware)
    {
      pattern: /^battery\s+health$/i,
      type: "power-management",
      confidence: 0.98,
    },
    // FIX AGENT 1: App launch vs OS-config/focus/wifi/ports
    { pattern: /^mở\s+app\s+giúp\s*tôi$/i, type: "ask-clarification", confidence: 0.96 },
    { pattern: /^chế\s*độ\s*tối\s*bật\s*lên$/i, type: "os-config", confidence: 0.96 },
    { pattern: /^bật\s*chế\s*độ\s*tập\s*trung$/i, type: "os-config", confidence: 0.96 },
    { pattern: /^tắt\s*chế\s*độ\s*tập\s*trung\s*đi$/i, type: "os-config", confidence: 0.95 },
    { pattern: /^open\s+history$/i, type: "app-control", confidence: 0.95 },
    { pattern: /^bật\s*wifi\s*(?:lên)?$/i, type: "network-control", confidence: 0.96 },
    { pattern: /^tắt\s*wifi\s*(?:đi)?$/i, type: "network-control", confidence: 0.96 },
    { pattern: /^show\s*open\s*ports?$/i, type: "network-control", confidence: 0.96 },
    { pattern: /^kết\s*nối\s*VPN\s+\S+/i, type: "network-control", confidence: 0.95 },
    { pattern: /^kết\s*nối\s+VPN$/i, type: "network-control", confidence: 0.93 },
    { pattern: /^block\s*IP\s+\S+/i, type: "security-management", confidence: 0.95 },
    { pattern: /^ping\s+\S+\s+/i, type: "network-control", confidence: 0.94 },
    { pattern: /^ping\s+\S+$/i, type: "network-control", confidence: 0.93 },
    // FIX AGENT 2: Process/system/power management
    { pattern: /^list\s+running\s+processes$/i, type: "process-management", confidence: 0.96 },
    { pattern: /^kill\s+process\s+(?:named\s+)?\S+/i, type: "process-management", confidence: 0.96 },
    { pattern: /^restart\s+docker\s+service$/i, type: "service-management", confidence: 0.95 },
    { pattern: /^sleep\s+máy(?:\s+ngay)?$/i, type: "power-management", confidence: 0.96 },
    { pattern: /^restart\s+máy\s+tính$/i, type: "power-management", confidence: 0.96 },
    { pattern: /\b(sleep|restart|shutdown)\s+máy\b/i, type: "power-management", confidence: 0.95 },
    { pattern: /^ngủ\s*máy(?:\s+ngay)?$/i, type: "power-management", confidence: 0.95 },
    // FIX AGENT 3: File ops, compression, clipboard, multi-step
    { pattern: /^xóa\s+file\s+\S+/i, type: "file-operation", confidence: 0.96 },
    { pattern: /^nén\s+file\b/i, type: "file-operation", confidence: 0.96 },
    { pattern: /^nén\s+file\s+lại$/i, type: "file-operation", confidence: 0.96 },
    { pattern: /^giải\s*nén\s+\S+/i, type: "file-operation", confidence: 0.96 },
    { pattern: /^find\s+large\s+files\b/i, type: "disk-cleanup", confidence: 0.96 },
    { pattern: /^copy\s+nội\s*dung\s+ vào\s+clipboard$/i, type: "clipboard-management", confidence: 0.95 },
    { pattern: /^copy\s+.*\s+clipboard$/i, type: "clipboard-management", confidence: 0.93 },
    { pattern: /^paste\s+từ\s+clipboard$/i, type: "clipboard-management", confidence: 0.95 },
    { pattern: /^chụp\s+màn\s*hình\s*rồi\s+/i, type: "multi-step", confidence: 0.96 },
    { pattern: /^screenshot\s+then\s+/i, type: "multi-step", confidence: 0.95 },
    { pattern: /\b(screenshot|chup\s*man)\s+rồi\s+/i, type: "multi-step", confidence: 0.95 },
    // FIX AGENT 4: Package manager (brew, npm, pip) — shell execution patterns take priority
    // "execute npm install" should be shell-command, not package-management
    { pattern: /^execute\s+(?:npm|pnpm|yarn|git|python|node|bash|sh|perl|ruby|cargo)\b/i, type: "shell-command", confidence: 0.97 },
    { pattern: /^run\s+(?:npm|pnpm|yarn|git|python|node|bash|sh)\s+/i, type: "shell-command", confidence: 0.96 },
    { pattern: /^exec(?:ute)?\s+(?:npm|pnpm|yarn|git|python|node|bash|sh)\b/i, type: "shell-command", confidence: 0.96 },
    { pattern: /^brew\s+install\s+\S+/i, type: "package-management", confidence: 0.97 },
    { pattern: /^npm\s+(?:install|uninstall|list|outdated|search|update|run)\b/i, type: "package-management", confidence: 0.97 },
    { pattern: /^pip\s+install\s+\S+/i, type: "package-management", confidence: 0.97 },
    { pattern: /^yarn\s+(?:add|remove|upgrade|list)\b/i, type: "package-management", confidence: 0.96 },
    { pattern: /^pnpm\s+(?:add|remove|upgrade|list)\b/i, type: "package-management", confidence: 0.96 },
    { pattern: /^cài\s*(?:đặt\s*)?package\s+bằng\s+npm/i, type: "package-management", confidence: 0.96 },
    { pattern: /^cài\s*thư\s*viện\s+\S+\s*(?:cho|for)\s+\S+/i, type: "package-management", confidence: 0.96 },
    { pattern: /^cài\s*thư\s*viện\s+\S+/i, type: "package-management", confidence: 0.95 },
    { pattern: /^search\s+for\s+\S+\s+package\s+/i, type: "package-management", confidence: 0.95 },
    { pattern: /^list\s+installed\s+(?:npm|node|package)s?$/i, type: "package-management", confidence: 0.95 },
    { pattern: /^list\s+installed\s+npm\s+packages$/i, type: "package-management", confidence: 0.96 },
    { pattern: /^uninstall\s+\S+\s+via\s+brew/i, type: "package-management", confidence: 0.95 },
    { pattern: /^check\s+npm\s+outdated/i, type: "package-management", confidence: 0.94 },
    { pattern: /\b(brew|npm|yarn|pnpm|pip|pip3)\s+install\b/i, type: "package-management", confidence: 0.96 },
    { pattern: /\b(brew|npm|yarn|pnpm)\s+(?:search|list|outdated|uninstall|remove)\b/i, type: "package-management", confidence: 0.95 },
    // FIX AGENT 5: Hardware display/bluetooth/printer/container
    { pattern: /^tăng\s*(?:độ\s*)?sáng\s*(?:màn\s*hình\s*)?lên$/i, type: "display-management", confidence: 0.96 },
    { pattern: /^giảm\s*(?:độ\s*)?sáng\s*(?:màn\s*hình\s*)?xuống$/i, type: "display-management", confidence: 0.96 },
    { pattern: /^bật\s*bluetooth\s*(?:lên)?$/i, type: "peripheral-management", confidence: 0.96 },
    { pattern: /^turn\s*off\s*bluetooth$/i, type: "peripheral-management", confidence: 0.96 },
    { pattern: /^list\s*bluetooth\s*devices$/i, type: "peripheral-management", confidence: 0.96 },
    { pattern: /^đổi\s*keyboard\s*layout/i, type: "hardware-control", confidence: 0.95 },
    { pattern: /^print\s+document\s+\S+/i, type: "printer-management", confidence: 0.96 },
    { pattern: /^stop\s+all\s+containers$/i, type: "container-management", confidence: 0.96 },
    { pattern: /^display\s+brightness\s+(?:up|down|increase|decrease)/i, type: "display-management", confidence: 0.95 },
    // FIX AGENT 6: IOKit, multi-step, workflow
    { pattern: /open\s+youtube.*search/i, type: "multi-step", confidence: 0.95 },
    { pattern: /youtube.*search.*music/i, type: "multi-step", confidence: 0.94 },
    { pattern: /^bật\s+nhạc\s+rồi\s+đợi.*phút.*tắt\s+máy$/i, type: "multi-step", confidence: 0.96 },
    { pattern: /^bật\s+nhạc\s+rồi\s+/i, type: "multi-step", confidence: 0.93 },
    { pattern: /\band\s+(?:search|play|open|find|look|get)/i, type: "multi-step", confidence: 0.93 },
    { pattern: /\bread\s+SMC\s+keys/i, type: "iokit-hardware", confidence: 0.95 },
    { pattern: /đọc\s+nhiệt\s*độ.*IOKit/i, type: "iokit-hardware", confidence: 0.96 },
    { pattern: /^tạo\s+automation\s+macro/i, type: "automation-macro", confidence: 0.95 },
    { pattern: /^run\s+data\s+entry\s+workflow/i, type: "multi-step", confidence: 0.96 },
    { pattern: /^run\s+workflow\s+template/i, type: "workflow-template", confidence: 0.96 },
    { pattern: /generate\s+script\s+to\s+backup/i, type: "script-generation", confidence: 0.95 },
    { pattern: / SMC\s+key|smc\s+key|IOKit.*cpu|IOKit.*nhiệt/i, type: "iokit-hardware", confidence: 0.93 },

    // Fix: "open github.com" → app-control (not app-launch)
    {
      pattern: /^open\s+[a-zA-Z0-9][a-zA-Z0-9.-]*\.(com|vn|org|net|io|dev|app|co|me|info|xyz|biz|cc|ru|cn|jp|kr|au|uk|de|fr|es|it|nl|pl|br|in|th|sg|hk|tw)\b/i,
      type: "app-control",
      confidence: 0.97,
    },
    // Fix: "open incognito/private window"
    {
      pattern: /^open\s+(incognito|private\s*(window|tab|browser))/i,
      type: "app-control",
      confidence: 0.97,
    },
    // Fix: "open folder <name>" → file-operation
    {
      pattern: /^(?:open|mở)\s+folder\s+[a-zA-ZÀ-ỹ0-9][a-zA-ZÀ-ỹ0-9 _.-]{0,60}$/i,
      type: "file-operation",
      confidence: 0.97,
    },
    // Fix: "mở thư mục X" → file-operation
    {
      pattern: /^mở\s+thư\s*mục\s+[a-zA-ZÀ-ỹ0-9][a-zA-ZÀ-ỹ0-9 _.-]{0,60}$/i,
      type: "file-operation",
      confidence: 0.97,
    },
    // Fix: "mở file X" → file-operation
    {
      pattern: /^(?:mở|open)\s+file\s+[a-zA-Z0-9./\\_-]+$/i,
      type: "file-operation",
      confidence: 0.97,
    },
    // Fix: "bật wifi / tắt wifi" → network-control
    {
      pattern: /^(?:bật|tắt)\s+wifi$/i,
      type: "network-control",
      confidence: 0.97,
    },
    // Fix: "bật nhạc" → media.play
    {
      pattern: /^(?:bật|phát|chơi)\s+(?:nhạc|bài\s*(?:hát)?|music|sound)(?:\s+lên)?$/i,
      type: "media.play",
      confidence: 0.97,
    },
    // Fix: "tắt nhạc" → media.pause
    {
      pattern: /^(?:tắt|dừng|ngừng)\s+(?:nhạc|bài|song|music)$/i,
      type: "media.pause",
      confidence: 0.97,
    },
    // Fix: "next track / bài tiếp theo" → media.nextTrack
    {
      pattern: /^(?:next\s*(?:track|song|bài)|bài\s*tiếp\s*theo)$/i,
      type: "app-control",
      confidence: 0.97,
    },
    // Fix: "mở trang youtube" → multi-step
    {
      pattern: /^mở\s+trang\s+(?:youtube|google|facebook|tiktok|instagram|twitter|wiki)/i,
      type: "multi-step",
      confidence: 0.95,
    },
    // Fix: "mở video trên youtube" → multi-step
    {
      pattern: /^mở\s+video\s+.+\s+trên\s+youtube$/i,
      type: "multi-step",
      confidence: 0.95,
    },
    // Fix: "kiểm tra mạng" → system-query
    {
      pattern: /^kiểm\s*tra\s+(?:mạng|internet|network|web)$/i,
      type: "system-query",
      confidence: 0.97,
    },
    // Fix: "chép file" → file-operation
    {
      pattern: /^chép\s+file/i,
      type: "file-operation",
      confidence: 0.97,
    },
    // Fix: "tìm file X" → file-operation
    {
      pattern: /^tìm\s+file\s+[a-zA-Z0-9./\\_-]/i,
      type: "file-operation",
      confidence: 0.95,
    },
    // Fix: "tìm kiếm file" → file.search
    {
      pattern: /^tìm\s*kiếm\s+file/i,
      type: "file.search",
      confidence: 0.96,
    },
    // Fix: "nén file / giải nén" → file-operation
    {
      pattern: /^(?:nén|compress)\s+file/i,
      type: "file-operation",
      confidence: 0.97,
    },
    {
      pattern: /^(?:giải\s*nén|unzip|extract)\s+(?:file|folder|archive)/i,
      type: "file-operation",
      confidence: 0.97,
    },
    // Fix: "xóa cache" → app-control
    {
      pattern: /^(?:xóa|xóa|clear)\s+cache/i,
      type: "app-control",
      confidence: 0.96,
    },
    {
      pattern: /^xóa\s+cache\s+(?:trình\s*duyệt|browser|chrome|safari|firefox)/i,
      type: "app-control",
      confidence: 0.97,
    },
    {
      pattern: /^(?:run|execute|bash|sh)\s+\S/i,
      type: "shell-command",
      confidence: 0.97,
    },
    {
      pattern: /^(?:ls|cat|grep|ps|df|du|top|rm|cp|mv|mkdir|chmod|curl|wget|whoami|pwd|uname|ping|ssh|git|npm|yarn|pnpm|python|node|make|cargo)\s+(?:-|\.|\/|~|\w+\s*-)/i,
      type: "shell-command",
      confidence: 0.96,
    },
    {
      pattern: /^(?:mở|open|launch).+(?:,\s*(?:truy\s*cập|mở|vào|sau\s*đó|rồi|navigate|go\s+to)|sau\s*đó\s+(?:mở|truy|vào|click|nhấp)|rồi\s+(?:mở|truy|vào)|tiếp\s*(?:theo\s*)?(?:mở|truy|vào|click))/i,
      type: "multi-step",
      confidence: 0.95,
    },
    {
      pattern: /^(?:mở|open)\s+.+\s+(?:trên|bằng|qua|trong)\s+(?:safari|chrome|firefox|brave|arc|edge|cốc\s*cốc|trình\s*duyệt)/i,
      type: "app-control",
      confidence: 0.96,
    },
    {
      pattern: /^(?:truy\s*cập|vào\s*(?:trang|web|website)?)\s+(?:https?:\/\/|www\.|youtube|google|facebook|tiktok|instagram|twitter|github|[\w-]+\.(?:com|vn|org|net))/i,
      type: "app-control",
      confidence: 0.95,
    },
    {
      pattern: /^(?:open|launch|start|activate|mở|khởi?\s*động)\s+(?!.*\b(?:bằng|qua|tại|trong|sau\s*đó|rồi|tiếp\s*theo|truy\s*cập|video\s*đầ|kết\s*quả)\b)(?!.*\bon\s+(?:youtube|spotify|netflix|tiktok|soundcloud|apple\s*music)\b)(?!.*,)[a-zA-ZÀ-ỹ][a-zA-ZÀ-ỹ0-9\s\-\.]{0,40}?(?:\s+(?:app|application|ứng\s*dụng))?$/i,
      type: "app-launch",
      confidence: 0.97,
    },
    // ── YouTube video search (no browser specified) ──
    {
      pattern: /^mở\s+video\s+["'”'”]?([^"''"’'”"]+)["'”'”]?\s*trên\s*youtube\b/i,
      type: "multi-step",
      confidence: 0.95,
      entityExtractor: (m) => ({ query: { type: "text", value: m[1]?.trim() ?? "" } }),
    },
    {
      pattern: /^mở\s+video\s+["'”'”]?([^"''"’'”"]+)["'”'”]?\s*$/i,
      type: "multi-step",
      confidence: 0.60,
      entityExtractor: (m) => ({ query: { type: "text", value: m[1]?.trim() ?? "" } }),
    },
    // ── Alarm / timer set with time specified ──
    {
      pattern: /^.*\b(cài\s*báo\s*thức|đặt\s*báo\s*thức|set\s*alarm|đặt\s*alarm|create\s*alarm|set\s*timer|đặt\s*hẹn\s*giờ|hẹn\s*giờ)\b.*\b\d{1,2}\s*h(?:r)?\s*\d{0,2}|\b\d{1,2}\s*giờ\s*\d{0,2}\s*(?:phút|p)|(?:at\s*|lúc\s*)?\d{1,2}:\d{2}(?:\s*(?:am|pm|sáng|chiều|tối))?\b/i,
      type: "alarm.set",
      confidence: 0.97,
      entityExtractor: (m) => ({ intent: { type: "text", value: m[0] } }),
    },
    {
      pattern: /^.*\b(cài\s*báo\s*thức|đặt\s*báo\s*thức|set\s*alarm|đặt\s*alarm|create\s*alarm|set\s*timer|đặt\s*hẹn\s*giờ|hẹn\s*giờ|alarm\s*set)\b.*$/i,
      type: "alarm.set",
      confidence: 0.90,
      entityExtractor: (m) => ({ intent: { type: "text", value: m[0] } }),
    },
    {
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
      pattern: /\b(vault|bitwarden|1password|autofill\s+password|password\s+manager|điền\s+mật\s*khẩu)\b/i,
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
      pattern: /\b(?:switch|mirror|extend|external\s*display|monitor)\b.*\b(display|screen|monitor)\b/i,
      type: "display-audio",
      confidence: 0.93,
    },
    {
      pattern: /(?:\b(?:bluetooth|\bbt\b)\b.*\b(?:toggle|turn\s*off|disable|tắt)\b)|(?:\b(?:toggle|turn\s*off|disable|tắt)\b.*\b(?:bluetooth|\bbt\b)\b)/i,
      type: "peripheral-management",
      confidence: 0.94,
    },
    {
      pattern: /\b(bookmark|save\s*page|lưu\s*trang\s*dấu|d[ấa]u\s*trang)\b/i,
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
    {
      pattern: /(?:^|\s)(?:tắt\s*(?:nhạc|âm\s*thanh|tiếng)|phát\s*(?:nhạc|bài|video|clip)|dừng\s*(?:nhạc|phát)|tua\s*(?:nhạc|bài)|bài\s*(?:tiếp|kế\s*tiếp)|âm\s*lượng\s*(?:tối\s*đa|tối\s*thiểu|lên|xuống))(?:\s|$)/i,
      type: "audio-management",
      confidence: 0.95,
    },
    {
      pattern: /(?:tăng|giảm|chỉnh)\s*(?:âm\s*lượng|tiếng)|(?:âm\s*lượng|volume)\s*(?:tăng|giảm|lên|xuống|\d+%?)/i,
      type: "audio-management",
      confidence: 0.96,
    },
    {
      pattern: /\b(?:volume\s+(?:up|down)|(?:increase|decrease|raise|lower|set|mute|unmute)\s+(?:volume|sound|audio))\b/i,
      type: "audio-management",
      confidence: 0.96,
    },
    // ── Vietnamese close/tab commands ──
    {
      pattern: /(?:đóng\s*(?:tất\s*cả\s*)?tab|đóng\s*(?:tab|cửa\s*sổ|window)|tắt\s*(?:ứng\s*dụng|app\b))/i,
      type: "app-control",
      confidence: 0.95,
    },
    // ── Vietnamese alarm/reminder commands ──
    {
      pattern: /(?:đặt\s*(?:báo\s*thức|hẹn\s*giờ|nhắc\s*nhở)|tạo\s*(?:báo\s*thức|nhắc\s*nhở)|\bset\s*(?:alarm|timer|reminder)\b)/i,
      type: "app-control",
      confidence: 0.95,
    },
    // ── Notification / timer commands ──
    {
      pattern: /(?:thông\s*báo|nofitication|notify\s*me|remind\s*me|nhắc\s*(?:tôi|mình))\b.*(?:sau|trong|in|after)\b/i,
      type: "app-control",
      confidence: 0.96,
    },
    {
      pattern: /(?:thông\s*báo|nofitication|notify\s*me|remind\s*me|nhắc\s*(?:tôi|mình))\b/i,
      type: "app-control",
      confidence: 0.93,
    },
    // ── Vietnamese notes/notes-app commands ──
    {
      pattern: /(?:ghi\s*chú|tạo\s*(?:ghi\s*chú|note)|thêm\s*(?:vào\s*)?notes?|\bcreate\s*note\b|\badd\s*note\b|\btake\s*note\b)/i,
      type: "app-control",
      confidence: 0.95,
    },
    // ── IOKit hardware ──
    {
      pattern: /\b(?:đọc\s*(?:nhiệt\s*độ|cảm\s*biến|pin)|smc\s*key|iokit\s*sensor|battery\s*health|nvram\s*(?:read|write|list)|usb\s*tree|pci\s*(?:devices?|tree))\b/i,
      type: 'iokit-hardware',
      confidence: 0.92,
    },
    // ── Kernel control ──
    {
      pattern: /\b(?:sysctl|load\s*kext|unload\s*kext|kext\s*(?:load|unload|stat|list)|vm\s*stat|purge\s*(?:memory|ram|cache)|dtrace|dtruss|syscall\s*trace|mdutil|launchctl\s*(?:list|load|unload|kickstart)|launchd\s*service)\b/i,
      type: 'kernel-control',
      confidence: 0.93,
    },
    // ── WiFi security ──
    {
      pattern: /\b(?:aircrack|airodump|aireplay|capture\s*handshake|wifi\s*(?:monitor\s*mode|packet\s*capture|deauth|crack|attack)|deauth(?:entication)?\s*attack|wpa\s*(?:handshake|crack)|channel\s*hop(?:ping)?|install\s*aircrack)\b/i,
      type: 'wifi-security',
      confidence: 0.95,
    },
    // ── Non-technical user natural language ──
    {
      pattern: /\b(?:làm\s*gì|xoay\s*sở|giúp\s*(?:được\s*)?gì|dùng\s*(?:được\s*)?gì|máy\s*(?:này\s*)?làm\s*được\s*gì)\b/i,
      type: "system-query",
      confidence: 0.92,
    },
    {
      pattern: /\b(?:máy\s*(?:tôi\s*)?(?:chạy\s*)?(?:ổn\s*)?(?:định\s*)?(?:tốt\s*)?không|máy\s*(?:tôi\s*)?có\s*khỏe\s*không|tình\s*trạng\s*(?:máy\s*)?(?:của\s*)?tôi)\b/i,
      type: "system-query",
      confidence: 0.93,
    },
    {
      pattern: /\b(?:bật\s*(?:wifi|wifi|wi-fi|bluetooth|bt|âm\s*lượng|volume|màn\s*hình|screen|brightness|nhạc|nhạc\s*nền))\b/i,
      type: "multi-step",
      confidence: 0.93,
    },
    {
      pattern: /\b(?:tắt\s*(?:wifi|wifi|wi-fi|bluetooth|bt|âm\s*lượng|volume|màn\s*hình|screen|brightness))\b/i,
      type: "multi-step",
      confidence: 0.93,
    },
    {
      pattern: /\b(?:tăng\s*(?:volume|âm\s*lượng|tiếng|sound))\b/i,
      type: "audio-management",
      confidence: 0.94,
    },
    {
      pattern: /\b(?:giảm\s*(?:volume|âm\s*lượng|tiếng|sound))\b/i,
      type: "audio-management",
      confidence: 0.94,
    },
    {
      pattern: /\b(?:bật\s*nhạc|bật\s*bài\s*(?:hát)?|phát\s*nhạc|chơi\s*nhạc)\b/i,
      type: "media.play",
      confidence: 0.93,
    },
    {
      pattern: /\b(?:tắt\s*nhạc|dừng\s*nhạc|ngừng\s*nhạc)\b/i,
      type: "media.pause",
      confidence: 0.93,
    },
    {
      pattern: /\b(?:đợi|chờ)\s*\d+\s*(?:phút|p|giây|s|giờ|h)\b/i,
      type: "alarm.set",
      confidence: 0.93,
    },
    {
      pattern: /\b(?:bật\s*nhạc\s*.+rồi\s*(?:đợi|chờ|tắt|đóng))\b/i,
      type: "multi-step",
      confidence: 0.92,
    },
    {
      pattern: /\b(?:mở\s*file|mở\s*tài\s*liệu|mở\s*folder|mở\s*thư\s*mục)\b/i,
      type: "file-operation",
      confidence: 0.93,
    },
    {
      pattern: /\b(?:tạo\s*file|tạo\s*tài\s*liệu|tạo\s*thư\s*mục)\b/i,
      type: "file-operation",
      confidence: 0.93,
    },
    {
      pattern: /\b(?:kiểm\s*tra\s*(?:wifi|mạng|internet|pin|pin\s*còn))\b/i,
      type: "system-query",
      confidence: 0.94,
    },
    {
      pattern: /\b(?:dọn\s*(?:desktop|màn\s*hình|file|temp|rác))\b/i,
      type: "maintenance.diskCleanup",
      confidence: 0.93,
    },
    {
      pattern: /\b(?:xoá\s*cache|xóa\s*cache|dọn\s*cache)\b/i,
      type: "maint.clearBrowserCache",
      confidence: 0.93,
    },
    {
      pattern: /\b(?:gửi\s*(?:tin\s*)?nhắn|nhắn\s*tin\s*cho|gửi\s*message)\b/i,
      type: "app-control",
      confidence: 0.93,
    },
    {
      pattern: /\b(?:xoá|xóa|delete)\s+(?:hết|tất\s*cả)\b/i,
      type: "ask-clarification",
      confidence: 0.96,
    },
    {
      pattern: /\b(?:mở\s*chế\s*độ\s*(?:tối|sáng|tập\s*trung|focus))\b/i,
      type: "os-config",
      confidence: 0.94,
    },
    {
      pattern: /\b(?:cho\s*tôi\s*xem|hiển\s*thị|show\s*me|cho\s*xem)\b/i,
      type: "system-query",
      confidence: 0.88,
    },
    {
      pattern: /\b(?:tìm\s*(?:kiếm\s*)?(?:file|thư\s*mục|app|ứng\s*dụng))\b/i,
      type: "file.search",
      confidence: 0.93,
    },
    {
      pattern: /\b(?:màn\s*hình\s*(?:của\s*)?tôi|brightness|màn\s*hình)\s*(?:sáng|tối|tăng|giảm)\b/i,
      type: "display-management",
      confidence: 0.93,
    },
  ];

  for (const rule of preLlmRules) {
    if (rule.pattern.test(text)) {
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
        const browserMatch = text.match(/(?:trên|bằng|qua|trong)\s+(safari|chrome|firefox|brave|arc|edge|cốc\s*cốc)/i);
        const browser = browserMatch?.[1]?.trim();
        const queryMatch = text.match(/^(?:mở|open)\s+(.+?)\s+(?:trên|bằng|qua|trong)\s+/i);
        const navMatch = text.match(/^(?:truy\s*cập|vào\s*(?:trang|web|website)?)\s+(.+)/i);
        const queryRaw = queryMatch?.[1]?.trim() ?? navMatch?.[1]?.trim();
        if (browser) entities.app = { type: "app", value: browser };
        if (queryRaw) entities.query = { type: "text", value: queryRaw };
      } else if (rule.type === "multi-step" && rule.entityExtractor) {
        entities = rule.entityExtractor([text]);
      } else if (rule.type === "multi-step") {
        // Extract video query from "mở video 'X' trên youtube" patterns
        const queryMatch = text.match(/^mở\s+video\s+["'""'"]+([^"''""'"]+)["'""'"]+\s*(?:\s*trên\s*youtube)?\s*$/i);
        if (queryMatch?.[1]) entities.query = { type: "text", value: queryMatch[1].trim() };
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

  let llmResult: LLMClassificationResult | null = null;
  try {
    llmResult = await classifyWithLLM(effectiveText, strictLlm);
  } catch (err) {
    if (strictLlm) throw err; // Re-throw when LLM is required
    // LLM failed (empty response, network error, etc.) — fall through to heuristics
    llmResult = null;
  }

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

  const heuristicResult = classifyWithHeuristics(text);
  const result = llmResult ?? heuristicResult;

  if (!llmResult && result.type === "multi-step") {
    // Guard: if text contains explicit target language, don't route translate commands
    // through the generic translate-ui pattern (let the detectMissingParams logic handle it)
    const hasTargetLang = /\b(sang|to|in)\s+(?:tiếng\s+)?(anh|việt|pháp|nhật|trung|hàn|đức|ý|english|vietnamese|french|japanese|chinese|korean|german|italian)\b/i.test(normalized);
    const isTranslateText = /\b(dịch|translate)\b/i.test(normalized);

    for (const [regex, intentType] of PHRASE_PATTERNS) {
      // Skip the generic translate-ui pattern when a specific target language is given
      if (isTranslateText && hasTargetLang) {
        const translatePat = /\b(?:translate\s*(?:screen|this|selection|text)|dịch\s*(?:màn\s*hình|đoạn\s*này|văn\s*bản|nội\s*dung))\b/i;
        if (translatePat.test(normalized)) continue;
      }
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
