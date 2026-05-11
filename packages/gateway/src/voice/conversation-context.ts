import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";

const log = childLogger("conversation-context");

export enum ConversationState {
  INITIAL = "INITIAL",
  AWAITING_CONFIRMATION = "AWAITING_CONFIRMATION",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
}

export interface TrackedEntity {
  type: string;
  value: string;
  firstMentioned: number;
}

export interface ConversationTurn {
  id: string;
  text: string;
  intent?: string;
  entities: TrackedEntity[];
  timestamp: number;
  ttsResponse?: string;
}

export interface ConversationContext {
  pushTranscript(text: string, intent?: string): ConversationTurn;
  getContextWindow(limit?: number): ConversationTurn[];
  trackEntity(type: string, value: string): void;
  getEntities(type?: string): TrackedEntity[];
  getConversationState(): ConversationState;
  confirmAction(expected: string, userResponse: string): boolean;
  setState(state: ConversationState): void;
  reset(): void;
}

// Vietnamese confirmation patterns
const VIETNAMESE_AFFIRMATIVE = new Set([
  "có", "được", "vâng", "ừ", "uh huh", "yeah", "yes", "đồng ý", "chắc chắn",
  "ok", "okay", "đúng rồi", "đúng", "thực hiện đi", "phải", "đồng ý", "vâng",
  "ừm", "ừ", "được rồi", "có rồi", "okê", "oke", "chấp nhận"
]);

const VIETNAMESE_NEGATIVE = new Set([
  "không", "không được", "thôi", "dừng", "hủy", "cancel", "no", "nope",
  "không cần", "bỏ", "bỏ qua", "không làm", "thôi không", "dừng lại",
  "hủy bỏ", "từ chối", "không đồng ý"
]);

class ConversationContextImpl extends EventEmitter implements ConversationContext {
  private turns: ConversationTurn[] = [];
  private entities: TrackedEntity[] = [];
  private state: ConversationState = ConversationState.INITIAL;
  private maxTurns: number;
  public pendingConfirmation: string | null = null;

  constructor() {
    super();
    this.maxTurns = parseInt(process.env.MAX_CONTEXT_TURNS ?? "20", 10);
    if (isNaN(this.maxTurns) || this.maxTurns < 1) this.maxTurns = 20;
  }

  private static normalizeText(text: string): string {
    return text.toLowerCase().trim();
  }

