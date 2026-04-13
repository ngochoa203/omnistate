import type { ClientMessage, ServerMessage } from "./protocol";
import type { ClaudeMemPayload } from "./protocol";
import { useAuthStore } from "./auth-store";

type EventHandler = (msg: ServerMessage) => void;

function resolveGatewayUrl(): string {
  // If running inside native macOS app (WKWebView), use injected URL
  if (typeof window !== "undefined" && (window as any).OMNISTATE_GATEWAY_URL) {
    return (window as any).OMNISTATE_GATEWAY_URL as string;
  }

  try {
    const envUrl = (import.meta as unknown as { env?: { VITE_GATEWAY_WS_URL?: string } })
      .env?.VITE_GATEWAY_WS_URL;
    if (envUrl) return envUrl;
  } catch {
    // ignore env resolution errors and fall back to runtime defaults
  }

  if (typeof window !== "undefined") {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    return `${scheme}://${window.location.host}/ws`;
  }

  return "ws://127.0.0.1:19800";
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

    this.ws.onerror = () => {
      // onclose will fire after this
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

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendTask(goal: string): void {
    this.send({ type: "task", goal });
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
    key: "provider" | "model" | "baseURL" | "apiKey" | "voice.lowLatency" | "voice.autoExecuteTranscript",
    value: string | boolean,
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

  requestHistory(limit: number = 20): void {
    this.send({ type: "history.query", limit } as ClientMessage);
  }

  sendVoice(audioBase64: string, id?: string): void {
    const msgId = id || `voice-${Date.now()}`;
    this.send({ type: "voice.transcribe", id: msgId, audio: audioBase64 } as ClientMessage);
  }

  requestSystemDashboard(id?: string): void {
    const msgId = id || `sys-${Date.now()}`;
    this.send({ type: "system.dashboard", id: msgId } as ClientMessage);
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
