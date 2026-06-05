import type { IntentCandidate, IntentLabel } from "./intent-parser.js";

type Language = "vi" | "en" | "mixed";

interface SemanticFrame {
  label: IntentLabel;
  actions: string[];
  objects: string[];
  contexts?: string[];
  blockers?: string[];
  priority: number;
}

interface ScoredIntent {
  candidate: IntentCandidate;
  score: number;
}

const FRAMES: SemanticFrame[] = [
  {
    label: "alarm_set",
    actions: ["dat", "set", "hen", "wake"],
    objects: ["bao thuc", "alarm", "timer", "dong ho"],
    contexts: ["luc", "vao", "sau", "in", "at"],
    priority: 10,
  },
  {
    label: "reminder_set",
    actions: ["nhac", "remind", "tao", "dat"],
    objects: ["nhac nho", "reminder", "loi nhac", "cuoc hop", "viec"],
    priority: 9,
  },
  {
    label: "file_read",
    actions: ["doc", "mo", "xem", "show", "read", "open"],
    objects: ["file", "tep", "tap tin", "tai lieu", "log", "pdf", "txt", "md", "docx"],
    blockers: ["safari", "chrome", "spotify", "zalo", "app", "ung dung"],
    priority: 7,
  },
  {
    label: "file_write",
    actions: ["luu", "ghi", "tao", "save", "write", "create"],
    objects: ["file", "tep", "tap tin", "tai lieu", "note", "ghi chu"],
    priority: 7,
  },
  {
    label: "message_send",
    actions: ["gui", "nhan", "send", "text", "message"],
    objects: ["tin nhan", "message", "sms", "zalo", "telegram", "slack", "whatsapp"],
    priority: 8,
  },
  {
    label: "call",
    actions: ["goi", "call", "ring"],
    objects: ["dien thoai", "phone", "facetime", "video call", "cuoc goi"],
    priority: 7,
  },
  {
    label: "music_control",
    actions: ["bat", "phat", "choi", "dung", "pause", "play", "skip", "tang", "giam"],
    objects: ["nhac", "music", "bai hat", "song", "volume", "am luong", "loa", "spotify"],
    priority: 7,
  },
  {
    label: "navigation",
    actions: ["chi", "tim", "dan", "navigate", "directions"],
    objects: ["duong", "ban do", "maps", "dia diem", "vi tri"],
    priority: 6,
  },
  {
    label: "search",
    actions: ["tim", "kiem", "search", "google", "tra cuu", "find"],
    objects: ["thong tin", "web", "google", "youtube", "ket qua"],
    blockers: ["file", "folder", "thu muc"],
    priority: 5,
  },
  {
    label: "app_close",
    actions: ["dong", "tat", "quit", "close", "stop", "thoat"],
    objects: ["app", "ung dung", "safari", "chrome", "zalo", "spotify", "slack", "discord"],
    blockers: ["nhac", "music", "volume", "wifi", "bluetooth"],
    priority: 6,
  },
  {
    label: "app_open",
    actions: ["mo", "bat", "khoi dong", "open", "launch", "start", "chay"],
    objects: ["app", "ung dung", "safari", "chrome", "finder", "zalo", "telegram", "spotify", "slack", "discord", "youtube"],
    blockers: ["file", "folder", "thu muc", "nhac", "wifi", "bluetooth"],
    priority: 6,
  },
  {
    label: "question",
    actions: ["la", "hoi", "what", "who", "where", "how", "why", "when"],
    objects: ["gi", "ai", "o dau", "bao nhieu", "tai sao", "vi sao", "the nao"],
    priority: 3,
  },
  {
    label: "command",
    actions: ["chay", "run", "execute", "exec"],
    objects: ["lenh", "command", "terminal", "shell", "bash", "script", "sudo"],
    priority: 4,
  },
];

const APP_NAMES = [
  "safari", "chrome", "finder", "notes", "reminders", "messages", "mail",
  "calendar", "photos", "camera", "settings", "facetime", "music", "clock",
  "discord", "slack", "whatsapp", "telegram", "spotify", "youtube", "zalo",
];

const CONNECTORS = /\b(va|roi|sau do|then|after|xong)\b/i;

export function detectLanguage(text: string): Language {
  const hasVi = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(text);
  const hasAsciiWord = /\b[a-z]{3,}\b/i.test(text);
  if (hasVi && hasAsciiWord) return "mixed";
  return hasVi ? "vi" : "en";
}

