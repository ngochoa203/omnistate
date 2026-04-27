/** Roles a client can authenticate as. */
export type ClientRole = "cli" | "ui" | "remote" | "fleet-agent";

// ─── Client → Gateway ────────────────────────────────────────────────────────

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
  | AdminShutdownMessage
  | VoiceTranscribeMessage
  | VibeVoiceStartMessage
  | VibeVoiceChunkMessage
  | VibeVoiceEndMessage
  | VoiceStreamStartMessage
  | VoiceStreamStopMessage
  | TtsCancelMessage
  | VoiceEnrollMessage
  | VoiceVerifyMessage
  | SystemDashboardMessage
  | PermissionPolicyGetMessage
  | PermissionPolicyUpdateMessage
  | PermissionHistoryMessage
  | PermissionStartMessage
  | PermissionStopMessage
  | VoiceEnrollStartMessage
  | VoiceEnrollSampleMessage
  | VoiceEnrollFinalizeMessage
  | VoiceEnrollCancelMessage
  | VoiceWakeEnableMessage
  | TriggerCreateMessage
  | TriggerListMessage
  | TriggerUpdateMessage
  | TriggerDeleteMessage
  | TriggerHistoryMessage
  | ToolsListMessage;

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
  attachments?: TaskAttachment[];
}

// ── Task Attachments ──────────────────────────────────────────────────────────

export interface TaskAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text" | "file";
  textPreview?: string;
  dataBase64?: string;
}

// ── Claude Memory ─────────────────────────────────────────────────────────────

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
  id?: string;
  sessionId?: string;
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

// ── Voice Enrollment (client → gateway) ──────────────────────────────────────

export interface VoiceEnrollStartMessage {
  type: "voice.enroll.start";
  userId: string;
}

export interface VoiceEnrollSampleMessage {
  type: "voice.enroll.sample";
  audio: string;
  format: string;
  phraseIndex: number;
}

export interface VoiceEnrollFinalizeMessage {
  type: "voice.enroll.finalize";
  userId: string;
}

export interface VoiceEnrollCancelMessage {
  type: "voice.enroll.cancel";
  userId: string;
}

// ── Voice Streaming (client → gateway) ───────────────────────────────────────

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

// ── Trigger Messages (client → gateway) ──────────────────────────────────────

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

// ── Tools ─────────────────────────────────────────────────────────────────────

export interface ToolsListMessage {
  type: "tools.list";
}

// ─── Gateway → Client ────────────────────────────────────────────────────────

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
  | PermissionStatusMessage
  | VoiceEnrollReadyMessage
  | VoiceEnrollProgressMessage
  | VoiceEnrollDoneMessage
  | VoiceEnrollErrorMessage
  | VoiceEnrollResultMessage
  | VoiceEnrollErrorGatewayMessage
  | VoiceVerifyResultMessage
  | VoiceVerifyErrorMessage
  | VoiceTtsAudioMessage
  | VoiceTtsChunkMessage
  | VoiceSpeakerMismatchMessage
  | TtsEndMessage
  | ToolsReportMessage;

export interface TtsEndMessage {
  type: "tts.end";
  taskId?: string;
  timestamp: string;
}

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
  result: {
    /** Primary output text (backward-compatible). */
    output?: string;
    /** Spoken response text for voice clients. */
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
  /** Legacy: one-shot transcription id. */
  id?: string;
  /** Streaming session id. */
  sessionId?: string;
  kind?: "partial" | "final";
  text: string;
  t0?: number;
  t1?: number;
}

export interface VoiceErrorMessage {
  type: "voice.error";
  /** Legacy: one-shot transcription id. */
  id?: string;
  /** Streaming session id. */
  sessionId?: string;
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

// ── Voice Enrollment (gateway → client) ──────────────────────────────────────

export interface VoiceEnrollReadyMessage {
  type: "voice.enroll.ready";
  phraseIndex: number;
  prompt: string;
}

export interface VoiceEnrollProgressMessage {
  type: "voice.enroll.progress";
  accepted: boolean;
  phraseIndex: number;
  reason?: string;
}

export interface VoiceEnrollDoneMessage {
  type: "voice.enroll.done";
  userId: string;
  sampleCount: number;
}

export interface VoiceEnrollErrorMessage {
  type: "voice.enroll.error";
  /** Structured error code (enrollment flow). */
  code?: string;
  message?: string;
  /** Legacy flat error string. */
  error?: string;
}

export interface VoiceTtsAudioMessage {
  type: "voice.tts.audio";
  taskId?: string;
  audio: string;       // base64-encoded MP3
  format: "mp3";
  lang: "vi" | "en";
  voice?: string;      // TTS voice identifier (e.g. "vi-VN-HoaiMyNeural")
  text?: string;       // spoken text for subtitle/transcript display
}

// ── Voice Speaker Verification (gateway → client) ─────────────────────────────

export interface VoiceSpeakerMismatchMessage {
  type: "voice.speaker.mismatch";
  sessionId: string;
  userId: string;
  score: number;
  threshold: number;
}

// ── Voice Enrollment — gateway protocol variants ──────────────────────────────

/** Gateway's compact voice.enroll.result (for VoiceEnrollMessage flow). */
export interface VoiceEnrollResultMessage {
  type: "voice.enroll.result";
  profileId: string;
  sampleCount: number;
  isComplete: boolean;
  required: number;
}

/** Gateway's compact voice.enroll.error (for VoiceEnrollMessage flow). */
export interface VoiceEnrollErrorGatewayMessage {
  type: "voice.enroll.error.gateway";
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

/** Streaming TTS audio chunk from server to client. */
export interface VoiceTtsChunkMessage {
  type: "voice.tts.chunk";
  sessionId: string;
  seq: number;
  audio: string;
  mime: string;
  eos: boolean;
}

export interface ToolsReportMessage {
  type: "tools.report";
  tools: Array<{ name: string; description: string; group: string }>;
  skills: Array<{ name: string; group: string }>;
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

// ─── System Events (macOS native → gateway → clients) ────────────────────────

export interface SystemClipboardChangedEvent {
  type: "system.clipboard.changed";
  content: string;
}

export interface SystemFileDownloadedEvent {
  type: "system.file.downloaded";
  name: string;
  path: string;
  sizeBytes: number;
}

export interface SystemAppSwitchedEvent {
  type: "system.app.switched";
  from: string;
  to: string;
}

export type SystemEvent =
  | SystemClipboardChangedEvent
  | SystemFileDownloadedEvent
  | SystemAppSwitchedEvent;
