import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const log = childLogger("voice-session-persistence");

export interface SessionState {
  sessionId: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  language: string;
  context: SavedTurn[];
  entities: Record<string, string[]>;
  metadata: Record<string, unknown>;
  expiresAt: number;
}

export interface SavedTurn {
  role: "user" | "assistant";
  transcript: string;
  intent?: string;
  entities?: Record<string, string[]>;
  timestamp: number;
  tts?: string;
}

export interface VoiceSessionPersistence {
  save(state: SessionState): Promise<void>;
  load(sessionId: string): SessionState | null;
  loadByUser(userId: string): SessionState[];
  delete(sessionId: string): void;
  deleteExpired(): number;
  prune(userId: string, keepLast?: number): number;
  clear(): void;
  getAll(): SessionState[];
}

interface PersistenceData {
  sessions: Record<string, SessionState>;
  index: Record<string, string[]>; // userId → sessionIds
}

const SESSIONS_DIR = join(homedir(), ".omnistate", "sessions");
const SESSIONS_FILE = join(SESSIONS_DIR, "sessions.json");
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

class VoiceSessionPersistenceImpl extends EventEmitter implements VoiceSessionPersistence {
  private sessions = new Map<string, SessionState>();
  private userIndex = new Map<string, string[]>();
  private saveDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.loadFromFile();
  }

  private loadFromFile(): void {
    try {
      if (!existsSync(SESSIONS_FILE)) {
        log.debug("No sessions file found");
        return;
      }

      const raw = readFileSync(SESSIONS_FILE, "utf-8");
      const data = JSON.parse(raw) as PersistenceData;

      if (data.sessions) {
        for (const [id, session] of Object.entries(data.sessions)) {
          // Only load non-expired sessions
          if (session.expiresAt > Date.now()) {
            this.sessions.set(id, session as SessionState);
          }
        }
      }

      if (data.index) {
        for (const [userId, sessionIds] of Object.entries(data.index)) {
          this.userIndex.set(userId, sessionIds.filter(id => this.sessions.has(id)));
        }
      }

      log.info(
        { sessionCount: this.sessions.size, userCount: this.userIndex.size },
        "Sessions loaded from file"
      );
    } catch (err) {
      log.warn({ err }, "Failed to load sessions");
    }
  }

  private saveToFile(): void {
    try {
      if (!existsSync(SESSIONS_DIR)) {
        mkdirSync(SESSIONS_DIR, { recursive: true });
      }

      const data: PersistenceData = {
        sessions: Object.fromEntries(this.sessions),
        index: Object.fromEntries(this.userIndex),
      };

      writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), "utf-8");
      log.debug({ sessionCount: this.sessions.size }, "Sessions saved to file");
    } catch (err) {
      log.error({ err }, "Failed to save sessions");
    }
  }

  private scheduleSave(): void {
    if (this.saveDebounce) {
      clearTimeout(this.saveDebounce);
    }
    this.saveDebounce = setTimeout(() => {
      this.saveToFile();
    }, 500);
  }

  async save(state: SessionState): Promise<void> {
    const now = Date.now();
    const session: SessionState = {
      ...state,
      updatedAt: now,
      expiresAt: state.expiresAt || now + SESSION_TTL_MS,
    };

    this.sessions.set(session.sessionId, session);

    // Update user index
    const userSessions = this.userIndex.get(session.userId) ?? [];
    if (!userSessions.includes(session.sessionId)) {
      userSessions.push(session.sessionId);
    }
    this.userIndex.set(session.userId, userSessions);

    this.scheduleSave();

    log.debug(
      { sessionId: session.sessionId, userId: session.userId, turnCount: session.context.length },
      "Session saved"
    );

    this.emit("sessionSaved", { sessionId: session.sessionId });
  }

  load(sessionId: string): SessionState | null {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check expiration
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      this.removeFromIndex(session.userId, sessionId);
      log.debug({ sessionId }, "Session expired");
      return null;
    }

    log.debug({ sessionId }, "Session loaded");
    return session;
  }

  loadByUser(userId: string): SessionState[] {
    const sessionIds = this.userIndex.get(userId) ?? [];
    const results: SessionState[] = [];

    for (const id of sessionIds) {
      const session = this.sessions.get(id);
      if (session && session.expiresAt > Date.now()) {
        results.push(session);
      }
    }

    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  delete(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      this.removeFromIndex(session.userId, sessionId);
      this.scheduleSave();
      log.info({ sessionId }, "Session deleted");
      this.emit("sessionDeleted", { sessionId });
    }
  }

  deleteExpired(): number {
    const now = Date.now();
    let deleted = 0;

    for (const [id, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(id);
        this.removeFromIndex(session.userId, id);
        deleted++;
      }
    }

    if (deleted > 0) {
      this.scheduleSave();
      log.info({ deleted }, "Expired sessions deleted");
    }

    return deleted;
  }

  prune(userId: string, keepLast = 5): number {
    const sessions = this.loadByUser(userId);

    if (sessions.length <= keepLast) {
      return 0;
    }

    const toDelete = sessions.slice(keepLast);
    let deleted = 0;

    for (const session of toDelete) {
      this.sessions.delete(session.sessionId);
      this.removeFromIndex(userId, session.sessionId);
      deleted++;
    }

    if (deleted > 0) {
      this.scheduleSave();
      log.info({ userId, deleted }, "User sessions pruned");
    }

    return deleted;
  }

  clear(): void {
    const count = this.sessions.size;
    this.sessions.clear();
    this.userIndex.clear();
    this.scheduleSave();
    log.info({ count }, "All sessions cleared");
    this.emit("sessionsCleared");
  }

  getAll(): SessionState[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private removeFromIndex(userId: string, sessionId: string): void {
    const userSessions = this.userIndex.get(userId);
    if (userSessions) {
      const filtered = userSessions.filter(id => id !== sessionId);
      if (filtered.length === 0) {
        this.userIndex.delete(userId);
      } else {
        this.userIndex.set(userId, filtered);
      }
    }
  }
}

export interface VoiceSessionPersistence extends EventEmitter {
  on(event: "sessionSaved", listener: (info: { sessionId: string }) => void): this;
  on(event: "sessionDeleted", listener: (info: { sessionId: string }) => void): this;
  on(event: "sessionsCleared", listener: () => void): this;
  emit(event: "sessionSaved", info: { sessionId: string }): boolean;
  emit(event: "sessionDeleted", info: { sessionId: string }): boolean;
  emit(event: "sessionsCleared"): boolean;
}

// ─── Session Resume Helper ─────────────────────────────────────────────────────

/**
 * Load the most recent session for a user and resume context.
 */
export function resumeSession(userId: string): SessionState | null {
  const sessions = voiceSessionPersistence.loadByUser(userId);
  return sessions[0] ?? null;
}

/**
 * Serialize turn for storage.
 */
export function serializeTurn(turn: SavedTurn): SavedTurn {
  return { ...turn };
}

/**
 * Create a new session state.
 */
export function createSessionState(
  sessionId: string,
  userId: string,
  language = "vi"
): SessionState {
  const now = Date.now();
  return {
    sessionId,
    userId,
    createdAt: now,
    updatedAt: now,
    language,
    context: [],
    entities: {},
    metadata: {},
    expiresAt: now + SESSION_TTL_MS,
  };
}

// ─── Singleton Export ──────────────────────────────────────────────────────────

export const voiceSessionPersistence: VoiceSessionPersistence = new VoiceSessionPersistenceImpl();

// Auto-prune expired sessions periodically (every hour)
setInterval(() => {
  voiceSessionPersistence.deleteExpired();
}, 60 * 60 * 1000);