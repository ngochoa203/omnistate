// Vietnamese NLP utilities for voice command processing

// Number word mappings
const VIETNAMESE_NUMBERS: Record<string, number> = {
  "một": 1, "mốt": 1,
  "hai": 2,
  "ba": 3,
  "bốn": 4, "tư": 4,
  "năm": 5, "lăm": 5,
  "sáu": 6,
  "bảy": 7,
  "tám": 8,
  "chín": 9,
  "mười": 10, "mươi": 10,
  "trăm": 100,
  "nghìn": 1000, "ngàn": 1000,
  "không": 0, "ko": 0,
};

// Question words in Vietnamese
const QUESTION_WORDS = ["không", "nào", "gì", "sao", "mấy", "thế nào", "ở đâu", "ai", "cách", "bao nhiêu", "vì sao", "tại sao", "lúc nào", "khi nào"];

// Action verbs in Vietnamese
const ACTION_VERBS = ["mở", "đóng", "tắt", "bật", "gửi", "gọi", "tìm", "đọc", "lưu", "tạo", "xóa", "chạy", "dừng", "tạm dừng", "tiếp tục", "chỉ", "đợi", "tìm kiếm", "xem", "kiểm tra", "kích hoạt"];

// Intent patterns
const INTENT_PATTERNS: Array<{ intent: string; pattern: RegExp }> = [
  { intent: "search", pattern: /\b(tìm|kiếm|search|google)\b/i },
  { intent: "open_app", pattern: /\b(mở|khởi động|chạy|open|launch|start)\b/i },
  { intent: "close_app", pattern: /\b(đóng|tắt|close|quit)\b/i },
  { intent: "set_reminder", pattern: /\b(nhắc nhở|remind|tạo nhắc)\b/i },
  { intent: "set_alarm", pattern: /\b(báo thức|đặt báo|alarm|wake)\b/i },
  { intent: "send_message", pattern: /\b(gửi tin|message|text|SMS)\b/i },
  { intent: "make_call", pattern: /\b(gọi|call|điện thoại)\b/i },
  { intent: "play_music", pattern: /\b(bật nhạc|chơi nhạc|play music|pause|dừng)\b/i },
  { intent: "read_file", pattern: /\b(đọc|mở file|read|open file)\b/i },
  { intent: "write_file", pattern: /\b(lưu|tạo file|save|create)\b/i },
  { intent: "system_control", pattern: /\b(mở Safari|killswitch|system)\b/i },
];

// Abbreviation expansions
const ABBREVIATIONS: Record<string, string> = {
  "mk": "mình",
  "vs": "với",
  "bt": "bình thường",
  "tc": "thông thường",
  "ntn": "như thế nào",
  "kt": "kiểm tra",
  "ko": "không",
  "k": "không",
  "dc": "được",
  "đc": "được",
  "tk": "tài khoản",
  "tt": "tin tức",
  "mn": "mọi người",
  "ms": "máy",
  "sp": "sản phẩm",
};

// Relative time mappings
const RELATIVE_TIME: Record<string, string> = {
  "bây giờ": "now",
  "giờ": "now",
  "bây": "now",
  "ngay": "now",
  "5 phút nữa": "in_5_minutes",
  "5 phút": "in_5_minutes",
  "mười phút nữa": "in_10_minutes",
  "mười phút": "in_10_minutes",
  "nửa tiếng": "in_30_minutes",
  "30 phút": "in_30_minutes",
  "1 tiếng": "in_1_hour",
  "một tiếng": "in_1_hour",
  "ngày mai": "tomorrow",
  "sáng mai": "tomorrow_morning",
  "chiều mai": "tomorrow_afternoon",
  "tối mai": "tomorrow_evening",
  "hôm qua": "yesterday",
  "sáng qua": "yesterday_morning",
  "tuần này": "this_week",
  "tuần sau": "next_week",
  "tháng này": "this_month",
  "tháng sau": "next_month",
  "năm nay": "this_year",
  "năm sau": "next_year",
  "thứ 2": "next_monday",
  "thứ hai": "next_monday",
  "thứ 3": "next_tuesday",
  "thứ tư": "next_wednesday",
  "thứ 5": "next_thursday",
  "thứ 6": "next_friday",
  "thứ 7": "next_saturday",
  "chủ nhật": "next_sunday",
};

export interface IntentExtractionResult {
  intent: string;
  entities: Record<string, string[]>;
  confidence: number;
}

