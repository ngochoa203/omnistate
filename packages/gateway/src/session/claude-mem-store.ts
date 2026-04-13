import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export interface ClaudeMemSessionState {
  memorySummary: string;
  memoryLog: string[];
  provider?: string;
  model?: string;
  updatedAt?: number;
}

export interface ClaudeMemPayload {
  sharedMemorySummary: string;
  sharedMemoryLog: string[];
  sessionStateByConversation: Record<string, ClaudeMemSessionState>;
}

interface ClaudeMemFileShape {
  updatedAt: string;
  payload: ClaudeMemPayload;
}

interface SharedFileShape {
  updatedAt: string;
  sharedMemorySummary: string;
  sharedMemoryLog: string[];
}

interface SessionFileShape {
  conversationId: string;
  updatedAt: string;
  state: ClaudeMemSessionState;
}

const STORE_DIR = resolve(homedir(), ".omnistate/claude-mem");
const SHARED_FILE = "shared.json";
const SESSIONS_DIR = "sessions";
const LEGACY_STORE_PATH = resolve(homedir(), ".omnistate/session-memory.json");

function createDefaultPayload(): ClaudeMemPayload {
  return {
    sharedMemorySummary: "",
    sharedMemoryLog: [],
    sessionStateByConversation: {},
  };
}

function sanitizePayload(payload: ClaudeMemPayload): ClaudeMemPayload {
  const sharedMemorySummary = String(payload.sharedMemorySummary ?? "").slice(0, 8000);
  const sharedMemoryLog = Array.isArray(payload.sharedMemoryLog)
    ? payload.sharedMemoryLog.map((item) => String(item)).slice(-120)
    : [];

  const sessionStateByConversation: Record<string, ClaudeMemSessionState> = {};
  const entries = Object.entries(payload.sessionStateByConversation ?? {}).slice(0, 200);

  for (const [conversationId, state] of entries) {
    const key = String(conversationId || "").trim();
    if (!key) continue;

    const summary = String(state?.memorySummary ?? "").slice(0, 4000);
    const log = Array.isArray(state?.memoryLog)
      ? state.memoryLog.map((item) => String(item)).slice(-80)
      : [];

    sessionStateByConversation[key] = {
      memorySummary: summary,
      memoryLog: log,
      provider: state?.provider ? String(state.provider).slice(0, 120) : undefined,
      model: state?.model ? String(state.model).slice(0, 200) : undefined,
      updatedAt: typeof state?.updatedAt === "number" ? state.updatedAt : Date.now(),
    };
  }

  return {
    sharedMemorySummary,
    sharedMemoryLog,
    sessionStateByConversation,
  };
}

export class ClaudeMemStore {
  private payload: ClaudeMemPayload;
  private updatedAt: string;

  constructor(
    private readonly baseDir: string = STORE_DIR,
    private readonly legacyStorePath: string = LEGACY_STORE_PATH,
  ) {
    this.payload = createDefaultPayload();
    this.updatedAt = new Date().toISOString();
    this.load();
  }

  loadState(): { payload: ClaudeMemPayload; updatedAt: string } {
    return {
      payload: this.payload,
      updatedAt: this.updatedAt,
    };
  }

  saveState(payload: ClaudeMemPayload): { payload: ClaudeMemPayload; updatedAt: string } {
    this.payload = sanitizePayload(payload);
    this.updatedAt = new Date().toISOString();
    this.save();
    return this.loadState();
  }

