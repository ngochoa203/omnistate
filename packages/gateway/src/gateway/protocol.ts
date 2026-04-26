/** Roles a client can authenticate as. */
export type ClientRole = "cli" | "ui" | "remote" | "fleet-agent";

/** Messages sent from client to gateway. */
export type ClientMessage =
  | ConnectMessage
  | TaskMessage
  | ClaudeMemQueryMessage
  | ClaudeMemSyncMessage
  | HistoryQueryMessage
  | HealthQueryMessage
  | LlmPreflightQueryMessage
  | RuntimeConfigGetMessage
  | RuntimeConfigSetMessage
  | RuntimeConfigUpsertProviderMessage
  | StatusQueryMessage
  | AdminShutdownMessage
  | VoiceStreamStartMessage
  | VoiceStreamStopMessage
  | TtsCancelMessage
  | VoiceEnrollMessage
  | VoiceVerifyMessage
  | SystemDashboardMessage
  | TriggerCreateMessage
  | TriggerListMessage
  | TriggerUpdateMessage
  | TriggerDeleteMessage
  | TriggerHistoryMessage
  | PermissionPolicyGetMessage
  | PermissionPolicyUpdateMessage
  | PermissionHistoryMessage
  | PermissionStartMessage
  | PermissionStopMessage
  | VoiceWakeEnableMessage
  | ToolsListMessage;

export interface ToolsListMessage {
  type: "tools.list";
}

export interface VoiceWakeEnableMessage {
  type: "voice.wake.enable";
  enabled: boolean;
}

export interface ConnectMessage {
  type: "connect";
  auth: { token?: string };
  role: ClientRole;
}

export interface TaskMessage {
  type: "task";
  goal: string;
  /** Optional: force routing mode. */
  mode?: "auto" | "chat" | "task";
  /** Optional: force a specific execution layer. */
  layer?: "deep" | "surface" | "auto";
  /** Optional attachment payloads from UI clients. */
  attachments?: TaskAttachment[];
}

export interface TaskAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text" | "file";
  textPreview?: string;
  dataBase64?: string;
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

export interface AdminShutdownMessage {
  type: "admin.shutdown";
}

/** Begin a streaming voice session. Binary WS frames carrying PCM16 will be associated with this sessionId. */
export interface VoiceStreamStartMessage {
  type: "voice.stream.start";
  sessionId: string;
  sampleRate: 16000;
  codec: "pcm16";
}

/** End a streaming voice session; triggers final STT processing. */
export interface VoiceStreamStopMessage {
  type: "voice.stream.stop";
  sessionId: string;
}

/** Cancel in-progress TTS playback for a session. */
export interface TtsCancelMessage {
  type: "tts.cancel";
  sessionId: string;
}

export interface VoiceEnrollMessage {
  type: "voice.enroll";
  profileId: string;
  /** Base64-encoded WAV audio. */
  audio: string;
}

