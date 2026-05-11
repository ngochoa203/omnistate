/**
 * whisper-local-client.ts
 *
 * Singleton that manages a long-lived `whisper_server.py` subprocess and
 * multiplexes async transcription requests over its stdin/stdout.
 *
 * Features:
 * - Model fallback chain (large -> medium -> small -> tiny)
 * - Request batching with parallel processing and per-request timeouts
 * - Streaming quality adaptation based on audio characteristics
 * - Session state persistence (shutdown/resume/crash recovery)
 * - Health check method
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname, join } from "node:path";
import { childLogger } from "../utils/logger.js";
import { loadLlmRuntimeConfig } from "../llm/runtime-config.js";

const log = childLogger("whisper-local-client");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TranscribeRequest {
  id: string;
  wav_path: string;
  language: string;
}

interface TranscribeResponse {
  id?: string;
  text?: string;
  durationMs?: number;
  error?: string;
  ready?: boolean;
  model?: string;
  device?: string;
}

interface PendingResolver {
  resolve: (result: { text: string; durationMs: number }) => void;
  reject: (err: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

/** Control message sent to the streaming whisper_server. */
interface WhisperCtrlMsg {
  cmd: "start" | "chunk" | "stop";
  session: string;
  pcm_b64?: string;
}

/** Transcript event emitted by the streaming whisper_server. */
interface WhisperStreamEvent {
  kind?: "partial" | "final";
  session?: string;
  text?: string;
  t0?: number;
  t1?: number;
  error?: string;
  ready?: boolean;
}

/** Single transcript event yielded by the streaming API. */
export interface TranscriptEvent {
  kind: "partial" | "final";
  text: string;
  t0: number;
  t1: number;
}

/** Per-session subscriber set for streaming responses. */
interface StreamSubscriber {
  push: (ev: TranscriptEvent) => void;
  done: () => void;
  error: (err: Error) => void;
}

/** Audio quality classification for streaming adaptation. */
export type AudioQuality = "clean" | "noisy" | "unknown";

/** Session state for persistence. */
interface SessionState {
  activeSessions: string[];
  currentModel: string;
  lastUsed: number;
  batchQueueSize: number;
  streamSubsCount: number;
}

/** Health check result. */
export interface HealthCheckResult {
  healthy: boolean;
  model: string;
  device: string;
  ready: boolean;
  activeSessions: number;
  pendingRequests: number;
  uptimeMs: number;
  restartCount: number;
  lastError?: string;
}

/** Model fallback chain configuration. */
const MODEL_CHAIN = ["large", "medium", "small", "tiny"] as const;
type WhisperModel = (typeof MODEL_CHAIN)[number];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRIPT_PATH = resolve(process.cwd(), "scripts/voice/whisper_server.py");
const STATE_FILE_PATH = join(process.cwd(), ".omnistate", "whisper-state.json");

const MAX_RESTARTS_PER_MINUTE = 3;
const RESTART_WINDOW_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const BATCH_SIZE = 10;
const BATCH_INTERVAL_MS = 100;

// ---------------------------------------------------------------------------
// WhisperLocalClient
// ---------------------------------------------------------------------------

class WhisperLocalClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingResolver>();
  private streamSubs = new Map<string, StreamSubscriber>();
  private ready = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private restartTimestamps: number[] = [];
  private idCounter = 0;
  private terminated = false;
  private currentModel: WhisperModel;
  private startTime = Date.now();
  private lastError: string | undefined;
  private activeModelIndex = 0;

  // Request batching
  private batchQueue: Array<{
    req: TranscribeRequest;
    resolver: PendingResolver;
  }> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  // Audio quality tracking for streaming adaptation
  private sessionQuality = new Map<string, AudioQuality>();

  private get pythonExec(): string {
    return (
      process.env.WHISPER_PYTHON?.trim() ||
      process.env.OMNISTATE_RTC_PYTHON?.trim() ||
      "python3"
    );
  }

  private get whisperDevice(): string {
    const explicit = process.env.WHISPER_DEVICE?.trim().toLowerCase();
    if (explicit === "cpu" || explicit === "cuda" || explicit === "mps") return explicit;
    if (process.platform === "darwin" && process.arch === "arm64") return "cpu";
    return "cpu";
  }

  constructor() {
    const envModel = process.env.WHISPER_MODEL?.trim() as WhisperModel;
    const configModel = loadLlmRuntimeConfig().voice.whisperLocalModel as WhisperModel;
    this.currentModel = envModel || configModel || "small";
    this.activeModelIndex = MODEL_CHAIN.indexOf(this.currentModel);
    if (this.activeModelIndex === -1) {
      this.activeModelIndex = 2; // default to "small"
      this.currentModel = MODEL_CHAIN[this.activeModelIndex];
    }
    this.restoreSessionState();
  }

  // -------------------------------------------------------------------------
  // Model Fallback Chain
  // -------------------------------------------------------------------------

  /**
   * Try the next model in the fallback chain.
   * Returns true if a fallback model was attempted, false if at end of chain.
   */
  private tryFallbackModel(): boolean {
    if (this.activeModelIndex >= MODEL_CHAIN.length - 1) {
      log.error("All models in fallback chain exhausted");
      return false;
    }

    this.activeModelIndex++;
    const fallbackModel = MODEL_CHAIN[this.activeModelIndex];
    log.info(
      { currentModel: this.currentModel, fallbackModel },
      "attempting model fallback"
    );
    this.setModel(fallbackModel);
    return true;
  }

  /**
   * Get the current active model name.
   */
  getActiveModel(): string {
    return this.currentModel;
  }

  // -------------------------------------------------------------------------
  // Request Batching
  // -------------------------------------------------------------------------

  /**
   * Add a request to the batch queue and flush if batch is full.
   */
  private enqueueBatchRequest(
    req: TranscribeRequest,
    resolver: PendingResolver,
    timeoutMs: number
  ): void {
    // Set timeout for this request
    resolver.timeout = setTimeout(() => {
      if (this.pending.has(req.id)) {
        this.pending.delete(req.id);
        resolver.reject(new Error(`Transcription request ${req.id} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    this.batchQueue.push({ req, resolver });

    if (this.batchQueue.length >= BATCH_SIZE) {
      this.flushBatch();
    } else if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flushBatch(), BATCH_INTERVAL_MS);
    }
  }

  /**
   * Flush all pending requests in the batch to the subprocess.
   */
  private flushBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.batchQueue.length === 0) return;
    if (!this.proc || !this.ready) {
      // Reject all if not ready
      for (const { resolver } of this.batchQueue) {
        if (resolver.timeout) clearTimeout(resolver.timeout);
        resolver.reject(new Error("whisper_server not ready"));
      }
      this.batchQueue = [];
      return;
    }

    const batch = [...this.batchQueue];
    this.batchQueue = [];

    for (const { req } of batch) {
      this.pending.set(req.id, { resolve: () => {}, reject: () => {} });
      this.proc.stdin.write(JSON.stringify(req) + "\n");
    }

    // Re-map resolvers after flush
    for (const { req, resolver } of batch) {
      this.pending.set(req.id, resolver);
    }

    log.debug({ batchSize: batch.length }, "flushed batch request");
  }

  // -------------------------------------------------------------------------
  // Streaming Quality Adaptation
  // -------------------------------------------------------------------------

  /**
   * Analyze audio buffer for quality and return classification.
   * Simple energy-based detection: noisy = high variance / clipping.
   */
  analyzeAudioQuality(pcm: Buffer): AudioQuality {
    if (pcm.length < 1600) return "unknown"; // Less than 100ms of 16kHz audio

    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
    let sum = 0;
    let sumSq = 0;
    let maxAmp = 0;
    let clippingCount = 0;

    for (let i = 0; i < samples.length; i++) {
      const amp = Math.abs(samples[i]);
      sum += amp;
      sumSq += amp * amp;
      if (amp > maxAmp) maxAmp = amp;
      if (amp >= 32000) clippingCount++;
    }

    const mean = sum / samples.length;
    const variance = sumSq / samples.length - mean * mean;

    // High variance or clipping indicates noisy audio
    if (clippingCount > samples.length * 0.01 || variance > 5000000) {
      return "noisy";
    }
    if (variance < 500000 && maxAmp < 20000) {
      return "clean";
    }
    return "unknown";
  }

  /**
   * Set audio quality for a session and adapt model if needed.
   */
  setSessionQuality(sessionId: string, quality: AudioQuality): void {
    this.sessionQuality.set(sessionId, quality);

    // Auto-adapt model based on quality
    if (quality === "noisy" && this.activeModelIndex < MODEL_CHAIN.length - 1) {
      // Switch to smaller model for noisy audio
      const smallerModel = MODEL_CHAIN[this.activeModelIndex + 1];
      if (this.currentModel !== smallerModel) {
        log.info(
          { sessionId, from: this.currentModel, to: smallerModel, reason: "noisy audio" },
          "adapting model for audio quality"
        );
        this.setModel(smallerModel);
      }
    } else if (quality === "clean" && this.activeModelIndex > 0) {
      // Switch back to larger model for clean audio
      const largerModel = MODEL_CHAIN[this.activeModelIndex - 1];
      if (this.currentModel !== largerModel) {
        log.info(
          { sessionId, from: this.currentModel, to: largerModel, reason: "clean audio" },
          "adapting model for audio quality"
        );
        this.setModel(largerModel);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Session State Persistence
  // -------------------------------------------------------------------------

  /**
   * Persist current session state to disk.
   */
  private persistSessionState(): void {
    try {
      const state: SessionState = {
        activeSessions: Array.from(this.streamSubs.keys()),
        currentModel: this.currentModel,
        lastUsed: Date.now(),
        batchQueueSize: this.batchQueue.length,
        streamSubsCount: this.streamSubs.size,
      };

      const dir = dirname(STATE_FILE_PATH);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), "utf-8");
      log.debug({ stateFile: STATE_FILE_PATH }, "session state persisted");
    } catch (err) {
      log.warn({ error: err }, "failed to persist session state");
    }
  }

  /**
   * Restore session state from disk on startup.
   */
  private restoreSessionState(): void {
    try {
      if (!existsSync(STATE_FILE_PATH)) {
        log.debug("no saved session state found");
        return;
      }

      const raw = readFileSync(STATE_FILE_PATH, "utf-8");
      const state: SessionState = JSON.parse(raw) as SessionState;

      log.info(
        {
          previousModel: state.currentModel,
          lastUsed: new Date(state.lastUsed).toISOString(),
          activeSessions: state.activeSessions,
        },
        "restored session state"
      );

      // Note: active streaming sessions cannot be recovered across process restarts
      // The state is informative only; actual session recovery happens via startSession
      if (state.activeSessions.length > 0) {
        log.warn(
          { sessions: state.activeSessions },
          "streaming sessions cannot survive process restart; client will start fresh"
        );
      }
    } catch (err) {
      log.warn({ error: err }, "failed to restore session state");
    }
  }

  // -------------------------------------------------------------------------
  // Process Management
  // -------------------------------------------------------------------------

  private resetReadyGate(): void {
    this.ready = false;
    this.readyPromise = new Promise<void>((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });
    // Keep startup failures from surfacing as process-level unhandledRejection
    // when no transcribe call is currently awaiting the gate.
    void this.readyPromise.catch(() => {});
  }

  private start(): void {
    if (!existsSync(SCRIPT_PATH)) {
      const msg = `whisper_server.py not found at ${SCRIPT_PATH}`;
      log.error(msg);
      this.readyReject?.(new Error(msg));
      return;
    }

    const python = this.pythonExec;
    const device = this.whisperDevice;
    log.info({ python, script: SCRIPT_PATH, model: this.currentModel, device }, "spawning whisper_server");

    this.proc = spawn(python, [SCRIPT_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, WHISPER_MODEL: this.currentModel, WHISPER_DEVICE: device },
    });

    const rl = createInterface({ input: this.proc.stdout, crlfDelay: Infinity });

    rl.on("line", (line) => {
      let msg: TranscribeResponse & WhisperStreamEvent;
      try {
        msg = JSON.parse(line) as TranscribeResponse & WhisperStreamEvent;
      } catch {
        log.warn({ line }, "unparseable stdout line from whisper_server");
        return;
      }

      if (msg.ready) {
        log.info({ model: msg.model, device: msg.device }, "whisper_server ready");
        this.ready = true;
        const reportedModel = (msg.model || this.currentModel) as WhisperModel;
        this.activeModelIndex = MODEL_CHAIN.indexOf(reportedModel);
        if (this.activeModelIndex === -1) {
          this.activeModelIndex = MODEL_CHAIN.indexOf(this.currentModel);
        }
        this.readyResolve?.();
        this.persistSessionState();
        return;
      }

      if (msg.error && !msg.id && !msg.session) {
        log.error({ error: msg.error }, "whisper_server startup error");
        this.lastError = msg.error;

        // Try fallback model if load failed
        if (msg.error.includes("model") || msg.error.includes("load") || msg.error.includes("memory")) {
          if (this.tryFallbackModel()) {
            return; // Fallback triggered; restart will happen
          }
        }

        this.readyReject?.(new Error(msg.error));
        return;
      }

      // Streaming transcript event (kind + session)
      if (msg.kind && msg.session) {
        const sub = this.streamSubs.get(msg.session);
        if (sub) {
          sub.push({
            kind: msg.kind,
            text: msg.text ?? "",
            t0: msg.t0 ?? 0,
            t1: msg.t1 ?? 0,
          });
          if (msg.kind === "final") {
            this.streamSubs.delete(msg.session);
            this.sessionQuality.delete(msg.session);
            sub.done();
          }
        }
        return;
      }

      // Legacy batch response (id field)
      if (msg.id) {
        const resolver = this.pending.get(msg.id);
        if (!resolver) return;
        this.pending.delete(msg.id);
        if (resolver.timeout) clearTimeout(resolver.timeout);
        if (msg.error) {
          resolver.reject(new Error(msg.error));
        } else {
          resolver.resolve({ text: msg.text ?? "", durationMs: msg.durationMs ?? 0 });
        }
      }
    });

    this.proc.stderr.on("data", (chunk: Buffer) => {
      // Surface stderr as info so users see whisper_server lifecycle + per-request
      // logs without having to bump log level. Stderr is bounded (~1 line/request).
      log.info({ stderr: chunk.toString().trimEnd() }, "whisper_server stderr");
    });

    this.proc.on("close", (code) => {
      if (this.terminated) return;
      // proc was set to null by setModel — suppress auto-restart if intentional
      if (this.proc === null && !this.readyPromise) return;
      log.warn({ code }, "whisper_server exited unexpectedly");

      // Reject all pending requests
      for (const [id, resolver] of this.pending) {
        if (resolver.timeout) clearTimeout(resolver.timeout);
        resolver.reject(new Error(`whisper_server exited with code ${code}`));
        this.pending.delete(id);
      }

      // Terminate all streaming sessions
      for (const [sid, sub] of this.streamSubs) {
        sub.error(new Error(`whisper_server exited with code ${code}`));
        this.streamSubs.delete(sid);
        this.sessionQuality.delete(sid);
      }

      // Flush batch queue
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
        this.batchTimer = null;
      }
      for (const { resolver } of this.batchQueue) {
        if (resolver.timeout) clearTimeout(resolver.timeout);
        resolver.reject(new Error(`whisper_server exited with code ${code}`));
      }
      this.batchQueue = [];

      this.proc = null;
      this.ready = false;

      // Restart with backoff enforcement
      const now = Date.now();
      this.restartTimestamps = this.restartTimestamps.filter(
        (t) => now - t < RESTART_WINDOW_MS
      );

      if (this.restartTimestamps.length >= MAX_RESTARTS_PER_MINUTE) {
        const msg = "whisper_server exceeded max restarts per minute; giving up";
        log.error(msg);
        this.lastError = msg;
        this.readyReject?.(new Error(msg));
        return;
      }

      this.restartTimestamps.push(now);
      log.info("restarting whisper_server");
      this.resetReadyGate();
      this.start();
    });
  }

  private ensureRunning(): Promise<void> {
    if (this.proc && this.ready) return Promise.resolve();
    if (this.readyPromise) {
      return this.readyPromise.catch((err) => {
        this.readyPromise = null;
        throw err;
      });
    }

    this.resetReadyGate();
    this.start();
    return this.readyPromise!.catch((err) => {
      this.readyPromise = null;
      throw err;
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async transcribe(
    wavPath: string,
    language: string,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<{ text: string; durationMs: number }> {
    await this.ensureRunning();

    const id = String(++this.idCounter);
    const req: TranscribeRequest = { id, wav_path: wavPath, language };

    return new Promise<{ text: string; durationMs: number }>((resolve, reject) => {
      const resolver: PendingResolver = { resolve, reject };
      this.enqueueBatchRequest(req, resolver, timeoutMs);
    });
  }

  /**
   * Begin a streaming STT session for `sessionId`.
   * Returns an AsyncIterable that yields partial and final transcript events.
   * The iterable completes when the server emits a final event for this session
   * (triggered by calling stopSession).
   */
  async *startSession(sessionId: string): AsyncIterable<TranscriptEvent> {
    await this.ensureRunning();

    // Buffer events that arrive before the consumer calls next()
    const queue: Array<TranscriptEvent | Error | null> = [];
    let notify: (() => void) | null = null;

    const sub: StreamSubscriber = {
      push(ev) {
        queue.push(ev);
        notify?.();
      },
      done() {
        queue.push(null); // sentinel
        notify?.();
      },
      error(err) {
        queue.push(err);
        notify?.();
      },
    };

    this.streamSubs.set(sessionId, sub);
    this.sessionQuality.set(sessionId, "unknown");
    this.persistSessionState();

    const ctrl: WhisperCtrlMsg = { cmd: "start", session: sessionId };
    this.proc!.stdin.write(JSON.stringify(ctrl) + "\n");

    try {
      while (true) {
        if (queue.length === 0) {
          // Wait for the next push
          await new Promise<void>((res) => { notify = res; });
          notify = null;
        }
        while (queue.length > 0) {
          const item = queue.shift()!;
          if (item === null) return; // done sentinel
          if (item instanceof Error) throw item;
          yield item;
        }
      }
    } finally {
      this.streamSubs.delete(sessionId);
      this.sessionQuality.delete(sessionId);
      this.persistSessionState();
    }
  }

  /** Push a PCM16 LE mono 16kHz chunk (as a Buffer) to an active streaming session. */
  async pushChunk(sessionId: string, pcm: Buffer): Promise<void> {
    await this.ensureRunning();

    // Auto-detect audio quality for adaptation
    const quality = this.analyzeAudioQuality(pcm);
    if (quality !== "unknown") {
      this.setSessionQuality(sessionId, quality);
    }

    const ctrl: WhisperCtrlMsg = {
      cmd: "chunk",
      session: sessionId,
      pcm_b64: pcm.toString("base64"),
    };
    this.proc!.stdin.write(JSON.stringify(ctrl) + "\n");
  }

  /**
   * Signal end of audio for a streaming session.
   * The server will emit a final transcript event; the AsyncIterable from
   * startSession() will complete after that event is yielded.
   */
  async stopSession(sessionId: string): Promise<void> {
    await this.ensureRunning();
    const ctrl: WhisperCtrlMsg = { cmd: "stop", session: sessionId };
    this.proc!.stdin.write(JSON.stringify(ctrl) + "\n");
  }

  /** Switch to a different Whisper model; kills the current subprocess and respawns. */
  setModel(model: string): void {
    const modelKey = model as WhisperModel;
    if (!MODEL_CHAIN.includes(modelKey)) {
      log.warn({ model }, "unknown model; using small");
    }

    const targetModel = MODEL_CHAIN.includes(modelKey) ? modelKey : "small";

    if (targetModel === this.currentModel && this.proc && this.ready) return;
    log.info({ from: this.currentModel, to: targetModel }, "whisper model change; restarting subprocess");
    this.currentModel = targetModel;
    this.activeModelIndex = MODEL_CHAIN.indexOf(targetModel);

    // Kill the current process (close handler will NOT auto-restart because we set proc = null first)
    const prev = this.proc;
    this.proc = null;
    this.ready = false;

    // Flush and reject batch queue
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    for (const { resolver } of this.batchQueue) {
      if (resolver.timeout) clearTimeout(resolver.timeout);
      resolver.reject(new Error("whisper_server restarting for model change"));
    }
    this.batchQueue = [];

    if (prev) prev.kill("SIGTERM");
    // Reject any in-flight requests
    for (const [id, resolver] of this.pending) {
      if (resolver.timeout) clearTimeout(resolver.timeout);
      resolver.reject(new Error("whisper_server restarting for model change"));
      this.pending.delete(id);
    }
    for (const [sid, sub] of this.streamSubs) {
      sub.error(new Error("whisper_server restarting for model change"));
      this.streamSubs.delete(sid);
      this.sessionQuality.delete(sid);
    }
    this.readyPromise = null;
    this.persistSessionState();
  }

  /**
   * Health check for the whisper client.
   * Returns status information about the client.
   */
  healthCheck(): HealthCheckResult {
    return {
      healthy: this.proc !== null && this.ready,
      model: this.currentModel,
      device: this.whisperDevice,
      ready: this.ready,
      activeSessions: this.streamSubs.size,
      pendingRequests: this.pending.size + this.batchQueue.length,
      uptimeMs: Date.now() - this.startTime,
      restartCount: this.restartTimestamps.length,
      lastError: this.lastError,
    };
  }

  /** Gracefully shut down the subprocess (call on process exit). */
  shutdown(): void {
    this.terminated = true;
    this.persistSessionState();
    this.proc?.kill("SIGTERM");
    this.proc = null;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

const _client = new WhisperLocalClient();

process.on("exit", () => _client.shutdown());

export const whisperLocalClient = _client;