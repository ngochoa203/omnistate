import type { ClientMessage, EventRecord, EventSeverity, MemoryRecord, ServerMessage } from "./protocol";
import type { ClaudeMemPayload } from "./protocol";
import type { TaskAttachment } from "./protocol";
import { useAuthStore } from "./auth-store";
import { resolveGatewayWsUrl } from "./runtime-config";

type EventHandler = (msg: ServerMessage) => void;

function resolveGatewayUrl(): string {
  return resolveGatewayWsUrl();
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private shouldReconnect = true;
  private _url: string;

  constructor(url: string = resolveGatewayUrl()) {
    this._url = url;
  }

  get url(): string {
    return this._url;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this._doConnect();
  }

  private _doConnect(): void {
    this.ws = new WebSocket(this._url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.reconnectAttempts = 0;
      // Send connect handshake with auth token
      const token = useAuthStore.getState().accessToken;
      this.send({ type: "connect", auth: { token: token || undefined }, role: "ui" });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        this.emit(msg.type, msg);
        this.emit("*", msg); // wildcard for catch-all
      } catch { /* ignore parse errors */ }
    };

    this.ws.onclose = () => {
      this.emit("_disconnected", { type: "error", message: "disconnected" } as ServerMessage);
      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (event) => {
      // onclose fires after this in browser, but may not in all environments
      console.warn('[GatewayClient] WebSocket error', event);
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    console.warn('[GatewayClient] send() called while not connected — message dropped', msg);
    return false;
  }

  sendTask(goal: string, options?: { attachments?: TaskAttachment[] }): void {
    this.send({ type: "task", goal, attachments: options?.attachments });
  }

  requestHealth(): void {
    this.send({ type: "health.query" } as ClientMessage);
  }

  requestLlmPreflight(): void {
    this.send({ type: "llm.preflight.query" } as ClientMessage);
  }

  requestRuntimeConfig(): void {
    this.send({ type: "runtime.config.get" } as ClientMessage);
  }

  queryClaudeMem(): void {
    this.send({ type: "claude.mem.query" } as ClientMessage);
  }

  syncClaudeMem(payload: ClaudeMemPayload): void {
    this.send({ type: "claude.mem.sync", payload } as ClientMessage);
  }

  setRuntimeConfig(
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
      | "voice.whisperLocalModel",
    value: string | boolean | number,
  ): void {
    this.send({ type: "runtime.config.set", key, value } as ClientMessage);
  }

  upsertRuntimeProvider(provider: {
    id: string;
    kind: "anthropic" | "openai-compatible";
    baseURL: string;
    apiKey: string;
    model: string;
    enabled?: boolean;
    models?: string[];
  }, options?: { activate?: boolean; addToFallback?: boolean }): void {
    this.send({
      type: "runtime.config.upsertProvider",
      provider,
      activate: options?.activate,
      addToFallback: options?.addToFallback,
    } as ClientMessage);
  }

  deleteRuntimeProvider(providerId: string): void {
    this.send({
      type: "runtime.config.deleteProvider",
      providerId,
    } as ClientMessage);
  }

  requestHistory(limit: number = 20): void {
    this.send({ type: "history.query", limit } as ClientMessage);
  }

  sendVoice(audioBase64: string, id?: string): void {
    const msgId = id || `voice-${Date.now()}`;
    this.send({ type: "voice.transcribe", id: msgId, audio: audioBase64 } as ClientMessage);
  }

  startVoiceStream(options: { sessionId?: string; mimeType?: string; sampleRate?: number } = {}): string {
    const sessionId = options.sessionId || `voice-${Date.now()}`;
    this.send({
      type: "voice.stream.start",
      sessionId,
      mimeType: options.mimeType,
      sampleRate: options.sampleRate,
    } as unknown as ClientMessage);
    return sessionId;
  }

  sendVoiceChunk(sessionId: string, base64Chunk: string, seq: number): void {
    this.send({ type: "voice.stream.chunk", sessionId, chunk: base64Chunk, seq } as unknown as ClientMessage);
  }

  stopVoiceStream(sessionId: string, reason?: string): void {
    this.send({ type: "voice.stream.stop", sessionId, reason } as unknown as ClientMessage);
  }

  cancelVoiceSession(sessionId: string, reason?: string): void {
    this.send({ type: "voice.session.cancel", sessionId, reason } as unknown as ClientMessage);
  }

  cancelTask(taskId: string, reason?: string): void {
    this.send({ type: "task.cancel", taskId, reason } as unknown as ClientMessage);
  }

  requestSystemDashboard(id?: string): void {
    const msgId = id || `sys-${Date.now()}`;
    this.send({ type: "system.dashboard", id: msgId } as ClientMessage);
  }

  // Events API
  ingestEvent(event: {
    id?: string;
    source: string;
    kind: string;
    severity?: EventSeverity;
    title: string;
    body?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    occurredAt?: string;
  }): void {
    this.send({ type: "event.ingest", ...event } as ClientMessage);
  }

  queryEvents(opts?: { source?: string; kind?: string; severity?: EventSeverity; tagsAny?: string[]; text?: string; before?: string; limit?: number }): void {
    this.send({ type: "event.query", ...opts } as ClientMessage);
  }

  getEvent(id: string): void {
    this.send({ type: "event.get", id } as ClientMessage);
  }

  upsertMemoryRecord(record: {
    id?: string;
    scope?: MemoryRecord["scope"];
    conversationId?: string;
    title: string;
    content: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): void {
    this.send({ type: "memory.record.upsert", ...record } as ClientMessage);
  }

  queryMemoryRecords(opts?: { scope?: MemoryRecord["scope"]; conversationId?: string; tagsAny?: string[]; text?: string; before?: string; limit?: number }): void {
    this.send({ type: "memory.record.query", ...opts } as ClientMessage);
  }

  deleteMemoryRecord(id: string): void {
    this.send({ type: "memory.record.delete", id } as ClientMessage);
  }

  queryEventRules(): void {
    this.send({ type: "events.rules.list" } as unknown as ClientMessage);
  }

  addEventRule(rule: { name: string; eventPattern: string; condition?: string; action: { type: string; config: Record<string, unknown> } }): void {
    this.send({ type: "events.rules.add", ...rule } as unknown as ClientMessage);
  }

  toggleEventRule(ruleId: string, enabled: boolean): void {
    this.send({ type: "events.rules.toggle", ruleId, enabled } as unknown as ClientMessage);
  }

  // Memory API
  queryEpisodes(query?: string, limit?: number): void {
    this.send({ type: "memory.episodes.query", query, limit } as unknown as ClientMessage);
  }

  queryKGEntities(query?: { type?: string; name?: string }): void {
    this.send({ type: "memory.kg.query", ...query } as unknown as ClientMessage);
  }

  requestToolsList(): void {
    this.send({ type: "tools.list" } as unknown as ClientMessage);
  }

  on(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  private emit(event: string, msg: ServerMessage): void {
    this.handlers.get(event)?.forEach(h => h(msg));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    this.emit("reconnecting", { type: "error", message: `reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})` } as ServerMessage);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
      this._doConnect();
    }, this.reconnectDelay);
  }
}
