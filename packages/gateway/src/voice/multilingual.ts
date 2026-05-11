export type Language = "vi" | "en" | "zh" | "ja" | "mixed" | "unknown";

export interface LanguageDetectionResult {
  language: Language;
  confidence: number;
  primary: Language;
  secondary?: Language;
  mixed: boolean;
}

// Character range patterns for language detection
const VIETNAMESE_RANGE = /[À-ỹ]/;
const CHINESE_RANGE = /[一-鿿]/;
const JAPANESE_RANGE = /[぀-ゟ゠-ヿ一-鿿]/;

// Common function words for heuristic detection
const VIETNAMESE_WORDS = new Set([
  "và", "của", "là", "có", "được", "trong", "với", "cho", "để", "tôi",
  "bạn", "mình", "này", "kia", "ở", "lên", "xuống", "vào", "ra", "đi",
  "đến", "từ", "bây", "giờ", "ngày", "tháng", "năm", "sáng", "chiều", "tối"
]);

const ENGLISH_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "to", "of", "in", "for", "on", "with",
  "at", "by", "from", "as", "into", "through", "during", "before", "after"
]);



// Language-specific Whisper models or settings
const LANGUAGE_MODELS: Record<Language, string> = {
  vi: "vi",
  en: "en",
  zh: "zh",
  ja: "ja",
  mixed: "mixed",
  unknown: "en", // fallback
};

// TTS voice mappings per language
const TTS_VOICES: Record<Language, { voice: string; speed?: number }> = {
  vi: { voice: "vi-VN-HoaiMyNeural", speed: 1.0 },
  en: { voice: "en-US-AriaNeural", speed: 1.0 },
  zh: { voice: "zh-CN-XiaoxiaoNeural", speed: 1.0 },
  ja: { voice: "ja-JP-NanamiNeural", speed: 1.0 },
  mixed: { voice: "vi-VN-HoaiMyNeural", speed: 1.05 }, // slightly faster for mixed
  unknown: { voice: "en-US-AriaNeural", speed: 1.0 },
};

/**
 * Detect language from text using character ranges and heuristics.
 */
export function detectLanguage(text: string): LanguageDetectionResult {
  if (!text || text.trim().length === 0) {
    return {
      language: "unknown",
      confidence: 0,
      primary: "unknown",
      mixed: false,
    };
  }

  const normalizedText = text.toLowerCase().trim();

  // Count character ranges
  let vietnameseChars = 0;
  let chineseChars = 0;
  let japaneseChars = 0;
  let totalChars = 0;

  for (const char of text) {
    if (VIETNAMESE_RANGE.test(char)) {
      vietnameseChars++;
    }
    if (CHINESE_RANGE.test(char)) {
      chineseChars++;
    }
    if (JAPANESE_RANGE.test(char)) {
      japaneseChars++;
    }
    totalChars++;
  }

  // Calculate character-based confidence
  const viRatio = vietnameseChars / totalChars;
  const zhRatio = chineseChars / totalChars;
  const jaRatio = japaneseChars / totalChars;

  // Detect by character ranges first
  if (viRatio > 0.3 || vietnameseChars > 5) {
    return {
      language: "vi",
      confidence: Math.min(0.95, viRatio + 0.3),
      primary: "vi",
      mixed: zhRatio > 0.1 || jaRatio > 0.1,
    };
  }

  if (zhRatio > 0.3 || chineseChars > 5) {
    return {
      language: "zh",
      confidence: Math.min(0.95, zhRatio + 0.3),
      primary: "zh",
      mixed: viRatio > 0.1 || jaRatio > 0.1,
    };
  }

  if (jaRatio > 0.3 || japaneseChars > 5) {
    return {
      language: "ja",
      confidence: Math.min(0.95, jaRatio + 0.3),
      primary: "ja",
      mixed: viRatio > 0.1 || zhRatio > 0.1,
    };
  }

  // Fall back to word-based detection for Latin script
  const words = normalizedText.split(/\s+/).filter(w => w.length > 1);

  let viWordCount = 0;
  let enWordCount = 0;
    
  for (const word of words) {
    if (VIETNAMESE_WORDS.has(word)) viWordCount++;
    if (ENGLISH_WORDS.has(word)) enWordCount++;
    // Chinese/Japanese words are single characters usually
    if (word.length <= 3 && !VIETNAMESE_RANGE.test(word)) {
      // Likely English
      enWordCount++;
    }
  }

  const wordTotal = words.length;
  const viWordRatio = viWordCount / wordTotal;
  const enWordRatio = enWordCount / wordTotal;

  // Determine primary language
  let primary: Language = "en";
  let confidence = 0.5;

  if (viWordRatio > enWordRatio && viWordRatio > 0.2) {
    primary = "vi";
    confidence = Math.min(0.9, viWordRatio + 0.2);
  } else if (enWordRatio > 0.3) {
    primary = "en";
    confidence = Math.min(0.9, enWordRatio + 0.2);
  }

  // Check for code-switching patterns
  const mixed = (viWordRatio > 0.1 && enWordRatio > 0.1) ||
                 normalizedText.includes(" Safari ") ||
                 normalizedText.includes(" Google ") ||
                 /\b(mở|open|close|đóng)\s+\w+\s+(app|application)\b/i.test(normalizedText);

  return {
    language: mixed ? "mixed" : primary,
    confidence,
    primary,
    secondary: mixed ? (primary === "vi" ? "en" : "vi") : undefined,
    mixed,
  };
}