  private load(): void {
    const sharedPath = join(this.baseDir, SHARED_FILE);
    const sessionsPath = join(this.baseDir, SESSIONS_DIR);

    if (!existsSync(sharedPath) && !existsSync(sessionsPath) && existsSync(this.legacyStorePath)) {
      this.loadLegacyAndMigrate();
      return;
    }

    if (!existsSync(sharedPath) && !existsSync(sessionsPath)) return;

    try {
      let updatedAt = new Date().toISOString();
      let sharedSummary = "";
      let sharedLog: string[] = [];

      if (existsSync(sharedPath)) {
        const sharedRaw = readFileSync(sharedPath, "utf-8");
        const sharedParsed = JSON.parse(sharedRaw) as Partial<SharedFileShape>;
        sharedSummary = String(sharedParsed.sharedMemorySummary ?? "");
        sharedLog = Array.isArray(sharedParsed.sharedMemoryLog)
          ? sharedParsed.sharedMemoryLog.map(String)
          : [];
        if (typeof sharedParsed.updatedAt === "string") {
          updatedAt = sharedParsed.updatedAt;
        }
      }

      const sessionStateByConversation: Record<string, ClaudeMemSessionState> = {};
      if (existsSync(sessionsPath)) {
        const files = readdirSync(sessionsPath).filter((name) => name.endsWith(".json"));
        for (const file of files) {
          const raw = readFileSync(join(sessionsPath, file), "utf-8");
          const parsed = JSON.parse(raw) as Partial<SessionFileShape>;
          const conversationId = String(parsed.conversationId ?? "").trim();
          if (!conversationId) continue;
          const state = parsed.state;
          if (!state) continue;
          sessionStateByConversation[conversationId] = {
            memorySummary: String(state.memorySummary ?? ""),
            memoryLog: Array.isArray(state.memoryLog) ? state.memoryLog.map(String) : [],
            provider: state.provider ? String(state.provider) : undefined,
            model: state.model ? String(state.model) : undefined,
            updatedAt: typeof state.updatedAt === "number" ? state.updatedAt : Date.now(),
          };
        }
      }

      this.payload = sanitizePayload({
        sharedMemorySummary: sharedSummary,
        sharedMemoryLog: sharedLog,
        sessionStateByConversation,
      });
      this.updatedAt = updatedAt;
    } catch {
      this.payload = createDefaultPayload();
      this.updatedAt = new Date().toISOString();
    }
  }

  private save(): void {
    const sessionsPath = join(this.baseDir, SESSIONS_DIR);
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });
    if (!existsSync(sessionsPath)) mkdirSync(sessionsPath, { recursive: true });

    const sharedData: SharedFileShape = {
      updatedAt: this.updatedAt,
      sharedMemorySummary: this.payload.sharedMemorySummary,
      sharedMemoryLog: this.payload.sharedMemoryLog,
    };

    writeFileSync(join(this.baseDir, SHARED_FILE), JSON.stringify(sharedData, null, 2), "utf-8");

    const seen = new Set<string>();
    for (const [conversationId, state] of Object.entries(this.payload.sessionStateByConversation)) {
      const fileName = `${encodeURIComponent(conversationId)}.json`;
      seen.add(fileName);
      const sessionData: SessionFileShape = {
        conversationId,
        updatedAt: this.updatedAt,
        state,
      };
      writeFileSync(join(sessionsPath, fileName), JSON.stringify(sessionData, null, 2), "utf-8");
    }

    // Clean stale per-session files.
    for (const file of readdirSync(sessionsPath).filter((name) => name.endsWith(".json"))) {
      if (!seen.has(file)) {
        rmSync(join(sessionsPath, file), { force: true });
      }
    }

    // Remove legacy monolithic file after successful save.
    if (existsSync(this.legacyStorePath)) {
      rmSync(this.legacyStorePath, { force: true });
    }
  }

  private loadLegacyAndMigrate(): void {
    try {
      const raw = readFileSync(this.legacyStorePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<ClaudeMemFileShape>;
      if (!parsed?.payload) return;
      this.payload = sanitizePayload(parsed.payload);
      this.updatedAt = typeof parsed.updatedAt === "string"
        ? parsed.updatedAt
        : new Date().toISOString();
      this.save();
    } catch {
      this.payload = createDefaultPayload();
      this.updatedAt = new Date().toISOString();
    }
  }
}
