import { create } from "zustand";

export interface ChatMessage {
  id: string;
  role: "user" | "system";
  content: string;
  timestamp: number;
  taskId?: string;
  steps?: StepInfo[];
  status?: "pending" | "streaming" | "complete" | "failed";
  data?: Record<string, unknown>;
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

interface ChatStore {
  appLanguage: "vi" | "en";
  messages: ChatMessage[];
  conversations: Conversation[];
  currentConversationId: string;
  messagesByConversation: Record<string, ChatMessage[]>;
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
  setConnectionState: (state: ChatStore["connectionState"]) => void;
  addUserMessage: (content: string) => string; // returns id
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
const CHAT_SNAPSHOT_KEY = "omnistate.chatSnapshot.v1";

function getInitialAppLanguage(): "vi" | "en" {
  if (typeof window === "undefined") return "vi";
  const saved = window.localStorage.getItem("omnistate.appLanguage");
  return saved === "en" ? "en" : "vi";
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
}

function loadChatSnapshot(): ChatSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CHAT_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatSnapshot;
    if (!parsed?.conversations?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveChatSnapshot(snapshot: ChatSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_SNAPSHOT_KEY, JSON.stringify(snapshot));
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

export const useChatStore = create<ChatStore>((set) => ({
  appLanguage: getInitialAppLanguage(),
  messages: initialMessagesByConversation[initialCurrentConversationId] ?? [],
  conversations: initialConversations,
  currentConversationId: initialCurrentConversationId,
  messagesByConversation: initialMessagesByConversation,
  connectionState: "disconnected",
  health: null,
  voiceState: "idle",
  ttsEnabled: false,
  systemInfo: null,
  llmPreflight: null,
  runtimeConfig: null,
  runtimeConfigAck: null,

  setAppLanguage: (appLanguage) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("omnistate.appLanguage", appLanguage);
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
      delete nextMessagesByConversation[id];
      const fallbackConversation = nextConversations[0];
      const nextCurrentId = s.currentConversationId === id ? fallbackConversation.id : s.currentConversationId;
      return {
        conversations: nextConversations,
        currentConversationId: nextCurrentId,
        messagesByConversation: nextMessagesByConversation,
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

  setConnectionState: (connectionState) => set({ connectionState }),

  addUserMessage: (content) => {
    const id = nextId();
    set((s) => ({
      messages: [...s.messages, {
        id, role: "user", content, timestamp: Date.now(),
      }],
      messagesByConversation: {
        ...s.messagesByConversation,
        [s.currentConversationId]: [
          ...(s.messagesByConversation[s.currentConversationId] ?? []),
          { id, role: "user", content, timestamp: Date.now() },
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
    set((s) => ({
      messages: [...s.messages, {
        id, role: "system", content, timestamp: Date.now(),
        taskId, status: taskId ? "pending" : "complete",
      }],
      messagesByConversation: {
        ...s.messagesByConversation,
        [s.currentConversationId]: [
          ...(s.messagesByConversation[s.currentConversationId] ?? []),
          {
            id, role: "system", content, timestamp: Date.now(),
            taskId, status: taskId ? "pending" : "complete",
          },
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

  updateMessage: (id, updates) =>
    set((s) => ({
      messages: s.messages.map((m) => m.id === id ? { ...m, ...updates } : m),
      messagesByConversation: {
        ...s.messagesByConversation,
        [s.currentConversationId]: (s.messagesByConversation[s.currentConversationId] ?? []).map((m) =>
          m.id === id ? { ...m, ...updates } : m,
        ),
      },
    })),

  addStep: (taskId, _step) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.taskId === taskId
          ? { ...m, status: "streaming" as const }
          : m
      ),
      messagesByConversation: {
        ...s.messagesByConversation,
        [s.currentConversationId]: (s.messagesByConversation[s.currentConversationId] ?? []).map((m) =>
          m.taskId === taskId ? { ...m, status: "streaming" as const } : m,
        ),
      },
    }));
  },

  completeTask: (taskId, result) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.taskId === taskId
          ? {
              ...m,
              status: "complete" as const,
              data: result,
              content: typeof result.output === "string"
                ? result.output
                : extractReadableContent(result) || m.content,
            }
          : m
      ),
      messagesByConversation: {
        ...s.messagesByConversation,
        [s.currentConversationId]: (s.messagesByConversation[s.currentConversationId] ?? []).map((m) =>
          m.taskId === taskId
            ? {
                ...m,
                status: "complete" as const,
                data: result,
                content: typeof result.output === "string"
                  ? result.output
                  : extractReadableContent(result) || m.content,
              }
            : m,
        ),
      },
    })),

  failTask: (taskId, error) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.taskId === taskId
          ? { ...m, status: "failed" as const, content: error }
          : m
      ),
      messagesByConversation: {
        ...s.messagesByConversation,
        [s.currentConversationId]: (s.messagesByConversation[s.currentConversationId] ?? []).map((m) =>
          m.taskId === taskId ? { ...m, status: "failed" as const, content: error } : m,
        ),
      },
    })),

  setHealth: (health) => set({ health }),
  clearMessages: () => set((s) => ({
    messages: [],
    messagesByConversation: { ...s.messagesByConversation, [s.currentConversationId]: [] },
    conversations: updateConversationStats(s.conversations, s.currentConversationId, 0),
  })),
  setVoiceState: (voiceState) => set({ voiceState }),
  setTtsEnabled: (ttsEnabled) => set({ ttsEnabled }),
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
    });
  });
}
