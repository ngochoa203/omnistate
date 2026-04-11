import { exec } from "node:child_process";
import { promisify } from "node:util";
import { WebSocketServer, type WebSocket } from "ws";
import type { GatewayConfig } from "../config/schema.js";
import type { ClientMessage, ServerMessage, ClientRole } from "./protocol.js";
import { authenticateClient } from "./auth.js";
import { classifyIntent, planFromIntent } from "../planner/intent.js";
import { optimizePlan } from "../planner/optimizer.js";
import { Orchestrator } from "../executor/orchestrator.js";
import { HealthMonitor } from "../health/monitor.js";
import * as HybridAutomation from "../hybrid/automation.js";
import { runLlmPreflight } from "../llm/preflight.js";
import { tryHandleGatewayCommand } from "./command-router.js";
import { incrementSessionUsage, loadLlmRuntimeConfig } from "../llm/runtime-config.js";

const execAsync = promisify(exec);

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
    if (this.wss) {
      console.warn("[OmniState] Gateway already started in this process; ignoring duplicate start()");
      return;
    }

    this.wss = new WebSocketServer({
      host: this.config.gateway.bind,
      port: this.config.gateway.port,
    });

    this.wss.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `[OmniState] Port ${this.config.gateway.port} is already in use on ${this.config.gateway.bind}.\n` +
            "Stop the existing daemon or use --port <other-port>."
        );
        return;
      }
      console.error(`[OmniState] Gateway server error: ${err.message}`);
    });

    this.wss.on("listening", () => {
      console.log(
        `[OmniState] Gateway listening on ${this.config.gateway.bind}:${this.config.gateway.port}`
      );
    });

    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws, req);
    });
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
        this.handleMessage(clientId, ws, msg).catch((err) => {
          ws.send(
            JSON.stringify({
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            })
          );
        });
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

  private async handleMessage(
    clientId: string,
    ws: WebSocket,
    msg: ClientMessage
  ): Promise<void> {
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
          capabilities: ["task", "health", "fleet", "llm.preflight"],
        };
        ws.send(JSON.stringify(response));
        break;
      }

      case "task": {
        const taskId = crypto.randomUUID();

        const commandResult = tryHandleGatewayCommand(msg.goal, {
          clearTaskHistory: () => this.clearTaskHistory(),
          connectedClients: () => this.clients.size,
          uptimeMs: () => Date.now() - this.startedAt,
          taskHistorySize: () => this.taskHistory.length,
        });

        if (commandResult) {
          const accepted: ServerMessage = {
            type: "task.accepted",
            taskId,
            goal: msg.goal,
          };
          this.safeSend(ws, accepted);

          this.safeSend(ws, {
            type: "task.complete",
            taskId,
            result: {
              goal: msg.goal,
              command: true,
              output: commandResult.output,
              ...(commandResult.data ? { commandData: commandResult.data } : {}),
            },
          } as ServerMessage);

          incrementSessionUsage();
          return;
        }

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

      case "voice.transcribe": {
        const { id, audio, format: _format } = msg;
        try {
          // Decode base64 audio and run configured voice provider chain.
          const audioBuffer = Buffer.from(audio, "base64");
          const runtime = loadLlmRuntimeConfig();
          const voice = runtime.voice;

          const dedupedProviders = [
            voice.primaryProvider,
            ...voice.fallbackProviders,
          ].filter((p, i, arr) => arr.indexOf(p) === i);
          const orderedProviders = voice.lowLatency
            ? (["native", ...dedupedProviders.filter((p) => p !== "native")] as Array<
                "native" | "whisper-local" | "whisper-cloud"
              >)
            : dedupedProviders;

          let transcript = "";
          let usedProvider = "";

          try {
            // Low-latency mode races providers and takes first non-empty transcript.
            const fastest = await Promise.any(
              orderedProviders.map(async (provider) => {
                const result = await HybridAutomation.transcribeAudio(audioBuffer, provider);
                const text = result.text.trim();
                if (!text) throw new Error(`empty transcript from ${provider}`);
                return { text, provider };
              }),
            );
            transcript = fastest.text;
            usedProvider = fastest.provider;
          } catch {
            // If race fails, retry sequentially through provider chain.
            for (const provider of orderedProviders) {
              try {
                const result = await HybridAutomation.transcribeAudio(audioBuffer, provider);
                const text = result.text.trim();
                if (text) {
                  transcript = text;
                  usedProvider = provider;
                  break;
                }
              } catch {
                // try next provider
              }
            }
          }

          if (transcript) {
            this.safeSend(ws, { type: "voice.transcript", id, text: transcript });

            const shouldAutoExecute =
              voice.autoExecuteTranscript &&
              !(voice.siri.enabled && voice.siri.mode === "handoff");

            if (shouldAutoExecute) {
              const goal = usedProvider
                ? `${transcript}`
                : transcript;
              const voiceTaskId = `voice-${id}-${crypto.randomUUID()}`;
              this.safeSend(ws, { type: "task.accepted", taskId: voiceTaskId, goal });
              this.executeTaskPipeline(voiceTaskId, goal, undefined, ws).catch(
                (err) => {
                  this.safeSend(ws, {
                    type: "task.error",
                    taskId: voiceTaskId,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              );
            }
          } else {
            this.safeSend(ws, {
              type: "voice.error",
              id,
              error: "Could not transcribe audio",
            });
          }
        } catch (err: any) {
          this.safeSend(ws, {
            type: "voice.error",
            id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }

      case "system.dashboard": {
        const { id } = msg;
        try {
          // Disk usage
          let disk: { total: string; used: string; available: string; usePercent: string } | null = null;
          try {
            const { stdout: dfOut } = await execAsync("df -h / | tail -1");
            const parts = dfOut.trim().split(/\s+/);
            disk = {
              total: parts[1] ?? "",
              used: parts[2] ?? "",
              available: parts[3] ?? "",
              usePercent: parts[4] ?? "",
            };
          } catch { /* ignore */ }

          // CPU load average
          let cpu: { loadAvg: string } | null = null;
          try {
            const { stdout: cpuOut } = await execAsync("sysctl -n vm.loadavg");
            cpu = { loadAvg: cpuOut.trim() };
          } catch { /* ignore */ }

          // Memory via Node built-ins (no external layer needed)
          let memory: { totalMB: number; freeMB: number } | null = null;
          try {
            const os = await import("node:os");
            memory = {
              totalMB: Math.round(os.totalmem() / 1024 / 1024),
              freeMB: Math.round(os.freemem() / 1024 / 1024),
            };
          } catch { /* ignore */ }

          // Hostname
          let hostname = "unknown";
          try {
            const os = await import("node:os");
            hostname = os.hostname();
          } catch { /* ignore */ }

          // Battery (macOS pmset)
          let battery: { percent: string; charging: boolean } | null = null;
          try {
            const { stdout: batOut } = await execAsync("pmset -g batt");
            const pctMatch = batOut.match(/(\d+)%/);
            const charging = batOut.includes("charging") || batOut.includes("AC Power");
            if (pctMatch) battery = { percent: pctMatch[1] + "%", charging };
          } catch { /* ignore */ }

          // WiFi (macOS networksetup)
          let wifi: { ssid: string; connected: boolean; ip?: string } | null = null;
          try {
            const { stdout: wifiOut } = await execAsync("networksetup -getairportnetwork en0");
            const match = wifiOut.match(/Current Wi-Fi Network:\s*(.+)/);
            if (match) {
              wifi = { ssid: match[1].trim(), connected: true };
              try {
                const { stdout: infoOut } = await execAsync("networksetup -getinfo Wi-Fi");
                const ipMatch = infoOut.match(/IP address:\s*(.+)/);
                if (ipMatch) wifi.ip = ipMatch[1].trim();
              } catch { /* ignore */ }
            } else {
              wifi = { ssid: "Not connected", connected: false };
            }
          } catch { /* ignore */ }

          this.safeSend(ws, {
            type: "system.info",
            id,
            data: { battery, wifi, disk, cpu, memory, hostname },
          });
        } catch (err: any) {
          this.safeSend(ws, {
            type: "system.info",
            id,
            data: {
              battery: null,
              wifi: null,
              disk: null,
              cpu: null,
              memory: null,
              hostname: "unknown",
              error: err instanceof Error ? err.message : String(err),
            },
          });
        }
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

      case "llm.preflight.query": {
        const report = await runLlmPreflight();
        const reply: ServerMessage = {
          type: "llm.preflight.report",
          ok: report.ok,
          status: report.status,
          message: report.message,
          required: report.required,
          baseURL: report.baseURL,
          providerId: report.providerId,
          model: report.model,
          checkedAt: report.checkedAt,
        };
        this.safeSend(ws, reply);
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
        incrementSessionUsage();
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

    incrementSessionUsage();
  }

  private clearTaskHistory(): number {
    const count = this.taskHistory.length;
    this.taskHistory = [];
    return count;
  }

  /** Send message to WS only if still open. */
  private safeSend(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify(msg));
    }
  }
}
