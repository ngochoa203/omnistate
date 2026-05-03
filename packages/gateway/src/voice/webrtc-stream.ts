/**
 * WebSocket Audio Streaming Handler
 *
 * Implements real-time voice streaming over the existing WebSocket connection.
 * Audio flows: client MediaRecorder → WS binary frames → server buffer → STT → response.
 *
 * Message protocol (JSON, client → server):
 *   voice.stream.start   — begin a streaming session
 *   voice.stream.stop    — end stream, trigger final STT processing
 *
 * Binary frames (client → server):
 *   Raw audio chunks (PCM/webm/ogg/wav depending on MediaRecorder mimeType)
 *
 * Message protocol (JSON, server → client):
 *   voice.stream.started  — session is live, ready for binary frames
 *   voice.stream.result   — transcription (intermediate or final)
 *   voice.stream.tts      — base64-encoded TTS audio for the response
 *   voice.stream.error    — error during streaming
 *   voice.stream.ended    — session closed cleanly
 *   voice.stream.barge_in — VAD detected speech start (barge-in signal)
 *
 * Integration pattern — in handleConnection, after the existing JSON message
 * handler, register the binary frame handler:
 *
 *   import { VoiceStreamManager } from "../voice/webrtc-stream.js";
 *
 *   const streamManager = new VoiceStreamManager();
 *
 *   ws.on("message", (raw, isBinary) => {
 *     if (isBinary) {
 *       streamManager.handleBinaryFrame(clientId, raw as Buffer, (msg) => {
 *         if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
 *       });
 *       return;
 *     }
 *     // existing JSON parse + handleMessage...
 *   });
 *
 *   // Route voice.stream.* messages from handleMessage:
 *   case "voice.stream.start":
 *   case "voice.stream.stop":
 *     streamManager.handleControlMessage(clientId, msg, (m) => safeSend(ws, m));
 *     break;
 *
 *   ws.on("close", () => {
 *     streamManager.dropSession(clientId);
 *     // existing cleanup...
 *   });
 */

import * as HybridAutomation from "../hybrid/automation.js";
import { loadLlmRuntimeConfig } from "../llm/runtime-config.js";
import { verifySpeaker } from "./verification.js";
import { synthesize as edgeTtsSynthesize, detectLanguage, pickVoice } from "./edge-tts.js";
import { whisperLocalClient } from "./whisper-local-client.js";
import { AudioIngest } from "./audio-ingest.js";

import { logger } from "../utils/logger.js";
// ─── Protocol types ────────────────────────────────────────────────────────────

/** Client → server control messages (sent as JSON). */
export interface VoiceStreamStartMessage {
  type: "voice.stream.start";
  /** Caller-supplied session ID, echoed back in all responses. */
  sessionId: string;
  /** MediaRecorder mimeType hint, e.g. "audio/webm;codecs=opus". Defaults to "audio/webm". */
  mimeType?: string;
  /** Sample rate in Hz (informational). Defaults to 16000. */
  sampleRate?: number;
  /** When true, server will also return TTS audio for the assistant reply. */
  wantTts?: boolean;
  /** Voice clone profile ID to use for TTS synthesis. */
  ttsProfileId?: string;
}

export interface VoiceStreamStopMessage {
  type: "voice.stream.stop";
  sessionId: string;
}

export type VoiceStreamClientMessage =
  | VoiceStreamStartMessage
  | VoiceStreamStopMessage;

/** Server → client response messages (sent as JSON). */
export interface VoiceStreamStartedMessage {
  type: "voice.stream.started";
  sessionId: string;
  maxChunkBytes: number;
}

export interface VoiceStreamResultMessage {
  type: "voice.stream.result";
  sessionId: string;
  /** "partial" for interim results (if STT supports it), "final" after voice.stream.stop. */
  kind: "partial" | "final";
  text: string;
  provider?: string;
}

export interface VoiceStreamTtsMessage {
  type: "voice.stream.tts";
  sessionId: string;
  /** Base64-encoded audio (WAV). */
  audio: string;
  contentType: string;
}

