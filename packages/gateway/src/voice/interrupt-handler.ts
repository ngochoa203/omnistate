import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";

const log = childLogger("interrupt-handler");

export type InterruptPriority = "critical" | "high" | "normal" | "low";
export type InterruptType = "barge_in" | "timeout" | "error" | "user_cancel" | "system_cancel";

export interface InterruptContext {
  type: InterruptType;
  priority: InterruptPriority;
  sessionId: string;
  userId?: string;
  reason?: string;
  timestamp: number;
  canResume: boolean;
}

export interface ResponseCancellation {
  cancelled: boolean;
  partialResponseDelivered: boolean;
  resumeFromPoint?: string;
  compensation?: string;
}

export interface MonitorOptions {
  energyThreshold?: number;
  silenceFramesRequired?: number;
  maxResponseBeforeInterrupt?: number;
}

interface MonitorState {
  silentFrames: number;
  totalEnergy: number;
  frameCount: number;
  responseDeliveredChars: number;
}

const DEFAULT_MONITOR_OPTIONS: Required<MonitorOptions> = {
  energyThreshold: 0.3,
  silenceFramesRequired: 3,
  maxResponseBeforeInterrupt: 50,
};

// Priority weight for comparison
const PRIORITY_WEIGHTS: Record<InterruptPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

class InterruptHandlerImpl extends EventEmitter implements InterruptHandler {
  private interruptState = new Map<string, InterruptContext | null>();
  private monitorState = new Map<string, MonitorState>();
  private monitorOptions = new Map<string, Required<MonitorOptions>>();
  private activeMonitors = new Set<string>();
  private responseCharCounts = new Map<string, number>();

  shouldInterrupt(incoming: InterruptContext, current: InterruptContext | null): boolean {
    if (!current) return true;

    const incomingWeight = PRIORITY_WEIGHTS[incoming.priority];
    const currentWeight = PRIORITY_WEIGHTS[current.priority];

    // Critical always wins
    if (incoming.priority === "critical") return true;
    if (current.priority === "critical") return false;

    // Higher priority wins
    if (incomingWeight > currentWeight) return true;
    if (incomingWeight < currentWeight) return false;

    // Same priority - most recent wins (if different sessions)
    if (incoming.sessionId !== current.sessionId) return true;

    // Same session, same priority - later timestamp wins
    return incoming.timestamp > current.timestamp;
  }

  cancelResponse(sessionId: string): ResponseCancellation {
    const state = this.monitorState.get(sessionId);
    const deliveredChars = this.responseCharCounts.get(sessionId) ?? 0;
    const maxChars = this.monitorOptions.get(sessionId)?.maxResponseBeforeInterrupt ?? DEFAULT_MONITOR_OPTIONS.maxResponseBeforeInterrupt;

    if (!state) {
      log.debug({ sessionId }, "No monitor state for cancellation");
      return { cancelled: false, partialResponseDelivered: false };
    }

    const partialResponseDelivered = deliveredChars > maxChars * 0.5;
    let resumeFromPoint: string | undefined;
    let compensation: string | undefined;

    if (partialResponseDelivered) {
      // Generate resume point based on delivered characters
      resumeFromPoint = "continuation";

      // Generate compensation text for significant interruption
      if (deliveredChars > maxChars * 0.8) {
        compensation = "Xin lỗi, để tôi nghe lại. Bạn cần gì?";
      } else if (deliveredChars > maxChars * 0.5) {
        compensation = "Xin lỗi, bạn nói lại được không?";
      }
    }

    // Clear state
    this.monitorState.delete(sessionId);
    this.responseCharCounts.delete(sessionId);
    this.interruptState.delete(sessionId);

    log.info(
      { sessionId, deliveredChars, partialResponseDelivered, compensation },
      "Response cancelled"
    );

    this.emit("responseCancelled", { sessionId, deliveredChars, partialResponseDelivered });

    return {
      cancelled: true,
      partialResponseDelivered,
      resumeFromPoint,
      compensation,
    };
  }

  getInterruptState(sessionId: string): InterruptContext | null {
    return this.interruptState.get(sessionId) ?? null;
  }

  recordResponseDelivery(sessionId: string, textLength: number): void {
    const current = this.responseCharCounts.get(sessionId) ?? 0;
    this.responseCharCounts.set(sessionId, current + textLength);

    log.debug(
      { sessionId, totalChars: current + textLength, newChars: textLength },
      "Response delivery recorded"
    );
  }

