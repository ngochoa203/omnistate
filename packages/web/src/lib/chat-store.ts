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

interface ChatStore {
  messages: ChatMessage[];
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
}

let _id = 0;
const nextId = () => `msg-${++_id}-${Date.now()}`;

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

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  connectionState: "disconnected",
  health: null,
  voiceState: "idle",
  ttsEnabled: false,
  systemInfo: null,
  llmPreflight: null,

  setConnectionState: (connectionState) => set({ connectionState }),

  addUserMessage: (content) => {
    const id = nextId();
    set((s) => ({
      messages: [...s.messages, {
        id, role: "user", content, timestamp: Date.now(),
      }],
    }));
    return id;
  },

  addSystemMessage: (content, taskId) => {
    const id = nextId();
    set((s) => ({
      messages: [...s.messages, {
        id, role: "system", content, timestamp: Date.now(),
        taskId, status: taskId ? "pending" : "complete",
        steps: [],
      }],
    }));
    return id;
  },

  updateMessage: (id, updates) =>
    set((s) => ({
      messages: s.messages.map((m) => m.id === id ? { ...m, ...updates } : m),
    })),

  addStep: (taskId, step) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.taskId === taskId
          ? { ...m, status: "streaming" as const, steps: [...(m.steps ?? []), step] }
          : m
      ),
    })),

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
    })),

  failTask: (taskId, error) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.taskId === taskId
          ? { ...m, status: "failed" as const, content: error }
          : m
      ),
    })),

  setHealth: (health) => set({ health }),
  clearMessages: () => set({ messages: [] }),
  setVoiceState: (voiceState) => set({ voiceState }),
  setTtsEnabled: (ttsEnabled) => set({ ttsEnabled }),
  setSystemInfo: (systemInfo) => set({ systemInfo }),
  setLlmPreflight: (llmPreflight) => set({ llmPreflight }),
}));
