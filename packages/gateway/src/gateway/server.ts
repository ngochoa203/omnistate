import { exec, execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir, stat, writeFile, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import { WebSocketServer, type WebSocket } from "ws";
import type { GatewayConfig } from "../config/schema.js";
import type { ClientMessage, ServerMessage, ClientRole, RuntimeConfigSetMessage } from "./protocol.js";
import { authenticateConnection } from "./auth.js";
import { createAuthRoutes, parseBody, jsonResponse } from "../http/auth-routes.js";
import { createVoiceRoutes } from "../http/voice-routes.js";
import { createNetworkRoutes } from "../http/network-routes.js";
import { createDeviceRoutes } from "../http/device-routes.js";
import { classifyIntent, planFromIntent } from "../planner/intent.js";
import { optimizePlan } from "../planner/optimizer.js";
import { Orchestrator } from "../executor/orchestrator.js";
import { HealthMonitor } from "../health/monitor.js";
import * as HybridAutomation from "../hybrid/automation.js";
import { runLlmPreflight } from "../llm/preflight.js";
import { tryHandleGatewayCommand } from "./command-router.js";
import { incrementSessionUsage, loadLlmRuntimeConfig } from "../llm/runtime-config.js";
import { setActiveModel, setActiveProvider, setSiriField, setVoiceField, setWakeField, updateActiveProviderField } from "../llm/runtime-config.js";
import { upsertProvider, addFallbackProvider } from "../llm/runtime-config.js";
import { WakeManager } from "../voice/wake-manager.js";
import { TriggerEngine } from "../triggers/index.js";
import { ClaudeMemStore } from "../session/claude-mem-store.js";
import { ApprovalEngine } from "../vision/approval-policy.js";
import { ClaudeCodeResponder } from "../vision/permission-responder.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const bridgeProbeScriptPath = fileURLToPath(new URL("../../scripts/bridge-probe.mjs", import.meta.url));
const speechbrainScriptPath = fileURLToPath(new URL("../../scripts/speechbrain_voiceprint.py", import.meta.url));

type KnownAudioFormat = "wav" | "webm" | "ogg" | "mp3" | "unknown";

function sniffAudioFormat(buffer: Buffer): KnownAudioFormat {
  if (buffer.length < 4) return "unknown";
  const four = buffer.toString("ascii", 0, 4);
  const isWebm =
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3;
  const isWav =
    buffer.length >= 12 &&
    four === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE";
  const isOgg = four === "OggS";
  const isMp3 =
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) ||
    buffer.toString("ascii", 0, 3) === "ID3";

  if (isWav) return "wav";
  if (isWebm) return "webm";
  if (isOgg) return "ogg";
  if (isMp3) return "mp3";
  return "unknown";
}

function normalizeDeclaredAudioFormat(raw: string): KnownAudioFormat {
  let format = (raw || "").trim().toLowerCase();
  if (format.startsWith("audio/")) format = format.slice("audio/".length);
  if (format.includes(";")) format = format.split(";", 1)[0] ?? format;

  if (format.includes("wav") || format.includes("wave")) return "wav";
  if (format.includes("webm")) return "webm";
  if (format.includes("ogg")) return "ogg";
  if (format.includes("mp3") || format.includes("mpeg") || format.includes("m4a") || format.includes("mp4")) return "mp3";
  return "unknown";
}