export function normalizeSemanticText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9:%./_\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = normalizeSemanticText(phrase);
  return new RegExp(`(?:^|\\s)${escapeRegExp(normalizedPhrase)}(?:\\s|$)`, "i").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreFrame(text: string, frame: SemanticFrame): number {
  let score = 0;
  const actionHits = frame.actions.filter((phrase) => containsPhrase(text, phrase)).length;
  const objectHits = frame.objects.filter((phrase) => containsPhrase(text, phrase)).length;
  const contextHits = frame.contexts?.filter((phrase) => containsPhrase(text, phrase)).length ?? 0;
  const blockerHits = frame.blockers?.filter((phrase) => containsPhrase(text, phrase)).length ?? 0;

  score += actionHits * 2.2;
  score += objectHits * 2.6;
  score += contextHits * 0.8;
  score += frame.priority * 0.08;
  score -= blockerHits * 2.4;

  if (actionHits > 0 && objectHits > 0) score += 1.4;
  const firstActionIndex = frame.actions
    .map((phrase) => text.search(new RegExp(`(?:^|\\s)${escapeRegExp(normalizeSemanticText(phrase))}(?:\\s|$)`, "i")))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b)[0];
  if (firstActionIndex === 0) score += 1.2;
  else if (typeof firstActionIndex === "number" && firstActionIndex > 0) score += Math.max(0, 0.7 - firstActionIndex / 80);
  if (frame.label === "app_open" && APP_NAMES.some((app) => containsPhrase(text, app))) score += 1.3;
  if (frame.label === "app_open" && /^(?:mo|open|launch|start|khoi dong)\s+\S+/.test(text)) score += 3.5;
  if (frame.label === "app_close" && APP_NAMES.some((app) => containsPhrase(text, app))) score += 1.1;
  if (frame.label === "question" && /[?？]$/.test(text)) score += 2;
  if (CONNECTORS.test(text) && frame.label !== "command") score -= 0.2;

  return score;
}

function extractEntities(text: string, normalized: string): string[] {
  const entities = new Set<string>();
  const quoted = text.match(/["']([^"']+)["']/g);
  quoted?.forEach((entry) => entities.add(entry.slice(1, -1)));

  text.match(/\b\d{1,2}:\d{2}\b/g)?.forEach((entry) => entities.add(entry));
  text.match(/\b\d{1,2}h\d{0,2}\b/gi)?.forEach((entry) => entities.add(entry));
  text.match(/\b\d+\b/g)?.forEach((entry) => entities.add(entry));
  text.match(/\.\w{2,5}\b/g)?.forEach((entry) => entities.add(entry));

  for (const app of APP_NAMES) {
    if (containsPhrase(normalized, app)) entities.add(app);
  }

  return Array.from(entities);
}

function confidenceFromScore(score: number, secondScore: number, partial: boolean): number {
  const margin = Math.max(0, score - secondScore);
  let confidence = 0.18 + Math.min(0.68, score / 10) + Math.min(0.14, margin / 10);
  if (score < 2.8) confidence = 0.1;
  if (partial) confidence *= 0.78;
  return Math.max(0.1, Math.min(0.98, confidence));
}

export function rankSemanticIntents(text: string, partial: boolean, maxCandidates = 3): IntentCandidate[] {
  if (!text.trim()) return [{ label: "unknown", confidence: 0, entities: [], partial }];

  const normalized = normalizeSemanticText(text);
  const scored = FRAMES
    .map((frame): ScoredIntent => ({
      score: scoreFrame(normalized, frame),
      candidate: {
        label: frame.label,
        confidence: 0,
        entities: extractEntities(text, normalized),
        partial,
      },
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0 || scored[0]!.score < 2.4) {
    return [{ label: "unknown", confidence: 0.1, entities: extractEntities(text, normalized), partial }];
  }

  return scored.slice(0, maxCandidates).map((entry, index) => ({
    ...entry.candidate,
    confidence: confidenceFromScore(entry.score, scored[index + 1]?.score ?? 0, partial),
  }));
}

export function classifySemanticIntent(text: string, partial: boolean): IntentCandidate {
  return rankSemanticIntents(text, partial, 1)[0]!;
}
