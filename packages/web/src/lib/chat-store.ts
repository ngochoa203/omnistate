import { create } from "zustand";
import { buildMemoryEntry, summarizeMemory } from "./session-memory";
import type { ClaudeMemPayload } from "./protocol";
import { storageGetItem, storageSetItem } from "./native-storage";

export interface ChatMessage {
  id: string;
  role: "user" | "system";
  content: string;
  timestamp: number;
  attachments?: ChatAttachment[];
  taskId?: string;
  steps?: StepInfo[];
  status?: "pending" | "streaming" | "complete" | "failed";
  data?: Record<string, unknown>;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text" | "file";
  previewUrl?: string;
}

export interface StepInfo {
  step: number;
  status: "executing" | "completed" | "failed";
  layer: string;
  data?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ConversationSessionState {
  provider: string;
  model: string;
  memorySummary: string;
  memoryLog: string[];
  updatedAt: number;
}

interface ChatStore {
  appLanguage: "vi" | "en";
  messages: ChatMessage[];
  conversations: Conversation[];
  currentConversationId: string;
  messagesByConversation: Record<string, ChatMessage[]>;
  sessionStateByConversation: Record<string, ConversationSessionState>;
  sharedMemorySummary: string;
  sharedMemoryLog: string[];
  outboundConversationQueue: string[];
  taskConversationMap: Record<string, string>;
  connectionState: "connecting" | "connected" | "disconnected";
  health: null | {
    overall: string;
    timestamp: string;
    sensors: Record<string, { status: string; value: number; unit: string; message?: string }>;
    alerts: Array<{ sensor: string; severity: string; message: string }>;
  };
  voiceState: "idle" | "recording" | "transcribing";
  ttsEnabled: boolean;
  systemInfo: null | {
    battery: any;
    wifi: any;
    disk: any;
    cpu: any;
    memory: any;
    hostname: string;
  };
  llmPreflight: null | {
    ok: boolean;
    status: "ok" | "missing_key" | "auth_error" | "insufficient_credits" | "api_error";
    message: string;
    required: boolean;
    baseURL: string;
    providerId?: string;
    model?: string;
    checkedAt: string;
  };
  runtimeConfig: null | Record<string, unknown>;
  runtimeConfigAck: null | {
    ok: boolean;
    key: string;
    message: string;
    at: number;
  };
  setAppLanguage: (lang: "vi" | "en") => void;
  createConversation: (name?: string) => string;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, name: string) => void;
  setConversationRuntime: (id: string, runtime: { provider?: string; model?: string }) => void;
  setSharedMemoryManual: (summary: string, log: string[]) => void;
  applyClaudeMemState: (payload: ClaudeMemPayload) => void;
  noteOutboundTaskRequest: (conversationId: string) => void;
  setConnectionState: (state: ChatStore["connectionState"]) => void;
  addUserMessage: (content: string, attachments?: ChatAttachment[]) => string;
  addSystemMessage: (content: string, taskId?: string) => string;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  addStep: (taskId: string, step: StepInfo) => void;
  completeTask: (taskId: string, result: Record<string, unknown>) => void;
  failTask: (taskId: string, error: string) => void;
  setHealth: (report: ChatStore["health"]) => void;
  clearMessages: () => void;
  setVoiceState: (state: "idle" | "recording" | "transcribing") => void;
  setTtsEnabled: (enabled: boolean) => void;
  setSystemInfo: (info: ChatStore["systemInfo"]) => void;
  setLlmPreflight: (info: ChatStore["llmPreflight"]) => void;
  setRuntimeConfig: (config: ChatStore["runtimeConfig"]) => void;
  setRuntimeConfigAck: (ack: ChatStore["runtimeConfigAck"]) => void;
}

let _id = 0;
const nextId = () => `msg-${++_id}-${Date.now()}`;
const CHAT_SNAPSHOT_KEY = "omnistate.chatSnapshot.v2";

function getInitialAppLanguage(): "vi" | "en" {
  if (typeof window === "undefined") return "vi";
  const saved = storageGetItem("omnistate.appLanguage");
  return saved === "en" ? "en" : "vi";
}

function getInitialTtsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const saved = storageGetItem("omnistate.ttsEnabled");
  if (saved === "1") return true;
  if (saved === "0") return false;
  return Boolean(window.omnistateNative?.isNative);
}

function newConversation(name?: string): Conversation {
  const now = Date.now();
  const id = `conv-${now}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    name: name?.trim() || `Conversation ${new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
}

interface ChatSnapshot {
  conversations: Conversation[];
  currentConversationId: string;
  messagesByConversation: Record<string, ChatMessage[]>;
  sessionStateByConversation?: Record<string, ConversationSessionState>;
  sharedMemorySummary?: string;
  sharedMemoryLog?: string[];
}

function createDefaultSessionState(now: number = Date.now()): ConversationSessionState {
  return {
    provider: "anthropic",
    model: "",
    memorySummary: "",
    memoryLog: [],
    updatedAt: now,
  };
}

function ensureSessionStates(
  conversations: Conversation[],
  existing?: Record<string, ConversationSessionState>,
): Record<string, ConversationSessionState> {
  const next: Record<string, ConversationSessionState> = {};
  for (const conv of conversations) {
    next[conv.id] = existing?.[conv.id] ?? createDefaultSessionState();
  }
  return next;
}

function loadChatSnapshot(): ChatSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = storageGetItem(CHAT_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatSnapshot;
    if (!parsed?.conversations?.length) return null;

    const normalizedMessagesByConversation: Record<string, ChatMessage[]> = {};
    for (const conv of parsed.conversations) {
      const messages = parsed.messagesByConversation?.[conv.id];
      normalizedMessagesByConversation[conv.id] = Array.isArray(messages) ? messages : [];
    }

    const currentConversationId = parsed.conversations.some((conv) => conv.id === parsed.currentConversationId)
      ? parsed.currentConversationId
      : parsed.conversations[0].id;

    return {
      ...parsed,
      currentConversationId,
      messagesByConversation: normalizedMessagesByConversation,
    };
  } catch {
    return null;
  }
}

function saveChatSnapshot(snapshot: ChatSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    storageSetItem(CHAT_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore storage errors
  }
}

function updateConversationStats(conversations: Conversation[], id: string, count: number): Conversation[] {
  return conversations.map((conv) =>
    conv.id === id
      ? { ...conv, updatedAt: Date.now(), messageCount: count }
      : conv,
  );
}

function extractReadableContent(result: Record<string, unknown>): string {
  if (typeof result.message === "string") return result.message;
  if (typeof result.summary === "string") return result.summary;
  if (typeof result.error === "string") return result.error;

  const nested = result.result;
  if (nested && typeof nested === "object") {
    const r = nested as Record<string, unknown>;
    if (typeof r.output === "string") return r.output;
    if (typeof r.message === "string") return r.message;
    if (typeof r.summary === "string") return r.summary;
  }

  return "";
}

const defaultConversation: Conversation = {
  id: "conv-default",
  name: "Main",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messageCount: 0,
};

const snapshot = loadChatSnapshot();
const initialConversations = snapshot?.conversations?.length
  ? snapshot.conversations
  : [defaultConversation];
const initialCurrentConversationId = snapshot?.currentConversationId ?? initialConversations[0].id;
const initialMessagesByConversation = snapshot?.messagesByConversation ?? { [initialConversations[0].id]: [] };
const initialSessionStates = ensureSessionStates(initialConversations, snapshot?.sessionStateByConversation);

function resolveConversationForTask(state: ChatStore, taskId?: string): string {
  if (!taskId) return state.currentConversationId;
  return state.taskConversationMap[taskId] ?? state.outboundConversationQueue[0] ?? state.currentConversationId;
}

function normalizeLog(log: string[], maxItems: number): string[] {
  return log
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(-maxItems);
}