export interface VoiceVerifyMessage {
  type: "voice.verify";
  /** Base64-encoded WAV audio. */
  audio: string;
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
  | TaskStepMessage
  | TaskVerifyMessage
  | TaskCompleteMessage
  | TaskErrorMessage
  | HealthAlertMessage
  | GatewayShutdownMessage
  | ErrorMessage
  | HistoryResultMessage
  | HealthReportMessage
  | LlmPreflightReportMessage
  | RuntimeConfigReportMessage
  | RuntimeConfigAckMessage
  | StatusReplyMessage
  | VoiceTranscriptMessage
  | VoiceErrorMessage
  | VoiceEnrollResultMessage
  | VoiceEnrollErrorMessage
  | VoiceVerifyResultMessage
  | VoiceVerifyErrorMessage
  | SystemInfoMessage
  | PermissionPolicyReportMessage
  | PermissionHistoryResultMessage
  | PermissionStatusMessage
  | VoiceTtsChunkMessage
  | ToolsReportMessage;

export interface ConnectedMessage {
  type: "connected";
  clientId: string;
  capabilities: string[];
}

export interface ClaudeMemStateMessage {
  type: "claude.mem.state";
  payload: ClaudeMemPayload;
  updatedAt: string;
}

export interface ClaudeMemAckMessage {
  type: "claude.mem.ack";
  ok: boolean;
  message: string;
  updatedAt: string;
}

export interface TaskAcceptedMessage {
  type: "task.accepted";
  taskId: string;
  goal: string;
}

export interface TaskStepMessage {
  type: "task.step";
  taskId: string;
  step: number;
  status: "executing" | "completed" | "failed";
  layer: "deep" | "surface" | "fleet";
  data?: Record<string, unknown>;
}

export interface TaskVerifyMessage {
  type: "task.verify";
  taskId: string;
  step: number;
  result: "pass" | "fail" | "ambiguous";
  confidence?: number;
}

export interface TaskCompleteMessage {
  type: "task.complete";
  taskId: string;
  result: {
    /** Primary output text (backward-compatible). */
    output?: string;
    /** Spoken response text for voice clients. Mirrors output when set from StructuredResponse. */
    speak?: string;
    /** Structured UI payload for rich clients. */
    ui?: Record<string, unknown>;
    /** Suggested follow-up prompts. */
    followup?: string[];
    /** Arbitrary additional data from the handler. */
    [key: string]: unknown;
  };
}

export interface TaskErrorMessage {
  type: "task.error";
  taskId: string;
  error: string;
}

export interface HealthAlertMessage {
  type: "health.alert";
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface GatewayShutdownMessage {
  type: "gateway.shutdown";
  reason: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface HistoryResultMessage {
  type: "history.result";
  entries: Array<{
    taskId: string;
    goal: string;
    status: "complete" | "failed";
    output?: string;
    intentType: string;
    timestamp: string;
    durationMs: number;
  }>;
}

export interface HealthReportMessage {
  type: "health.report";
  overall: string;
  timestamp: string;
  sensors: Record<string, { status: string; value: number; unit: string; message?: string }>;
  alerts: Array<{ sensor: string; severity: string; message: string }>;
}

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

export interface RuntimeConfigReportMessage {
  type: "runtime.config.report";
  config: unknown;
}

export interface RuntimeConfigAckMessage {
  type: "runtime.config.ack";
  ok: boolean;
  key: RuntimeConfigSetMessage["key"];
  message: string;
  config: unknown;
}

export interface StatusReplyMessage {
  type: "status.reply";
  connectedClients: number;
  queueDepth: number;
  uptime: number;
}

export interface VoiceTranscriptMessage {
  type: "voice.transcript";
  sessionId: string;
  kind: "partial" | "final";
  text: string;
  t0: number;
  t1: number;
}

export interface VoiceErrorMessage {
  type: "voice.error";
  sessionId: string;
  error: string;
}

export interface VoiceEnrollResultMessage {
  type: "voice.enroll.result";
  profileId: string;
  sampleCount: number;
  isComplete: boolean;
  required: number;
}

export interface VoiceEnrollErrorMessage {
  type: "voice.enroll.error";
  error: string;
}

export interface VoiceVerifyResultMessage {
  type: "voice.verify.result";
  matched: boolean;
  profileId: string | null;
  similarity: number;
}

export interface VoiceVerifyErrorMessage {
  type: "voice.verify.error";
  error: string;
}

export interface SystemInfoMessage {
  type: "system.info";
  id: string;
  data: {
    battery: any;
    wifi: any;
    disk: any;
    cpu: any;
    memory: any;
    hostname: string;
    error?: string;
  };
}

// ─── Trigger Messages (client → gateway) ─────────────────────────────────────

export interface TriggerCreateMessage {
  type: "trigger.create";
  name: string;
  description?: string;
  condition: { type: string; config: Record<string, unknown> };
  action: { type: "execute_task"; goal: string; layer?: "deep" | "surface" | "auto" };
  cooldownMs?: number;
}

export interface TriggerListMessage {
  type: "trigger.list";
}

export interface TriggerUpdateMessage {
  type: "trigger.update";
  triggerId: string;
  updates: Record<string, unknown>;
}

export interface TriggerDeleteMessage {
  type: "trigger.delete";
  triggerId: string;
}

export interface TriggerHistoryMessage {
  type: "trigger.history";
  triggerId: string;
  limit?: number;
}

// ─── Permission Responder Messages ────────────────────────────────────────────

// Client → gateway
export interface PermissionPolicyGetMessage {
  type: "permission.policy.get";
}

export interface PermissionPolicyUpdateMessage {
  type: "permission.policy.update";
  /** Partial policy fields to merge into the running config. */
  policy: Record<string, unknown>;
}

export interface PermissionHistoryMessage {
  type: "permission.history";
}

export interface PermissionStartMessage {
  type: "permission.start";
}

export interface PermissionStopMessage {
  type: "permission.stop";
}

// Gateway → client
export interface PermissionPolicyReportMessage {
  type: "permission.policy.report";
  policy: Record<string, unknown> | null;
}

export interface PermissionHistoryResultMessage {
  type: "permission.history.result";
  history: Array<{
    timestamp: string;
    promptLine: string;
    action: "allowed" | "denied" | "deferred" | "error";
    reason: string;
  }>;
}

export interface PermissionStatusMessage {
  type: "permission.status";
  running: boolean;
}

/** Streaming TTS audio chunk from server to client (coordinates with TTS agent). */
export interface VoiceTtsChunkMessage {
  type: "voice.tts.chunk";
  sessionId: string;
  seq: number;
  audio: string;  // base64-encoded audio
  mime: string;
  eos: boolean;
}

export interface ToolsReportMessage {
  type: "tools.report";
  tools: Array<{ name: string; description: string; group: string }>;
  skills: Array<{ name: string; group: string }>;
}