export interface TimeEntity {
  relative: string;
  absolute?: Date;
}

export interface NumberEntity {
  value: number;
  unit?: string;
  context: string;
}

export interface CodeSwitchSegment {
  lang: "vi" | "en";
  text: string;
}

/**
 * Normalize Vietnamese text for processing
 */
export function normalizeVietnameseText(text: string): string {
  if (!text) return "";

  let result = text.toLowerCase();

  // Expand abbreviations
  for (const [abbr, expansion] of Object.entries(ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${abbr}\\b`, "gi");
    result = result.replace(regex, expansion);
  }

  // Normalize repeated characters (e.g., "hiiii" → "hi")
  result = result.replace(/(.)\1{2,}/g, "$1");

  // Normalize diacritics (đ → d for matching purposes)
  // Note: keeping full diacritics for display, but also provide normalized version
  result = result.replace(/đ/g, "d");
  result = result.replace(/Đ/g, "d");

  // Normalize spacing
  result = result.replace(/\s+/g, " ").trim();

  // Remove common typos
  result = result.replace(/qu/g, "qu"); // normalize qu
  result = result.replace(/qur/gi, "qui"); // common typo

  return result;
}

/**
 * Simple word tokenization for Vietnamese
 */
export function tokenizeVietnamese(text: string): string[] {
  if (!text) return [];

  // Split on whitespace and punctuation
  const tokens = text.split(/[\s\p{P}]+/u).filter((t) => t.length > 0);

  return tokens;
}

/**
 * Extract intent from text using heuristic patterns
 */
export function extractIntentFromText(text: string): IntentExtractionResult {
  if (!text) return { intent: "unknown", entities: {}, confidence: 0 };

  const entities: Record<string, string[]> = {};
  let bestIntent = "unknown";
  let bestConfidence = 0;

  for (const { intent, pattern } of INTENT_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      const confidence = matches.length > 1 ? 0.9 : 0.7;
      if (confidence > bestConfidence) {
        bestIntent = intent;
        bestConfidence = confidence;
      }
    }
  }

  // Extract time entities
  const timeEntities = extractTimeEntities(text);
  if (timeEntities.relative) {
    entities.time = [timeEntities.relative];
  }

  // Extract numbers
  const numberEntities = extractNumberEntities(text);
  if (numberEntities.value) {
    entities.number = [String(numberEntities.value)];
  }

  return { intent: bestIntent, entities, confidence: bestConfidence };
}

/**
 * Extract time entities from Vietnamese text
 */
export function extractTimeEntities(text: string): TimeEntity {
  if (!text) return { relative: "unknown" };

  const normalizedText = text.toLowerCase();

  // Check for exact matches first
  for (const [phrase, relative] of Object.entries(RELATIVE_TIME)) {
    if (normalizedText.includes(phrase)) {
      return { relative };
    }
  }

  // Extract time patterns (e.g., "5h30", "14:00")
  const timePattern = /\b(\d{1,2})[h:](\d{2})\b/;
  const timeMatch = normalizedText.match(timePattern);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1]!, 10);
    const minutes = parseInt(timeMatch[2]!, 10);
    const now = new Date();
    const absolute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
    return { relative: "specific_time", absolute };
  }

  // Extract duration patterns (e.g., "5 phút", "2 tiếng")
  const durationPattern = /\b(\d+)\s*(phút|tiếng|giây|ngày)\b/i;
  const durationMatch = normalizedText.match(durationPattern);
  if (durationMatch) {
    const value = parseInt(durationMatch[1]!, 10);
    const unit = durationMatch[2]!.toLowerCase();
    if (unit === "phút") return { relative: `in_${value}_minutes` };
    if (unit === "tiếng" || unit === "giờ") return { relative: `in_${value * 60}_minutes` };
    if (unit === "giây") return { relative: `in_${value}_seconds` };
    if (unit === "ngày") return { relative: `in_${value}_days` };
  }

  return { relative: "unknown" };
}

/**
 * Extract number entities from Vietnamese text
 */
export function extractNumberEntities(text: string): NumberEntity {
  if (!text) return { value: 0, context: "unknown" };

  const normalizedText = text.toLowerCase();

  // Check for Vietnamese number words
  const numberWordPattern = new RegExp(
    `(${Object.keys(VIETNAMESE_NUMBERS).join("|")})\\s*(cái|lần|người|tiếng|phút|ngày|giờ|không)?`,
    "gi"
  );
  const numberMatch = normalizedText.match(numberWordPattern);
  if (numberMatch) {
    const value = VIETNAMESE_NUMBERS[numberMatch[1]!.toLowerCase()];
    const unit = numberMatch[2];
    return { value, unit, context: unit ? `quantity_${unit}` : "count" };
  }

  // Check for Arabic numerals
  const arabicPattern = /\b(\d+)\s*(cái|lần|người|tiếng|phút|ngày|giờ)?\b/;
  const arabicMatch = normalizedText.match(arabicPattern);
  if (arabicMatch) {
    const value = parseInt(arabicMatch[1]!, 10);
    const unit = arabicMatch[2];
    return { value, unit, context: unit ? `quantity_${unit}` : "count" };
  }

  return { value: 0, context: "unknown" };
}

/**
 * Expand abbreviations in text
 */
export function expandAbbreviations(text: string): string {
  if (!text) return "";

  let result = text.toLowerCase();

  for (const [abbr, expansion] of Object.entries(ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${abbr}\\b`, "gi");
    result = result.replace(regex, expansion);
  }

  return result;
}

