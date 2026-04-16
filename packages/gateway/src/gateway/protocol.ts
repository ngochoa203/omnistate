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
  | VoiceTranscribeMessage
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
  | PermissionStopMessage;

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

export interface VoiceTranscribeMessage {
  type: "voice.transcribe";
  id: string;
  /** Base64-encoded audio data. */
  audio: string;
  /** Audio format hint (e.g. "wav", "mp3"). Defaults to "wav". */
  format?: string;
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
  | PermissionStatusMessage;

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
  result: Record<string, unknown>;
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
  id: string;
  text: string;
}

export interface VoiceErrorMessage {
  type: "voice.error";
  id: string;
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