/**
 * Get STT language code for Whisper.
 */
export function getSttLanguage(language: Language): string {
  return LANGUAGE_MODELS[language] ?? "en";
}

/**
 * Get TTS voice settings for a language.
 */
export function getTtsVoice(language: Language): { voice: string; speed?: number } {
  return TTS_VOICES[language] ?? { voice: "en-US-AriaNeural", speed: 1.0 };
}

/**
 * Auto-detect and switch language based on input.
 */
export function autoDetectLanguage(text: string): {
  language: Language;
  sttLanguage: string;
  ttsVoice: string;
  ttsSpeed: number;
  mixed: boolean;
} {
  const result = detectLanguage(text);

  return {
    language: result.language,
    sttLanguage: getSttLanguage(result.language),
    ttsVoice: getTtsVoice(result.language).voice,
    ttsSpeed: getTtsVoice(result.language).speed ?? 1.0,
    mixed: result.mixed,
  };
}

/**
 * Normalize text for language-specific processing.
 */
export function normalizeForLanguage(text: string, language: Language): string {
  if (language === "vi") {
    return normalizeVietnamese(text);
  }
  if (language === "zh") {
    return normalizeChinese(text);
  }
  if (language === "ja") {
    return normalizeJapanese(text);
  }
  return text.toLowerCase().trim();
}

// Language-specific normalizations
function normalizeVietnamese(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacritics for matching
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeChinese(text: string): string {
  // Simplified Chinese normalization
  return text
    .replace(/[^一-龥]/g, " ") // keep only Chinese chars
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeJapanese(text: string): string {
  // Japanese normalization
  return text
    .replace(/[^぀-ゟ゠-ヿ一-龥]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Get language-specific greeting.
 */
export function getGreeting(language: Language): string {
  const greetings: Record<Language, string> = {
    vi: "Xin chào",
    en: "Hello",
    zh: "你好",
    ja: "こんにちは",
    mixed: "Xin chào",
    unknown: "Hello",
  };
  return greetings[language] ?? "Hello";
}

/**
 * Get language name in local language.
 */
export function getLanguageName(language: Language): string {
  const names: Record<Language, string> = {
    vi: "Tiếng Việt",
    en: "English",
    zh: "中文",
    ja: "日本語",
    mixed: "Mixed",
    unknown: "Unknown",
  };
  return names[language] ?? "Unknown";
}

/**
 * Check if language supports a specific feature.
 */
export function supportsFeature(language: Language, feature: "emoji" | "tone-marks" | "cjk"): boolean {
  switch (feature) {
    case "emoji":
      return true; // All languages support emoji
    case "tone-marks":
      return language === "vi";
    case "cjk":
      return ["zh", "ja", "mixed"].includes(language);
    default:
      return true;
  }
}
