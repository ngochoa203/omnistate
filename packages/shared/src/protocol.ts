/** Roles a client can authenticate as. */
export type ClientRole = "cli" | "ui" | "remote" | "fleet-agent";

// ─── Client → Gateway ────────────────────────────────────────────────────────

/** Messages sent from client to gateway. */
export type ClientMessage =
  | { type: "event.ingest"; id?: string; source: string; kind: string; severity?: EventSeverity; title: string; body?: string; tags?: string[]; metadata?: Record<string, unknown>; occurredAt?: string }
  | { type: "event.query"; source?: string; kind?: string; severity?: EventSeverity; tagsAny?: string[]; text?: string; before?: string; limit?: number }
  | { type: "event.get"; id: string }
  | { type: "memory.record.upsert"; id?: string; scope?: MemoryRecord["scope"]; conversationId?: string; title: string; content: string; tags?: string[]; metadata?: Record<string, unknown> }
  | { type: "memory.record.query"; scope?: MemoryRecord["scope"]; conversationId?: string; tagsAny?: string[]; text?: string; before?: string; limit?: number }
  | { type: "memory.record.delete"; id: string }
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
  | RuntimeConfigDeleteProviderMessage
  | StatusQueryMessage
  | AdminShutdownMessage
  | VoiceTranscribeMessage
  | VoiceStreamStartMessage
  | VoiceStreamChunkMessage
  | VoiceStreamStopMessage
  | VoiceSessionCancelMessage
  | TaskCancelMessage
  | VibeVoiceStartMessage
  | VibeVoiceChunkMessage
  | VibeVoiceEndMessage
  | SystemDashboardMessage
  | PermissionPolicyGetMessage
  | PermissionPolicyUpdateMessage
  | PermissionHistoryMessage
  | PermissionStartMessage
  | PermissionStopMessage
  | VoiceEnrollStartMessage
  | VoiceEnrollSampleMessage
  | VoiceEnrollCancelMessage
  | VoiceEnrollFinalizeMessage
  | ToolsListMessage;

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


// ── Events ───────────────────────────────────────────────────────────────────

export type EventSeverity = "debug" | "info" | "warning" | "error" | "critical";

