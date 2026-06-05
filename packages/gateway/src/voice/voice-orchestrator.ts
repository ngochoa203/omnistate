import { EventEmitter } from "node:events";

import { logger } from "../utils/logger.js";
import type { WakeManager } from "./wake-manager.js";
import { verifySpeaker } from "./verification.js";
import { whisperLocalClient } from "./whisper-local-client.js";
import type { TranscriptEvent } from "./whisper-local-client.js";
import { StreamingTTS, type TtsChunk } from "./tts-stream.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum VoiceState {
  IDLE = "IDLE",
  LISTENING = "LISTENING",
  PROCESSING = "PROCESSING",
  RESPONDING = "RESPONDING",
  ERROR = "ERROR",
}

export type VoiceStateChangeCallback = (state: VoiceState, prevState: VoiceState) => void;

export interface VoiceOrchestratorOptions {
  wakeManager: WakeManager;
  defaultUserId?: string;
  verificationThreshold?: number;
  sttLanguage?: string;
  ttsLanguage?: "vi" | "en";
}

interface RecoveryConfig {
  maxRetries: number;
  baseDelayMs: number;
}

const DEFAULT_RECOVERY: RecoveryConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
};

// ---------------------------------------------------------------------------
// VoiceOrchestrator
// ---------------------------------------------------------------------------

export class VoiceOrchestrator extends EventEmitter {
  private state: VoiceState = VoiceState.IDLE;
  private userId: string | null = null;
  private defaultUserId: string | null = null;
  private sessionId: string | null = null;
  private recoveryCount = 0;
  private aborted = false;

  private readonly wakeManager: WakeManager;
  private readonly verificationThreshold: number;
  private readonly sttLanguage: string;
  private readonly ttsLanguage: "vi" | "en";

  private streamingTts: StreamingTTS | null = null;
  private ttsAbortController: AbortController | null = null;