  private extractEntitiesFromText(text: string): TrackedEntity[] {
    const entities: TrackedEntity[] = [];
    const now = Date.now();

    // Extract time mentions
    const timePatterns = [
      /\b(bây giờ|giờ|sáng|chiều|tối|ngày mai|hôm qua|tuần này|tháng này)\b/gi,
      /\b(thứ\s*\d+|thứ\s*hai|thứ\s*ba|thứ\s*tư|thứ\s*năm|thứ\s*sáu|thứ\s*bảy|chủ nhật)\b/gi,
      /\d{1,2}h\d{0,2}/g,
      /\d{1,2}:\d{2}/g,
    ];
    for (const pattern of timePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          entities.push({ type: "time", value: match, firstMentioned: now });
        }
      }
    }

    // Extract app names (common Vietnamese)
    const appPatterns = /\b(Safari|Chrome|Finder|Notes|Reminders|Messages|Mail|Calendar|Photos|Camera|Settings|System|FaceTime|Phone|Music|Clock|Timer)\b/gi;
    const appMatches = text.match(appPatterns);
    if (appMatches) {
      for (const match of appMatches) {
        entities.push({ type: "app", value: match, firstMentioned: now });
      }
    }

    // Extract file extensions
    const filePatterns = /\b\w+\.(txt|pdf|doc|docx|ppt|pptx|xls|xlsx|jpg|jpeg|png|gif|mp3|mp4|zip|rar)\b/gi;
    const fileMatches = text.match(filePatterns);
    if (fileMatches) {
      for (const match of fileMatches) {
        entities.push({ type: "file", value: match, firstMentioned: now });
      }
    }

    // Extract quoted strings
    const quotedPattern = /["'"]([^"']+)["']/g;
    const quotedMatches = text.match(quotedPattern);
    if (quotedMatches) {
      for (const match of quotedMatches) {
        const inner = match.slice(1, -1);
        if (inner.length > 0) {
          entities.push({ type: "quoted", value: inner, firstMentioned: now });
        }
      }
    }

    return entities;
  }

  pushTranscript(text: string, intent?: string): ConversationTurn {
    const turn: ConversationTurn = {
      id: `turn-${Date.now()}-${this.turns.length}`,
      text,
      intent,
      entities: this.extractEntitiesFromText(text),
      timestamp: Date.now(),
    };

    this.turns.push(turn);

    // Maintain rolling window
    if (this.turns.length > this.maxTurns) {
      this.turns = this.turns.slice(-this.maxTurns);
    }

    // Auto-track extracted entities
    for (const entity of turn.entities) {
      const existing = this.entities.find(
        (e) => e.type === entity.type && e.value === entity.value
      );
      if (!existing) {
        this.entities.push(entity);
      }
    }

    // Auto-detect conversation state transitions
    if (intent === "question" || intent === "command") {
      // Check if asking for confirmation
      if (/\b(có|không|navigate|confirm|đồng ý|thực hiện)\b/i.test(text)) {
        this.state = ConversationState.AWAITING_CONFIRMATION;
      }
    }

    log.debug(
      { turnId: turn.id, intent, entityCount: turn.entities.length, state: this.state },
      "Conversation turn added"
    );

    this.emit("turn", turn);
    this.emit("stateChange", this.state);

    return turn;
  }

  getContextWindow(limit?: number): ConversationTurn[] {
    const effectiveLimit = limit ?? this.maxTurns;
    return this.turns.slice(-effectiveLimit);
  }

  trackEntity(type: string, value: string): void {
    const existing = this.entities.find((e) => e.type === type && e.value === value);
    if (!existing) {
      this.entities.push({ type, value, firstMentioned: Date.now() });
      log.debug({ type, value }, "Entity tracked");
    }
  }

  getEntities(type?: string): TrackedEntity[] {
    if (type) {
      return this.entities.filter((e) => e.type === type);
    }
    return [...this.entities];
  }

  getConversationState(): ConversationState {
    return this.state;
  }

  confirmAction(expected: string, userResponse: string): boolean {
    this.pendingConfirmation = expected;
    const normalized = ConversationContextImpl.normalizeText(userResponse);

    // Check direct matches first
    if (VIETNAMESE_AFFIRMATIVE.has(normalized)) {
      log.info({ expected, response: userResponse, confirmed: true }, "User confirmed action");
      this.state = ConversationState.COMPLETED;
      return true;
    }

    if (VIETNAMESE_NEGATIVE.has(normalized)) {
      log.info({ expected, response: userResponse, confirmed: false }, "User rejected action");
      this.state = ConversationState.COMPLETED;
      return false;
    }

    // Check partial keyword matches (contains confirm intent)
    const confirmPhrases = ["có", "đồng ý", "thực hiện", "đúng", "vâng", "ok"];
    const rejectPhrases = ["không", "thôi", "dừng", "hủy", "bỏ"];

    const normalizedLower = normalized.toLowerCase();
    const hasConfirm = confirmPhrases.some((p) => normalizedLower.includes(p));
    const hasReject = rejectPhrases.some((p) => normalizedLower.includes(p));

    if (hasConfirm && !hasReject) {
      log.info({ expected, response: userResponse, confirmed: true }, "User confirmed (partial match)");
      this.state = ConversationState.COMPLETED;
      return true;
    }

    if (hasReject) {
      log.info({ expected, response: userResponse, confirmed: false }, "User rejected (partial match)");
      this.state = ConversationState.COMPLETED;
      return false;
    }

    // Unknown response - ask for clarification by staying in AWAITING_CONFIRMATION
    this.state = ConversationState.AWAITING_CONFIRMATION;
    log.warn({ expected, response: userResponse }, "Unclear user response");
    return false;
  }

  setState(state: ConversationState): void {
    const prev = this.state;
    this.state = state;
    log.info({ from: prev, to: state }, "Conversation state changed");
    this.emit("stateChange", state);
  }

  reset(): void {
    this.turns = [];
    this.entities = [];
    this.state = ConversationState.INITIAL;
    this.pendingConfirmation = null;
    log.info("Conversation context reset");
    this.emit("reset");
  }
}

// Singleton export
export const conversationContext: ConversationContext = new ConversationContextImpl();
