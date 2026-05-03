// server-handlers.ts — HTTP/WebSocket handlers extracted from server.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFile, readdir, stat, writeFile, unlink } from "node:fs/promises";
import type { WebSocket } from "ws";
import type { ClientMessage, ServerMessage, RuntimeConfigSetMessage, TaskAttachment, RuntimeConfigDeleteProviderMessage } from "./protocol.js";
import { createAuthRoutes, parseBody, jsonResponse } from "../http/auth-routes.js";
import { createVoiceRoutes } from "../http/voice-routes.js";
import { createNetworkRoutes } from "../http/network-routes.js";
import { createDeviceRoutes } from "../http/device-routes.js";
import { checkRateLimit } from "../http/rate-limiter.js";
import { runLlmPreflight } from "../llm/preflight.js";
import { requestLlmTextWithFallback } from "../llm/router.js";
import { tryHandleGatewayCommand } from "./command-router.js";
import { incrementSessionUsage, loadLlmRuntimeConfig, saveLlmRuntimeConfig } from "../llm/runtime-config.js";
import { setActiveModel, setActiveProvider, setSiriField, setVoiceField, setWakeField, updateActiveProviderField } from "../llm/runtime-config.js";
import { upsertProvider, addFallbackProvider, deleteProvider } from "../llm/runtime-config.js";
import { synthesizeRtvcSpeech, trainRtvcProfile } from "../voice/rtvc.js";
import { applySecurityHeaders, applyCorsHeaders, applyPreflightHeaders } from "./security-headers.js";
import { applyRequestId } from "./request-context.js";
import { httpRequestsTotal, httpRequestDurationSeconds, wsConnectionsGauge, register } from "./metrics.js";
import { execAsync, execFileAsync, isAllowedFilePath, mimeForPath, sniffAudioFormat, normalizeDeclaredAudioFormat, ensureSpeechbrainCompatibleAudio, bridgeProbeScriptPath, speechbrainScriptPath } from "./server-helpers.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Gateway = any;

// ──────────────────────────────────────────────────────────────────────────────
// handleSiriBridgeRequest — HTTP handler for Siri bridge and REST endpoints
// ──────────────────────────────────────────────────────────────────────────────

