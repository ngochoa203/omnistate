export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";
export type MessageHandler = (msg: any) => void;

export interface TtsChunkEvent {
  sessionId: string;
  seq: number;
  audio: ArrayBuffer;
  mime: string;
  eos: boolean;
}

/** Token will expire within this many seconds — fire onTokenExpiring */
const TOKEN_EXPIRY_WARNING_SECONDS = 60 * 60 * 24; // 24 hours

export interface GatewayClientOptions {
  url: string;
  role?: string;
  token?: string;
  /** Identifies whether the token is a short-lived session token or a
   *  long-lived device token issued by POST /api/lan/pair.
   *  Default: 'session' */
  tokenType?: "session" | "device";
  /** Required when tokenType === 'device' so the gateway can map the
   *  connection back to the registered device record. */
  deviceId?: string;
  maxReconnectAttempts?: number;
  onStateChange?: (state: ConnectionState) => void;
  onMessage?: (msg: any) => void;
  /** Fired when the device token is within TOKEN_EXPIRY_WARNING_SECONDS of
   *  expiry. The caller should refresh and call updateToken(). */
  onTokenExpiring?: () => void;
}

export class GatewayClientCore {
  readonly url: string;
  private role: string;
  private token?: string;
  private tokenType: "session" | "device";
  private deviceId?: string;
  private onTokenExpiring?: () => void;
  private tokenExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _state: ConnectionState = "disconnected";
  private onStateChange?: (state: ConnectionState) => void;
  private ttsChunkHandlers = new Set<(evt: TtsChunkEvent) => void>();
  private transcriptHandlers = new Set<(msg: any) => void>();

  constructor(options: GatewayClientOptions) {
    this.url = options.url;
    this.role = options.role ?? "remote";
    this.token = options.token;
    this.tokenType = options.tokenType ?? "session";
    this.deviceId = options.deviceId;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.onStateChange = options.onStateChange;
    this.onTokenExpiring = options.onTokenExpiring;
    if (options.onMessage) {
      this.on("*", options.onMessage);
    }
    // Schedule expiry warning if we have a device token
    if (this.tokenType === "device" && this.token) {
      this.scheduleTokenExpiryWarning(this.token);
    }
  }

  get state(): ConnectionState {
    return this._state;
  }

  private setState(state: ConnectionState) {
    this._state = state;
    this.onStateChange?.(state);
    this.emit("_state", { state });
  }

  connect(): void {
    if (this.ws) return;
    this.setState("connecting");

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.setState("error");
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      // Build connect handshake — include device identity when using device token
      const handshake: Record<string, unknown> = {
        type: "connect",
        role: this.role,
        auth: this.token
          ? { token: this.token, type: this.tokenType }
          : undefined,
      };
      if (this.tokenType === "device" && this.deviceId) {
        handshake.device = { type: "device", deviceId: this.deviceId };
      }
      this.send(handshake);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : "{}");

        if (msg.type === "connected") {
          this.setState("connected");
        }

        // Gateway may push a token_expiring notice
        if (msg.type === "token_expiring") {
          this.onTokenExpiring?.();
        }

        // Streaming TTS chunk (Phase 5 protocol)
        if (msg.type === "voice.tts.chunk") {
          const raw = msg.audio as string;
          const binaryStr = atob(raw);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          const evt: TtsChunkEvent = {
            sessionId: msg.sessionId as string,
            seq: msg.seq as number,
            audio: bytes.buffer,
            mime: (msg.mime as string) ?? "audio/mpeg",
            eos: Boolean(msg.eos),
          };
          this.ttsChunkHandlers.forEach((h) => { try { h(evt); } catch { /* ignore */ } });
        }

        // Transcript events
        if (msg.type === "voice.transcript" || msg.type === "transcript") {
          this.transcriptHandlers.forEach((h) => { try { h(msg); } catch { /* ignore */ } });
        }

        this.emit(msg.type, msg);
        this.emit("*", msg);
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.setState("disconnected");
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
      this.ws = null;
      this.setState("error");
    };
  }

  disconnect(): void {
    this.clearTokenExpiryTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts; // prevent reconnect
    this.ws?.close();
    this.ws = null;
    this.setState("disconnected");
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendTask(goal: string, layer: "deep" | "surface" | "auto" = "auto"): void {
    this.send({ type: "task", goal, layer });
  }

  /**
   * Announce a new voice stream session to the server, then send raw audio
   * chunks as binary WebSocket frames, and finally signal end of stream.
   */
  startVoiceStream(sessionId: string): void {
    this.send({ type: "voice.stream.start", sessionId });
  }

  sendAudioChunk(buf: ArrayBuffer | Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(buf);
    }
  }

  stopVoiceStream(sessionId: string): void {
    this.send({ type: "voice.stream.stop", sessionId });
  }

  cancelTts(sessionId: string): void {
    this.send({ type: "tts.cancel", sessionId });
  }

  /** Register a handler for decoded TTS audio chunks (Phase 5 streaming). */
  onTtsChunk(handler: (evt: TtsChunkEvent) => void): () => void {
    this.ttsChunkHandlers.add(handler);
    return () => this.ttsChunkHandlers.delete(handler);
  }

  /** Register a handler for transcript events from the server. */
  onTranscript(handler: (msg: any) => void): () => void {
    this.transcriptHandlers.add(handler);
    return () => this.transcriptHandlers.delete(handler);
  }

  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  off(type: string, handler: MessageHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  private emit(type: string, msg: any): void {
    this.handlers.get(type)?.forEach((h) => {
      try { h(msg); } catch { /* ignore */ }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Re-schedule token expiry warning after updateToken() */
  private scheduleTokenExpiryWarning(token: string): void {
    this.clearTokenExpiryTimer();
    if (!this.onTokenExpiring) return;
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return;
      const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const jsonStr = atob(padded.padEnd(padded.length + (4 - (padded.length % 4)) % 4, "="));
      const payload = JSON.parse(jsonStr) as { exp?: number };
      if (typeof payload.exp !== "number") return;

      const nowMs = Date.now();
      const warnAtMs = (payload.exp - TOKEN_EXPIRY_WARNING_SECONDS) * 1000;
      const delay = warnAtMs - nowMs;
      if (delay <= 0) {
        // Already within warning window — fire immediately
        this.onTokenExpiring();
        return;
      }
      this.tokenExpiryTimer = setTimeout(() => {
        this.tokenExpiryTimer = null;
        this.onTokenExpiring?.();
      }, delay);
    } catch {
      // Non-JWT token or atob unavailable — skip timer
    }
  }

  private clearTokenExpiryTimer(): void {
    if (this.tokenExpiryTimer) {
      clearTimeout(this.tokenExpiryTimer);
      this.tokenExpiryTimer = null;
    }
  }

  updateToken(token: string): void {
    this.token = token;
    if (this.tokenType === "device") {
      this.scheduleTokenExpiryWarning(token);
    }
  }

  updateUrl(url: string): void {
    (this as any).url = url;
  }
}
