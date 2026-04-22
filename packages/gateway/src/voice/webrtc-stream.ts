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
}

export interface VoiceStreamEndedMessage {
  type: "voice.stream.ended";
  sessionId: string;
}

export type VoiceStreamServerMessage =
  | VoiceStreamStartedMessage
  | VoiceStreamResultMessage
  | VoiceStreamTtsMessage
  | VoiceStreamErrorMessage
  | VoiceStreamEndedMessage;

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
  chunks: Buffer[];
  totalBytes: number;
  /** Timestamp of the last received binary frame or start. */
  lastActivityAt: number;
  /** True once a stop has been received or the buffer limit hit. */
  closed: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  send: SendFn;
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
   */
  handleControlMessage(
    clientId: string,
    msg: VoiceStreamClientMessage,
    send: SendFn,
  ): void {
    switch (msg.type) {
      case "voice.stream.start":
        this.startSession(clientId, msg, send);
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
    this.sessions.delete(clientId);
  }

  // ── Session lifecycle ───────────────────────────────────────────────────────

  private startSession(
    clientId: string,
    msg: VoiceStreamStartMessage,
    send: SendFn,
  ): void {
    // Terminate any stale session first.
    this.dropSession(clientId);

    const session: StreamSession = {
      sessionId: msg.sessionId,
      mimeType: msg.mimeType ?? "audio/webm",
      sampleRate: msg.sampleRate ?? 16_000,
      wantTts: msg.wantTts ?? false,
      ttsProfileId: msg.ttsProfileId,
      chunks: [],
      totalBytes: 0,
      lastActivityAt: Date.now(),
      closed: false,
      idleTimer: null,
      send,
    };

    this.sessions.set(clientId, session);
    this.resetIdleTimer(clientId, session);

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

    this.finalize(clientId, session).catch((err) => {
      send({
        type: "voice.stream.error",
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
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
      if (session.chunks.length === 0) {
        send({
          type: "voice.stream.error",
          sessionId: session.sessionId,
          error: "No audio data received",
        });
        return;
      }

      const audioBuffer = Buffer.concat(session.chunks);

      // ── STT ──────────────────────────────────────────────────────────────────
      const transcript = await this.transcribe(audioBuffer);

      if (!transcript.text) {
        send({
          type: "voice.stream.error",
          sessionId: session.sessionId,
          error: "Could not transcribe audio — no speech detected",
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
  private async transcribe(
    audioBuffer: Buffer,
  ): Promise<{ text: string; provider: string }> {
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

    // Race all providers in low-latency mode, first non-empty wins.
    try {
      const fastest = await Promise.any(
        orderedProviders.map(async (provider) => {
          const result = await HybridAutomation.transcribeAudio(audioBuffer, provider);
          const text = result.text.trim();
          if (!text) throw new Error(`empty transcript from ${provider}`);
          return { text, provider };
        }),
      );
      return fastest;
    } catch {
      // Race failed — try sequentially.
    }

    for (const provider of orderedProviders) {
      try {
        const result = await HybridAutomation.transcribeAudio(audioBuffer, provider);
        const text = result.text.trim();
        if (text) return { text, provider };
      } catch {
        // try next
      }
    }

    return { text: "", provider: "" };
  }

  /**
   * Synthesize TTS via the RTVC engine and send audio back to the client.
   * Falls back gracefully if RTVC is not configured.
   */
  private async synthesizeAndSend(
    session: StreamSession,
    text: string,
  ): Promise<void> {
    const { send } = session;
    try {
      const { synthesizeRtvcSpeech } = await import("./rtvc.js");
      const result = await synthesizeRtvcSpeech({
        text,
        profileId: session.ttsProfileId,
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
