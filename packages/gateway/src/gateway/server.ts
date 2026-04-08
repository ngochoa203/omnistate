import { WebSocketServer, type WebSocket } from "ws";
import type { GatewayConfig } from "../config/schema.js";
import type { ClientMessage, ServerMessage, ClientRole } from "./protocol.js";
import { authenticateClient } from "./auth.js";

interface ConnectedClient {
  ws: WebSocket;
  id: string;
  role: ClientRole;
  authenticatedAt: number;
}

/**
 * OmniState Gateway — the central daemon.
 *
 * Accepts WebSocket connections from CLI, UI, remote, and fleet agents.
 * Routes commands to the Task Planner and Execution Orchestrator.
 */
export class OmniStateGateway {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private config: GatewayConfig;

  constructor(config: GatewayConfig) {
    this.config = config;
  }

  /** Start the WebSocket server. */
  start(): void {
    this.wss = new WebSocketServer({
      host: this.config.gateway.bind,
      port: this.config.gateway.port,
    });

    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws, req);
    });

    console.log(
      `[OmniState] Gateway listening on ${this.config.gateway.bind}:${this.config.gateway.port}`
    );
  }

  /** Gracefully shut down the gateway. */
  stop(): void {
    for (const client of this.clients.values()) {
      const msg: ServerMessage = {
        type: "gateway.shutdown",
        reason: "Gateway shutting down",
      };
      client.ws.send(JSON.stringify(msg));
      client.ws.close();
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
    console.log("[OmniState] Gateway stopped");
  }

  /** Broadcast a message to all connected clients. */
  broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === 1 /* OPEN */) {
        client.ws.send(payload);
      }
    }
  }

  private handleConnection(
    ws: WebSocket,
    _req: import("http").IncomingMessage
  ): void {
    const clientId = crypto.randomUUID();

    ws.on("message", (raw) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());
        this.handleMessage(clientId, ws, msg);
      } catch {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Invalid JSON message",
          })
        );
      }
    });

    ws.on("close", () => {
      this.clients.delete(clientId);
    });
  }

  private handleMessage(
    clientId: string,
    ws: WebSocket,
    msg: ClientMessage
  ): void {
    switch (msg.type) {
      case "connect": {
        const authResult = authenticateClient(msg, this.config);
        if (!authResult.ok) {
          ws.send(
            JSON.stringify({ type: "error", message: authResult.reason })
          );
          ws.close();
          return;
        }
        this.clients.set(clientId, {
          ws,
          id: clientId,
          role: msg.role,
          authenticatedAt: Date.now(),
        });
        const response: ServerMessage = {
          type: "connected",
          clientId,
          capabilities: ["task", "health", "fleet"],
        };
        ws.send(JSON.stringify(response));
        break;
      }

      case "task": {
        // TODO: Route to Task Planner
        const response: ServerMessage = {
          type: "task.accepted",
          taskId: crypto.randomUUID(),
          goal: msg.goal,
        };
        ws.send(JSON.stringify(response));
        break;
      }

      default: {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Unknown message type: ${(msg as ClientMessage).type}`,
          })
        );
      }
    }
  }
}