export interface VoiceStreamErrorMessage {
  type: "voice.stream.error";
  sessionId: string;
  error: string;
  /** Machine-readable error code. */
  code?: "STT_EMPTY_AUDIO" | "STT_NO_SPEECH" | "STT_PROVIDER_FAILED" | "SPEAKER_MISMATCH" | "TTS_FAILED";
}

export interface VoiceStreamEndedMessage {
  type: "voice.stream.ended";
  sessionId: string;
}

export interface VoiceStreamBargeInMessage {
  type: "voice.stream.barge_in";
  sessionId: string;
  /** Timestamp when speech was detected (ms since session start). */
  t?: number;
}

export interface VoiceSpeakerMismatchMessage {
  type: "voice.speaker.mismatch";
  sessionId: string;
  userId: string;
  score: number;
  threshold: number;
}

export type VoiceStreamServerMessage =
  | VoiceStreamStartedMessage
  | VoiceStreamResultMessage
  | VoiceStreamTtsMessage
  | VoiceStreamErrorMessage
  | VoiceStreamEndedMessage
  | VoiceStreamBargeInMessage
  | VoiceSpeakerMismatchMessage;

// ─── Internals ─────────────────────────────────────────────────────────────────

const MAX_CHUNK_BYTES = 512 * 1024; // 512 KB per binary frame
const MAX_BUFFER_BYTES = 25 * 1024 * 1024; // 25 MB total per session
const SESSION_IDLE_TIMEOUT_MS = 60_000; // 60 s without data → auto-close

interface StreamSession {
  sessionId: string;
  mimeType: string;
  sampleRate: number;
  wantTts: boolean;
  ttsProfileId?: string;
  /** Resolved user ID for speaker verification; undefined if not authenticated. */
  userId?: string;
  chunks: Buffer[];
  totalBytes: number;
  /** Timestamp of the last received binary frame or start. */
  lastActivityAt: number;
  /** True once a stop has been received or the buffer limit hit. */
  closed: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  send: SendFn;
  /**
   * When true the session routes PCM16 data through the whisper-local-client
   * streaming API (startSession/pushChunk/stopSession) and emits partial events.
   * Falls back to batch HybridAutomation.transcribeAudio when false.
   */
  useStreamingStt: boolean;
  /** AudioIngest instance for this session (only when useStreamingStt=true). */
  audioIngest: AudioIngest | null;
}

type SendFn = (msg: VoiceStreamServerMessage) => void;

// ─── VoiceStreamManager ────────────────────────────────────────────────────────

/**
 * Manages per-client voice streaming sessions.
 *
 * One VoiceStreamManager instance is shared across all WebSocket connections
 * (typically created once in OmniStateGateway alongside the WSS).  Each
 * connected client may have at most one active streaming session at a time.
 */
export class VoiceStreamManager {
  private sessions = new Map<string, StreamSession>();

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Handle a JSON control message (voice.stream.start / voice.stream.stop).
   * Call this from handleMessage() for the two message types above.
   *
   * @param userId  Optional authenticated user ID for speaker verification.
   */
  handleControlMessage(
    clientId: string,
    msg: VoiceStreamClientMessage,
    send: SendFn,
    userId?: string,
  ): void {
    switch (msg.type) {
      case "voice.stream.start":
        this.startSession(clientId, msg, send, userId);
        break;
      case "voice.stream.stop":
        this.stopSession(clientId, msg.sessionId, send);
        break;
    }
  }