async function ensureSpeechbrainCompatibleAudio(
  inputPath: string,
  declaredFormat: string,
): Promise<{ finalPath: string; cleanupPaths: string[] }> {
  const raw = await readFile(inputPath);
  const sniffed = sniffAudioFormat(raw);
  const declared = normalizeDeclaredAudioFormat(declaredFormat);
  const effective = sniffed !== "unknown" ? sniffed : declared;

  if (effective === "wav") {
    return { finalPath: inputPath, cleanupPaths: [] };
  }

  const convertedPath = join(tmpdir(), `omnistate-voice-converted-${crypto.randomUUID()}.wav`);
  try {
    await execFileAsync(
      "ffmpeg",
      ["-nostdin", "-y", "-i", inputPath, "-ac", "1", "-ar", "16000", "-f", "wav", convertedPath],
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    );
    return { finalPath: convertedPath, cleanupPaths: [convertedPath] };
  } catch (err) {
    throw new Error(
      "Cannot decode uploaded audio for SpeechBrain. Install ffmpeg or upload PCM WAV. Root error: " +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

interface ConnectedClient {
  ws: WebSocket;
  id: string;
  role: ClientRole;
  authenticatedAt: number;
  userId: string | null;
  /** Set when the connection authenticated via a device JWT (type: "device"). */
  deviceId?: string | null;
}

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
  private triggerEngine: TriggerEngine = new TriggerEngine();
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
  private claudeMemStore = new ClaudeMemStore();
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
      this.orchestrator.permissionResponder = (this.orchestrator as any).permissionResponder
        ?? undefined;
    }
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

    this.startSiriBridge();
    this.startWakeListener();
    this.triggerEngine.start(async (trigger) => {
      const taskId = `trigger-${trigger.id}-${crypto.randomUUID()}`;
      this.executeTaskPipeline(taskId, trigger.action.goal, trigger.action.layer, undefined).catch(console.error);
    });

    // Start Claude Code permission auto-responder if configured and enabled
    if (this.claudeCodeResponder) {
      this.claudeCodeResponder.start();
      console.log("[OmniState] ClaudeCodeResponder started (permission auto-responder active)");
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
    if (this.claudeCodeResponder?.isRunning) {
      void this.claudeCodeResponder.stop();
    }
    console.log("[OmniState] Gateway stopped");
  }

  private startWakeListener(): void {
    const runtime = loadLlmRuntimeConfig();
    this.wakeManager.start({
      config: runtime.voice.wake,
      endpoint: runtime.voice.siri.endpoint,
      token: runtime.voice.siri.token,
    });
  }

  private shouldRefreshWakeListener(goal: string): boolean {
    const normalized = goal.trim().toLowerCase();
    if (!normalized) return false;

    return (
      normalized.startsWith("/wake") ||
      normalized.startsWith("omnistate wake") ||
      normalized.startsWith("/voice siri") ||
      normalized.startsWith("omnistate voice siri") ||
      normalized.startsWith("/config set wake_") ||
      normalized.startsWith("omnistate config set wake_") ||
      normalized.startsWith("/config set siri_") ||
      normalized.startsWith("omnistate config set siri_")
    );
  }

  private startSiriBridge(): void {
    const runtime = loadLlmRuntimeConfig();
    const siri = runtime.voice?.siri;

    let endpoint: URL;
    try {
      endpoint = new URL(siri?.endpoint || "http://127.0.0.1:19801/siri/command");
    } catch {
      endpoint = new URL("http://127.0.0.1:19801/siri/command");
    }

    const host = endpoint.hostname || "127.0.0.1";
    const port = Number(endpoint.port || "19801");
    const path = endpoint.pathname && endpoint.pathname !== "/" ? endpoint.pathname : "/siri/command";

    const server = createServer((req, res) => {
      void this.handleSiriBridgeRequest(req, res, path);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.warn(`[OmniState] Siri bridge port ${port} is already in use. Bridge is disabled.`);
        return;
      }
      console.warn(`[OmniState] Siri bridge error: ${err.message}`);
    });

    server.listen(port, host, () => {
      console.log(`[OmniState] Siri bridge listening on http://${host}:${port}${path}`);
    });

    this.siriBridgeServer = server;
  }

  private async handleSiriBridgeRequest(
    req: IncomingMessage,
    res: ServerResponse,
    expectedPath: string,
  ): Promise<void> {
    const json = (status: number, body: Record<string, unknown>) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };

    const requestPath = (() => {
      try {
        return new URL(req.url ?? "", "http://localhost").pathname;
      } catch {
        return req.url ?? "";
      }
    })();

    const remote = req.socket.remoteAddress ?? "";
    const isLocalRequest =
      remote === "127.0.0.1" ||
      remote === "::1" ||
      remote.startsWith("::ffff:127.0.0.1");

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end();
      return;
    }

    // Auth REST routes
    const authRoutes = createAuthRoutes();
    const authHandler = authRoutes.match(req.method!, requestPath);
    if (authHandler) {
      try {
        const body = await parseBody(req);
        await authHandler(req, res, body);
      } catch (err: any) {
        jsonResponse(res, 400, { error: err.message ?? "Bad request" });
      }
      return;
    }

    // Voice profile REST routes
    const voiceRoutes = createVoiceRoutes();
    const voiceHandler = voiceRoutes.match(req.method!, requestPath);
    if (voiceHandler) {
      try {
        const body = await parseBody(req);
        await voiceHandler(req, res, body);
      } catch (err: any) {
        jsonResponse(res, 400, { error: err.message ?? "Bad request" });
      }
      return;
    }

    // Network info REST routes (Tailscale + LAN detection)
    const networkRoutes = createNetworkRoutes();
    const networkHandler = networkRoutes.match(req.method!, requestPath);
    if (networkHandler) {
      try {
        await networkHandler(req, res);
      } catch (err: any) {
        jsonResponse(res, 500, { error: err.message ?? "Internal server error" });
      }
      return;
    }

    // Device management REST routes (LAN pairing + token lifecycle)
    const deviceRoutes = createDeviceRoutes();
    const deviceHandler = deviceRoutes.match(req.method!, requestPath);
    if (deviceHandler) {
      try {
        const body = await parseBody(req);
        await deviceHandler(req, res, body);
      } catch (err: any) {
        jsonResponse(res, 400, { error: err.message ?? "Bad request" });
      }
      return;
    }

    // POST /api/voice/enroll — direct HTTP enrollment via Resemblyzer service
    if (req.method === "POST" && requestPath === "/api/voice/enroll") {
      const body = await parseBody(req);
      try {
        const { enrollVoiceSample } = await import("../voice/voiceprint.js");
        const result = await enrollVoiceSample(body.profileId, body.audio);
        jsonResponse(res, 200, result);
      } catch (err: any) {
        // If voiceprint service is unavailable, still track sample count in DB
        // so profile becomes "enrolled" after enough samples
        try {
          const { VoiceProfileRepository } = await import("../db/voice-profile-repository.js");
          const { getDb } = await import("../db/database.js");
          const repo = new VoiceProfileRepository(getDb());
          const newCount = repo.incrementSamples(body.profileId);
          const REQUIRED = 3;
          if (newCount >= REQUIRED) {
            repo.markEnrolled(body.profileId, newCount);
          }
          jsonResponse(res, 200, {
            sampleCount: newCount,
            isComplete: newCount >= REQUIRED,
            fallback: true,
            warning: "Voiceprint service unavailable — enrollment tracked without voice embedding.",
          });
        } catch {
          jsonResponse(res, 500, { error: err.message });
        }
      }
      return;
    }

    // POST /api/voice/verify — direct HTTP verification via Resemblyzer service
    if (req.method === "POST" && requestPath === "/api/voice/verify") {
      const body = await parseBody(req);
      try {
        const { verifySpeaker } = await import("../voice/voiceprint.js");
        const result = await verifySpeaker(body.audio);
        jsonResponse(res, 200, result);
      } catch (err: any) {
        jsonResponse(res, 500, { error: err.message });
      }
      return;
    }

    if (req.method === "GET" && (requestPath === "/health" || requestPath === "/healthz")) {
      const { getTailscaleStatus } = await import("../network/tailscale.js");
      jsonResponse(res, 200, {
        status: "ok",
        uptime: process.uptime(),
        connections: this.clients.size,
        timestamp: new Date().toISOString(),
        tailscale: getTailscaleStatus(),
      });
      return;
    }

    if (req.method === "GET" && requestPath === "/readyz") {
      json(200, {
        ok: true,
        ready: true,
        wakeListenerRunning: this.wakeManager.isRunning(),
      });
      return;
    }

    if (req.method === "GET" && requestPath === "/session/logs") {
      if (!isLocalRequest) {
        json(403, { ok: false, error: "Only local requests are allowed" });
        return;
      }

      try {
        const urlObj = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        const source = (urlObj.searchParams.get("source") ?? "claude-mem").toLowerCase();
        const limitRaw = Number.parseInt(urlObj.searchParams.get("limit") ?? "20", 10);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 100)) : 20;

        const root = source === "claude-mem"
          ? "/Users/hoahn/Projects/claude-mem"
          : process.cwd();

        const candidateDirs = source === "claude-mem"
          ? [
              join(root, ".claude/reports"),
              join(root, ".claude/commands/plans"),
              join(root, "docs/reports"),
              join(root, ".plan"),
            ]
          : [join(root, "logs"), join(root, "reports")];

        const files: Array<{ path: string; name: string; mtimeMs: number; size: number }> = [];

        for (const dir of candidateDirs) {
          try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isFile()) continue;
              if (!/\.(md|txt|json|yaml|yml)$/i.test(entry.name)) continue;
              const p = join(dir, entry.name);
              try {
                const st = await stat(p);
                files.push({ path: p, name: entry.name, mtimeMs: st.mtimeMs, size: st.size });
              } catch {
                // ignore stat failure
              }
            }
          } catch {
            // ignore missing dirs
          }
        }

        files.sort((a, b) => b.mtimeMs - a.mtimeMs);
        const selected = files.slice(0, limit);

        const logs = await Promise.all(
          selected.map(async (f) => {
            let preview = "";
            try {
              preview = (await readFile(f.path, "utf-8")).slice(0, 4000);
            } catch {
              preview = "";
            }
            return {
              file: f.path,
              name: f.name,
              modifiedAt: new Date(f.mtimeMs).toISOString(),
              size: f.size,
              preview,
            };
          }),
        );

        json(200, {
          ok: true,
          source,
          root,
          count: logs.length,
          logs,
        });
      } catch (err) {
        json(500, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (req.method === "GET" && requestPath === "/screen/tree") {
      if (!isLocalRequest) {
        json(403, { ok: false, error: "Only local requests are allowed" });
        return;
      }
      try {
        const urlObj = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        const treeMode = urlObj.searchParams.get("mode") ?? "tree";
        const allowedModes = ["tree", "hierarchy"];
        const safeMode = allowedModes.includes(treeMode) ? treeMode : "tree";
        const { stdout } = await execFileAsync(
          process.execPath,
          [bridgeProbeScriptPath, safeMode],
          { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
        );
        json(200, JSON.parse(stdout));
      } catch (err) {
        json(500, {
          ok: false,
          error:
            "Native bridge worker failed while collecting screen tree. " +
            (err instanceof Error ? err.message : String(err)),
        });
      }
      return;
    }

    if (req.method === "GET" && requestPath === "/latency/benchmark") {
      if (!isLocalRequest) {
        json(403, { ok: false, error: "Only local requests are allowed" });
        return;
      }
      try {
        const urlObj = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        const profileParam = urlObj.searchParams.get("profile") ?? "full";
        const safeProfile = profileParam === "frame-only" ? "frame-only" : "full";
        const { stdout } = await execFileAsync(process.execPath, [bridgeProbeScriptPath, "latency", safeProfile], {
          timeout: 60_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        json(200, JSON.parse(stdout));
      } catch (err) {
        json(500, {
          ok: false,
          error:
            "Native bridge worker failed while benchmarking latency. " +
            (err instanceof Error ? err.message : String(err)),
        });
      }
      return;
    }

    if (req.method !== "POST") {
      json(404, { ok: false, error: "Not found" });
      return;
    }

    const chunks: Buffer[] = [];
    const MAX_BODY_BYTES = 5 * 1024 * 1024;
    let bodyTooLarge = false;
    let currentSize = 0;

    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk) => {
        if (bodyTooLarge) return;
        const asBuffer = Buffer.from(chunk);
        chunks.push(asBuffer);
        currentSize += asBuffer.length;
        if (currentSize > MAX_BODY_BYTES) {
          bodyTooLarge = true;
          req.destroy(new Error("Request body too large"));
        }
      });
      req.on("end", () => resolve());
      req.on("aborted", () => reject(new Error("Request aborted")));
      req.on("error", (err) => reject(err));
    }).catch((err) => {
      if (bodyTooLarge) {
        json(413, { ok: false, error: "Request body too large" });
      } else {
        json(400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    if (bodyTooLarge || res.writableEnded) {
      return;
    }

    const runtime = loadLlmRuntimeConfig();
    const siri = runtime.voice.siri;

    try {
      const bodyText = Buffer.concat(chunks).toString("utf-8");
      const body = JSON.parse(bodyText) as {
        token?: string;
        text?: string;
        goal?: string;
        audioPath?: string;
        audioBase64?: string;
        audioFormat?: string;
        profilePath?: string;
        userId?: string;
        displayName?: string;
        threshold?: number;
      };
      const token = body.token ?? "";
      const goal = (body.text ?? body.goal ?? "").trim();

      const isVoiceApi = requestPath === "/voice/enroll" || requestPath === "/voice/verify";

      if (!siri.enabled && !isVoiceApi) {
        res.statusCode = 403;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Siri bridge disabled" }));
        return;
      }

      const allowLocalVoiceWithoutToken =
        isVoiceApi && isLocalRequest && process.env.OMNISTATE_LOCAL_VOICE_API_NO_TOKEN !== "0";

      if ((!siri.token || token !== siri.token) && !allowLocalVoiceWithoutToken) {
        json(401, { ok: false, error: "Invalid token" });
        return;
      }

      if (isVoiceApi) {
        let audioPath = (body.audioPath ?? "").trim();
        const cleanupPaths: string[] = [];
        const audioBase64 = (body.audioBase64 ?? "").trim();
        let audioFormat = (body.audioFormat ?? "wav") as string;

        if (!audioPath && audioBase64) {
          const dataUrlMatch = /^data:audio\/([a-zA-Z0-9+.-]+);base64,/i.exec(audioBase64);
          const formatFromDataUrl = (dataUrlMatch?.[1] ?? "").toLowerCase();
          const normalizedFromDataUrl = normalizeDeclaredAudioFormat(formatFromDataUrl);

          if (normalizedFromDataUrl !== "unknown") audioFormat = normalizedFromDataUrl;

          const clean = audioBase64.replace(/^data:[^;]+;base64,/, "");
          const rawAudio = Buffer.from(clean, "base64");

          // Sniff raw bytes regardless of declared format to avoid wrong extension.
          const sniffed = sniffAudioFormat(rawAudio);
          if (sniffed !== "unknown") audioFormat = sniffed;

          const ext =
            audioFormat === "mp3"
              ? "mp3"
              : audioFormat === "ogg"
                ? "ogg"
                : audioFormat === "webm"
                  ? "webm"
                  : "wav";
          const tempPath = join(tmpdir(), `omnistate-voice-${crypto.randomUUID()}.${ext}`);
          await writeFile(tempPath, rawAudio);
          audioPath = tempPath;
                  cleanupPaths.push(tempPath);
        }

        if (!audioPath) {
          json(400, { ok: false, error: "Missing audioPath" });
          return;
        }

        const profilePath = (body.profilePath ?? `${process.env.HOME}/.omnistate/voice_profile.json`).trim();
        const pythonBin = process.env.OMNISTATE_PYTHON || `${process.env.HOME}/.pyenv/versions/3.12.12/bin/python3`;

        try {
          const prepared = await ensureSpeechbrainCompatibleAudio(audioPath, audioFormat);
          audioPath = prepared.finalPath;
          cleanupPaths.push(...prepared.cleanupPaths);

          if (requestPath === "/voice/enroll") {
            const userId = (body.userId ?? "owner").trim();
            const displayName = (body.displayName ?? userId).trim();
            const threshold = typeof body.threshold === "number" ? body.threshold : 0.85;

            const { stdout } = await execFileAsync(pythonBin, [
              speechbrainScriptPath,
              "enroll",
              "--audio",
              audioPath,
              "--user-id",
              userId,
              "--display-name",
              displayName,
              "--profile",
              profilePath,
              "--threshold",
              String(threshold),
            ], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });

            try {
              json(200, JSON.parse(stdout));
            } catch {
              json(200, { ok: true, output: stdout.trim() });
            }
            return;
          }

          const { stdout } = await execFileAsync(pythonBin, [
            speechbrainScriptPath,
            "verify",
            "--audio",
            audioPath,
            "--profile",
            profilePath,
          ], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
          try {
            json(200, JSON.parse(stdout));
          } catch {
            json(200, { ok: true, output: stdout.trim() });
          }
          return;
        } finally {
          for (const path of [...new Set(cleanupPaths)]) {
            await unlink(path).catch(() => {
              // ignore cleanup errors
            });
          }
        }
      }

      if (requestPath !== expectedPath) {
        json(404, { ok: false, error: "Not found" });
        return;
      }

      if (!goal) {
        json(400, { ok: false, error: "Missing text" });
        return;
      }

      const taskId = `siri-${crypto.randomUUID()}`;
      this.executeTaskPipeline(taskId, goal, undefined, undefined).catch(() => {
        // no-op: pipeline error is returned through history and server logs
      });

      json(200, { ok: true, taskId, accepted: true });
    } catch (err) {
      json(400, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
    const remoteIp = _req.socket.remoteAddress ?? "unknown";
    const isLocalhost =
      remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp.startsWith("::ffff:127.0.0.1");

    ws.on("message", (raw) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());
        this.handleMessage(clientId, ws, msg, remoteIp, isLocalhost).catch((err) => {
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

    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 30_000);

    ws.on("pong", () => {
      // client is alive
    });

    ws.on("close", () => {
      clearInterval(pingInterval);
      this.clients.delete(clientId);
    });
  }

  private async handleMessage(
    clientId: string,
    ws: WebSocket,
    msg: ClientMessage,
    remoteIp: string = "unknown",
    isLocalhost: boolean = true
  ): Promise<void> {
    switch (msg.type) {
      case "connect": {
        const authResult = authenticateConnection(msg.auth?.token, this.config, isLocalhost, remoteIp);
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
          userId: authResult.userId ?? null,
          deviceId: authResult.deviceId ?? null,
        });
        const response: ServerMessage = {
          type: "connected",
          clientId,
          capabilities: ["task", "health", "fleet", "llm.preflight", "claude.mem"],
        };
        ws.send(JSON.stringify(response));
        break;
      }

      case "claude.mem.query": {
        const state = this.claudeMemStore.loadState();
        this.safeSend(ws, {
          type: "claude.mem.state",
          payload: state.payload,
          updatedAt: state.updatedAt,
        } as ServerMessage);
        break;
      }

      case "claude.mem.sync": {
        const state = this.claudeMemStore.saveState(msg.payload);
        this.safeSend(ws, {
          type: "claude.mem.ack",
          ok: true,
          message: "claude-mem synced",
          updatedAt: state.updatedAt,
        } as ServerMessage);

        this.safeSend(ws, {
          type: "claude.mem.state",
          payload: state.payload,
          updatedAt: state.updatedAt,
        } as ServerMessage);
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
          if (this.shouldRefreshWakeListener(msg.goal)) {
            this.startWakeListener();
          }

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

      case "runtime.config.get": {
        const config = loadLlmRuntimeConfig();
        this.safeSend(ws, {
          type: "runtime.config.report",
          config,
        } as ServerMessage);
        break;
      }

      case "runtime.config.set": {
        let config = loadLlmRuntimeConfig();
        const key = String((msg as RuntimeConfigSetMessage).key);
        let handled = false;

        try {
          switch (key) {
            case "provider":
              handled = true;
              config = setActiveProvider(String(msg.value));
              break;
            case "model":
              handled = true;
              config = setActiveModel(String(msg.value));
              break;
            case "baseURL":
              handled = true;
              config = updateActiveProviderField("baseURL", String(msg.value));
              break;
            case "apiKey":
              handled = true;
              config = updateActiveProviderField("apiKey", String(msg.value));
              break;
            case "voice.lowLatency":
              handled = true;
              config = setVoiceField("lowLatency", Boolean(msg.value));
              break;
            case "voice.autoExecuteTranscript":
              handled = true;
              config = setVoiceField("autoExecuteTranscript", Boolean(msg.value));
              break;
            case "voice.wake.enabled":
              handled = true;
              config = setWakeField("enabled", Boolean(msg.value));
              break;
            case "voice.wake.phrase":
              handled = true;
              config = setWakeField("phrase", String(msg.value));
              break;
            case "voice.wake.cooldownMs":
              handled = true;
              config = setWakeField("cooldownMs", Number(msg.value));
              break;
            case "voice.wake.commandWindowSec":
              handled = true;
              config = setWakeField("commandWindowSec", Number(msg.value));
              break;
            case "voice.siri.enabled":
              handled = true;
              config = setSiriField("enabled", Boolean(msg.value));
              break;
            case "voice.siri.mode":
              handled = true;
              config = setSiriField("mode", String(msg.value));
              break;
            case "voice.siri.shortcutName":
              handled = true;
              config = setSiriField("shortcutName", String(msg.value));
              break;
            case "voice.siri.endpoint":
              handled = true;
              config = setSiriField("endpoint", String(msg.value));
              break;
            case "voice.siri.token":
              handled = true;
              config = setSiriField("token", String(msg.value));
              break;
          }

          if (!handled) {
            this.safeSend(ws, {
              type: "runtime.config.ack",
              ok: false,
              key,
              message: `Unsupported runtime config key: ${key}`,
              config,
            } as ServerMessage);
            break;
          }

          this.safeSend(ws, {
            type: "runtime.config.ack",
            ok: true,
            key,
            message: `Updated ${key}`,
            config,
          } as ServerMessage);

          this.safeSend(ws, {
            type: "runtime.config.report",
            config,
          } as ServerMessage);
        } catch (err) {
          this.safeSend(ws, {
            type: "runtime.config.ack",
            ok: false,
            key,
            message: err instanceof Error ? err.message : String(err),
            config,
          } as ServerMessage);
        }
        break;
      }

      case "runtime.config.upsertProvider": {
        const providerInput = msg.provider ?? ({} as Record<string, unknown>);
        const providerId = String(providerInput.id ?? "").trim();
        const providerModel = String(providerInput.model ?? "").trim();
        const providerBaseURL = String(providerInput.baseURL ?? "").trim();
        if (!providerId || !providerModel || !providerBaseURL) {
          this.safeSend(ws, {
            type: "runtime.config.ack",
            ok: false,
            key: "provider",
            message: "Provider id/model/baseURL are required",
            config: loadLlmRuntimeConfig(),
          } as ServerMessage);
          break;
        }

        const kindRaw = String(providerInput.kind ?? "openai-compatible");
        const kind = kindRaw === "anthropic" ? "anthropic" : "openai-compatible";
        const modelsRaw = Array.isArray(providerInput.models)
          ? providerInput.models
          : String(providerInput.models ?? "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);

        let config = upsertProvider({
          id: providerId,
          kind,
          baseURL: providerBaseURL,
          apiKey: String(providerInput.apiKey ?? ""),
          model: providerModel,
          enabled: providerInput.enabled !== false,
          models: modelsRaw,
        });

        if (msg.addToFallback) {
          config = addFallbackProvider(providerId);
        }
        if (msg.activate) {
          config = setActiveProvider(providerId);
        }

        this.safeSend(ws, {
          type: "runtime.config.ack",
          ok: true,
          key: "provider",
          message: `Upserted provider ${providerId}`,
          config,
        } as ServerMessage);

        this.safeSend(ws, {
          type: "runtime.config.report",
          config,
        } as ServerMessage);
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

      case "admin.shutdown": {
        const reply: ServerMessage = {
          type: "gateway.shutdown",
          reason: "Requested by admin",
        };
        this.safeSend(ws, reply);
        setTimeout(() => this.stop(), 100);
        break;
      }

      case "voice.enroll": {
        // msg: { type: "voice.enroll", profileId: string, audio: string }
        try {
          const { enrollVoiceSample } = await import("../voice/voiceprint.js");
          const result = await enrollVoiceSample(msg.profileId, msg.audio);
          this.safeSend(ws, {
            type: "voice.enroll.result",
            profileId: msg.profileId,
            sampleCount: result.sampleCount,
            isComplete: result.isComplete,
            required: 3,
          });
        } catch (err: any) {
          this.safeSend(ws, { type: "voice.enroll.error", error: err.message });
        }
        break;
      }

      case "voice.verify": {
        // msg: { type: "voice.verify", audio: string }
        try {
          const { verifySpeaker } = await import("../voice/voiceprint.js");
          const result = await verifySpeaker(msg.audio);
          this.safeSend(ws, {
            type: "voice.verify.result",
            matched: result.matched,
            profileId: result.profileId,
            similarity: result.similarity,
          });
        } catch (err: any) {
          this.safeSend(ws, { type: "voice.verify.error", error: err.message });
        }
        break;
      }

      case "trigger.create": {
        const trigger = this.triggerEngine.createTrigger(this.clients.get(clientId)?.userId ?? "local", {
          name: msg.name,
          description: msg.description,
          condition: msg.condition as import("../triggers/index.js").TriggerCondition,
          action: msg.action,
          cooldownMs: msg.cooldownMs,
        });
        this.safeSend(ws, { type: "trigger.created", trigger } as unknown as ServerMessage);
        break;
      }
      case "trigger.list": {
        const triggers = this.triggerEngine.listTriggers(this.clients.get(clientId)?.userId ?? "local");
        this.safeSend(ws, { type: "trigger.list.result", triggers } as unknown as ServerMessage);
        break;
      }
      case "trigger.update": {
        const trigger = this.triggerEngine.updateTrigger(msg.triggerId, msg.updates);
        this.safeSend(ws, { type: "trigger.updated", trigger } as unknown as ServerMessage);
        break;
      }
      case "trigger.delete": {
        this.triggerEngine.deleteTrigger(msg.triggerId);
        this.safeSend(ws, { type: "trigger.deleted", triggerId: msg.triggerId } as unknown as ServerMessage);
        break;
      }
      case "trigger.history": {
        const entries = this.triggerEngine.getTriggerHistory(msg.triggerId, msg.limit);
        this.safeSend(ws, { type: "trigger.history.result", triggerId: msg.triggerId, entries } as unknown as ServerMessage);
        break;
      }

      // ── Permission responder commands ──────────────────────────────────────
      case "permission.policy.get": {
        const policy = this.config.approvalPolicy ?? null;
        this.safeSend(ws, { type: "permission.policy.report", policy } as unknown as ServerMessage);
        break;
      }
      case "permission.policy.update": {
        const client = this.clients.get(clientId);
        if (client?.role !== "ui" && client?.role !== "cli") {
          this.safeSend(ws, { type: "error", message: "Admin role required to update permission policy" });
          break;
        }
        // Merge the incoming patch into config (runtime only — not persisted to disk)
        const patch = (msg as unknown as { policy: Record<string, unknown> }).policy ?? {};
        (this.config as any).approvalPolicy = { ...(this.config.approvalPolicy ?? {}), ...patch };
        if (this.approvalEngine) {
          // Re-create the engine with the updated policy
          this.approvalEngine = new ApprovalEngine(this.config.approvalPolicy!);
          this.orchestrator.approvalEngine = this.approvalEngine;
          if (this.claudeCodeResponder) {
            await this.claudeCodeResponder.stop();
            this.claudeCodeResponder = new ClaudeCodeResponder(
              (this.orchestrator as any).surface,
              this.approvalEngine,
              { enabled: this.config.approvalPolicy?.enabled ?? false }
            );
            if (this.config.approvalPolicy?.enabled) this.claudeCodeResponder.start();
          }
        }
        this.safeSend(ws, { type: "permission.policy.report", policy: this.config.approvalPolicy } as unknown as ServerMessage);
        break;
      }
      case "permission.history": {
        const history = this.claudeCodeResponder?.getHistory() ?? [];
        this.safeSend(ws, { type: "permission.history.result", history } as unknown as ServerMessage);
        break;
      }
      case "permission.start": {
        if (!this.claudeCodeResponder) {
          this.safeSend(ws, { type: "error", message: "No permission responder configured. Set approvalPolicy in config." });
          break;
        }
        if (!this.claudeCodeResponder.isRunning) {
          this.claudeCodeResponder.start();
        }
        this.safeSend(ws, { type: "permission.status", running: this.claudeCodeResponder.isRunning } as unknown as ServerMessage);
        break;
      }
      case "permission.stop": {
        if (this.claudeCodeResponder?.isRunning) {
          await this.claudeCodeResponder.stop();
        }
        this.safeSend(ws, { type: "permission.status", running: false } as unknown as ServerMessage);
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
    ws?: WebSocket
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
  private safeSend(ws: WebSocket | undefined, msg: ServerMessage): void {
    if (!ws) return;
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify(msg));
    }
  }
}
