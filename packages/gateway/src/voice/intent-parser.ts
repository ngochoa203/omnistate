import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";
import { classifySemanticIntent, rankSemanticIntents } from "./semantic-intent.js";

const log = childLogger("intent-parser");

export type IntentLabel =
  | "search"
  | "app_open"
  | "app_close"
  | "file_read"
  | "file_write"
  | "message_send"
  | "reminder_set"
  | "alarm_set"
  | "music_control"
  | "navigation"
  | "call"
  | "question"
  | "command"
  | "unknown";

export interface IntentCandidate {
  label: IntentLabel;
  confidence: number;
  entities: string[];
  partial: boolean;
}

export interface IntentParser {
  feed(text: string): IntentCandidate;
  feedMultiple(text: string, maxCandidates?: number): IntentCandidate[];
  getCurrentIntent(): IntentCandidate | null;
  reset(): void;
  getHistory(): IntentCandidate[];
}

// Keyword patterns for each intent - more specific first
const INTENT_RULES: Array<{
  label: IntentLabel;
  keywords: string[];
  priority: number;
}> = [
  // Alarm and reminders
  {
    label: "alarm_set",
    keywords: [
      "báo thức", "đặt báo thức", "set alarm", "hẹn giờ", "wake me up at",
      "alarm for", "đặt đồng hồ", "hẹn báo thức", "báo thức lúc"
    ],
    priority: 10,
  },
  {
    label: "reminder_set",
    keywords: [
      "nhắc nhở", "tạo nhắc nhở", "remind me", "reminder", "nhớ", "tạo lời nhắc",
      "đặt nhắc nhở", "lời nhắc", "remind", "nhắc tôi"
    ],
    priority: 9,
  },
  // File operations
  {
    label: "file_read",
    keywords: [
      "đọc", "mở file", "open file", "read file", "xem file", "show me",
      "đọc file", "hiển thị", "mở", "xem", "đọc nội dung"
    ],
    priority: 8,
  },
  {
    label: "file_write",
    keywords: [
      "lưu", "ghi", "save", "write", "tạo file", "create file", "ghi file",
      "lưu file", "tạo", "new file", "tạo mới"
    ],
    priority: 8,
  },
  // App control
  {
    label: "app_open",
    keywords: [
      "mở", "khởi động", "open", "launch", "start", "chạy", "run",
      "turn on", "bật", "điều khiển", "truy cập", "khoảng"
    ],
    priority: 7,
  },
  {
    label: "app_close",
    keywords: [
      "đóng", "close", "quit", "tắt", "turn off", "thoát", "dừng ứng dụng",
      "kết thúc", "tắt ứng dụng", "đóng ứng dụng"
    ],
    priority: 7,
  },
  // Communication
  {
    label: "message_send",
    keywords: [
      "gửi tin nhắn", "send message", "message", "text", "SMS", "chat",
      "nhắn tin", "tin nhắn", "soạn tin", "gửi SMS", "gửi text"
    ],
    priority: 6,
  },
  {
    label: "call",
    keywords: [
      "gọi", "call", "phone", "điện thoại", "ring", "gọi điện", "gọi cho",
      "liên hệ", "cuộc gọi", "video call"
    ],
    priority: 6,
  },
  // Media control
  {
    label: "music_control",
    keywords: [
      "bật nhạc", "chơi nhạc", "play music", "pause", "dừng nhạc", "next song",
      "skip", "volume", "tăng âm", "giảm âm", "nhạc", "âm nhạc", "chơi nhạc",
      "tạm dừng", "phát nhạc", "nghe nhạc", "loa", "speaker"
    ],
    priority: 5,
  },
  // Navigation
  {
    label: "navigation",
    keywords: [
      "chỉ đường", "navigation", "maps", "directions", "tìm đường", "bản đồ",
      "địa điểm", "vị trí", "đường đi", "navigate", "dẫn đường"
    ],
    priority: 5,
  },
  // Search
  {
    label: "search",
    keywords: [
      "tìm", "search", "google", "search for", "find", "kiếm", "tra cứu",
      "tìm kiếm", "searching", "tìm thông tin", "google", "searching"
    ],
    priority: 4,
  },
  // Questions
  {
    label: "question",
    keywords: [
      "what is", "what's", "who is", "where is", "how to", "là gì", "ở đâu",
      "là ai", "thế nào", "bao nhiêu", "tại sao", "vì sao", "why", "when",
      "how many", "which", "nào", "gì", "sao", "mấy", "thế nào", "ai"
    ],
    priority: 3,
  },
  // System commands
  {
    label: "command",
    keywords: [
      "chạy lệnh", "run command", "terminal", "bash", "execute", "lệnh",
      "command", "sudo", "shell", "script", "cmd"
    ],
    priority: 2,
  },
];

