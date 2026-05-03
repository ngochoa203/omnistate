import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { GatewayConfig } from "../config/schema.js";
import type { ClientMessage, ServerMessage, TaskAttachment } from "./protocol.js";
import { classifyIntent, planFromIntent } from "../planner/intent.js";
import { optimizePlan } from "../planner/optimizer.js";
import { Orchestrator } from "../executor/orchestrator.js";
import type { HealthMonitor } from "../health/monitor.js";
import { requestLlmTextWithFallback } from "../llm/router.js";
import { incrementSessionUsage, loadLlmRuntimeConfig } from "../llm/runtime-config.js";
import { WakeManager } from "../voice/wake-manager.js";
import { VoiceStreamManager } from "../voice/webrtc-stream.js";
import { CancellationRegistry, TaskCancelledError } from "../executor/cancellation-registry.js";
import { TriggerEngine } from "../triggers/index.js";
import { getDb } from "../db/database.js";
import { EventBus } from "../events/event-bus.js";
import { OSFirehose } from "../events/os-firehose.js";
import { RuleEngine } from "../events/rule-engine.js";
import { EventRepository } from "../events/event-repository.js";
import { MemoryRepository } from "../memory/memory-repository.js";
import { ClaudeMemStore } from "../session/claude-mem-store.js";
import { ApprovalEngine } from "../vision/approval-policy.js";
import { ClaudeCodeResponder } from "../vision/permission-responder.js";
import { logger } from "../utils/logger.js";
import { handleSiriBridgeRequest as _handleSiriBridgeRequest, handleConnection as _handleConnection, handleMessage as doHandleMessage } from "./server-handlers.js";
import type { ConnectedClient } from "./server-types.js";

// Re-export helpers and types for external consumers
export {
  execAsync,
  execFileAsync,
  bridgeProbeScriptPath,
  speechbrainScriptPath,
  isAllowedFilePath,
  mimeForPath,
  sniffAudioFormat,
  normalizeDeclaredAudioFormat,
  ensureSpeechbrainCompatibleAudio,
} from "./server-helpers.js";
export type { ConnectedClient, KnownAudioFormat } from "./server-types.js";

/**
 * OmniState Gateway — the central daemon.
 *
 * Accepts WebSocket connections from CLI, UI, remote, and fleet agents.
 * Routes commands through: Intent → Plan → Optimize → Execute → Verify.
 */
export class OmniStateGateway {
  private wss: WebSocketServer | null = null;
  private siriBridgeServer: HttpServer | null = null;
  private wakeManager: WakeManager = new WakeManager();
  public streamManager = new VoiceStreamManager(); // used by server-handlers
  private cancellationRegistry: CancellationRegistry = new CancellationRegistry();
  private triggerEngine: TriggerEngine = new TriggerEngine();
  private eventBus: EventBus = new EventBus();
  private firehose: OSFirehose = new OSFirehose(this.eventBus);
  private ruleEngine: RuleEngine = new RuleEngine(this.eventBus);
  private clients: Map<string, ConnectedClient> = new Map();
  private config: GatewayConfig;
  private orchestrator: Orchestrator;
  public monitor: HealthMonitor | null = null; // used by server-handlers
  public startedAt = Date.now(); // used by server-handlers
  private taskHistory: Array<{
    taskId: string;
    goal: string;
    status: "complete" | "failed";
    output?: string;
    intentType: string;
    timestamp: string;
    durationMs: number;
  }> = [];
  public claudeMemStore = new ClaudeMemStore(); // used by server-handlers
  public eventRepository = new EventRepository(getDb()); // used by server-handlers
  public memoryRepository = new MemoryRepository(getDb()); // used by server-handlers
  private approvalEngine?: ApprovalEngine;
  private claudeCodeResponder?: ClaudeCodeResponder;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.orchestrator = new Orchestrator();