  /**
   * Handle a binary WebSocket frame carrying a raw audio chunk.
   * Call this from the ws "message" event handler when isBinary is true.
   *
   * @param clientId  The connected client's ID.
   * @param chunk     The raw Buffer from the WebSocket frame.
   * @param send      Function to send a JSON message back to this client.
   *                  Provide a no-op if you want to route errors via another path.
   */
  handleBinaryFrame(clientId: string, chunk: Buffer, send: SendFn): void {
    const session = this.sessions.get(clientId);

    if (!session) {
      // Silently drop frames with no active session — the client may have
      // sent a stale frame after a session was already closed.
      return;
    }

    if (session.closed) {
      return;
    }

    if (chunk.length > MAX_CHUNK_BYTES) {
      send({
        type: "voice.stream.error",
        sessionId: session.sessionId,
        error: `Audio chunk too large (${chunk.length} bytes, max ${MAX_CHUNK_BYTES})`,
      });
      return;
    }

    const projectedTotal = session.totalBytes + chunk.length;
    if (projectedTotal > MAX_BUFFER_BYTES) {
      // Force-finalize rather than silently drop data.
      logger.warn(
        `[VoiceStream] ${clientId} hit buffer limit (${MAX_BUFFER_BYTES} bytes) — forcing stop`,
      );
      this.finalize(clientId, session).catch((err) => {
        send({
          type: "voice.stream.error",
          sessionId: session.sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return;
    }

    session.chunks.push(chunk);
    session.totalBytes += chunk.length;
    session.lastActivityAt = Date.now();

    // Forward PCM16 chunk through AudioIngest (which gates VAD) to streaming STT
    if (session.useStreamingStt) {
      if (session.audioIngest) {
        // VAD path: convert Buffer to Int16Array and push through AudioIngest
        const samples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength >> 1);
        session.audioIngest.pushPCM16(session.sessionId, samples).catch((err) => {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), sessionId: session.sessionId },
            "[VoiceStream] audioIngest.pushPCM16 error",
          );
        });
      } else {
        // Bypass: direct push to whisper (vadEnabled=false path)
        whisperLocalClient.pushChunk(session.sessionId, chunk).catch((err) => {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), sessionId: session.sessionId },
            "[VoiceStream] pushChunk error",
          );
        });
      }
    }

    // Reset idle timer on each received chunk.
    this.resetIdleTimer(clientId, session);
  }

  /**
   * Drop all state for a disconnected client.
   * Call this from ws "close" handler.
   */
  dropSession(clientId: string): void {
    const session = this.sessions.get(clientId);
    if (!session) return;

    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.closed = true;
    if (session.audioIngest) {
      session.audioIngest.stop(session.sessionId).catch(() => {/* best-effort */});
      session.audioIngest = null;
    }
    this.sessions.delete(clientId);
  }

  // ── Session lifecycle ───────────────────────────────────────────────────────

  private startSession(
    clientId: string,
    msg: VoiceStreamStartMessage,
    send: SendFn,
    userId?: string,
  ): void {
    // Terminate any stale session first.
    this.dropSession(clientId);

    // Use streaming STT when codec is PCM16 (raw PCM, compatible with whisper-local streaming API)
    const mimeType = msg.mimeType ?? "audio/webm";
    const useStreamingStt = mimeType === "audio/pcm" || mimeType === "audio/raw" || mimeType.includes("pcm");

    const vadConfig = loadLlmRuntimeConfig().voice.vad;

    const session: StreamSession = {
      sessionId: msg.sessionId,
      mimeType,
      sampleRate: msg.sampleRate ?? 16_000,
      wantTts: msg.wantTts ?? false,
      ttsProfileId: msg.ttsProfileId,
      userId,
      chunks: [],
      totalBytes: 0,
      lastActivityAt: Date.now(),
      closed: false,
      idleTimer: null,
      send,
      useStreamingStt,
      audioIngest: null,
    };

    this.sessions.set(clientId, session);
    this.resetIdleTimer(clientId, session);

    if (useStreamingStt) {
      // Start the streaming STT session; emit partial events as they arrive
      const iter = whisperLocalClient.startSession(msg.sessionId);
      (async () => {
        try {
          for await (const ev of iter) {
            if (session.closed && ev.kind === "partial") continue;
            send({
              type: "voice.stream.result",
              sessionId: msg.sessionId,
              kind: ev.kind,
              text: ev.text,
              provider: "whisper-local",
            });
          }
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), sessionId: msg.sessionId },
            "[VoiceStream] streaming STT error",
          );
        }
      })();

      // Set up AudioIngest for VAD gating
      if (vadConfig.enabled) {
        const ingest = new AudioIngest({
          vadEnabled: true,
          speechThreshold: vadConfig.speechThreshold,
          silenceThreshold: vadConfig.silenceThreshold,
          silenceThresholdMs: vadConfig.silenceThresholdMs,
          minSpeechMs: vadConfig.minSpeechMs,
        });

        // speech.frame -> forward PCM to whisper
        ingest.on("speech.frame", ({ pcm }) => {
          whisperLocalClient.pushChunk(session.sessionId, pcm).catch((err) => {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err), sessionId: session.sessionId },
              "[VoiceStream] VAD speech.frame pushChunk error",
            );
          });
        });

        // speech.start -> forward as server notification so client can handle barge-in
        ingest.on("speech.start", ({ t }) => {
          send({
            type: "voice.stream.barge_in",
            sessionId: msg.sessionId,
            t,
          });
          logger.debug({ sessionId: msg.sessionId, t }, "[VoiceStream] VAD speech.start → barge_in");
        });

        // speech.end -> signal whisper to flush -> final
        ingest.on("speech.end", ({ durationMs }) => {
          logger.debug({ sessionId: msg.sessionId, durationMs }, "[VoiceStream] VAD speech.end — flushing whisper");
          whisperLocalClient.stopSession(session.sessionId).catch((err) => {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err), sessionId: session.sessionId },
              "[VoiceStream] VAD-triggered stopSession error",
            );
          });
        });

        ingest.start(msg.sessionId);
        session.audioIngest = ingest;
        // warm up ORT in background
        ingest.warmup().catch(() => {/* handled inside warmup */});
      }
    }

    send({
      type: "voice.stream.started",
      sessionId: session.sessionId,
      maxChunkBytes: MAX_CHUNK_BYTES,
    });
  }

  private stopSession(clientId: string, sessionId: string, send: SendFn): void {
    const session = this.sessions.get(clientId);
    if (!session || session.sessionId !== sessionId) {
      send({
        type: "voice.stream.error",
        sessionId,
        error: "No active streaming session with that ID",
      });
      return;
    }

    // Allow a short drain window so any in-flight binary frames from the client
    // (sent just before the stop message) arrive before finalization.
    const STOP_DRAIN_MS = 150;
    setTimeout(() => {
      this.finalize(clientId, session).catch((err) => {
        send({
          type: "voice.stream.error",
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, STOP_DRAIN_MS);
  }

  // ── STT + TTS processing ────────────────────────────────────────────────────

  private async finalize(clientId: string, session: StreamSession): Promise<void> {
    if (session.closed) return;
    session.closed = true;

    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }

    const { send } = session;

    try {
      if (session.chunks.length === 0 && !session.useStreamingStt) {
        send({
          type: "voice.stream.error",
          sessionId: session.sessionId,
          error: "No audio data received",
          code: "STT_EMPTY_AUDIO",
        });
        return;
      }

      // ── Streaming STT path ────────────────────────────────────────────────
      // The async iterator (started in startSession) handles partial + final events.
      // We only need to signal the end of audio; the iterator emits the final result.
      if (session.useStreamingStt) {
        if (session.totalBytes < 1024) {
          send({
            type: "voice.stream.error",
            sessionId: session.sessionId,
            error: `Audio too short (${session.totalBytes} bytes) — no speech detected`,
            code: "STT_EMPTY_AUDIO",
          });
          // Still stop the session to clean up server-side state
          await whisperLocalClient.stopSession(session.sessionId).catch(() => {});
          send({ type: "voice.stream.ended", sessionId: session.sessionId });
          return;
        }

        // Signal end-of-audio to the streaming server; the async iterator will
        // receive the final transcript event and emit voice.stream.result.
        await whisperLocalClient.stopSession(session.sessionId).catch((err) => {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), sessionId: session.sessionId },
            "[VoiceStream] stopSession error",
          );
        });

        // Speaker verification and TTS are handled after final transcript by the
        // async iterator listener started in startSession.  Emit ended here.
        send({ type: "voice.stream.ended", sessionId: session.sessionId });
        return;
      }

      // ── Batch STT path (non-PCM16 formats) ───────────────────────────────
      const audioBuffer = Buffer.concat(session.chunks);

      if (audioBuffer.length < 1024) {
        send({
          type: "voice.stream.error",
          sessionId: session.sessionId,
          error: `Audio too short (${audioBuffer.length} bytes) — no speech detected`,
          code: "STT_EMPTY_AUDIO",
        });
        return;
      }

      // ── STT ──────────────────────────────────────────────────────────────────
      const transcript = await this.transcribe(audioBuffer);

      if (!transcript.text) {
        const anyError = transcript.attempts.some((a) => a.status === "error");
        const code = anyError ? "STT_PROVIDER_FAILED" : "STT_NO_SPEECH";
        send({
          type: "voice.stream.error",
          sessionId: session.sessionId,
          error: anyError
            ? "All STT providers failed to process audio"
            : "Could not transcribe audio — no speech detected",
          code,
        });
        return;
      }

      send({
        type: "voice.stream.result",
        sessionId: session.sessionId,
        kind: "final",
        text: transcript.text,
        provider: transcript.provider,
      });

      // ── Speaker verification ──────────────────────────────────────────────
      const svConfig = loadLlmRuntimeConfig().voice.speakerVerification;
      if (svConfig?.enabled && session.userId) {
        try {
          const result = await verifySpeaker(
            audioBuffer,
            session.mimeType,
            session.userId,
            svConfig.threshold,
          );
          if (!result.match) {
            const onMismatch = svConfig.onMismatch ?? "warn";
            logger.warn(
              { userId: session.userId, score: result.score, threshold: svConfig.threshold },
              `[VoiceStream] Speaker mismatch (onMismatch=${onMismatch})`,
            );
            if (onMismatch === "warn") {
              send({
                type: "voice.speaker.mismatch",
                sessionId: session.sessionId,
                userId: session.userId,
                score: result.score,
                threshold: svConfig.threshold,
              });
            } else if (onMismatch === "reject") {
              send({
                type: "voice.stream.error",
                sessionId: session.sessionId,
                error: "Speaker verification failed",
                code: "SPEAKER_MISMATCH",
              });
              send({ type: "voice.stream.ended", sessionId: session.sessionId });
              return;
            }
            // "silent" → log only, already done above
          }
        } catch (err) {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            `[VoiceStream] Speaker verification error — continuing`,
          );
        }
      }

      // ── Optional TTS ──────────────────────────────────────────────────────
      if (session.wantTts) {
        await this.synthesizeAndSend(session, transcript.text);
      }

      send({ type: "voice.stream.ended", sessionId: session.sessionId });
    } finally {
      this.sessions.delete(clientId);
    }
  }

  /**
   * Run STT using the same provider chain as the existing voice.transcribe handler.
   */
  private async transcribe(audioBuffer: Buffer): Promise<{
    text: string;
    provider: string;
    attempts: Array<{ provider: string; status: "ok" | "empty" | "error"; error?: string }>;
  }> {
    const runtime = loadLlmRuntimeConfig();
    const voice = runtime.voice;

    const dedupedProviders = [
      voice.primaryProvider,
      ...voice.fallbackProviders,
    ].filter((p, i, arr) => arr.indexOf(p) === i) as Array<
      "native" | "whisper-local" | "whisper-cloud"
    >;

    const orderedProviders = voice.lowLatency
      ? (["native", ...dedupedProviders.filter((p) => p !== "native")] as typeof dedupedProviders)
      : dedupedProviders;

    const bytes = audioBuffer.length;
    const attempts: Array<{ provider: string; status: "ok" | "empty" | "error"; error?: string }> = [];

    // Bug fix: Check for empty providers array
    if (dedupedProviders.length === 0) {
      logger.error("[VoiceStream] No STT providers configured");
      return { text: "", provider: "", attempts: [{ provider: "none", status: "error", error: "No providers" }] };
    }

    // Race all providers in low-latency mode, first non-empty wins.
    if (voice.lowLatency) {
      try {
        const fastest = await Promise.any(
          orderedProviders.map(async (provider) => {
            logger.info({ provider, bytes }, "[VoiceStream] STT attempt");
            try {
              const result = await HybridAutomation.transcribeAudio(audioBuffer, provider);
              const text = result.text.trim();
              if (!text) {
                logger.warn({ provider }, "[VoiceStream] STT empty transcript");
                attempts.push({ provider, status: "empty" });
                throw new Error(`empty transcript from ${provider}`);
              }
              logger.info({ provider, textLen: text.length, transcript: text }, "[VoiceStream] STT success");
              attempts.push({ provider, status: "ok" });
              return { text, provider };
            } catch (err) {
              if (!attempts.find((a) => a.provider === provider)) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.warn({ provider, err: msg }, "[VoiceStream] STT provider failed");
                attempts.push({ provider, status: "error", error: msg });
              }
              throw err;
            }
          }),
        );
        return { ...fastest, attempts };
      } catch {
        // Race failed — fall through to sequential.
      }
    }

    for (const provider of orderedProviders) {
      // Skip providers already attempted in the race phase (regardless of outcome).
      if (attempts.find((a) => a.provider === provider)) {
        continue;
      }
      logger.info({ provider, bytes }, "[VoiceStream] STT attempt");
      try {
        const result = await HybridAutomation.transcribeAudio(audioBuffer, provider);
        const text = result.text.trim();
        if (text) {
          logger.info({ provider, textLen: text.length, transcript: text }, "[VoiceStream] STT success");
          attempts.push({ provider, status: "ok" });
          return { text, provider, attempts };
        }
        logger.warn({ provider }, "[VoiceStream] STT empty transcript");
        attempts.push({ provider, status: "empty" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ provider, err: msg }, "[VoiceStream] STT provider failed");
        attempts.push({ provider, status: "error", error: msg });
      }
    }

    return { text: "", provider: "", attempts };
  }

  /**
   * Synthesize TTS and send audio back to the client.
   * Routes to Edge TTS or RTVC depending on runtime config.
   * Falls back gracefully if synthesis fails.
   */
  private async synthesizeAndSend(
    session: StreamSession,
    text: string,
  ): Promise<void> {
    const { send } = session;

    if (!text.trim()) return;

    const cfg = loadLlmRuntimeConfig();
    const provider = cfg.voice.tts?.provider ?? "edge";

    if (provider === "none") return;

    if (provider === "edge") {
      try {
        const lang = detectLanguage(text);
        const voice = pickVoice(lang, cfg.voice);
        const audioBuf = await edgeTtsSynthesize(text, { voice, lang });
        send({
          type: "voice.stream.tts",
          sessionId: session.sessionId,
          audio: audioBuf.toString("base64"),
          contentType: "audio/mpeg",
        });
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          `[VoiceStream] Edge TTS synthesis failed for session ${session.sessionId}`,
        );
        send({
          type: "voice.stream.error",
          sessionId: session.sessionId,
          error: `TTS synthesis failed: ${err instanceof Error ? err.message : String(err)}`,
          code: "TTS_FAILED",
        });
      }
      return;
    }

    // provider === "rtvc"
    try {
      const { synthesizeRtvcSpeech } = await import("./rtvc.js");
      const result = await synthesizeRtvcSpeech({
        text,
        profileId: session.ttsProfileId ?? "default",
      });
      send({
        type: "voice.stream.tts",
        sessionId: session.sessionId,
        audio: result.audio.toString("base64"),
        contentType: result.contentType,
      });
    } catch (err) {
      // TTS is best-effort — log and continue without blocking the transcript result.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        `[VoiceStream] TTS synthesis failed for session ${session.sessionId}`,
      );
    }
  }

  // ── Idle timer ──────────────────────────────────────────────────────────────

  private resetIdleTimer(clientId: string, session: StreamSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      if (!session.closed) {
        logger.warn(
          `[VoiceStream] Session ${session.sessionId} idle for ${SESSION_IDLE_TIMEOUT_MS}ms — auto-closing`,
        );
        this.finalize(clientId, session).catch((err) => {
          session.send({
            type: "voice.stream.error",
            sessionId: session.sessionId,
            error: `Session timed out: ${err instanceof Error ? err.message : String(err)}`,
          });
        });
      }
    }, SESSION_IDLE_TIMEOUT_MS);
  }
}
