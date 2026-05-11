import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const log = childLogger("streaming-wake");

export interface StreamingWakeConfig {
  engine: "porcupine" | "oww";
  modelPath?: string;
  accessKey?: string;
  threshold?: number;
  aliases?: string[];
  onWake?: (phrase: string, sessionId: string, confidence: number) => void;
  onAudioData?: (pcm: Buffer) => void;
  onError?: (error: Error) => void;
}

export interface SessionState {
  sessionId: string;
  status: "idle" | "listening" | "paused" | "woken";
  lastWakeTime: number;
  cooldownUntil: number;
}

export interface StreamingWakeListener {
  start(sessionId: string): void;
  stop(sessionId: string): void;
  pause(sessionId: string): void;
  resume(sessionId: string): void;
  isActive(sessionId: string): boolean;
  getSessionState(sessionId: string): SessionState["status"];
  setThreshold(threshold: number): void;
  getConfig(): StreamingWakeConfig;
}

const DEFAULT_THRESHOLD = 0.5;
const COOLDOWN_MS = 3000;

const DEFAULT_ALIASES = [
  "mimi", "hey mimi", "ok mimi", "mimi ơi", "mimi oi",
  "mi mi", "hi mimi", "he mimi", "ê mimi", "hey siri"
];

class StreamingWakeListenerImpl extends EventEmitter implements StreamingWakeListener {
  private config: StreamingWakeConfig;
  private sessions = new Map<string, SessionState>();
  private currentThreshold: number;
  private activeSessions = new Set<string>();

  constructor(config: StreamingWakeConfig) {
    super();
    this.config = {
      threshold: DEFAULT_THRESHOLD,
      aliases: DEFAULT_ALIASES,
      ...config,
    };
    this.currentThreshold = this.config.threshold ?? DEFAULT_THRESHOLD;
  }

  private getOrCreateSession(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        status: "idle",
        lastWakeTime: 0,
        cooldownUntil: 0,
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private isInCooldown(session: SessionState): boolean {
    return Date.now() < session.cooldownUntil;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public triggerWake(sessionId: string, phrase: string, confidence: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = "woken";
    session.lastWakeTime = Date.now();
    session.cooldownUntil = Date.now() + COOLDOWN_MS;

    log.info(
      { sessionId, phrase, confidence },
      "[StreamingWake] Wake phrase detected"
    );

    this.emit("wake", { sessionId, phrase, confidence });

    if (this.config.onWake) {
      this.config.onWake(phrase, sessionId, confidence);
    }

    // Schedule return to listening after cooldown
    setTimeout(() => {
      const s = this.sessions.get(sessionId);
      if (s && s.status === "woken" && !this.isInCooldown(s)) {
        s.status = "listening";
        this.emit("stateChange", { sessionId, status: "listening" });
      }
    }, COOLDOWN_MS);
  }

  /**
   * Process audio data for wake word detection.
   * Call this from audio stream when using continuous listening mode.
   */
  processAudio(sessionId: string, pcm: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "idle" || session.status === "paused") {
      return;
    }

    // Check cooldown
    if (this.isInCooldown(session)) {
      return;
    }

    // Emit audio data for external processing
    if (this.config.onAudioData) {
      this.config.onAudioData(pcm);
    }

    // Simple energy-based detection as placeholder
    // In production, this would call Porcupine or OWW
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
    let maxAmp = 0;
    for (let i = 0; i < samples.length; i++) {
      const amp = Math.abs(samples[i]!);
      if (amp > maxAmp) maxAmp = amp;
    }

    const normalizedEnergy = maxAmp / 32768;

    // High energy might indicate speech (potential wake phrase)
    if (normalizedEnergy > this.currentThreshold) {
      // In real implementation, this would analyze against wake phrase model
      // For now, emit energy event for monitoring
      this.emit("audioEnergy", { sessionId, energy: normalizedEnergy });
    }
  }

  /**
   * Check if audio matches a wake phrase pattern.
   * This is a simplified version - real implementation uses ML model.
   */
  checkWakePhrase(_audioBuffer: Buffer, sessionId: string): { matched: boolean; phrase: string; confidence: number } {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "listening") {
      return { matched: false, phrase: "", confidence: 0 };
    }

    if (this.isInCooldown(session)) {
      return { matched: false, phrase: "", confidence: 0 };
    }

    // Placeholder for actual ML-based wake word detection
    // In production: call Porcupine/OWW model inference
    const aliases = this.config.aliases ?? DEFAULT_ALIASES;

    // Return mock result for testing
    return {
      matched: false,
      phrase: aliases[0] ?? "mimi",
      confidence: 0,
    };
  }