  checkForInterrupt(sessionId: string, audioEnergy: number): boolean {
    const state = this.monitorState.get(sessionId);
    if (!state) return false;

    const options = this.monitorOptions.get(sessionId) ?? DEFAULT_MONITOR_OPTIONS;

    if (audioEnergy > options.energyThreshold) {
      // User speaking - reset silence counter
      state.silentFrames = 0;
      state.totalEnergy += audioEnergy;
      state.frameCount++;

      // If energy is very high, trigger immediate interrupt
      if (audioEnergy > options.energyThreshold * 2) {
        log.info({ sessionId, audioEnergy }, "High energy spike - triggering interrupt");

        const ctx: InterruptContext = {
          type: "barge_in",
          priority: "high",
          sessionId,
          timestamp: Date.now(),
          canResume: true,
        };

        this.interruptState.set(sessionId, ctx);
        this.emit("interrupt", ctx);
        return true;
      }

      // If consecutive speaking frames exceed threshold, trigger interrupt
      if (state.frameCount > options.silenceFramesRequired) {
        log.info({ sessionId, speakingFrames: state.frameCount }, "Speaking detected - triggering interrupt");

        const ctx: InterruptContext = {
          type: "barge_in",
          priority: "high",
          sessionId,
          timestamp: Date.now(),
          canResume: true,
        };

        this.interruptState.set(sessionId, ctx);
        this.emit("interrupt", ctx);
        return true;
      }
    } else {
      // Silence - increment silent frame counter
      state.silentFrames++;

      // Reset speaking if too much silence
      if (state.silentFrames > options.silenceFramesRequired * 2) {
        state.frameCount = 0;
      }
    }

    return false;
  }

  startMonitoring(sessionId: string, options?: MonitorOptions): void {
    const opts = {
      energyThreshold: options?.energyThreshold ?? DEFAULT_MONITOR_OPTIONS.energyThreshold,
      silenceFramesRequired: options?.silenceFramesRequired ?? DEFAULT_MONITOR_OPTIONS.silenceFramesRequired,
      maxResponseBeforeInterrupt: options?.maxResponseBeforeInterrupt ?? DEFAULT_MONITOR_OPTIONS.maxResponseBeforeInterrupt,
    };

    this.monitorOptions.set(sessionId, opts);

    const state: MonitorState = {
      silentFrames: 0,
      totalEnergy: 0,
      frameCount: 0,
      responseDeliveredChars: 0,
    };

    this.monitorState.set(sessionId, state);
    this.responseCharCounts.set(sessionId, 0);
    this.activeMonitors.add(sessionId);

    log.info(
      { sessionId, opts },
      "Interrupt monitoring started"
    );

    this.emit("monitoringStarted", { sessionId, options: opts });
  }

  stopMonitoring(sessionId: string): void {
    this.monitorState.delete(sessionId);
    this.monitorOptions.delete(sessionId);
    this.responseCharCounts.delete(sessionId);
    this.interruptState.delete(sessionId);
    this.activeMonitors.delete(sessionId);

    log.info({ sessionId }, "Interrupt monitoring stopped");
    this.emit("monitoringStopped", { sessionId });
  }
}

export interface InterruptHandler {
  shouldInterrupt(incoming: InterruptContext, current: InterruptContext | null): boolean;
  cancelResponse(sessionId: string): ResponseCancellation;
  getInterruptState(sessionId: string): InterruptContext | null;
  recordResponseDelivery(sessionId: string, textLength: number): void;
  checkForInterrupt(sessionId: string, audioEnergy: number): boolean;
  startMonitoring(sessionId: string, options?: MonitorOptions): void;
  stopMonitoring(sessionId: string): void;
}

export interface InterruptHandler extends EventEmitter {
  on(event: "interrupt", listener: (ctx: InterruptContext) => void): this;
  on(event: "responseCancelled", listener: (info: { sessionId: string; deliveredChars: number; partialResponseDelivered: boolean }) => void): this;
  on(event: "monitoringStarted", listener: (info: { sessionId: string; options: Required<MonitorOptions> }) => void): this;
  on(event: "monitoringStopped", listener: (info: { sessionId: string }) => void): this;
  emit(event: "interrupt", ctx: InterruptContext): boolean;
  emit(event: "responseCancelled", info: { sessionId: string; deliveredChars: number; partialResponseDelivered: boolean }): boolean;
  emit(event: "monitoringStarted", info: { sessionId: string; options: Required<MonitorOptions> }): boolean;
  emit(event: "monitoringStopped", info: { sessionId: string }): boolean;
}

// Singleton export
export const interruptHandler: InterruptHandler = new InterruptHandlerImpl();