export function buildClaudeMemPayloadFromState(state: {
  sharedMemorySummary: string;
  sharedMemoryLog: string[];
  sessionStateByConversation: Record<string, ConversationSessionState>;
}): ClaudeMemPayload {
  const sessionStateByConversation = Object.fromEntries(
    Object.entries(state.sessionStateByConversation).map(([conversationId, session]) => [
      conversationId,
      {
        memorySummary: session.memorySummary ?? "",
        memoryLog: normalizeLog(session.memoryLog ?? [], 80),
        provider: session.provider,
        model: session.model,
        updatedAt: session.updatedAt,
      },
    ]),
  );

  return {
    sharedMemorySummary: state.sharedMemorySummary ?? "",
    sharedMemoryLog: normalizeLog(state.sharedMemoryLog ?? [], 120),
    sessionStateByConversation,
  };
}

export const useChatStore = create<ChatStore>((set) => ({
  appLanguage: getInitialAppLanguage(),
  messages: initialMessagesByConversation[initialCurrentConversationId] ?? [],
  conversations: initialConversations,
  currentConversationId: initialCurrentConversationId,
  messagesByConversation: initialMessagesByConversation,
  sessionStateByConversation: initialSessionStates,
  sharedMemorySummary: snapshot?.sharedMemorySummary ?? "",
  sharedMemoryLog: Array.isArray(snapshot?.sharedMemoryLog) ? snapshot.sharedMemoryLog : [],
  outboundConversationQueue: [],
  taskConversationMap: {},
  connectionState: "disconnected",
  health: null,
  voiceState: "idle",
  ttsEnabled: getInitialTtsEnabled(),
  systemInfo: null,
  llmPreflight: null,
  runtimeConfig: null,
  runtimeConfigAck: null,

  setAppLanguage: (appLanguage) => {
    if (typeof window !== "undefined") {
      storageSetItem("omnistate.appLanguage", appLanguage);
    }
    set({ appLanguage });
  },

  createConversation: (name) => {
    const conv = newConversation(name);
    set((s) => ({
      conversations: [conv, ...s.conversations],
      currentConversationId: conv.id,
      messages: [],
      messagesByConversation: { ...s.messagesByConversation, [conv.id]: [] },
      sessionStateByConversation: {
        ...s.sessionStateByConversation,
        [conv.id]: createDefaultSessionState(),
      },
    }));
    return conv.id;
  },

  switchConversation: (id) => {
    set((s) => {
      if (!s.conversations.some((conv) => conv.id === id)) return s;
      return {
        currentConversationId: id,
        messages: s.messagesByConversation[id] ?? [],
      };
    });
  },

  deleteConversation: (id) => {
    set((s) => {
      if (s.conversations.length <= 1 || !s.conversations.some((conv) => conv.id === id)) {
        return s;
      }
      const nextConversations = s.conversations.filter((conv) => conv.id !== id);
      const nextMessagesByConversation = { ...s.messagesByConversation };
      const nextSessionStateByConversation = { ...s.sessionStateByConversation };
      delete nextMessagesByConversation[id];
      delete nextSessionStateByConversation[id];
      const fallbackConversation = nextConversations[0];
      const nextCurrentId = s.currentConversationId === id ? fallbackConversation.id : s.currentConversationId;
      return {
        conversations: nextConversations,
        currentConversationId: nextCurrentId,
        messagesByConversation: nextMessagesByConversation,
        sessionStateByConversation: ensureSessionStates(nextConversations, nextSessionStateByConversation),
        messages: nextMessagesByConversation[nextCurrentId] ?? [],
      };
    });
  },

  renameConversation: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((s) => ({
      conversations: s.conversations.map((conv) =>
        conv.id === id ? { ...conv, name: trimmed, updatedAt: Date.now() } : conv,
      ),
    }));
  },

  setConversationRuntime: (id, runtime) => {
    set((s) => {
      const current = s.sessionStateByConversation[id] ?? createDefaultSessionState();
      return {
        sessionStateByConversation: {
          ...s.sessionStateByConversation,
          [id]: {
            ...current,
            provider: runtime.provider?.trim() ? runtime.provider.trim() : current.provider,
            model: runtime.model?.trim() ? runtime.model.trim() : current.model,
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  setSharedMemoryManual: (summary, log) => {
    set({
      sharedMemorySummary: summary.trim(),
      sharedMemoryLog: normalizeLog(log, 120),
    });
  },

  applyClaudeMemState: (payload) => {
    set((s) => {
      const nextSharedSummary = String(payload.sharedMemorySummary ?? "");
      const nextSharedLog = normalizeLog(
        Array.isArray(payload.sharedMemoryLog) ? payload.sharedMemoryLog.map(String) : [],
        120,
      );

      const mergedSessionState: Record<string, ConversationSessionState> = {
        ...s.sessionStateByConversation,
      };

      for (const [conversationId, incoming] of Object.entries(payload.sessionStateByConversation ?? {})) {
        const existing = mergedSessionState[conversationId] ?? createDefaultSessionState();
        mergedSessionState[conversationId] = {
          ...existing,
          provider: typeof incoming.provider === "string" && incoming.provider.trim()
            ? incoming.provider.trim()
            : existing.provider,
          model: typeof incoming.model === "string" ? incoming.model.trim() : existing.model,
          memorySummary: typeof incoming.memorySummary === "string" ? incoming.memorySummary : existing.memorySummary,
          memoryLog: normalizeLog(
            Array.isArray(incoming.memoryLog) ? incoming.memoryLog.map(String) : existing.memoryLog,
            80,
          ),
          updatedAt: typeof incoming.updatedAt === "number" ? incoming.updatedAt : Date.now(),
        };
      }

      return {
        sharedMemorySummary: nextSharedSummary,
        sharedMemoryLog: nextSharedLog,
        sessionStateByConversation: mergedSessionState,
      };
    });
  },

  noteOutboundTaskRequest: (conversationId) => {
    set((s) => ({
      outboundConversationQueue: [...s.outboundConversationQueue, conversationId],
    }));
  },

  setConnectionState: (connectionState) => set({ connectionState }),

  addUserMessage: (content, attachments) => {
    const id = nextId();
    const message: ChatMessage = {
      id,
      role: "user",
      content,
      timestamp: Date.now(),
      ...(attachments?.length ? { attachments } : {}),
    };
    set((s) => ({
      messages: [...s.messages, message],
      messagesByConversation: {
        ...s.messagesByConversation,
        [s.currentConversationId]: [
          ...(s.messagesByConversation[s.currentConversationId] ?? []),
          message,
        ],
      },
      conversations: updateConversationStats(
        s.conversations,
        s.currentConversationId,
        (s.messagesByConversation[s.currentConversationId] ?? []).length + 1,
      ),
    }));
    return id;
  },

  addSystemMessage: (content, taskId) => {
    const id = nextId();
    set((s) => {
      const targetConversationId = resolveConversationForTask(s, taskId);
      const nextTaskMap = taskId
        ? { ...s.taskConversationMap, [taskId]: targetConversationId }
        : s.taskConversationMap;
      const nextQueue = taskId ? s.outboundConversationQueue.slice(1) : s.outboundConversationQueue;
      const nextMessagesByConversation = {
        ...s.messagesByConversation,
        [targetConversationId]: [
          ...(s.messagesByConversation[targetConversationId] ?? []),
          {
            id,
            role: "system" as const,
            content,
            timestamp: Date.now(),
            taskId,
            status: taskId ? "pending" as const : "complete" as const,
          },
        ],
      };
      return {
        taskConversationMap: nextTaskMap,
        outboundConversationQueue: nextQueue,
        messages: s.currentConversationId === targetConversationId
          ? nextMessagesByConversation[targetConversationId]
          : s.messages,
        messagesByConversation: nextMessagesByConversation,
        conversations: updateConversationStats(
          s.conversations,
          targetConversationId,
          nextMessagesByConversation[targetConversationId].length,
        ),
      };
    });
    return id;
  },

  updateMessage: (id, updates) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
      messagesByConversation: {
        ...s.messagesByConversation,
        [s.currentConversationId]: (s.messagesByConversation[s.currentConversationId] ?? []).map((m) =>
          m.id === id ? { ...m, ...updates } : m,
        ),
      },
    })),

  addStep: (taskId, step) => {
    set((s) => {
      const conversationId = s.taskConversationMap[taskId] ?? s.currentConversationId;
      const nextMessages = (s.messagesByConversation[conversationId] ?? []).map((m) =>
        m.taskId === taskId
          ? {
              ...m,
              status: "streaming" as const,
              steps: [...(m.steps ?? []), step],
            }
          : m,
      );
      return {
        messages: s.currentConversationId === conversationId ? nextMessages : s.messages,
        messagesByConversation: {
          ...s.messagesByConversation,
          [conversationId]: nextMessages,
        },
      };
    });
  },

  completeTask: (taskId, result) => {
    set((s) => {
      const conversationId = s.taskConversationMap[taskId] ?? s.currentConversationId;
      const targetMessages = s.messagesByConversation[conversationId] ?? [];
      const resolvedContent = typeof result.output === "string"
        ? result.output
        : extractReadableContent(result);
      const completedMessages = targetMessages.map((m) =>
        m.taskId === taskId
          ? {
              ...m,
              status: "complete" as const,
              data: result,
              content: resolvedContent || m.content,
            }
          : m,
      );

      const lastUser = [...targetMessages].reverse().find((m) => m.role === "user");
      const memoryEntry = buildMemoryEntry(lastUser?.content, resolvedContent);
      const currentSessionState = s.sessionStateByConversation[conversationId] ?? createDefaultSessionState();
      const nextSessionLog = memoryEntry
        ? [...currentSessionState.memoryLog, memoryEntry].slice(-20)
        : currentSessionState.memoryLog;
      const nextSharedLog = memoryEntry
        ? [...s.sharedMemoryLog, memoryEntry].slice(-40)
        : s.sharedMemoryLog;

      return {
        messages: s.currentConversationId === conversationId ? completedMessages : s.messages,
        messagesByConversation: {
          ...s.messagesByConversation,
          [conversationId]: completedMessages,
        },
        sessionStateByConversation: {
          ...s.sessionStateByConversation,
          [conversationId]: {
            ...currentSessionState,
            memoryLog: nextSessionLog,
            memorySummary: summarizeMemory(currentSessionState.memorySummary, memoryEntry),
            updatedAt: Date.now(),
          },
        },
        sharedMemoryLog: nextSharedLog,
        sharedMemorySummary: summarizeMemory(s.sharedMemorySummary, memoryEntry),
      };
    });
  },

  failTask: (taskId, error) => {
    set((s) => {
      const conversationId = s.taskConversationMap[taskId] ?? s.currentConversationId;
      const targetMessages = s.messagesByConversation[conversationId] ?? [];
      const failedMessages = targetMessages.map((m) =>
        m.taskId === taskId
          ? { ...m, status: "failed" as const, content: error }
          : m,
      );
      return {
        messages: s.currentConversationId === conversationId ? failedMessages : s.messages,
        messagesByConversation: {
          ...s.messagesByConversation,
          [conversationId]: failedMessages,
        },
      };
    });
  },

  setHealth: (health) => set({ health }),
  clearMessages: () =>
    set((s) => ({
      messages: [],
      messagesByConversation: { ...s.messagesByConversation, [s.currentConversationId]: [] },
      conversations: updateConversationStats(s.conversations, s.currentConversationId, 0),
    })),
  setVoiceState: (voiceState) => set({ voiceState }),
  setTtsEnabled: (ttsEnabled) => {
    storageSetItem("omnistate.ttsEnabled", ttsEnabled ? "1" : "0");
    set({ ttsEnabled });
  },
  setSystemInfo: (systemInfo) => set({ systemInfo }),
  setLlmPreflight: (llmPreflight) => set({ llmPreflight }),
  setRuntimeConfig: (runtimeConfig) => set({ runtimeConfig }),
  setRuntimeConfigAck: (runtimeConfigAck) => set({ runtimeConfigAck }),
}));

if (typeof window !== "undefined") {
  useChatStore.subscribe((state) => {
    saveChatSnapshot({
      conversations: state.conversations,
      currentConversationId: state.currentConversationId,
      messagesByConversation: state.messagesByConversation,
      sessionStateByConversation: state.sessionStateByConversation,
      sharedMemorySummary: state.sharedMemorySummary,
      sharedMemoryLog: state.sharedMemoryLog,
    });
  });
}
