/**
 * Mirror session — bi-directional screen + input bridge between a source
 * device (phone or mac) and one or more viewer devices.
 *
 * Design goals:
 *   - low latency: binary JPEG frames, no JSON envelope for frames
 *   - simple: single WebSocket path /mirror, message discriminators as first byte
 *   - pluggable: any device posting frames is a "source", any listener is a "viewer"
 *
 * Protocol (WebSocket messages):
 *   Binary messages (frames, always from source to viewers):
 *     [0x01] [1 byte stream id] [JPEG bytes...]
 *   Text messages (JSON):
 *     {"type":"hello","role":"source"|"viewer","sessionId":"...","streamId":0,"deviceId":"..."}
 *     {"type":"input","action":"tap|swipe|key|text","params":{...}}  // viewer → source
 *     {"type":"meta","width":1080,"height":2400,"fps":15}             // source → viewers
 *     {"type":"bye"}                                                   // either side
 */

import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";

export type MirrorRole = "source" | "viewer";

export interface MirrorClient {
  id: string;
  ws: WebSocket;
  role: MirrorRole;
  sessionId: string;
  streamId: number;
  deviceId?: string;
  joinedAt: number;
}

export interface MirrorInputEvent {
  action: "tap" | "swipe" | "key" | "text" | "back" | "home" | "recents";
  params?: Record<string, unknown>;
}

export interface MirrorMeta {
  width: number;
  height: number;
  fps: number;
  deviceName?: string;
}

export interface MirrorSessionOptions {
  path?: string;
  maxClients?: number;
  maxFrameBytes?: number;
  idleTimeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<MirrorSessionOptions> = {
  path: "/mirror",
  maxClients: 32,
  maxFrameBytes: 2 * 1024 * 1024,
  idleTimeoutMs: 60_000,
};

const FRAME_MAGIC = 0x01;

export class MirrorSessionServer {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<string, MirrorClient>();
  private readonly options: Required<MirrorSessionOptions>;

  constructor(options: MirrorSessionOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Attach to an existing HTTP server on the configured path. */
  attach(server: import("node:http").Server): void {
    if (this.wss) throw new Error("MirrorSessionServer already attached");
    this.wss = new WebSocketServer({ server, path: this.options.path });
    this.wss.on("connection", (ws) => this.onConnection(ws));
  }

  detach(): void {
    this.wss?.close();
    this.wss = null;
    for (const c of this.clients.values()) {
      try { c.ws.close(); } catch { /* ignore */ }
    }
    this.clients.clear();
  }

  listSessions(): Array<{ sessionId: string; sources: number; viewers: number }> {
    const sessions = new Map<string, { sources: number; viewers: number }>();
    for (const c of this.clients.values()) {
      const s = sessions.get(c.sessionId) ?? { sources: 0, viewers: 0 };
      if (c.role === "source") s.sources += 1;
      else s.viewers += 1;
      sessions.set(c.sessionId, s);
    }
    return Array.from(sessions.entries()).map(([sessionId, counts]) => ({
      sessionId,
      ...counts,
    }));
  }

  private onConnection(ws: WebSocket): void {
    if (this.clients.size >= this.options.maxClients) {
      ws.close(1013, "server at capacity");
      return;
    }
    const id = randomUUID();
    let client: MirrorClient | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const resetIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        try { ws.close(1001, "idle timeout"); } catch { /* ignore */ }
      }, this.options.idleTimeoutMs);
    };

    ws.on("message", (raw, isBinary) => {
      resetIdle();
      if (isBinary) {
        this.routeFrame(client, raw as Buffer);
        return;
      }
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "hello" && !client) {
          client = this.onHello(id, ws, msg);
          return;
        }
        if (!client) return;
        this.onControl(client, msg);
      } catch { /* ignore malformed */ }
    });

    ws.on("close", () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (client) this.clients.delete(client.id);
    });
    ws.on("error", () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (client) this.clients.delete(client.id);
    });

    resetIdle();
  }

  private onHello(id: string, ws: WebSocket, msg: Record<string, unknown>): MirrorClient {
    const role = (msg.role === "source" ? "source" : "viewer") as MirrorRole;
    const sessionId = String(msg.sessionId ?? "default");
    const streamId = Number.isFinite(msg.streamId) ? Number(msg.streamId) : 0;
    const deviceId = typeof msg.deviceId === "string" ? msg.deviceId : undefined;
    const client: MirrorClient = {
      id,
      ws,
      role,
      sessionId,
      streamId,
      deviceId,
      joinedAt: Date.now(),
    };
    this.clients.set(id, client);
    return client;
  }

  private onControl(client: MirrorClient, msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "input":
        if (client.role !== "viewer") return;
        this.forwardToSources(client.sessionId, { ...msg });
        break;
      case "meta":
        if (client.role !== "source") return;
        this.broadcastToViewers(client.sessionId, msg);
        break;
      case "ping":
        this.safeSend(client.ws, JSON.stringify({ type: "pong", ts: Date.now() }));
        break;
      case "bye":
        try { client.ws.close(1000, "bye"); } catch { /* ignore */ }
        break;
      default:
        break;
    }
  }

  private routeFrame(client: MirrorClient | null, buf: Buffer): void {
    if (!client || client.role !== "source") return;
    if (buf.length > this.options.maxFrameBytes) return;
    if (buf.length < 2 || buf[0] !== FRAME_MAGIC) return;
    for (const viewer of this.clients.values()) {
      if (viewer.role !== "viewer") continue;
      if (viewer.sessionId !== client.sessionId) continue;
      if (viewer.streamId !== client.streamId) continue;
      this.safeSendBinary(viewer.ws, buf);
    }
  }

  private forwardToSources(sessionId: string, msg: unknown): void {
    const json = JSON.stringify(msg);
    for (const c of this.clients.values()) {
      if (c.role === "source" && c.sessionId === sessionId) {
        this.safeSend(c.ws, json);
      }
    }
  }

  private broadcastToViewers(sessionId: string, msg: unknown): void {
    const json = JSON.stringify(msg);
    for (const c of this.clients.values()) {
      if (c.role === "viewer" && c.sessionId === sessionId) {
        this.safeSend(c.ws, json);
      }
    }
  }

  private safeSend(ws: WebSocket, data: string): void {
    try { ws.send(data); } catch { /* ignore */ }
  }

  private safeSendBinary(ws: WebSocket, data: Buffer): void {
    try { ws.send(data, { binary: true }); } catch { /* ignore */ }
  }
}