  start(sessionId: string): void {
    if (this.activeSessions.has(sessionId)) {
      log.warn({ sessionId }, "[StreamingWake] Session already started");
      return;
    }

    const session = this.getOrCreateSession(sessionId);
    session.status = "listening";
    session.lastWakeTime = 0;
    session.cooldownUntil = 0;

    this.activeSessions.add(sessionId);

    log.info({ sessionId, threshold: this.currentThreshold }, "[StreamingWake] Session started");
    this.emit("sessionStarted", { sessionId });
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "idle";
    }

    this.activeSessions.delete(sessionId);

    log.info({ sessionId }, "[StreamingWake] Session stopped");
    this.emit("sessionStopped", { sessionId });
  }

  pause(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = "paused";

    log.info({ sessionId }, "[StreamingWake] Session paused");
    this.emit("stateChange", { sessionId, status: "paused" });
  }

  resume(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "paused") return;

    if (!this.isInCooldown(session)) {
      session.status = "listening";
      log.info({ sessionId }, "[StreamingWake] Session resumed");
      this.emit("stateChange", { sessionId, status: "listening" });
    } else {
      log.debug({ sessionId, cooldownRemaining: session.cooldownUntil - Date.now() }, "[StreamingWake] Still in cooldown");
    }
  }

  isActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId) &&
           (this.sessions.get(sessionId)?.status === "listening" ||
            this.sessions.get(sessionId)?.status === "woken");
  }

  getSessionState(sessionId: string): SessionState["status"] {
    return this.sessions.get(sessionId)?.status ?? "idle";
  }

  setThreshold(threshold: number): void {
    this.currentThreshold = Math.max(0.1, Math.min(0.9, threshold));
    log.info({ threshold: this.currentThreshold }, "[StreamingWake] Threshold updated");
  }

  getConfig(): StreamingWakeConfig {
    return { ...this.config };
  }

  /**
   * Get all active sessions.
   */
  getActiveSessions(): string[] {
    return Array.from(this.activeSessions);
  }

  /**
   * Get statistics.
   */
  getStats(): { activeSessions: number; totalSessions: number } {
    return {
      activeSessions: this.activeSessions.size,
      totalSessions: this.sessions.size,
    };
  }

  /**
   * Clean up all sessions.
   */
  shutdown(): void {
    for (const sessionId of this.activeSessions) {
      this.stop(sessionId);
    }
    this.sessions.clear();
    log.info("[StreamingWake] Shutdown complete");
  }
}

/**
 * Factory function to create a StreamingWakeListener.
 * Handles Porcupine vs OWW engine selection.
 */
export function createStreamingWakeListener(config: StreamingWakeConfig): StreamingWakeListener {
  // Validate Porcupine access key if needed
  if (config.engine === "porcupine" && !config.accessKey) {
    config.accessKey = process.env.PORCUPINE_ACCESS_KEY?.trim();
    if (!config.accessKey) {
      log.warn("[StreamingWake] PORCUPINE_ACCESS_KEY not set, falling back to energy detection");
    }
  }

  // Validate OWW model path
  if (config.engine === "oww") {
    const modelPath = config.modelPath ??
      process.env.OMNISTATE_WAKE_MODEL_PATH ??
      `${homedir()}/.omnistate/wake-samples/personal_template.json`;

    if (!existsSync(modelPath)) {
      log.warn({ modelPath }, "[StreamingWake] OWW model not found, using energy detection fallback");
    }
  }

  const listener = new StreamingWakeListenerImpl(config);

  return listener;
}

/**
 * Default streaming wake listener singleton.
 */
export const streamingWakeListener: StreamingWakeListener = createStreamingWakeListener({
  engine: "porcupine",
  threshold: DEFAULT_THRESHOLD,
});