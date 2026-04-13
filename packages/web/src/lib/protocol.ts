/** Messages sent from client to gateway. */
export type ClientMessage =
  | ConnectMessage
  | TaskMessage
  | ClaudeMemQueryMessage
  | ClaudeMemSyncMessage
  | OpenClawTaskMessage
  | HistoryQueryMessage
  | HealthQueryMessage
  | LlmPreflightQueryMessage
  | RuntimeConfigGetMessage
  | RuntimeConfigSetMessage
  | RuntimeConfigUpsertProviderMessage
  | StatusQueryMessage
  | VoiceTranscribeMessage
  | VibeVoiceStartMessage
  | VibeVoiceChunkMessage
  | VibeVoiceEndMessage
  | SystemDashboardMessage;

export interface ConnectMessage {
  type: "connect";
  auth: { token?: string };
  role: "cli" | "ui" | "remote" | "fleet-agent";
}

export interface TaskMessage {
  type: "task";
  goal: string;
  layer?: "deep" | "surface" | "auto";
}

export interface ClaudeMemPayload {
  sharedMemorySummary: string;
  sharedMemoryLog: string[];
  sessionStateByConversation: Record<
    string,
    {
      memorySummary: string;
      memoryLog: string[];
      provider?: string;
      model?: string;
      updatedAt?: number;
    }
  >;
}

export interface ClaudeMemQueryMessage {
  type: "claude.mem.query";
}

export interface ClaudeMemSyncMessage {
  type: "claude.mem.sync";
  payload: ClaudeMemPayload;
}

export interface OpenClawAction {
  type: "move" | "click" | "drag" | "scroll" | "type" | "key" | "wait";
  x?: number;
  y?: number;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  dx?: number;
  dy?: number;
  button?: "left" | "right" | "middle";
  text?: string;
  key?: string;
  modifiers?: { shift?: boolean; control?: boolean; alt?: boolean; meta?: boolean };
  durationMs?: number;
}

export interface OpenClawTask {
  goal?: string;
  actions?: OpenClawAction[];
}

export interface OpenClawTaskMessage {
  type: "openclaw.task";
  id?: string;
  task: OpenClawTask;
}

export interface HistoryQueryMessage {
  type: "history.query";
  limit?: number;
  before?: string;
}

export interface HealthQueryMessage {
  type: "health.query";
}

export interface LlmPreflightQueryMessage {
  type: "llm.preflight.query";
}

export interface RuntimeConfigGetMessage {
  type: "runtime.config.get";
}

export interface RuntimeConfigSetMessage {
  type: "runtime.config.set";
  key:
    | "provider"
    | "model"
    | "baseURL"
    | "apiKey"
    | "voice.lowLatency"
    | "voice.autoExecuteTranscript"
    | "voice.wake.enabled"
    | "voice.wake.phrase"
    | "voice.wake.cooldownMs"
    | "voice.wake.commandWindowSec"
    | "voice.siri.enabled"
    | "voice.siri.mode"
    | "voice.siri.shortcutName"
    | "voice.siri.endpoint"
    | "voice.siri.token";
  value: string | boolean | number;
}

export interface RuntimeConfigUpsertProviderMessage {
  type: "runtime.config.upsertProvider";
  provider: {
    id: string;
    kind: "anthropic" | "openai-compatible";
    baseURL: string;
    apiKey: string;
    model: string;
    enabled?: boolean;
    models?: string[];
  };
  activate?: boolean;
  addToFallback?: boolean;
}

export interface StatusQueryMessage {
  type: "status.query";
}

export interface VoiceTranscribeMessage {
  type: "voice.transcribe";
  id: string;
  audio: string; // base64
  format?: string;
}

export interface VibeVoiceStartMessage {
  type: "vibevoice.start";
  sessionId: string;
  format?: string;
  sampleRate?: number;
}

export interface VibeVoiceChunkMessage {
  type: "vibevoice.chunk";
  sessionId: string;
  audio: string;
}

export interface VibeVoiceEndMessage {
  type: "vibevoice.end";
  sessionId: string;
  autoExecute?: boolean;
  provider?: "whisper-cloud" | "whisper-local" | "native";
}