// Entity extraction patterns
const ENTITY_PATTERNS = {
  time: /\b\d{1,2}:\d{2}\b/g,
  timeRange: /\b\d{1,2}h\d{0,2}\b/g,
  quoted: /["']([^"']+)["']/g,
  numbers: /\b\d+\b/g,
  duration_seconds: /\b(\d+)\s*(s|giây|seconds?)\b/gi,
  extensions: /\.\w{2,5}/g,
  apps: /\b(Safari|Chrome|Finder|Notes|Reminders|Messages|Mail|Calendar|Photos|Camera|Settings|System|FaceTime|Phone|Music|Clock|Timer|Discord|Slack|WhatsApp|Telegram|Spotify|YouTube|Netflix)\b/gi,
};

function extractEntities(text: string): string[] {
  const entities: string[] = [];

  // Extract quoted strings
  const quotedMatch = text.match(ENTITY_PATTERNS.quoted);
  if (quotedMatch) {
    for (const match of quotedMatch) {
      entities.push(match.slice(1, -1));
    }
  }

  // Extract time patterns
  const timeMatches = text.match(ENTITY_PATTERNS.time);
  if (timeMatches) {
    entities.push(...timeMatches);
  }

  // Extract time range (e.g., "5h30")
  const timeRangeMatches = text.match(ENTITY_PATTERNS.timeRange);
  if (timeRangeMatches) {
    entities.push(...timeRangeMatches);
  }

  // Extract numbers
  const numberMatches = text.match(ENTITY_PATTERNS.numbers);
  if (numberMatches) {
    entities.push(...numberMatches);
  }

  // Extract file extensions
  const extMatches = text.match(ENTITY_PATTERNS.extensions);
  if (extMatches) {
    entities.push(...extMatches);
  }

  // Extract app names
  const appMatches = text.match(ENTITY_PATTERNS.apps);
  if (appMatches) {
    entities.push(...appMatches.map((a) => a.toLowerCase()));
  }

  // Extract duration patterns (e.g., "30 giây", "5s", "10 seconds")
  const durationMatches = text.match(ENTITY_PATTERNS.duration_seconds);
  if (durationMatches) {
    entities.push(...durationMatches.map((d) => d.trim()));
  }

  return [...new Set(entities)];
}

