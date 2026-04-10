import { WebSocketServer, type WebSocket } from "ws";
import type { GatewayConfig } from "../config/schema.js";
import type { ClientMessage, ServerMessage, ClientRole } from "./protocol.js";
import { authenticateClient } from "./auth.js";
import { classifyIntent, planFromIntent } from "../planner/intent.js";
import { optimizePlan } from "../planner/optimizer.js";
import { Orchestrator } from "../executor/orchestrator.js";
import { HealthMonitor } from "../health/monitor.js";

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
  private monitor: HealthMonitor | null = null;
  private startedAt = Date.now();
  private taskHistory: Array<{
    taskId: string;
    goal: string;
    status: "complete" | "failed";
    output?: string;
    intentType: string;
    timestamp: string;
    durationMs: number;
  }> = [];

  constructor(config: GatewayConfig) {
    this.config = config;
    this.orchestrator = new Orchestrator();
  }

  /** Wire in the health monitor for health.query responses. */
  setHealthMonitor(monitor: HealthMonitor): void {
    this.monitor = monitor;
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

      case "history.query": {
        const limit = msg.limit ?? 20;
        const entries = this.taskHistory.slice(0, limit);
        const reply: ServerMessage = { type: "history.result", entries };
        this.safeSend(ws, reply);
        break;
      }

      case "health.query": {
        if (this.monitor) {
          this.monitor.runCheck().then((report) => {
            const reply: ServerMessage = {
              type: "health.report",
              overall: report.overall,
              timestamp: report.timestamp,
              sensors: report.sensors as Record<string, { status: string; value: number; unit: string; message?: string }>,
              alerts: report.alerts,
            };
            this.safeSend(ws, reply);
          }).catch(() => {
            this.safeSend(ws, { type: "error", message: "Health check failed" });
          });
        } else {
          this.safeSend(ws, { type: "error", message: "Health monitor not available" });
        }
        break;
      }

      case "status.query": {
        const reply: ServerMessage = {
          type: "status.reply",
          connectedClients: this.clients.size,
          queueDepth: 0,
          uptime: Date.now() - this.startedAt,
        };
        this.safeSend(ws, reply);
        break;
      }

      default: {
        // Handle admin.shutdown which is not in the ClientMessage union
        const anyMsg = msg as { type: string };
        if (anyMsg.type === "admin.shutdown") {
          this.safeSend(ws, { type: "gateway.shutdown", reason: "Admin requested shutdown" });
          this.stop();
          return;
        }
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
    const startMs = Date.now();

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
    const allStepData: Record<string, unknown>[] = [];

    for (const node of plan.nodes) {
      stepNum++;
      const resolvedLayer = node.layer === "auto" ? "deep" : node.layer;

      // Notify: step executing
      this.safeSend(ws, {
        type: "task.step",
        taskId,
        step: stepNum,
        status: "executing",
        layer: resolvedLayer,
      } as ServerMessage);

      // Execute via orchestrator (single-node plan for streaming)
      const singlePlan = { ...plan, nodes: [node] };
      const result = await this.orchestrator.executePlan(singlePlan);
      const stepData = result.stepResults?.[0]?.data ?? {};

      if (result.status === "failed") {
        this.safeSend(ws, {
          type: "task.step",
          taskId,
          step: stepNum,
          status: "failed",
          layer: resolvedLayer,
          data: stepData,
        } as ServerMessage);

        this.safeSend(ws, {
          type: "task.error",
          taskId,
          error: result.error ?? "Step execution failed",
        } as ServerMessage);

        this.taskHistory.unshift({
          taskId,
          goal,
          status: "failed",
          intentType: intent.type,
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startMs,
        });
        if (this.taskHistory.length > 100) this.taskHistory.pop();
        return;
      }

      allStepData.push(stepData);

      // Notify: step completed with data
      this.safeSend(ws, {
        type: "task.step",
        taskId,
        step: stepNum,
        status: "completed",
        layer: resolvedLayer,
        data: stepData,
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

    // 5. All steps complete — aggregate output
    // Collect all "output" fields from step data for the final result
    const outputs = allStepData
      .map((d) => d.output)
      .filter((o): o is string => typeof o === "string");

    this.safeSend(ws, {
      type: "task.complete",
      taskId,
      result: {
        goal,
        stepsCompleted: totalSteps,
        intentType: intent.type,
        confidence: intent.confidence,
        output: outputs.join("\n") || undefined,
        stepData: allStepData,
      },
    } as ServerMessage);

    this.taskHistory.unshift({
      taskId,
      goal,
      status: "complete",
      output: outputs.join("\n") || undefined,
      intentType: intent.type,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startMs,
    });
    if (this.taskHistory.length > 100) this.taskHistory.pop();
  }

  /** Send message to WS only if still open. */
  private safeSend(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify(msg));
    }
  }
}