export interface SystemDashboardMessage {
  type: "system.dashboard";
  id: string;
}

/** Messages sent from gateway to client. */
export type ServerMessage =
  | ConnectedMessage
  | ClaudeMemStateMessage
  | ClaudeMemAckMessage
  | TaskAcceptedMessage
  | OpenClawResultMessage
  | TaskStepMessage
  | TaskVerifyMessage
  | TaskCompleteMessage
  | TaskErrorMessage
  | HistoryResultMessage
  | HealthReportMessage
  | LlmPreflightReportMessage
  | RuntimeConfigReportMessage
  | RuntimeConfigAckMessage
  | StatusReplyMessage
  | GatewayShutdownMessage
  | ErrorMessage
  | VoiceTranscriptMessage
  | VoiceErrorMessage
  | VibeVoicePartialMessage
  | VibeVoiceTranscriptMessage
  | VibeVoiceErrorMessage
  | SystemInfoMessage;

export interface ConnectedMessage { type: "connected"; clientId: string; capabilities: string[] }
export interface ClaudeMemStateMessage { type: "claude.mem.state"; payload: ClaudeMemPayload; updatedAt: string }
export interface ClaudeMemAckMessage { type: "claude.mem.ack"; ok: boolean; message: string; updatedAt: string }
export interface TaskAcceptedMessage { type: "task.accepted"; taskId: string; goal: string }
export interface OpenClawResultMessage { type: "openclaw.result"; id: string; taskId: string; status: "complete" | "failed"; error?: string }
export interface TaskStepMessage { type: "task.step"; taskId: string; step: number; status: "executing" | "completed" | "failed"; layer: "deep" | "surface" | "fleet"; data?: Record<string, unknown> }
export interface TaskVerifyMessage { type: "task.verify"; taskId: string; step: number; result: "pass" | "fail" | "ambiguous"; confidence?: number }
export interface TaskCompleteMessage { type: "task.complete"; taskId: string; result: Record<string, unknown> }
export interface TaskErrorMessage { type: "task.error"; taskId: string; error: string }
export interface HistoryResultMessage { type: "history.result"; entries: HistoryEntry[] }
export interface HealthReportMessage { type: "health.report"; overall: string; timestamp: string; sensors: Record<string, SensorResult>; alerts: Alert[] }
export interface LlmPreflightReportMessage {
  type: "llm.preflight.report";
  ok: boolean;
  status: "ok" | "missing_key" | "auth_error" | "insufficient_credits" | "api_error";
  message: string;
  required: boolean;
  baseURL: string;
  providerId?: string;
  model?: string;
  checkedAt: string;
}
export interface RuntimeConfigReportMessage { type: "runtime.config.report"; config: Record<string, unknown> }
export interface RuntimeConfigAckMessage {
  type: "runtime.config.ack";
  ok: boolean;
  key: RuntimeConfigSetMessage["key"];
  message: string;
  config: Record<string, unknown>;
}
export interface StatusReplyMessage { type: "status.reply"; connectedClients: number; queueDepth: number; uptime: number }
export interface GatewayShutdownMessage { type: "gateway.shutdown"; reason: string }
export interface ErrorMessage { type: "error"; message: string }
export interface VoiceTranscriptMessage { type: "voice.transcript"; id: string; text: string }
export interface VoiceErrorMessage { type: "voice.error"; id: string; error: string }
export interface VibeVoicePartialMessage { type: "vibevoice.partial"; sessionId: string; receivedChunks: number; receivedBytes: number }
export interface VibeVoiceTranscriptMessage { type: "vibevoice.transcript"; sessionId: string; text: string }
export interface VibeVoiceErrorMessage { type: "vibevoice.error"; sessionId: string; error: string }
export interface SystemInfoMessage { type: "system.info"; id: string; data: { battery: any; wifi: any; disk: any; cpu: any; memory: any; hostname: string; error?: string } }

export interface HistoryEntry {
  taskId: string;
  goal: string;
  status: "complete" | "failed";
  output?: string;
  intentType: string;
  timestamp: string;
  durationMs: number;
}

export interface SensorResult {
  status: string;
  value: number;
  unit: string;
  message?: string;
}

export interface Alert {
  sensor: string;
  severity: string;
  message: string;
}