export async function handleSiriBridgeRequest(
  gateway: Gateway,
  req: IncomingMessage,
  res: ServerResponse,
  expectedPath: string,
): Promise<void> {
  const startMs = Date.now();
  applyRequestId(req, res);
  applySecurityHeaders(res);
  const origin = req.headers["origin"] as string | undefined;

  const json = (status: number, body: Record<string, unknown>) => {
    applyCorsHeaders(res, origin);
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
    const route = new URL(req.url ?? "/", "http://localhost").pathname;
    httpRequestsTotal.inc({ method: req.method ?? "GET", route, status: String(status) });
    httpRequestDurationSeconds.observe({ method: req.method ?? "GET", route, status: String(status) }, (Date.now() - startMs) / 1000);
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
    applyPreflightHeaders(res, origin);
    res.writeHead(204);
    res.end();
    return;
  }

  // Rate limiting — check before processing any route
  if (!checkRateLimit(req, res, requestPath)) {
    return; // 429 already sent
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

  // POST /api/voice/clone/train — store enrollment samples and generate RTVC embedding
  if (req.method === "POST" && requestPath === "/api/voice/clone/train") {
    const body = await parseBody(req);
    const profileId = String(body?.profileId ?? "").trim();
    const audio = String(body?.audio ?? "").trim();
    const format = String(body?.format ?? "wav").trim();
    const sampleIndex = Number(body?.sampleIndex ?? 0);

    if (!profileId) {
      jsonResponse(res, 400, { error: "Missing profileId" });
      return;
    }

    if (!audio) {
      jsonResponse(res, 400, { error: "Missing audio" });
      return;
    }

    try {
      const result = await trainRtvcProfile({
        profileId,
        audioBase64: audio,
        format,
        sampleIndex: Number.isFinite(sampleIndex) ? sampleIndex : 0,
      });
      if (!result.ok) {
        jsonResponse(res, 500, {
          error: "Voice clone training failed",
          details: result.warning ?? "Unknown training error",
          profileId: result.profileId,
          samplePath: result.samplePath,
        });
        return;
      }
      jsonResponse(res, 200, result);
    } catch (err: any) {
      jsonResponse(res, 500, {
        error: "Voice clone training failed",
        details: err?.message ?? String(err),
      });
    }
    return;
  }

  // POST /api/voice/clone/tts — proxy request to external voice clone inference service
  if (req.method === "POST" && (requestPath === "/api/voice/clone/tts" || requestPath === "/voice/clone/tts")) {
    const body = await parseBody(req);
    const text = String(body?.text ?? "").trim();
    const language = String(body?.language ?? "vi").trim() || "vi";
    const profileId = String(body?.profileId ?? "").trim() || undefined;
    const endpoint = process.env.OMNISTATE_VOICE_CLONE_TTS_URL?.trim();

    if (!text) {
      jsonResponse(res, 400, { error: "Missing text" });
      return;
    }

    if (!endpoint) {
      try {
        const local = await synthesizeRtvcSpeech({ text, language, profileId });
        applyCorsHeaders(res, origin);
        applySecurityHeaders(res);
        res.writeHead(200, {
          "Content-Type": local.contentType,
          "Content-Length": String(local.audio.length),
          "Cache-Control": "no-store",
        });
        res.end(local.audio);
      } catch (err: any) {
        jsonResponse(res, 503, {
          error: "Voice clone endpoint is not configured and local RTVC synthesis failed",
          hint: "Set OMNISTATE_VOICE_CLONE_TTS_URL or configure OMNISTATE_RTC_REPO_DIR (+ optional OMNISTATE_VOICE_CLONE_SPEAKER_WAV)",
          details: err?.message ?? String(err),
        });
      }
      return;
    }

    try {
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text, language }),
      });

      if (!upstream.ok) {
        const errText = await upstream.text();
        jsonResponse(res, 502, {
          error: `Voice clone provider error (${upstream.status})`,
          details: errText.slice(0, 2000),
        });
        return;
      }

      const contentType = (upstream.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.startsWith("audio/")) {
        const audioBuffer = Buffer.from(await upstream.arrayBuffer());
        applyCorsHeaders(res, origin);
        applySecurityHeaders(res);
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": String(audioBuffer.length),
          "Cache-Control": "no-store",
        });
        res.end(audioBuffer);
        return;
      }

      const json = await upstream.json();
      jsonResponse(res, 200, json);
    } catch (err: any) {
      jsonResponse(res, 502, {
        error: "Voice clone provider request failed",
        details: err?.message ?? String(err),
      });
    }
    return;
  }

  if (req.method === "GET" && (requestPath === "/api/files/read" || requestPath === "/files/read")) {
    if (!isLocalRequest) {
      jsonResponse(res, 403, { error: "Only local requests are allowed" });
      return;
    }

    try {
      const urlObj = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const requestedPath = urlObj.searchParams.get("path") ?? "";
      if (!requestedPath) {
        jsonResponse(res, 400, { error: "Missing path" });
        return;
      }

      const resolvedPath = resolve(requestedPath);
      if (!isAllowedFilePath(resolvedPath)) {
        jsonResponse(res, 403, { error: "File path is not allowed" });
        return;
      }

      const file = await readFile(resolvedPath);
      const fileInfo = await stat(resolvedPath);
      applyCorsHeaders(res, origin);
      applySecurityHeaders(res);
      res.writeHead(200, {
        "Content-Type": mimeForPath(resolvedPath),
        "Content-Length": String(fileInfo.size),
        "Cache-Control": "no-store",
      });
      res.end(file);
    } catch (err: any) {
      jsonResponse(res, 404, { error: err?.message ?? "File not found" });
    }
    return;
  }

  if (req.method === "GET" && requestPath === "/metrics") {
    const metricsOutput = await register.metrics();
    applyCorsHeaders(res, origin);
    res.writeHead(200, { "content-type": register.contentType });
    res.end(metricsOutput);
    return;
  }

  if (req.method === "GET" && requestPath === "/health/ready") {
    const checks: Record<string, { ok: boolean; error?: string }> = {};

    // DB check
    try {
      const db = (await import("../db/database.js")).getDb();
      db.prepare("SELECT 1").get();
      checks["db"] = { ok: true };
    } catch (err) {
      checks["db"] = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    // LLM provider reachability (best-effort, 2s timeout)
    try {
      const { loadLlmRuntimeConfig } = await import("../llm/runtime-config.js");
      const cfg = loadLlmRuntimeConfig();
      const baseURL = cfg.providers?.find((p) => p.id === cfg.activeProviderId)?.baseURL ?? "";
      if (baseURL) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        try {
          await fetch(baseURL, { method: "HEAD", signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      }
      checks["llm"] = { ok: true };
    } catch (err) {
      checks["llm"] = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const ready = Object.values(checks).every((c) => c.ok);
    json(ready ? 200 : 503, { ready, checks });
    return;
  }

  if (req.method === "GET" && (requestPath === "/health" || requestPath === "/healthz")) {
    const { getTailscaleStatus } = await import("../network/tailscale.js");
    json(200, {
      status: "ok",
      uptime: process.uptime(),
      connections: gateway.clients.size,
      timestamp: new Date().toISOString(),
      tailscale: getTailscaleStatus(),
    });
    return;
  }

  if (req.method === "GET" && requestPath === "/readyz") {
    json(200, {
      ok: true,
      ready: true,
      wakeListenerRunning: gateway.wakeManager.isRunning(),
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

  // GET /api/events — recent events from event bus
  if (req.method === "GET" && requestPath === "/api/events") {
    const urlObj = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const limitRaw = parseInt(urlObj.searchParams.get("limit") ?? "100", 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 1000)) : 100;
    const type = urlObj.searchParams.get("type") ?? undefined;
    const events = gateway.eventBus.getRecent({ limit, type });
    jsonResponse(res, 200, { events });
    return;
  }

  // GET /api/events/rules — list rules
  if (req.method === "GET" && requestPath === "/api/events/rules") {
    jsonResponse(res, 200, { rules: gateway.ruleEngine.listRules() });
    return;
  }

  // POST /api/events/rules — add rule
  if (req.method === "POST" && requestPath === "/api/events/rules") {
    try {
      const body = await parseBody(req);
      const name = String(body?.name ?? "").trim();
      const eventPattern = String(body?.eventPattern ?? "").trim();
      if (!name || !eventPattern) {
        jsonResponse(res, 400, { error: { code: "VALIDATION_ERROR", message: "name and eventPattern are required" } });
        return;
      }
      const rule = gateway.ruleEngine.addRule({
        name,
        eventPattern,
        condition: body?.condition ? String(body.condition) : undefined,
        action: body?.action ?? { type: "notify", config: {} },
        enabled: body?.enabled !== false,
      });
      jsonResponse(res, 201, { rule });
    } catch (err: any) {
      jsonResponse(res, 400, { error: { code: "BAD_REQUEST", message: err?.message ?? "Bad request" } });
    }
    return;
  }

  // POST /api/events/rules/:id/toggle — toggle rule
  const toggleMatch = requestPath.match(/^\/api\/events\/rules\/([^/]+)\/toggle$/);
  if (req.method === "POST" && toggleMatch) {
    try {
      const ruleId = toggleMatch[1];
      const body = await parseBody(req);
      const enabled = Boolean(body?.enabled ?? true);
      const rule = gateway.ruleEngine.toggleRule(ruleId, enabled);
      if (!rule) {
        jsonResponse(res, 404, { error: { code: "NOT_FOUND", message: "Rule not found" } });
        return;
      }
      jsonResponse(res, 200, { rule });
    } catch (err: any) {
      jsonResponse(res, 400, { error: { code: "BAD_REQUEST", message: err?.message ?? "Bad request" } });
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

  if (req.method === "POST" && requestPath === "/api/tts/preview") {
    const rawChunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk) => rawChunks.push(Buffer.from(chunk)));
      req.on("end", () => resolve());
      req.on("aborted", () => reject(new Error("Request aborted")));
      req.on("error", (err) => reject(err));
    }).catch((err: any) => {
      json(400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    });
    if (res.writableEnded) return;

    let ttsBody: { text?: string } = {};
    try {
      ttsBody = JSON.parse(Buffer.concat(rawChunks).toString("utf-8"));
    } catch {
      json(400, { error: { code: "INVALID_JSON", message: "Invalid JSON body" } });
      return;
    }

    const text = ttsBody.text;
    if (!text) {
      json(400, { error: { code: "MISSING_TEXT", message: "text is required" } });
      return;
    }
    if (text.length > 500) {
      json(400, { error: { code: "TEXT_TOO_LONG", message: "text exceeds 500 characters" } });
      return;
    }

    try {
      const { synthesize, detectLanguage, pickVoice } = await import("../voice/edge-tts.js");
      const voiceName = pickVoice(detectLanguage(text));
      const result = await synthesize(text, { voice: voiceName });
      json(200, { audio: result.toString("base64"), voice: voiceName });
    } catch (err) {
      json(500, { error: { code: "TTS_FAILED", message: err instanceof Error ? err.message : String(err) } });
    }
    return;
  }

  if (req.method !== "POST") {
    json(404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }

  const chunks: Buffer[] = [];
  const MAX_BODY_BYTES = 10 * 1024 * 1024;
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
  }).catch((err: any) => {
    if (bodyTooLarge) {
      json(413, { ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: `Request body exceeds ${MAX_BODY_BYTES} bytes` } });
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
        for (const path of new Set(cleanupPaths)) {
          await unlink(path).catch(() => {
            // ignore cleanup errors
          });
        }
      }
    }

    // POST /api/wake/event — wake phrase event from Python wake script
    if (req.method === "POST" && requestPath === "/api/wake/event") {
      const bodyText = Buffer.concat(chunks).toString("utf-8");
      let body: { token?: string; phrase?: string; confidence?: number };
      try {
        body = JSON.parse(bodyText);
      } catch {
        json(400, { ok: false, error: "Invalid JSON body" });
        return;
      }

      const expectedToken = process.env.OMNISTATE_SIRI_TOKEN ?? siri.token ?? "";
      if (expectedToken && body.token !== expectedToken) {
        json(401, { error: "unauthorized" });
        return;
      }

      const phrase = (body.phrase ?? "").trim();
      if (!phrase) {
        json(400, { ok: false, error: "Missing phrase" });
        return;
      }

      const confidence = typeof body.confidence === "number" ? body.confidence : 1;

      gateway.broadcast({ type: "wake.event", phrase, confidence } as unknown as ServerMessage);

      json(200, { ok: true });
      return;
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
    gateway.executeTaskPipeline(taskId, goal, undefined, undefined).catch(() => {
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

// ──────────────────────────────────────────────────────────────────────────────
// handleConnection — WebSocket connection handler
// ──────────────────────────────────────────────────────────────────────────────

export function handleConnection(
  gateway: Gateway,
  ws: WebSocket,
  _req: IncomingMessage
): void {
  const clientId = crypto.randomUUID();
  const remoteIp = _req.socket.remoteAddress ?? "unknown";
  const isLocalhost =
    remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp.startsWith("::ffff:127.0.0.1");

  wsConnectionsGauge.inc();

  ws.on("message", (raw, isBinary) => {
    try {
      if (isBinary) {
        gateway.streamManager.handleBinaryFrame(clientId, raw as Buffer, (msg: any) => {
          if (ws.readyState === 1) ws.send(JSON.stringify(msg));
        });
        return;
      }
      const msg: ClientMessage = JSON.parse(raw.toString());
      gateway.handleMessage(clientId, ws, msg, remoteIp, isLocalhost).catch((err: any) => {
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
    gateway.streamManager.dropSession(clientId);
    gateway.clients.delete(clientId);
    wsConnectionsGauge.dec();
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// handleMessage — WebSocket message dispatcher
// ──────────────────────────────────────────────────────────────────────────────

export async function handleMessage(
  gateway: Gateway,
  clientId: string,
  ws: WebSocket,
  msg: ClientMessage,
  remoteIp: string = "unknown",
  isLocalhost: boolean = true
): Promise<void> {
  switch (msg.type) {
    case "connect": {
      const { authenticateConnection } = await import("./auth.js");
      const authResult = authenticateConnection(msg.auth?.token, gateway.config, isLocalhost, remoteIp);
      if (!authResult.ok) {
        ws.send(
          JSON.stringify({ type: "error", message: authResult.reason })
        );
        ws.close();
        return;
      }
      gateway.clients.set(clientId, {
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
        capabilities: [
          "task",
          "health",
          "system.dashboard",
          "history.query",
          "runtime.config",
          "voice.transcribe",
          "voice.stream",
          "voice.session.cancel",
          "task.cancel",
          "triggers",
          "fleet",
          "llm.preflight",
          "claude.mem",
        ],
      };
      ws.send(JSON.stringify(response));
      break;
    }

    case "claude.mem.query": {
      const state = gateway.claudeMemStore.loadState();
      gateway.safeSend(ws, {
        type: "claude.mem.state",
        payload: state.payload,
        updatedAt: state.updatedAt,
      } as ServerMessage);
      break;
    }

    case "claude.mem.sync": {
      const state = gateway.claudeMemStore.saveState(msg.payload);
      gateway.safeSend(ws, {
        type: "claude.mem.ack",
        ok: true,
        message: "claude-mem synced",
        updatedAt: state.updatedAt,
      } as ServerMessage);

      gateway.safeSend(ws, {
        type: "claude.mem.state",
        payload: state.payload,
        updatedAt: state.updatedAt,
      } as ServerMessage);
      break;
    }

    case "event.ingest": {
      try {
        const event = gateway.eventRepository.ingest(msg);
        const reply: ServerMessage = { type: "event.ingested", event };
        gateway.broadcast(reply);
        await gateway.triggerEngine.evaluateEvent(event);
      } catch {
        gateway.safeSend(ws, { type: "error", message: "Invalid event ingest request" });
      }
      break;
    }

    case "event.query": {
      try {
        const events = gateway.eventRepository.query(msg);
        gateway.safeSend(ws, { type: "event.query.result", events } as ServerMessage);
      } catch {
        gateway.safeSend(ws, { type: "error", message: "Event query failed" });
      }
      break;
    }

    case "event.get": {
      try {
        const event = gateway.eventRepository.get(msg.id);
        gateway.safeSend(ws, { type: "event.detail", event } as ServerMessage);
      } catch {
        gateway.safeSend(ws, { type: "error", message: "Event lookup failed" });
      }
      break;
    }

    case "memory.record.upsert": {
      try {
        const record = gateway.memoryRepository.upsert(msg);
        gateway.safeSend(ws, { type: "memory.record.saved", record } as ServerMessage);
      } catch {
        gateway.safeSend(ws, { type: "error", message: "Invalid memory record request" });
      }
      break;
    }

    case "memory.record.query": {
      try {
        const records = gateway.memoryRepository.query(msg);
        gateway.safeSend(ws, { type: "memory.record.query.result", records } as ServerMessage);
      } catch {
        gateway.safeSend(ws, { type: "error", message: "Memory record query failed" });
      }
      break;
    }

    case "memory.record.delete": {
      try {
        const deleted = gateway.memoryRepository.delete(msg);
        gateway.safeSend(ws, { type: "memory.record.deleted", id: msg.id, deleted } as ServerMessage);
      } catch {
        gateway.safeSend(ws, { type: "error", message: "Memory record delete failed" });
      }
      break;
    }

    case "task": {
      const taskId = crypto.randomUUID();
      const requestedMode = String(((msg as { mode?: string }).mode ?? "auto")).toLowerCase();
      const taskGoal = gateway.buildGoalWithAttachments(msg.goal, (msg as { attachments?: TaskAttachment[] }).attachments);

      const commandResult = tryHandleGatewayCommand(msg.goal, {
        clearTaskHistory: () => gateway.clearTaskHistory(),
        connectedClients: () => gateway.clients.size,
        uptimeMs: () => Date.now() - gateway.startedAt,
        taskHistorySize: () => gateway.taskHistory.length,
      });

      if (commandResult) {
        if (gateway.shouldRefreshWakeListener(msg.goal)) {
          gateway.startWakeListener();
        }

        const accepted: ServerMessage = {
          type: "task.accepted",
          taskId,
          goal: msg.goal,
        };
        gateway.safeSend(ws, accepted);

        gateway.safeSend(ws, {
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

      const shouldChat = requestedMode === "chat"
        ? true
        : requestedMode === "task"
          ? false
          : await gateway.shouldUseChatMode(msg.goal);

      if (shouldChat) {
        const accepted: ServerMessage = {
          type: "task.accepted",
          taskId,
          goal: msg.goal,
        };
        gateway.safeSend(ws, accepted);

        const userGoal = gateway.unwrapUserGoal(taskGoal);
        try {
          const llm = await requestLlmTextWithFallback({
            system:
              "You are OmniState chat assistant. Reply naturally, concise, and helpful. If user asks simple math, answer directly with result.",
            user: userGoal,
            maxTokens: 220,
          });

          gateway.safeSend(ws, {
            type: "task.complete",
            taskId,
            result: {
              goal: msg.goal,
              mode: "chat",
              route: requestedMode,
              providerId: llm.providerId,
              model: llm.model,
              output: llm.text,
              attachmentCount: Array.isArray((msg as { attachments?: TaskAttachment[] }).attachments)
                ? ((msg as { attachments?: TaskAttachment[] }).attachments?.length ?? 0)
                : 0,
            },
          } as ServerMessage);

          gateway.taskHistory.unshift({
            taskId,
            goal: msg.goal,
            status: "complete",
            output: llm.text,
            intentType: "chat-mode",
            timestamp: new Date().toISOString(),
            durationMs: 0,
          });
          if (gateway.taskHistory.length > 100) gateway.taskHistory.pop();
          incrementSessionUsage();
          return;
        } catch (err) {
          const fallback = gateway.fallbackUserFacingOutput(taskGoal, "system-query") ?? "Mình đã nhận câu hỏi, nhưng hiện tại chưa lấy được câu trả lời từ model.";
          gateway.safeSend(ws, {
            type: "task.complete",
            taskId,
            result: {
              goal: msg.goal,
              mode: "chat",
              route: requestedMode,
              output: fallback,
              warning: err instanceof Error ? err.message : String(err),
            },
          } as ServerMessage);
          incrementSessionUsage();
          return;
        }
      }

      // Acknowledge immediately
      const accepted: ServerMessage = {
        type: "task.accepted",
        taskId,
        goal: msg.goal,
      };
      ws.send(JSON.stringify(accepted));

      // Run pipeline async — stream progress to client
      gateway.executeTaskPipeline(taskId, taskGoal, msg.layer, ws).catch(
        (err: any) => {
          const errMsg: ServerMessage = {
            type: "task.error",
            taskId,
            error: err instanceof Error ? err.message : String(err),
          };
          gateway.safeSend(ws, errMsg);
        }
      );
      break;
    }

    case "voice.transcribe": {
      const { id, audio } = msg as { id: string; audio: string };
      const tempSessionId = `transcribe-${id}-${Date.now()}`;
      let transcriptText: string | null = null;
      let resolved = false;
      const finish = (text: string | null) => {
        if (resolved) return;
        resolved = true;
        const voice = loadLlmRuntimeConfig().voice;
        const shouldAutoExecute = voice.autoExecuteTranscript && !(voice.siri.enabled && voice.siri.mode === "handoff");
        if (text) {
          gateway.safeSend(ws, { type: "voice.transcript", id, text });
          if (shouldAutoExecute) {
            const voiceTaskId = `voice-${id}-${crypto.randomUUID()}`;
            gateway.safeSend(ws, { type: "task.accepted", taskId: voiceTaskId, goal: text });
            gateway.executeTaskPipeline(voiceTaskId, text, undefined, ws).catch((err: any) => {
              gateway.safeSend(ws, { type: "task.error", taskId: voiceTaskId, error: err instanceof Error ? err.message : String(err) });
            });
          }
        } else {
          gateway.safeSend(ws, { type: "voice.error", id, error: "Could not transcribe audio" });
        }
      };
      // Safety timeout: 30s (covers any utterance + VAD silence delay + Whisper processing)
      const safetyTimer = setTimeout(() => {
        if (!resolved) finish(transcriptText);
      }, 30_000);
      gateway.streamManager.handleControlMessage(tempSessionId, {
        type: "voice.stream.start",
        sessionId: tempSessionId,
        source: "voice",
        autoExecute: false,
        includeContext: false,
      } as any, (msg: any) => {
        if (msg.type === "voice.stream.result" && (msg as any).kind === "final") {
          clearTimeout(safetyTimer);
          transcriptText = (msg as any).text || null;
          finish(transcriptText);
        }
      });
      gateway.streamManager.handleBinaryFrame(tempSessionId, Buffer.from(audio, "base64"), () => {});
      gateway.streamManager.handleControlMessage(tempSessionId, {
        type: "voice.stream.stop",
        sessionId: tempSessionId,
      } as any, () => {});
      break;
    }

    case "voice.stream.start":
    case "voice.stream.stop": {
      gateway.streamManager.handleControlMessage(clientId, msg as any, (serverMsg: any) => {
        gateway.safeSend(ws, serverMsg as unknown as ServerMessage);
      });
      break;
    }

    case "voice.session.cancel": {
      gateway.streamManager.dropSession(msg.sessionId);
      break;
    }

    case "task.cancel": {
      gateway.cancellationRegistry.cancel(msg.taskId);
      gateway.safeSend(ws, { type: "task.cancelled", taskId: msg.taskId, reason: "requested" });
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

        gateway.safeSend(ws, {
          type: "system.info",
          id,
          data: { battery, wifi, disk, cpu, memory, hostname },
        });
      } catch (err: any) {
        gateway.safeSend(ws, {
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
      const entries = gateway.taskHistory.slice(0, limit);
      const reply: ServerMessage = { type: "history.result", entries };
      gateway.safeSend(ws, reply);
      break;
    }

    case "health.query": {
      if (gateway.monitor) {
        gateway.monitor.runCheck().then((report: any) => {
          const reply: ServerMessage = {
            type: "health.report",
            overall: report.overall,
            timestamp: report.timestamp,
            sensors: report.sensors as Record<string, { status: string; value: number; unit: string; message?: string }>,
            alerts: report.alerts,
          };
          gateway.safeSend(ws, reply);
        }).catch(() => {
          gateway.safeSend(ws, { type: "error", message: "Health check failed" });
        });
      } else {
        gateway.safeSend(ws, { type: "error", message: "Health monitor not available" });
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
      gateway.safeSend(ws, reply);
      break;
    }

    case "runtime.config.get": {
      const config = loadLlmRuntimeConfig();
      gateway.safeSend(ws, {
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
          case "voice.wake.enabled": {
            handled = true;
            config = setWakeField("enabled", Boolean(msg.value));
            if (gateway.wakeManager) {
              const runtime = loadLlmRuntimeConfig();
              if (msg.value) {
                gateway.wakeManager.start({
                  config: runtime.voice.wake,
                  endpoint: runtime.voice.siri.endpoint,
                  token: runtime.voice.siri.token,
                });
              } else {
                gateway.wakeManager.stop();
              }
            }
            break;
          }
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
          case "vad.silenceThresholdMs": {
            handled = true;
            const conf = loadLlmRuntimeConfig();
            const n = Number(msg.value);
            if (!Number.isNaN(n) && Number.isFinite(n) && n >= 50) {
              conf.voice.vad.silenceThresholdMs = Math.round(n);
              saveLlmRuntimeConfig(conf);
              config = conf;
            }
            break;
          }
          case "vad.speechThreshold": {
            handled = true;
            const conf = loadLlmRuntimeConfig();
            const n = Number(msg.value);
            if (!Number.isNaN(n) && Number.isFinite(n) && n >= 0 && n <= 1) {
              conf.voice.vad.speechThreshold = n;
              saveLlmRuntimeConfig(conf);
              config = conf;
            }
            break;
          }
          case "vad.minSpeechMs": {
            handled = true;
            const conf = loadLlmRuntimeConfig();
            const n = Number(msg.value);
            if (!Number.isNaN(n) && Number.isFinite(n) && n >= 10) {
              conf.voice.vad.minSpeechMs = Math.round(n);
              saveLlmRuntimeConfig(conf);
              config = conf;
            }
            break;
          }
          case "provider.delete": {
            handled = true;
            config = deleteProvider(String(msg.value));
            break;
          }
        }

        if (!handled) {
          gateway.safeSend(ws, {
            type: "runtime.config.ack",
            ok: false,
            key,
            message: `Unsupported runtime config key: ${key}`,
            config,
          } as ServerMessage);
          break;
        }

        gateway.safeSend(ws, {
          type: "runtime.config.ack",
          ok: true,
          key,
          message: `Updated ${key}`,
          config,
        } as ServerMessage);

        gateway.safeSend(ws, {
          type: "runtime.config.report",
          config,
        } as ServerMessage);
      } catch (err) {
        gateway.safeSend(ws, {
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
        gateway.safeSend(ws, {
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

      gateway.safeSend(ws, {
        type: "runtime.config.ack",
        ok: true,
        key: "provider",
        message: `Upserted provider ${providerId}`,
        config,
      } as ServerMessage);

      gateway.safeSend(ws, {
        type: "runtime.config.report",
        config,
      } as ServerMessage);
      break;
    }

    case "runtime.config.deleteProvider": {
      const msg_ = msg as RuntimeConfigDeleteProviderMessage;
      const conf = deleteProvider(msg_.providerId);
      gateway.safeSend(ws, {
        type: "runtime.config.ack",
        ok: true,
        key: "provider",
        message: `Deleted provider ${msg_.providerId}`,
        config: conf,
      } as ServerMessage);
      gateway.safeSend(ws, {
        type: "runtime.config.report",
        config: conf,
      } as ServerMessage);
      break;
    }

    case "status.query": {
      const reply: ServerMessage = {
        type: "status.reply",
        connectedClients: gateway.clients.size,
        queueDepth: 0,
        uptime: Date.now() - gateway.startedAt,
      };
      gateway.safeSend(ws, reply);
      break;
    }

    case "admin.shutdown": {
      const reply: ServerMessage = {
        type: "gateway.shutdown",
        reason: "Requested by admin",
      };
      gateway.safeSend(ws, reply);
      setTimeout(() => gateway.stop(), 100);
      break;
    }

    case "voice.enroll": {
      // msg: { type: "voice.enroll", profileId: string, audio: string }
      try {
        const { enrollVoiceSample } = await import("../voice/voiceprint.js");
        const result = await enrollVoiceSample(msg.profileId, msg.audio);
        gateway.safeSend(ws, {
          type: "voice.enroll.result",
          profileId: msg.profileId,
          sampleCount: result.sampleCount,
          isComplete: result.isComplete,
          required: 3,
        });
      } catch (err: any) {
        gateway.safeSend(ws, { type: "voice.enroll.error", error: err.message });
      }
      break;
    }

    case "voice.verify": {
      // msg: { type: "voice.verify", audio: string }
      try {
        const { verifySpeaker } = await import("../voice/voiceprint.js");
        const result = await verifySpeaker(msg.audio);
        gateway.safeSend(ws, {
          type: "voice.verify.result",
          matched: result.matched,
          profileId: result.profileId,
          similarity: result.similarity,
        });
      } catch (err: any) {
        gateway.safeSend(ws, { type: "voice.verify.error", error: err.message });
      }
      break;
    }

    case "trigger.create": {
      const trigger = gateway.triggerEngine.createTrigger(gateway.clients.get(clientId)?.userId ?? "local", {
        name: msg.name,
        description: msg.description,
        condition: msg.condition as import("../triggers/index.js").TriggerCondition,
        action: msg.action,
        cooldownMs: msg.cooldownMs,
      });
      gateway.safeSend(ws, { type: "trigger.created", trigger } as unknown as ServerMessage);
      break;
    }
    case "trigger.list": {
      const triggers = gateway.triggerEngine.listTriggers(gateway.clients.get(clientId)?.userId ?? "local");
      gateway.safeSend(ws, { type: "trigger.list.result", triggers } as unknown as ServerMessage);
      break;
    }
    case "trigger.update": {
      const trigger = gateway.triggerEngine.updateTrigger(msg.triggerId, msg.updates);
      gateway.safeSend(ws, { type: "trigger.updated", trigger } as unknown as ServerMessage);
      break;
    }
    case "trigger.delete": {
      gateway.triggerEngine.deleteTrigger(msg.triggerId);
      gateway.safeSend(ws, { type: "trigger.deleted", triggerId: msg.triggerId } as unknown as ServerMessage);
      break;
    }
    case "trigger.history": {
      const entries = gateway.triggerEngine.getTriggerHistory(msg.triggerId, msg.limit);
      gateway.safeSend(ws, { type: "trigger.history.result", triggerId: msg.triggerId, entries } as unknown as ServerMessage);
      break;
    }

    // ── Permission responder commands ──────────────────────────────────────
    case "permission.policy.get": {
      const policy = gateway.config.approvalPolicy ?? null;
      gateway.safeSend(ws, { type: "permission.policy.report", policy } as unknown as ServerMessage);
      break;
    }
    case "permission.policy.update": {
      const client = gateway.clients.get(clientId);
      if (client?.role !== "ui" && client?.role !== "cli") {
        gateway.safeSend(ws, { type: "error", message: "Admin role required to update permission policy" });
        break;
      }
      // Merge the incoming patch into config (runtime only — not persisted to disk)
      const patch = (msg as unknown as { policy: Record<string, unknown> }).policy ?? {};
      (gateway.config as any).approvalPolicy = { ...gateway.config.approvalPolicy, ...patch };
      if (gateway.approvalEngine) {
        // Re-create the engine with the updated policy
        gateway.approvalEngine = new (await import("../vision/approval-policy.js")).ApprovalEngine(gateway.config.approvalPolicy!);
        gateway.orchestrator.approvalEngine = gateway.approvalEngine;
        if (gateway.claudeCodeResponder) {
          await gateway.claudeCodeResponder.stop();
          gateway.claudeCodeResponder = new (await import("../vision/permission-responder.js")).ClaudeCodeResponder(
            (gateway.orchestrator as any).surface,
            gateway.approvalEngine,
            { enabled: gateway.config.approvalPolicy?.enabled ?? false }
          );
          if (gateway.config.approvalPolicy?.enabled) gateway.claudeCodeResponder.start();
        }
      }
      gateway.safeSend(ws, { type: "permission.policy.report", policy: gateway.config.approvalPolicy } as unknown as ServerMessage);
      break;
    }
    case "permission.history": {
      const history = gateway.claudeCodeResponder?.getHistory() ?? [];
      gateway.safeSend(ws, { type: "permission.history.result", history } as unknown as ServerMessage);
      break;
    }
    case "permission.start": {
      if (!gateway.claudeCodeResponder) {
        gateway.safeSend(ws, { type: "error", message: "No permission responder configured. Set approvalPolicy in config." });
        break;
      }
      if (!gateway.claudeCodeResponder.isRunning) {
        gateway.claudeCodeResponder.start();
      }
      gateway.safeSend(ws, { type: "permission.status", running: gateway.claudeCodeResponder.isRunning } as unknown as ServerMessage);
      break;
    }
    case "permission.stop": {
      if (gateway.claudeCodeResponder?.isRunning) {
        await gateway.claudeCodeResponder.stop();
      }
      gateway.safeSend(ws, { type: "permission.status", running: false } as unknown as ServerMessage);
      break;
    }

    case "events.query": {
      const events = gateway.eventBus.getRecent({
        type: (msg as import("./protocol.js").EventsQueryMessage).eventType,
        limit: (msg as import("./protocol.js").EventsQueryMessage).limit,
        since: (msg as import("./protocol.js").EventsQueryMessage).since,
      });
      gateway.safeSend(ws, { type: "events.list", events } as import("./protocol.js").ServerMessage);
      break;
    }

    case "events.rules.list": {
      const rules = gateway.ruleEngine.listRules().map((r: any) => ({
        id: r.id,
        name: r.name,
        eventPattern: r.eventPattern,
        condition: r.condition,
        action: r.action,
        enabled: r.enabled,
      }));
      gateway.safeSend(ws, { type: "events.rules.result", rules } as import("./protocol.js").ServerMessage);
      break;
    }

    case "events.rules.add": {
      const addMsg = msg as import("./protocol.js").EventRuleAddMessage;
      gateway.ruleEngine.addRule({
        name: addMsg.name,
        eventPattern: addMsg.eventPattern,
        condition: addMsg.condition,
        action: addMsg.action as import("../events/rule-engine.js").EventRule["action"],
        enabled: true,
      });
      const rules = gateway.ruleEngine.listRules().map((r: any) => ({
        id: r.id, name: r.name, eventPattern: r.eventPattern, condition: r.condition, action: r.action, enabled: r.enabled,
      }));
      gateway.safeSend(ws, { type: "events.rules.result", rules } as import("./protocol.js").ServerMessage);
      break;
    }

    case "events.rules.toggle": {
      const toggleMsg = msg as import("./protocol.js").EventRuleToggleMessage;
      gateway.ruleEngine.toggleRule(toggleMsg.ruleId, toggleMsg.enabled);
      const rules = gateway.ruleEngine.listRules().map((r: any) => ({
        id: r.id, name: r.name, eventPattern: r.eventPattern, condition: r.condition, action: r.action, enabled: r.enabled,
      }));
      gateway.safeSend(ws, { type: "events.rules.result", rules } as import("./protocol.js").ServerMessage);
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