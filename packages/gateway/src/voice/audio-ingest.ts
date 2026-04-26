/**
 * audio-ingest.ts
 *
 * Silero VAD endpointing for the streaming STT pipeline.
 *
 * Audio flows: binary WS frames -> pushPCM16() -> VAD -> speech.start / speech.frame / speech.end
 *
 * The Silero VAD ONNX model is downloaded on first run to
 * ~/.omnistate/models/silero_vad.onnx.  If the download fails or
 * onnxruntime-node is unavailable the class falls through to bypass mode
 * (every frame forwarded without start/end semantics).
 *
 * Session state is per-session; the class is safe to share across sessions.
 */

import { EventEmitter } from "node:events";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { childLogger } from "../utils/logger.js";

const log = childLogger("audio-ingest");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SILERO_VAD_URL =
  "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx";
const MODEL_DIR = join(homedir(), ".omnistate", "models");
const MODEL_PATH = join(MODEL_DIR, "silero_vad.onnx");

/** Silero VAD expects 512-sample frames at 16 kHz (32 ms). */
const FRAME_SAMPLES = 512;
const SAMPLE_RATE = 16_000;

// ---------------------------------------------------------------------------
// Public event types
// ---------------------------------------------------------------------------

export interface SpeechStartEvent {
  sessionId: string;
  t: number;
}

export interface SpeechFrameEvent {
  sessionId: string;
  pcm: Buffer;
}

export interface SpeechEndEvent {
  sessionId: string;
  t: number;
  durationMs: number;
}

export interface AudioIngestEvents {
  "speech.start": (ev: SpeechStartEvent) => void;
  "speech.frame": (ev: SpeechFrameEvent) => void;
  "speech.end":   (ev: SpeechEndEvent) => void;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AudioIngestConfig {
  vadEnabled: boolean;
  speechThreshold: number;
  silenceThreshold: number;
  silenceThresholdMs: number;
  minSpeechMs: number;
}

const DEFAULT_CONFIG: AudioIngestConfig = {
  vadEnabled: true,
  speechThreshold: 0.5,
  silenceThreshold: 0.35,
  silenceThresholdMs: 400,
  minSpeechMs: 250,
};

// ---------------------------------------------------------------------------
// Silero VAD LSTM state
// ---------------------------------------------------------------------------

interface VadState {
  /** Accumulated PCM16 samples not yet dispatched as a full 512-sample frame. */
  carryover: Int16Array;
  carryoverLen: number;

  /** Silero LSTM hidden states (2 x 1 x 64 float32 each). */
  h: Float32Array;
  c: Float32Array;

  /** Rolling buffer: how many consecutive frames were above speechThreshold. */
  speechRun: number;
  /** Rolling buffer: frames below silenceThreshold while in speech segment. */
  silenceRun: number;

