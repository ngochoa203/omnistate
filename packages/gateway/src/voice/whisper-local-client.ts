/**
 * whisper-local-client.ts
 *
 * Singleton that manages a long-lived `whisper_server.py` subprocess and
 * multiplexes async transcription requests over its stdin/stdout.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRIPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../scripts/whisper_server.py"
);

const MAX_RESTARTS_PER_MINUTE = 3;
const RESTART_WINDOW_MS = 60_000;

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
  private currentModel: string;

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
    this.currentModel = loadLlmRuntimeConfig().voice.whisperLocalModel ?? "small";
  }

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
        this.readyResolve?.();
        return;
      }

      if (msg.error && !msg.id && !msg.session) {
        log.error({ error: msg.error }, "whisper_server startup error");
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
      // proc was set to null by setModel — suppress auto-restart
      if (this.proc === null && !this.readyPromise) return;
      log.warn({ code }, "whisper_server exited unexpectedly");

      // Reject all pending requests
      for (const [id, resolver] of this.pending) {
        resolver.reject(new Error(`whisper_server exited with code ${code}`));
        this.pending.delete(id);
      }
      // Terminate all streaming sessions
      for (const [sid, sub] of this.streamSubs) {
        sub.error(new Error(`whisper_server exited with code ${code}`));
        this.streamSubs.delete(sid);
      }

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

  async transcribe(wavPath: string, language: string): Promise<{ text: string; durationMs: number }> {
    await this.ensureRunning();

    const id = String(++this.idCounter);
    const req: TranscribeRequest = { id, wav_path: wavPath, language };

    return new Promise<{ text: string; durationMs: number }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin.write(JSON.stringify(req) + "\n");
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
    }
  }

  /** Push a PCM16 LE mono 16kHz chunk (as a Buffer) to an active streaming session. */
  async pushChunk(sessionId: string, pcm: Buffer): Promise<void> {
    await this.ensureRunning();
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

  /** Switch to a different Whisper model; kills the current subprocess and respawns. */  setModel(model: string): void {
    if (model === this.currentModel && this.proc && this.ready) return;
    log.info({ from: this.currentModel, to: model }, "whisper model change; restarting subprocess");
    this.currentModel = model;
    // Kill the current process (close handler will NOT auto-restart because we set proc = null first)
    const prev = this.proc;
    this.proc = null;
    this.ready = false;
    if (prev) prev.kill("SIGTERM");
    // Reject any in-flight requests
    for (const [id, resolver] of this.pending) {
      resolver.reject(new Error("whisper_server restarting for model change"));
      this.pending.delete(id);
    }
    for (const [sid, sub] of this.streamSubs) {
      sub.error(new Error("whisper_server restarting for model change"));
      this.streamSubs.delete(sid);
    }
    this.readyPromise = null;
  }

  /** Gracefully shut down the subprocess (call on process exit). */
  shutdown(): void {
    this.terminated = true;
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