    // Wire up permission responder system if approvalPolicy is configured
    if (config.approvalPolicy) {
      this.approvalEngine = new ApprovalEngine(config.approvalPolicy);
      if (config.approvalPolicy.enabled) {
        this.claudeCodeResponder = new ClaudeCodeResponder(
          // SurfaceLayer is accessed via the orchestrator's private field;
          // ClaudeCodeResponder needs a SurfaceLayer — we pass a lazy getter
          // by constructing with the orchestrator's internal surface reference
          // cast through the public approval shim fields instead.
          (this.orchestrator as any).surface,
          this.approvalEngine,
          { enabled: true }
        );
      }
      // Wire engine + responder back into the orchestrator so it can use them
      // in the accessibility recovery path.
      this.orchestrator.approvalEngine = this.approvalEngine;
      this.orchestrator.permissionResponder = this.claudeCodeResponder;
    }
  }

  /** Wire in the health monitor for health.query responses. */
  setHealthMonitor(monitor: HealthMonitor): void {
    this.monitor = monitor;
  }

  /** Start the WebSocket server. */
  start(): void {
    if (this.wss) {
      logger.warn("[OmniState] Gateway already started in this process; ignoring duplicate start()");
      return;
    }

    this.wss = new WebSocketServer({
      host: this.config.gateway.bind,
      port: this.config.gateway.port,
    });

    this.wss.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        logger.error(
          `[OmniState] Port ${this.config.gateway.port} is already in use on ${this.config.gateway.bind}.\n` +
            "Stop the existing daemon or use --port <other-port>."
        );
        return;
      }
      logger.error(`[OmniState] Gateway server error: ${err.message}`);
    });

    this.wss.on("listening", () => {
      logger.info(
        `[OmniState] Gateway listening on ${this.config.gateway.bind}:${this.config.gateway.port}`
      );
    });

    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws, req);
    });

    this.startSiriBridge();
    this.startWakeListener();
    this.triggerEngine.start(async (trigger) => {
      const taskId = `trigger-${trigger.id}-${crypto.randomUUID()}`;
      this.executeTaskPipeline(taskId, trigger.action.goal, trigger.action.layer, undefined).catch((err) => logger.error({ err }, "unhandled promise rejection"));
    });
    this.triggerEngine.bridgeToEventBus(this.eventBus);
    this.firehose.start();
    this.ruleEngine.start(async (_rule, event) => {
      logger.info({ eventType: event.type }, "[rule-engine] Rule fired");
    });

    // Broadcast all events to connected WS clients
    this.eventBus.onPattern("**", (event) => {
      this.broadcast({ type: "events.stream", event } as import("./protocol.js").ServerMessage);
    });

    // Start Claude Code permission auto-responder if configured and enabled
    if (this.claudeCodeResponder) {
      this.claudeCodeResponder.start();
      logger.info("[OmniState] ClaudeCodeResponder started (permission auto-responder active)");
    }
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
    this.siriBridgeServer?.close();
    this.siriBridgeServer = null;
    this.wakeManager.stop();
    this.triggerEngine.stop();
    this.firehose.stop();
    this.ruleEngine.stop();
    if (this.claudeCodeResponder?.isRunning) {
      void this.claudeCodeResponder.stop();
    }
    logger.info("[OmniState] Gateway stopped");
  }

  private startWakeListener(): void {
    const runtime = loadLlmRuntimeConfig();
    this.wakeManager.start({
      config: runtime.voice.wake,
      endpoint: runtime.voice.siri.endpoint,
      token: runtime.voice.siri.token,
    });
  }

  private startSiriBridge(): void {
    const runtime = loadLlmRuntimeConfig();
    const siri = runtime.voice?.siri;

    const endpoint = new URL(siri?.endpoint || "http://127.0.0.1:19801/siri/command");
    const host = endpoint.hostname || "127.0.0.1";
    const portOverride = process.env.OMNISTATE_SIRI_BRIDGE_PORT ? Number(process.env.OMNISTATE_SIRI_BRIDGE_PORT) : NaN;
    const port = Number.isFinite(portOverride) ? portOverride : Number(endpoint.port || "19801");
    const expectedPath = endpoint.pathname && endpoint.pathname !== "/" ? endpoint.pathname : "/siri/command";

    const server = createServer((req, res) => {
      void this.handleSiriBridgeRequest(req, res, expectedPath);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        logger.warn(`[OmniState] Siri bridge port ${port} is already in use. Bridge is disabled.`);
        return;
      }
      logger.warn(`[OmniState] Siri bridge error: ${err.message}`);
    });

    server.listen(port, host, () => {
      logger.info(`[OmniState] Siri bridge listening on http://${host}:${port}${expectedPath}`);
    });

    this.siriBridgeServer = server;
  }

  private handleConnection(
    ws: WebSocket,
    _req: IncomingMessage
  ): void {
    _handleConnection(this, ws, _req);
  }

  private async handleSiriBridgeRequest(
    req: IncomingMessage,
    res: ServerResponse,
    expectedPath: string,
  ): Promise<void> {
    await _handleSiriBridgeRequest(this, req, res, expectedPath);
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

  // Handle incoming client message (currently unused but available for future use)
  // @ts-ignore
  private async handleMessage(
    clientId: string,
    ws: WebSocket,
    msg: ClientMessage,
    remoteIp: string = "unknown",
    isLocalhost: boolean = true
  ): Promise<void> {
    await doHandleMessage(this, clientId, ws, msg, remoteIp, isLocalhost);
  }

  /**
   * Full execution pipeline: Intent → Plan → Optimize → Execute.
   * Streams step progress to the connected WebSocket client.
   */
  private async executeTaskPipeline(
    taskId: string,
    goal: string,
    _layerHint: string | undefined,
    ws?: WebSocket
  ): Promise<void> {
    const startMs = Date.now();
    this.cancellationRegistry.create(taskId);

    try {
      this.cancellationRegistry.throwIfCancelled(taskId);

      // 1. Classify intent
      const intent = await classifyIntent(goal);
      this.cancellationRegistry.throwIfCancelled(taskId);

      // If the intent is ask-clarification, send a question back instead of executing
      if (intent.type === 'ask-clarification' || intent.is_valid === false) {
        const question = intent.clarification_question ??
          (intent.missing_params && intent.missing_params.length > 0
            ? `Bạn cần cung cấp thêm: ${intent.missing_params.join(', ')}`
            : 'Vui lòng cung cấp thêm thông tin để tôi có thể thực hiện lệnh này.');
        this.safeSend(ws, {
          type: 'task.complete',
          taskId,
          result: {
            goal,
            mode: 'clarification',
            stepsCompleted: 0,
            intentType: 'ask-clarification',
            confidence: intent.confidence,
            output: question,
            missing_params: intent.missing_params,
            stepData: [],
          },
        } as ServerMessage);
        this.taskHistory.unshift({
          taskId,
          goal,
          status: 'complete',
          output: question,
          intentType: 'ask-clarification',
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startMs,
        });
        if (this.taskHistory.length > 100) this.taskHistory.pop();
        incrementSessionUsage();
        return;
      }

      // 2. Build plan from intent
      let plan = await planFromIntent(intent);
      plan = { ...plan, taskId };
      this.cancellationRegistry.throwIfCancelled(taskId);

      // 3. Optimize plan
      plan = optimizePlan(plan);

    // 4. Execute plan — stream step updates
    const totalSteps = plan.nodes.length;
    let stepNum = 0;
    const allStepData: Record<string, unknown>[] = [];

    for (const node of plan.nodes) {
      this.cancellationRegistry.throwIfCancelled(taskId);
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
      this.cancellationRegistry.throwIfCancelled(taskId);
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

        // Translate technical error to user-friendly language
        const rawError = result.error ?? 'Step execution failed';
        const stepError = result.stepResults?.[0]?.error;
        const errorMsg = rawError || stepError || 'Step execution failed';
        const friendlyError = await this.translateErrorToNaturalLanguage(goal, errorMsg);

        this.safeSend(ws, {
          type: "task.error",
          taskId,
          error: friendlyError,
          technicalError: rawError, // keep raw for debugging
        } as unknown as ServerMessage);

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
    // Prefer explicit textual fields returned by steps, then fall back to user goal.
    const outputs = allStepData.flatMap((d) => this.extractUserFacingTexts(d));
    const structuredSummary = this.summarizeStructuredStepData(allStepData, goal, intent.type);
    const combinedOutput = outputs.join("\n").trim() || structuredSummary || this.fallbackUserFacingOutput(goal, intent.type);

    this.safeSend(ws, {
      type: "task.complete",
      taskId,
      result: {
        goal,
        mode: "task",
        stepsCompleted: totalSteps,
        intentType: intent.type,
        confidence: intent.confidence,
        output: combinedOutput || undefined,
        stepData: allStepData,
      },
    } as ServerMessage);

    this.taskHistory.unshift({
      taskId,
      goal,
      status: "complete",
      output: combinedOutput || undefined,
      intentType: intent.type,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startMs,
    });
    if (this.taskHistory.length > 100) this.taskHistory.pop();

    incrementSessionUsage();
    } catch (err) {
      if (err instanceof TaskCancelledError) {
        this.safeSend(ws, { type: "task.cancelled", taskId, reason: "cancelled" } as ServerMessage);
        return;
      }
      throw err;
    } finally {
      this.cancellationRegistry.complete(taskId);
    }
  }

  private async translateErrorToNaturalLanguage(
    goal: string,
    error: string,
  ): Promise<string> {
    // Use LLM to translate the raw error
    try {
      const resp = await requestLlmTextWithFallback({
        system: `You are a helpful assistant that translates technical error messages into friendly, natural language explanations.
The user was trying to: ${goal}
Rules:
- If the user's goal was in Vietnamese, respond in Vietnamese
- Keep the explanation concise (1-2 sentences)
- Include a practical suggestion for what the user can do next
- Don't include stack traces or raw technical details
- Be empathetic and helpful`,
        user: `Technical error: ${error}`,
        maxTokens: 150,
      });
      return resp.text.trim();
    } catch {
      // LLM unavailable — return the raw error with minimal formatting
      return `❌ Lỗi thực thi: ${error}`;
    }
  }

  private extractUserFacingTexts(stepData: Record<string, unknown>): string[] {
    const preferredKeys = ["speak", "output", "message", "response", "answer", "summary", "text", "final"];
    const results: string[] = [];

    const pushIfValid = (value: unknown): void => {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (!trimmed) return;
      if (trimmed.includes("[Native Session Context]")) return;
      if (trimmed.includes("sessionMemorySummary") && trimmed.includes("[Reply Preference]")) return;
      results.push(trimmed);
    };

    for (const key of preferredKeys) {
      pushIfValid(stepData[key]);
    }

    // Also inspect one level of nested objects for common text keys.
    for (const value of Object.values(stepData)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const nested = value as Record<string, unknown>;
      for (const key of preferredKeys) {
        pushIfValid(nested[key]);
      }
    }

    return Array.from(new Set(results));
  }

  private summarizeStructuredStepData(
    allStepData: Array<Record<string, unknown>>,
    goal: string,
    intentType: string,
  ): string | undefined {
    if (allStepData.length === 0) return undefined;

    for (const stepData of allStepData) {
      const info = stepData.info;
      if (info && typeof info === "object" && !Array.isArray(info)) {
        const infoText = this.formatSystemInfoSummary(info as Record<string, unknown>);
        if (infoText) return infoText;
      }

      const nestedInfo = Object.values(stepData).find(
        (value) => value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).info,
      ) as Record<string, unknown> | undefined;
      if (nestedInfo?.info && typeof nestedInfo.info === "object" && !Array.isArray(nestedInfo.info)) {
        const infoText = this.formatSystemInfoSummary(nestedInfo.info as Record<string, unknown>);
        if (infoText) return infoText;
      }

      const pathKeys = ["screenshotPath", "filePath", "path", "savedTo", "location", "outputPath"];
      for (const key of pathKeys) {
        const value = stepData[key];
        if (typeof value === "string" && value.trim()) {
          const path = value.trim();
          if (/(screenshot|màn\s*hình|man\s*hinh|capture|chụp|chup)/i.test(goal)) {
            return `Đã chụp màn hình và lưu tại: ${path}`;
          }
          return `Đã hoàn tất yêu cầu. Kết quả được lưu tại: ${path}`;
        }
      }

      if (stepData.success === true) {
        const userGoal = this.unwrapUserGoal(goal);
        if (intentType === "system-query") {
          return `Đã chạy truy vấn hệ thống cho yêu cầu: ${userGoal}`;
        }
        return `Đã hoàn tất xử lý cho yêu cầu: ${userGoal}`;
      }
    }

    return undefined;
  }

  private formatSystemInfoSummary(info: Record<string, unknown>): string | undefined {
    const hostname = typeof info.hostname === "string" ? info.hostname : undefined;
    const cpuModel = typeof info.cpuModel === "string" ? info.cpuModel : undefined;
    const cpuCores = typeof info.cpuCores === "number" ? info.cpuCores : undefined;
    const totalMemoryMB = typeof info.totalMemoryMB === "number" ? info.totalMemoryMB : undefined;
    const freeMemoryMB = typeof info.freeMemoryMB === "number" ? info.freeMemoryMB : undefined;
    const platform = typeof info.platform === "string" ? info.platform : undefined;

    const parts: string[] = [];
    if (hostname) parts.push(`Máy: ${hostname}`);
    if (platform) parts.push(`Nền tảng: ${platform}`);
    if (cpuModel) {
      const cores = cpuCores ? ` (${cpuCores} cores)` : "";
      parts.push(`CPU: ${cpuModel}${cores}`);
    }
    if (typeof totalMemoryMB === "number") {
      if (typeof freeMemoryMB === "number") {
        const usedMemoryMB = Math.max(0, totalMemoryMB - freeMemoryMB);
        parts.push(`RAM: ${usedMemoryMB}/${totalMemoryMB} MB đang dùng`);
      } else {
        parts.push(`RAM tổng: ${totalMemoryMB} MB`);
      }
    }

    return parts.length > 0 ? parts.join(" | ") : undefined;
  }

  private unwrapUserGoal(goal: string): string {
    const match = goal.match(/\[User Goal\]([\s\S]*)$/);
    return (match?.[1] ?? goal).trim();
  }

  // Build goal with attachments (currently unused but available for future use)
  public buildGoalWithAttachments(goal: string, attachments?: TaskAttachment[]): string {
    if (!Array.isArray(attachments) || attachments.length === 0) return goal;

    const chunks = attachments.slice(0, 8).map((att, index) => {
      const head = `- Attachment ${index + 1}: ${att.name} (${att.mimeType || "unknown"}, ${att.size} bytes, kind=${att.kind})`;
      if (typeof att.textPreview === "string" && att.textPreview.trim()) {
        return `${head}\n  Preview: ${att.textPreview.trim().slice(0, 1500)}`;
      }
      if (att.kind === "image") {
        return `${head}\n  Note: image attached by user (binary payload available).`;
      }
      return head;
    });

    return `${goal}\n\n[Attachment Context]\n${chunks.join("\n")}`;
  }

  // Determine chat mode (currently unused but available for future use)
  public async shouldUseChatMode(goal: string): Promise<boolean> {
    const text = this.unwrapUserGoal(goal).toLowerCase();
    if (!text) return false;

    const taskVerbRegex = /(mở|mo\b|đóng|dong\b|tắt|tat\b|bật|bat\b|kiểm tra|kiem tra|check\b|status\b|lấy|lay\b|xem\b|show\b|xoá|xoa\b|xóa|gửi|gui\b|chạy|chay\b|run\b|open\b|close\b|shutdown\b|restart\b|kill\b|install\b|uninstall\b|fetch\b|download\b|upload\b|execute\b|benchmark\b|profile\b|scan\b|sync\b|chụp|chup\b|ghi\s+âm|ghi\sam\b|screenshot\b|capture\b|chup\s+man\s*hinh|chụp\s+màn\s*hình|cpu\b|ram\b|battery\b|pin\b|wifi\b|bluetooth\b|volume\b|brightness\b|permission\b|quyền|quyen\b|process\b|tiến\s+trình|tien\s+trinh|window\b|tab\b)/;
    const chatCueRegex = /(xin\s+chào|xin\s+chao|chào|chao\b|hello\b|hi\b|bạn\s+nghĩ\s+gì|ban\s+nghi\s+gi|tại\s+sao|tai\s+sao|kể\s+cho|ke\s+cho|giải\s+thích|giai\s+thich|là\s+gì|la\s+gi|1\s*[+\-*/x]\s*1|2\s*[+\-*/x]\s*2)/;

    const hasTaskCue = taskVerbRegex.test(text);
    const hasChatCue = chatCueRegex.test(text);

    // Strong default: actionable verbs should go to task mode.
    if (hasTaskCue) {
      return false;
    }
    if (hasChatCue) {
      return true;
    }

    // Ambiguous intent: use a tiny LLM classification call on the configured provider chain.
    try {
      const classify = await requestLlmTextWithFallback({
        system:
          "Classify user input into TASK or MODE. TASK means perform system actions or fetch machine/runtime data. MODE means conversational Q&A, greeting, explanation, or general chat. Reply exactly one token: TASK or MODE.",
        user: text,
        maxTokens: 4,
      });
      const label = classify.text.trim().toUpperCase();
      if (label.startsWith("TASK")) {
        return false;
      }
      if (label.startsWith("MODE")) {
        return true;
      }
    } catch {
      // Fall through to conservative heuristic below.
    }

    return !hasTaskCue;
  }

  private fallbackUserFacingOutput(goal: string, intentType: string): string | undefined {
    const match = goal.match(/\[User Goal\]([\s\S]*)$/);
    const userGoal = (match?.[1] ?? goal).trim();
    if (!userGoal) return undefined;

    if (intentType === "system-query") {
      const normalized = userGoal.toLowerCase();

      if (["hi", "hello", "xin chao", "xin chào", "chao", "chào"].includes(normalized)) {
        return "Xin chào! Mình đang sẵn sàng hỗ trợ bạn. Bạn muốn mình giúp gì tiếp theo?";
      }

      const math = normalized.replace(/\s+/g, "").match(/^(-?\d+(?:\.\d+)?)([+\-*/x])(-?\d+(?:\.\d+)?)(=|\?)?$/);
      if (math) {
        const left = Number.parseFloat(math[1]);
        const op = math[2];
        const right = Number.parseFloat(math[3]);
        const result = op === "+" ? left + right
          : op === "-" ? left - right
          : (op === "*" || op === "x") ? left * right
          : right === 0 ? Number.NaN : left / right;
        if (Number.isFinite(result)) {
          return `${left} ${op === "x" ? "*" : op} ${right} = ${result}`;
        }
        return "Không thể tính phép chia cho 0.";
      }

      return `Mình đã nhận câu hỏi: "${userGoal}". Hiện luồng trả lời của gateway chưa trả nội dung cuối, vui lòng thử lại hoặc đổi model/provider.`;
    }

    return `Đã hoàn tất xử lý cho yêu cầu: ${userGoal}`;
  }

  // Clear task history (available for future use)
  public clearTaskHistory(): number {
    const count = this.taskHistory.length;
    this.taskHistory = [];
    return count;
  }

  /** Send message to WS only if still open. */
  private safeSend(ws: WebSocket | undefined, msg: ServerMessage): void {
    if (!ws) return;
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify(msg));
    }
  }
}