  inSpeech: boolean;
  speechStartT: number;
  /** Accumulated PCM for the current speech segment (for minSpeechMs check). */
  segmentSamples: number;
}

function makeLstmTensor(size: number): Float32Array {
  return new Float32Array(size).fill(0);
}

function makeVadState(): VadState {
  return {
    carryover: new Int16Array(FRAME_SAMPLES),
    carryoverLen: 0,
    h: makeLstmTensor(2 * 1 * 64),
    c: makeLstmTensor(2 * 1 * 64),
    speechRun: 0,
    silenceRun: 0,
    inSpeech: false,
    speechStartT: 0,
    segmentSamples: 0,
  };
}

// ---------------------------------------------------------------------------
// ORT lazy loader
// ---------------------------------------------------------------------------

type OrtInferenceSession = {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
};

type OrtTensor = {
  data: Float32Array | BigInt64Array;
  dims: readonly number[];
};

type OrtModule = {
  InferenceSession: {
    create(path: string, opts?: Record<string, unknown>): Promise<OrtInferenceSession>;
  };
  Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => OrtTensor;
};

let ortSession: OrtInferenceSession | null = null;
let ortModule: OrtModule | null = null;
let ortInitialized = false;
let ortAvailable = false;

async function ensureModel(): Promise<void> {
  if (!existsSync(MODEL_PATH)) {
    try {
      mkdirSync(MODEL_DIR, { recursive: true });
      log.info({ url: SILERO_VAD_URL, dest: MODEL_PATH }, "downloading Silero VAD model");
      const resp = await fetch(SILERO_VAD_URL);
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status} fetching model`);
      }
      // fetch body is a web ReadableStream — convert to node stream via pipeline workaround
      const dest = createWriteStream(MODEL_PATH);
      const reader = resp.body.getReader();
      await new Promise<void>((resolve, reject) => {
        function pump(): void {
          reader.read().then(({ done, value }) => {
            if (done) {
              dest.end();
              resolve();
              return;
            }
            dest.write(value, (err) => {
              if (err) { reject(err); return; }
              pump();
            });
          }).catch(reject);
        }
        pump();
      });
      log.info({ dest: MODEL_PATH }, "Silero VAD model downloaded");
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "failed to download Silero VAD model — VAD disabled");
      throw err;
    }
  }
}

async function initOrt(): Promise<void> {
  if (ortInitialized) return;
  ortInitialized = true;

  try {
    await ensureModel();

    // Dynamic import so onnxruntime-node is optional at build time
    ortModule = (await import("onnxruntime-node")) as unknown as OrtModule;
    ortSession = await ortModule.InferenceSession.create(MODEL_PATH, { executionProviders: ["cpu"] });
    ortAvailable = true;
    log.info("Silero VAD ONNX session ready");
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "Silero VAD unavailable — falling through to bypass mode");
    ortAvailable = false;
  }
}

// ---------------------------------------------------------------------------
// Silero inference for a single 512-sample frame
// ---------------------------------------------------------------------------

async function runVadFrame(
  samples: Int16Array,
  state: VadState,
): Promise<number> {
  if (!ortSession || !ortModule) return 0;

  // Normalise Int16 -> Float32 in [-1, 1]
  const input = new Float32Array(FRAME_SAMPLES);
  for (let i = 0; i < FRAME_SAMPLES; i++) {
    input[i] = (samples[i] ?? 0) / 32768;
  }

  // Silero VAD v4 expects: input [1,512], sr int64 [1], h [2,1,64], c [2,1,64]
  const srData = new BigInt64Array([BigInt(SAMPLE_RATE)]);

  const feeds: Record<string, OrtTensor> = {
    input: new ortModule.Tensor("float32", input, [1, FRAME_SAMPLES]),
    sr: new ortModule.Tensor("int64", srData, [1]),
    h: new ortModule.Tensor("float32", state.h, [2, 1, 64]),
    c: new ortModule.Tensor("float32", state.c, [2, 1, 64]),
  };

  const out = await ortSession.run(feeds);

  // Update LSTM state in-place
  if (out["hn"]) state.h = out["hn"].data as Float32Array;
  if (out["cn"]) state.c = out["cn"].data as Float32Array;

  const probData = out["output"]?.data;
  if (!probData || probData.length === 0) return 0;
  return (probData as Float32Array)[0] ?? 0;
}

// ---------------------------------------------------------------------------
// AudioIngest
// ---------------------------------------------------------------------------

/**
 * AudioIngest ingests raw PCM16 LE mono 16 kHz audio and emits speech events.
 *
 * When vadEnabled, frames are run through the Silero VAD ONNX model and only
 * frames inside a detected speech segment are emitted as speech.frame events,
 * bounded by speech.start and speech.end.
 *
 * When vadEnabled=false (bypass), every frame is emitted as speech.frame with
 * no start/end semantics (Phase 1 passthrough behaviour preserved).
 *
 * Public API difference from Phase 1 stub:
 *   - startSession / pushPCM16 / stopSession  (renamed for clarity)
 *   - pushPCM16 accepts Int16Array, not Buffer
 *   - SpeechStartEvent and SpeechEndEvent carry { t, durationMs? }
 */
export class AudioIngest extends EventEmitter {
  private readonly config: AudioIngestConfig;
  private states = new Map<string, VadState>();
  private _ready: Promise<void> | null = null;

  constructor(config: Partial<AudioIngestConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Warm up ORT session (called lazily on first start if not called explicitly). */
  async warmup(): Promise<void> {
    if (!this.config.vadEnabled) return;
    this._ready ??= initOrt();
    await this._ready;
  }

  /** Begin a new per-session VAD state. */
  start(sessionId: string): void {
    if (this.states.has(sessionId)) {
      log.warn({ sessionId }, "AudioIngest.start: duplicate sessionId ignored");
      return;
    }
    this.states.set(sessionId, makeVadState());
    log.debug({ sessionId }, "AudioIngest: session started");

    // Kick off ORT init in background; pushPCM16 awaits _ready before inference
    if (this.config.vadEnabled) {
      this._ready ??= initOrt();
    }
  }

  /**
   * Push a PCM16 LE mono 16 kHz Int16Array for the given session.
   * Frames are collected in 512-sample windows before being run through VAD.
   */
  async pushPCM16(sessionId: string, pcm: Int16Array): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) {
      log.warn({ sessionId }, "AudioIngest.pushPCM16: unknown session");
      return;
    }

    if (!this.config.vadEnabled) {
      // Bypass: forward all data as speech.frame immediately
      this._emitFrame(sessionId, pcm);
      return;
    }

    // Ensure ORT is ready (no-op after first call)
    await this._ready;

    if (!ortAvailable) {
      // ORT unavailable — bypass mode fallback
      this._emitFrame(sessionId, pcm);
      return;
    }

    // Accumulate samples and dispatch in 512-sample windows
    let offset = 0;
    while (offset < pcm.length) {
      const needed = FRAME_SAMPLES - state.carryoverLen;
      const available = pcm.length - offset;
      const take = Math.min(needed, available);

      state.carryover.set(pcm.subarray(offset, offset + take), state.carryoverLen);
      state.carryoverLen += take;
      offset += take;

      if (state.carryoverLen === FRAME_SAMPLES) {
        await this._processVadFrame(sessionId, state, new Int16Array(state.carryover));
        state.carryoverLen = 0;
      }
    }
  }

  /**
   * Signal end of audio for a session.  Flushes any partial carryover frame,
   * closes any open speech segment, and removes session state.
   */
  async stop(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) {
      log.warn({ sessionId }, "AudioIngest.stop: unknown session");
      return;
    }

    if (state.carryoverLen > 0 && this.config.vadEnabled && ortAvailable) {
      // Zero-pad the last partial frame and process it
      const padded = new Int16Array(FRAME_SAMPLES);
      padded.set(state.carryover.subarray(0, state.carryoverLen));
      await this._processVadFrame(sessionId, state, padded);
    }

    // Close any open speech segment
    if (state.inSpeech) {
      this._closeSpeechSegment(sessionId, state);
    }

    this.states.delete(sessionId);
    log.debug({ sessionId }, "AudioIngest: session stopped");
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async _processVadFrame(sessionId: string, state: VadState, samples: Int16Array): Promise<void> {
    let prob = 0;
    try {
      prob = await runVadFrame(samples, state);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err), sessionId }, "VAD inference error — treating as silence");
    }

    const { speechThreshold, silenceThreshold, silenceThresholdMs, minSpeechMs } = this.config;
    const frameDurationMs = (FRAME_SAMPLES / SAMPLE_RATE) * 1000; // 32 ms
    const silenceFramesNeeded = Math.ceil(silenceThresholdMs / frameDurationMs);

    if (!state.inSpeech) {
      if (prob >= speechThreshold) {
        state.speechRun++;
        state.silenceRun = 0;
      } else {
        state.speechRun = 0;
      }

      if (state.speechRun >= 3) {
        // Speech onset confirmed
        state.inSpeech = true;
        state.speechStartT = Date.now();
        state.segmentSamples = 0;
        state.silenceRun = 0;
        this.emit("speech.start", { sessionId, t: state.speechStartT } satisfies SpeechStartEvent);
        log.debug({ sessionId }, "VAD: speech started");
      }
    } else {
      // Inside speech — emit frame
      this._emitFrame(sessionId, samples);

      if (prob < silenceThreshold) {
        state.silenceRun++;
        state.speechRun = 0;
      } else {
        // Only count voiced frames toward segment duration
        state.segmentSamples += FRAME_SAMPLES;
        state.silenceRun = 0;
        state.speechRun++;
      }

      if (state.silenceRun >= silenceFramesNeeded) {
        // Silence timeout — close the speech segment
        const durationMs = (state.segmentSamples / SAMPLE_RATE) * 1000;
        if (durationMs >= minSpeechMs) {
          this._closeSpeechSegment(sessionId, state);
        } else {
          // Too short — drop the segment silently
          log.debug({ sessionId, durationMs, minSpeechMs }, "VAD: speech segment below minSpeechMs — dropped");
          state.inSpeech = false;
          state.speechRun = 0;
          state.silenceRun = 0;
        }
      }
    }
  }

  private _closeSpeechSegment(sessionId: string, state: VadState): void {
    const t = Date.now();
    const durationMs = (state.segmentSamples / SAMPLE_RATE) * 1000;
    state.inSpeech = false;
    state.speechRun = 0;
    state.silenceRun = 0;
    this.emit("speech.end", { sessionId, t, durationMs } satisfies SpeechEndEvent);
    log.debug({ sessionId, durationMs }, "VAD: speech ended");
  }

  private _emitFrame(sessionId: string, samples: Int16Array): void {
    const pcm = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
    this.emit("speech.frame", { sessionId, pcm } satisfies SpeechFrameEvent);
  }

  // ── Typed EventEmitter overloads ──────────────────────────────────────────

  override emit<K extends keyof AudioIngestEvents>(
    event: K,
    ...args: Parameters<AudioIngestEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof AudioIngestEvents>(
    event: K,
    listener: AudioIngestEvents[K],
  ): this {
    return super.on(event, listener);
  }

  override once<K extends keyof AudioIngestEvents>(
    event: K,
    listener: AudioIngestEvents[K],
  ): this {
    return super.once(event, listener);
  }
}