/**
 * Classify sentence type
 */
export function classifySentenceType(text: string): "question" | "command" | "statement" | "greeting" {
  if (!text) return "statement";

  const normalizedText = text.toLowerCase();

  // Check for greetings
  if (/\b(xin chào|chào|hi|hey|hello|bonjour|ola|salut)\b/i.test(normalizedText)) {
    return "greeting";
  }

  // Check for question words
  for (const qw of QUESTION_WORDS) {
    if (normalizedText.includes(qw)) {
      return "question";
    }
  }

  // Check for question marks
  if (text.includes("?") || text.includes("？")) {
    return "question";
  }

  // Check for imperative verbs at the start (command patterns)
  const firstWord = normalizedText.split(/\s+/)[0];
  if (firstWord && ACTION_VERBS.includes(firstWord)) {
    return "command";
  }

  // Check for second person pronouns (likely a command)
  if (/\b(bạn|mình|tôi)\b/.test(normalizedText) && normalizedText.includes("hãy")) {
    return "command";
  }

  return "statement";
}

/**
 * Detect Vietnamese-English code switching
 */
export function detectCodeSwitching(text: string): { hasCodeSwitch: boolean; segments: CodeSwitchSegment[] } {
  if (!text) return { hasCodeSwitch: false, segments: [] };

  const segments: CodeSwitchSegment[] = [];
  let currentLang: "vi" | "en" | null = null;
  let currentText = "";

  const words = text.split(/(\s+)/);

  for (const word of words) {
    if (/^[ -~]*$/.test(word)) {
      // ASCII - likely English
      if (currentLang === "en") {
        currentText += word;
      } else {
        if (currentText && currentLang !== null) segments.push({ lang: currentLang, text: currentText.trim() });
        currentLang = "en";
        currentText = word;
      }
    } else {
      // Non-ASCII - likely Vietnamese
      if (currentLang === "vi") {
        currentText += word;
      } else {
        if (currentText && currentLang !== null) segments.push({ lang: currentLang, text: currentText.trim() });
        currentLang = "vi";
        currentText = word;
      }
    }
  }

  if (currentText) {
    if (currentLang !== null) segments.push({ lang: currentLang, text: currentText.trim() });
  }

  const hasCodeSwitch = segments.filter((s) => s.lang === "en" && s.text.trim().length > 2).length > 0 &&
    segments.filter((s) => s.lang === "vi" && s.text.trim().length > 2).length > 0;

  return { hasCodeSwitch, segments };
}

/**
 * Normalize text for fuzzy matching
 */
export function normalizeForMatching(text: string): string {
  if (!text) return "";

  let result = text.toLowerCase();

  // Remove diacritics
  result = result.normalize("NFD").replace(/[̀-ͯ]/g, "");

  // Remove punctuation
  result = result.replace(/[.,\/#!$%\^&\*;:{}=\_`~()]/g, " ");

  // Normalize whitespace
  result = result.replace(/\s+/g, " ").trim();

  return result;
}

/**
 * Check if text contains a question
 */
export function isQuestion(text: string): boolean {
  return classifySentenceType(text) === "question";
}

/**
 * Check if text is a command
 */
export function isCommand(text: string): boolean {
  return classifySentenceType(text) === "command";
}

/**
 * Check if text is a greeting
 */
export function isGreeting(text: string): boolean {
  return classifySentenceType(text) === "greeting";
}
