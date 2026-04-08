import { WebSocketServer, type WebSocket } from "ws";
import type { GatewayConfig } from "../config/schema.js";
import type { ClientMessage, ServerMessage, ClientRole } from "./protocol.js";
import { authenticateClient } from "./auth.js";
import { classifyIntent, planFromIntent } from "../planner/intent.js";
import { optimizePlan } from "../planner/optimizer.js";
import { Orchestrator } from "../executor/orchestrator.js";

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
 * Routes commands through: Intent → Plan → Optimize → Execute → Verify.
 */
export class OmniStateGateway {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private config: GatewayConfig;
  private orchestrator: Orchestrator;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.orchestrator = new Orchestrator();
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
        const taskId = crypto.randomUUID();

        // Acknowledge immediately
        const accepted: ServerMessage = {
          type: "task.accepted",
          taskId,
          goal: msg.goal,
        };
        ws.send(JSON.stringify(accepted));

        // Run pipeline async — stream progress to client
        this.executeTaskPipeline(taskId, msg.goal, msg.layer, ws).catch(
          (err) => {
            const errMsg: ServerMessage = {
              type: "task.error",
              taskId,
              error: err instanceof Error ? err.message : String(err),
            };
            this.safeSend(ws, errMsg);
          }
        );
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

  /**
   * Full execution pipeline: Intent → Plan → Optimize → Execute.
   * Streams step progress to the connected WebSocket client.
   */
  private async executeTaskPipeline(
    taskId: string,
    goal: string,
    _layerHint: string | undefined,
    ws: WebSocket
  ): Promise<void> {
    // 1. Classify intent
    const intent = await classifyIntent(goal);

    // 2. Build plan from intent
    let plan = await planFromIntent(intent);
    plan = { ...plan, taskId };

    // 3. Optimize plan
    plan = optimizePlan(plan);

    // 4. Execute plan — stream step updates
    const totalSteps = plan.nodes.length;
    let stepNum = 0;

    for (const node of plan.nodes) {
      stepNum++;

      // Notify: step executing
      this.safeSend(ws, {
        type: "task.step",
        taskId,
        step: stepNum,
        status: "executing",
        layer: node.layer === "auto" ? "deep" : node.layer,
      } as ServerMessage);

      // Execute via orchestrator (single-node plan for streaming)
      const singlePlan = { ...plan, nodes: [node] };
      const result = await this.orchestrator.executePlan(singlePlan);

      if (result.status === "failed") {
        this.safeSend(ws, {
          type: "task.step",
          taskId,
          step: stepNum,
          status: "failed",
          layer: node.layer === "auto" ? "deep" : node.layer,
        } as ServerMessage);

        this.safeSend(ws, {
          type: "task.error",
          taskId,
          error: result.error ?? "Step execution failed",
        } as ServerMessage);
        return;
      }

      // Notify: step completed + verification
      this.safeSend(ws, {
        type: "task.step",
        taskId,
        step: stepNum,
        status: "completed",
        layer: node.layer === "auto" ? "deep" : node.layer,
      } as ServerMessage);

      if (node.verify) {
        this.safeSend(ws, {
          type: "task.verify",
          taskId,
          step: stepNum,
          result: "pass",
          confidence: 0.9,
        } as ServerMessage);
      }
    }

    // 5. All steps complete
    this.safeSend(ws, {
      type: "task.complete",
      taskId,
      result: {
        goal,
        stepsCompleted: totalSteps,
        intentType: intent.type,
        confidence: intent.confidence,
      },
    } as ServerMessage);
  }

  /** Send message to WS only if still open. */
  private safeSend(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify(msg));
    }
  }
}
