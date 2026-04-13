/** Roles a client can authenticate as. */
export type ClientRole = "cli" | "ui" | "remote" | "fleet-agent";

// ─── Client → Gateway ────────────────────────────────────────────────────────

/** Messages sent from client to gateway. */
export type ClientMessage =
  | ConnectMessage
  | TaskMessage
  | OpenClawTaskMessage
  | HistoryQueryMessage
  | HealthQueryMessage
  | LlmPreflightQueryMessage
  | RuntimeConfigGetMessage
  | RuntimeConfigSetMessage
  | RuntimeConfigUpsertProviderMessage
  | StatusQueryMessage
  | AdminShutdownMessage
  | VoiceTranscribeMessage
  | VibeVoiceStartMessage
  | VibeVoiceChunkMessage
  | VibeVoiceEndMessage
  | SystemDashboardMessage
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
  /** Optional: force a specific execution layer. */
  layer?: "deep" | "surface" | "auto";
}

// ── OpenClaw ─────────────────────────────────────────────────────────────────

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

// ── History ───────────────────────────────────────────────────────────────────

export interface HistoryQueryMessage {
  type: "history.query";
  limit?: number;
  before?: string;
}

// ── Health ────────────────────────────────────────────────────────────────────

export interface HealthQueryMessage {
  type: "health.query";
}

// ── LLM Preflight ─────────────────────────────────────────────────────────────

export interface LlmPreflightQueryMessage {
  type: "llm.preflight.query";
}

// ── Runtime Config ────────────────────────────────────────────────────────────

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

// ── Status / Admin ────────────────────────────────────────────────────────────

export interface StatusQueryMessage {
  type: "status.query";
}

export interface AdminShutdownMessage {
  type: "admin.shutdown";
}

// ── Voice ─────────────────────────────────────────────────────────────────────

export interface VoiceTranscribeMessage {
  type: "voice.transcribe";
  id: string;
  /** Base64-encoded audio data. */
  audio: string;
  /** Audio format hint (e.g. "wav", "mp3"). Defaults to "wav". */
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

// ── System Dashboard ──────────────────────────────────────────────────────────

export interface SystemDashboardMessage {
  type: "system.dashboard";
  id: string;
}

// ── Permission Responder ──────────────────────────────────────────────────────

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

// ─── Gateway → Client ────────────────────────────────────────────────────────

/** Messages sent from gateway to client. */
export type ServerMessage =
  | ConnectedMessage
  | TaskAcceptedMessage
  | OpenClawResultMessage
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
  | VibeVoicePartialMessage
  | VibeVoiceTranscriptMessage
  | VibeVoiceErrorMessage
  | SystemInfoMessage
  | PermissionPolicyReportMessage
  | PermissionHistoryResultMessage
  | PermissionStatusMessage;

export interface ConnectedMessage {
  type: "connected";
  clientId: string;
  capabilities: string[];
}

export interface TaskAcceptedMessage {
  type: "task.accepted";
  taskId: string;
  goal: string;
}

export interface OpenClawResultMessage {
  type: "openclaw.result";
  id: string;
  taskId: string;
  status: "complete" | "failed";
  error?: string;
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
  entries: HistoryEntry[];
}

export interface HealthReportMessage {
  type: "health.report";
  overall: string;
  timestamp: string;
  sensors: Record<string, SensorResult>;
  alerts: Alert[];
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
  config: Record<string, unknown>;
}

export interface RuntimeConfigAckMessage {
  type: "runtime.config.ack";
  ok: boolean;
  key: RuntimeConfigSetMessage["key"];
  message: string;
  config: Record<string, unknown>;
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

export interface VibeVoicePartialMessage {
  type: "vibevoice.partial";
  sessionId: string;
  receivedChunks: number;
  receivedBytes: number;
}

export interface VibeVoiceTranscriptMessage {
  type: "vibevoice.transcript";
  sessionId: string;
  text: string;
}

export interface VibeVoiceErrorMessage {
  type: "vibevoice.error";
  sessionId: string;
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

// ── Permission Responder (server → client) ────────────────────────────────────

export interface PermissionPolicyReportMessage {
  type: "permission.policy.report";
  /** Current approval policy, or null if not configured. */
  policy: Record<string, unknown> | null;
}

export interface PermissionHistoryResultMessage {
  type: "permission.history.result";
  /** Recent approval events from the ClaudeCodeResponder. */
  history: Array<{
    timestamp: string;
    promptLine: string;
    action: "allowed" | "denied" | "deferred" | "error";
    reason: string;
  }>;
}

export interface PermissionStatusMessage {
  type: "permission.status";
  /** Whether the auto-responder is currently polling. */
  running: boolean;
}

// ─── Shared supporting types ─────────────────────────────────────────────────

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