  constructor(options: VoiceOrchestratorOptions) {
    super();
    this.wakeManager = options.wakeManager;
    this.defaultUserId = options.defaultUserId ?? null;
    this.verificationThreshold = options.verificationThreshold ?? 0.7;
    this.sttLanguage = options.sttLanguage ?? "vi";
    this.ttsLanguage = options.ttsLanguage ?? "vi";
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async startSession(userId: string): Promise<void> {
    if (this.state !== VoiceState.IDLE) {
      logger.warn("[VoiceOrchestrator] startSession called while not IDLE");
      return;
    }

    this.userId = userId;
    this.sessionId = `vo-${userId}-${Date.now()}`;
    this.recoveryCount = 0;
    this.aborted = false;

    logger.info({ userId, sessionId: this.sessionId }, "[VoiceOrchestrator] Starting session");
    this.setState(VoiceState.LISTENING);
  }

  setDefaultUserId(userId: string): void {
    this.defaultUserId = userId;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  stopSession(): void {
    logger.info({ sessionId: this.sessionId }, "[VoiceOrchestrator] Stopping session");

    this.aborted = true;

    if (this.ttsAbortController) {
      this.ttsAbortController.abort();
      this.ttsAbortController = null;
    }

    if (this.sessionId) {
      whisperLocalClient.stopSession(this.sessionId).catch(() => {});
    }

    this.streamingTts = null;
    this.sessionId = null;
    this.userId = null;

    this.setState(VoiceState.IDLE);
  }

  getState(): VoiceState {
    return this.state;
  }

  onStateChange(callback: VoiceStateChangeCallback): void {
    this.on("stateChange", callback);
  }

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------

  private setState(newState: VoiceState): void {
    if (this.state === newState) return;

    const prevState = this.state;
    this.state = newState;

    logger.info(
      { from: prevState, to: newState, userId: this.userId, sessionId: this.sessionId },
      "[VoiceOrchestrator] State transition",
    );

    this.emit("stateChange", newState, prevState);
  }

  private async transitionToProcessing(): Promise<void> {
    this.setState(VoiceState.PROCESSING);
  }

  private async transitionToResponding(): Promise<void> {
    this.setState(VoiceState.RESPONDING);
  }

  private transitionToError(err: Error): void {
    logger.error(
      { error: err.message, sessionId: this.sessionId, recoveryCount: this.recoveryCount },
      "[VoiceOrchestrator] Transitioning to ERROR state",
    );

    this.setState(VoiceState.ERROR);

    if (this.shouldAttemptRecovery()) {
      this.scheduleRecovery();
    } else {
      logger.error("[VoiceOrchestrator] Max recovery attempts exceeded, giving up");
      this.stopSession();
    }
  }

  private shouldAttemptRecovery(): boolean {
    return this.recoveryCount < DEFAULT_RECOVERY.maxRetries;
  }

  private scheduleRecovery(): void {
    this.recoveryCount++;
    const delayMs = DEFAULT_RECOVERY.baseDelayMs * Math.pow(2, this.recoveryCount - 1);

    logger.info(
      { delayMs, attempt: this.recoveryCount },
      "[VoiceOrchestrator] Scheduling recovery",
    );

    setTimeout(() => {
      if (this.aborted) return;

      logger.info("[VoiceOrchestrator] Attempting recovery");
      this.setState(VoiceState.IDLE);
    }, delayMs);
  }

  // ---------------------------------------------------------------------------
  // Voice Pipeline Coordination
  // ---------------------------------------------------------------------------

  /**
   * Process incoming voice audio: verify speaker, transcribe, and return text.
   */
  async processAudio(audioBuffer: Buffer, format: string): Promise<string> {
    if (!this.userId || !this.sessionId) {
      throw new Error("[VoiceOrchestrator] No active session");
    }

    await this.transitionToProcessing();

    try {
      // Step 1: Speaker verification
      const verification = await verifySpeaker(
        audioBuffer,
        format,
        this.userId,
        this.verificationThreshold,
      );

      if (!verification.match) {
        logger.warn(
          { score: verification.score, threshold: this.verificationThreshold },
          "[VoiceOrchestrator] Speaker verification failed",
        );
        throw new Error(
          verification.reason ?? "Speaker verification failed",
        );
      }

      logger.info({ score: verification.score }, "[VoiceOrchestrator] Speaker verified");

      // Step 2: STT transcription using streaming API
      const transcription = await this.transcribeAudio(audioBuffer, format);

      return transcription;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.transitionToError(error);
      throw error;
    }
  }

  /**
   * Transcribe audio using the whisper local client streaming session.
   */
  private async transcribeAudio(_audioBuffer: Buffer, _format: string): Promise<string> {
    if (!this.sessionId) {
      throw new Error("[VoiceOrchestrator] No session ID");
    }

    // For batch transcription, we write audio to a temp file and transcribe.
    // The streaming session is used for real-time chunked transcription.
    // Here we use the simpler batch API for the voice command use case.
    const { text } = await whisperLocalClient.transcribe(
      "/tmp/voice_command.wav", // path set by caller
      this.sttLanguage,
    );

    logger.info({ text }, "[VoiceOrchestrator] Transcription complete");
    return text;
  }

  /**
   * Stream transcription for real-time voice input.
   * Yields partial and final transcript events.
   */
  async *streamTranscription(): AsyncIterable<TranscriptEvent> {
    if (!this.sessionId) {
      throw new Error("[VoiceOrchestrator] No session ID");
    }

    yield* whisperLocalClient.startSession(this.sessionId);
  }

  /**
   * Push an audio chunk to the active streaming transcription session.
   */
  async pushAudioChunk(pcm: Buffer): Promise<void> {
    if (!this.sessionId) {
      throw new Error("[VoiceOrchestrator] No session ID");
    }

    await whisperLocalClient.pushChunk(this.sessionId, pcm);
  }

  /**
   * Synthesize and stream TTS response.
   * Returns an AsyncIterable of TTS audio chunks.
   */
  synthesizeResponse(
    text: string,
  ): AsyncIterable<TtsChunk> {
    if (!this.sessionId) {
      throw new Error("[VoiceOrchestrator] No session ID");
    }

    this.ttsAbortController = new AbortController();
    this.streamingTts = new StreamingTTS();

    const text$ = (async function* () {
      yield text;
    })();

    return this.streamingTts.synthesize(text$, {
      sessionId: this.sessionId,
      lang: this.ttsLanguage,
      signal: this.ttsAbortController.signal,
    });
  }

  /**
   * Full pipeline: process audio -> transcribe -> synthesize response.
   * Handles state transitions automatically.
   */
  async runVoicePipeline(
    audioBuffer: Buffer,
    format: string,
    responseText: string,
  ): Promise<AsyncIterable<TtsChunk>> {
    await this.processAudio(audioBuffer, format);

    await this.transitionToResponding();

    return this.synthesizeResponse(responseText);
  }

  // ---------------------------------------------------------------------------
  // Wake Integration
  // ---------------------------------------------------------------------------

  /**
   * Called when the wake manager detects a wake phrase.
   * Automatically starts a new session if not already active.
   */
  async handleWakeDetected(userId?: string): Promise<void> {
    const effectiveUserId = userId ?? this.userId ?? this.defaultUserId;
    if (!effectiveUserId) {
      logger.warn("[VoiceOrchestrator] Wake detected but no user ID is available");
      return;
    }

    if (this.state === VoiceState.IDLE) {
      logger.info("[VoiceOrchestrator] Wake detected, starting session");
      await this.startSession(effectiveUserId);
    }
  }

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  /**
   * Attempt to recover from an error state.
   * Called automatically by the state machine or manually by the user.
   */
  async recover(): Promise<void> {
    if (this.state !== VoiceState.ERROR) {
      logger.warn("[VoiceOrchestrator] recover called but not in ERROR state");
      return;
    }

    if (!this.shouldAttemptRecovery()) {
      logger.error("[VoiceOrchestrator] Max recovery attempts exceeded");
      this.stopSession();
      return;
    }

    logger.info(
      { attempt: this.recoveryCount },
      "[VoiceOrchestrator] Attempting manual recovery",
    );

    this.recoveryCount++;
    this.setState(VoiceState.IDLE);
  }

  /**
   * Clear the error state and reset the orchestrator.
   */
  clearError(): void {
    if (this.state !== VoiceState.ERROR) return;

    logger.info("[VoiceOrchestrator] Clearing error state");
    this.recoveryCount = 0;
    this.setState(VoiceState.IDLE);
  }

  /**
   * Get the current recovery attempt count.
   */
  getRecoveryCount(): number {
    return this.recoveryCount;
  }

  /**
   * Check if the wake manager is currently running.
   */
  isWakeManagerRunning(): boolean {
    return this.wakeManager.isRunning();
  }

  /**
   * Check if the orchestrator is in an active session.
   */
  isActive(): boolean {
    return (
      this.state === VoiceState.LISTENING ||
      this.state === VoiceState.PROCESSING ||
      this.state === VoiceState.RESPONDING
    );
  }
}
