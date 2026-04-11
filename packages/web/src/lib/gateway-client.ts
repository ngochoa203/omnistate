import type { ClientMessage, ServerMessage } from "./protocol";

type EventHandler = (msg: ServerMessage) => void;

function resolveGatewayUrl(): string {
  try {
    const envUrl = (import.meta as unknown as { env?: { VITE_GATEWAY_WS_URL?: string } })
      .env?.VITE_GATEWAY_WS_URL;
    if (envUrl) return envUrl;
  } catch {
    // ignore env resolution errors and fall back to runtime defaults
  }

  if (typeof window !== "undefined") {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.hostname || "127.0.0.1";
    return `${scheme}://${host}:19800`;
  }

  return "ws://127.0.0.1:19800";
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
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
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this._url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      // Send connect handshake
      this.send({ type: "connect", auth: {}, role: "ui" });
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
      if (this.shouldReconnect) {
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
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 8000);
      this.connect();
    }, this.reconnectDelay);
  }
}