export interface EventRecord {
  id: string;
  source: string;
  kind: string;
  severity: EventSeverity;
  title: string;
  body: string;
  tags: string[];
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export interface MemoryRecord {
  id: string;
  scope: "global" | "conversation" | "user";
  conversationId?: string;
  title: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

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
    | "voice.siri.token"
    | "vad.silenceThresholdMs"
    | "vad.speechThreshold"
    | "vad.minSpeechMs"
    | "tts.provider"
    | "tts.voiceVi"
    | "tts.voiceEn"
    | "speakerVerification.enabled"
    | "speakerVerification.threshold"
    | "speakerVerification.onMismatch"
    | "voice.sttProvider"
    | "voice.whisperLocalModel";
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

export interface RuntimeConfigDeleteProviderMessage {
  type: "runtime.config.deleteProvider";
  providerId: string;
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

export type VoiceState = "idle" | "wake-listening" | "wake-detected" | "recording" | "transcribing" | "thinking" | "executing" | "speaking" | "interrupted" | "error";

export interface VoiceStreamStartMessage {
  type: "voice.stream.start";
  sessionId: string;
  source?: "voice" | "wake" | "siri-handoff";
  mimeType?: string;
  sampleRate?: number;
  autoExecute?: boolean;
  includeContext?: boolean;
}

export interface VoiceStreamChunkMessage {
  type: "voice.stream.chunk";
  sessionId: string;
  audio: string;
}

export interface VoiceStreamStopMessage {
  type: "voice.stream.stop";
  sessionId: string;
  autoExecute?: boolean;
  includeContext?: boolean;
}

export interface VoiceSessionCancelMessage {
  type: "voice.session.cancel";
  sessionId: string;
}

export interface TaskCancelMessage {
  type: "task.cancel";
  taskId: string;
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

// ── Voice Enrollment (Client → Gateway) ──────────────────────────────────────

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

export interface VoiceEnrollCancelMessage {
  type: "voice.enroll.cancel";
  userId: string;
}

export interface VoiceEnrollFinalizeMessage {
  type: "voice.enroll.finalize";
  userId: string;
}

// ── Tools List (Client → Gateway) ─────────────────────────────────────────────

export interface ToolsListMessage {
  type: "tools.list";
}

// ─── Gateway → Client ────────────────────────────────────────────────────────

/** Messages sent from gateway to client. */
export type ServerMessage =
  | { type: "event.ingested"; event: EventRecord }
  | { type: "event.query.result"; events: EventRecord[] }
  | { type: "event.detail"; event: EventRecord | null }
  | { type: "memory.record.saved"; record: MemoryRecord }
  | { type: "memory.record.query.result"; records: MemoryRecord[] }
  | { type: "memory.record.deleted"; id: string; deleted: boolean }
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
  | VoiceStateMessage
  | VoiceTranscriptPartialMessage
  | VoiceTranscriptFinalMessage
  | VoiceContextMessage
  | VoiceStreamErrorMessage
  | TaskCancelledMessage
  | VibeVoicePartialMessage
  | VibeVoiceTranscriptMessage
  | VibeVoiceErrorMessage
  | SystemInfoMessage
  | PermissionPolicyReportMessage
  | PermissionHistoryResultMessage
  | PermissionStatusMessage
  | VoiceTtsAudioMessage
  | VoiceSpeakerMismatchMessage
  | VoiceEnrollReadyMessage
  | VoiceEnrollProgressMessage
  | VoiceEnrollDoneMessage
  | VoiceEnrollErrorMessage
  | ToolsListResultMessage;

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

export interface VoiceStateMessage {
  type: "voice.state";
  sessionId?: string;
  state: VoiceState;
  source?: string;
  taskId?: string;
  error?: string;
}

export interface VoiceTranscriptPartialMessage {
  type: "voice.transcript.partial";
  sessionId: string;
  text: string;
  provider?: string;
}

export interface VoiceTranscriptFinalMessage {
  type: "voice.transcript.final";
  sessionId: string;
  text: string;
  provider?: string;
  taskId?: string;
}

export interface VoiceContextMessage {
  type: "voice.context";
  sessionId: string;
  context: unknown;
}

export interface VoiceStreamErrorMessage {
  type: "voice.stream.error";
  sessionId: string;
  error: string;
}

export interface TaskCancelledMessage {
  type: "task.cancelled";
  taskId: string;
  reason?: string;
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

export interface BatteryInfo {
  level: number;        // 0-100
  charging: boolean;
  plugged: boolean;
  timeRemaining?: number; // minutes
  cycleCount?: number;
}

export interface WifiInfo {
  ssid: string | null;
  connected: boolean;
  signalStrength?: number;  // dBm
  ipAddress?: string;
}

export interface DiskInfo {
  total: number;   // bytes
  used: number;    // bytes
  free: number;    // bytes
  usedPercent: number;
}

export interface CpuInfo {
  usagePercent: number;
  model?: string;
  cores?: number;
  speedMhz?: number;
}

export interface MemoryInfo {
  total: number;    // bytes
  used: number;     // bytes
  free: number;     // bytes
  usedPercent: number;
}

export interface SystemInfoMessage {
  type: "system.info";
  id: string;
  data: {
    battery: BatteryInfo | null;
    wifi: WifiInfo | null;
    disk: DiskInfo | null;
    cpu: CpuInfo | null;
    memory: MemoryInfo | null;
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

// ── Voice TTS / Speaker (Gateway → Client) ────────────────────────────────────

export interface VoiceTtsAudioMessage {
  type: "voice.tts.audio";
  audio: string;
  format?: string;
}

export interface VoiceSpeakerMismatchMessage {
  type: "voice.speaker.mismatch";
  score: number;
  threshold: number;
}

// ── Voice Enrollment (Gateway → Client) ──────────────────────────────────────

export interface VoiceEnrollReadyMessage {
  type: "voice.enroll.ready";
  phraseIndex: number;
  prompt: string;
  totalPhrases: number;
}

export interface VoiceEnrollProgressMessage {
  type: "voice.enroll.progress";
  phraseIndex: number;
  accepted: boolean;
  reason?: string;
  samplesCollected: number;
}

export interface VoiceEnrollDoneMessage {
  type: "voice.enroll.done";
  userId: string;
  sampleCount: number;
}

export interface VoiceEnrollErrorMessage {
  type: "voice.enroll.error";
  code: string;
  message: string;
}

// ── Tools List (Gateway → Client) ────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ToolsListResultMessage {
  type: "tools.list.result";
  tools: ToolDefinition[];
}