function classifyIntent(text: string, partial: boolean): IntentCandidate {
  if (!text || text.trim().length === 0) {
    return { label: "unknown", confidence: 0, entities: [], partial };
  }

  const semanticResult = classifySemanticIntent(text, partial);
  if (semanticResult.label !== "unknown" && semanticResult.confidence >= 0.58) {
    return semanticResult;
  }

  const normalizedText = text.toLowerCase().trim();
  const matchedRules: Array<{ label: IntentLabel; keywords: string[]; matchCount: number }> = [];

  for (const rule of INTENT_RULES) {
    let matchCount = 0;
    for (const keyword of rule.keywords) {
      if (normalizedText.includes(keyword.toLowerCase())) {
        matchCount++;
      }
    }
    if (matchCount > 0) {
      matchedRules.push({ label: rule.label, keywords: rule.keywords, matchCount });
    }
  }

  if (matchedRules.length === 0) {
    return {
      label: "unknown",
      confidence: 0.1,
      entities: extractEntities(text),
      partial,
    };
  }

  // Sort by match count and priority
  matchedRules.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    const priorityA = INTENT_RULES.find((r) => r.label === a.label)?.priority ?? 0;
    const priorityB = INTENT_RULES.find((r) => r.label === b.label)?.priority ?? 0;
    return priorityB - priorityA;
  });

  const bestMatch = matchedRules[0]!;
  const totalKeywords = bestMatch.keywords.length;
  const matchedKeywords = bestMatch.matchCount;

  // Calculate confidence
  let confidence = matchedKeywords / totalKeywords;
  if (matchedKeywords === totalKeywords) {
    confidence = 1.0;
  } else if (matchedKeywords >= 2) {
    confidence = 0.8;
  } else if (matchedKeywords === 1) {
    confidence = 0.6;
  }

  // Short text penalty
  if (text.length < 3) {
    confidence -= 0.2;
  }

  // Partial penalty
  if (partial) {
    confidence *= 0.7;
  }

  const keywordResult = {
    label: bestMatch.label,
    confidence: Math.max(0.1, Math.min(1.0, confidence)),
    entities: extractEntities(text),
    partial,
  };

  if (semanticResult.label !== "unknown" && semanticResult.confidence >= keywordResult.confidence - 0.08) {
    return semanticResult;
  }

  return keywordResult;
}

class IntentParserImpl extends EventEmitter implements IntentParser {
  private history: IntentCandidate[] = [];
  private currentIntent: IntentCandidate | null = null;

  feed(text: string): IntentCandidate {
    const result = classifyIntent(text, true);

    // Update current intent if confidence is higher
    if (!this.currentIntent || result.confidence > this.currentIntent.confidence) {
      this.currentIntent = result;
    }

    this.history.push(result);
    log.debug(
      { text: text.substring(0, 50), label: result.label, confidence: result.confidence },
      "Intent classified"
    );

    return result;
  }

  feedMultiple(text: string, maxCandidates = 3): IntentCandidate[] {
    if (!text || text.trim().length === 0) {
      return [{ label: "unknown", confidence: 0, entities: [], partial: false }];
    }

    const semanticCandidates = rankSemanticIntents(text, true, maxCandidates);
    if (semanticCandidates[0]?.label !== "unknown" && semanticCandidates[0].confidence >= 0.58) {
      if (!this.currentIntent || semanticCandidates[0]!.confidence > this.currentIntent.confidence) {
        this.currentIntent = semanticCandidates[0]!;
      }
      this.history.push(...semanticCandidates);
      return semanticCandidates;
    }

    const normalizedText = text.toLowerCase().trim();
    const candidates: IntentCandidate[] = [];

    for (const rule of INTENT_RULES) {
      let matchCount = 0;
      for (const keyword of rule.keywords) {
        if (normalizedText.includes(keyword.toLowerCase())) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        const totalKeywords = rule.keywords.length;
        let confidence = matchCount / totalKeywords;
        if (matchCount === totalKeywords) confidence = 1.0;
        else if (matchCount >= 2) confidence = 0.8;
        else confidence = 0.6;

        if (text.length < 3) confidence -= 0.2;

        candidates.push({
          label: rule.label,
          confidence: Math.max(0.1, Math.min(1.0, confidence)),
          entities: extractEntities(text),
          partial: true,
        });
      }
    }

    if (candidates.length === 0) {
      candidates.push({ label: "unknown", confidence: 0.1, entities: extractEntities(text), partial: true });
    }

    // Sort by confidence
    candidates.sort((a, b) => b.confidence - a.confidence);
    const top = candidates.slice(0, maxCandidates);

    if (!this.currentIntent || top[0]!.confidence > this.currentIntent.confidence) {
      this.currentIntent = top[0]!;
    }

    this.history.push(...top);
    return top;
  }

  getCurrentIntent(): IntentCandidate | null {
    return this.currentIntent;
  }

  reset(): void {
    this.history = [];
    this.currentIntent = null;
    log.debug("Intent parser reset");
    this.emit("reset");
  }

  getHistory(): IntentCandidate[] {
    return [...this.history];
  }
}

// Singleton export
export const intentParser: IntentParser = new IntentParserImpl();
