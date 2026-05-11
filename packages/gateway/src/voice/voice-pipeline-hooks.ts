import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";

const log = childLogger("voice-pipeline-hooks");

export type PipelineStage =
  | "wake_detection"
  | "vad"
  | "stt"
  | "intent_parsing"
  | "entity_extraction"
  | "command_routing"
  | "tts"
  | "session_start"
  | "session_end";

export interface PipelineContext {
  userId: string;
  sessionId: string;
  stage: PipelineStage;
  language?: string;
  intent?: string;
  transcript?: string;
  audioBuffer?: Buffer;
  entities?: Record<string, string[]>;
  error?: string;
  startTime: number;
  metadata?: Record<string, unknown>;
}

export interface PipelineHook {
  id: string;
  name: string;
  stages: PipelineStage[];
  priority: number;
  enabled: boolean;
  before?: (ctx: PipelineContext) => PipelineContext | Promise<PipelineContext>;
  after?: (ctx: PipelineContext) => PipelineContext | Promise<PipelineContext>;
  onError?: (ctx: PipelineContext, error: Error) => void;
}

export interface VoicePipelineHooks {
  register(hook: PipelineHook): void;
  unregister(id: string): void;
  enable(id: string): void;
  disable(id: string): void;
  getHooks(stage: PipelineStage): PipelineHook[];
  process(stage: PipelineStage, ctx: PipelineContext): Promise<PipelineContext>;
}

class VoicePipelineHooksImpl extends EventEmitter implements VoicePipelineHooks {
  private hooks = new Map<string, PipelineHook>();

  register(hook: PipelineHook): void {
    const h: PipelineHook = {
      ...hook,
      id: hook.id || `hook-${Date.now()}`,
      priority: hook.priority ?? 0,
      enabled: hook.enabled ?? true,
      stages: hook.stages ?? [],
    };

    this.hooks.set(h.id, h);
    log.info({ id: h.id, name: h.name, stages: h.stages }, "Hook registered");
    this.emit("hookRegistered", h);
  }

  unregister(id: string): void {
    if (this.hooks.has(id)) {
      this.hooks.delete(id);
      log.info({ id }, "Hook unregistered");
      this.emit("hookUnregistered", { id });
    }
  }

  enable(id: string): void {
    const hook = this.hooks.get(id);
    if (hook) {
      hook.enabled = true;
      this.emit("hookEnabled", { id });
    }
  }

  disable(id: string): void {
    const hook = this.hooks.get(id);
    if (hook) {
      hook.enabled = false;
      this.emit("hookDisabled", { id });
    }
  }

  getHooks(stage: PipelineStage): PipelineHook[] {
    const result: PipelineHook[] = [];
    for (const hook of this.hooks.values()) {
      if (hook.enabled && hook.stages.includes(stage)) {
        result.push(hook);
      }
    }
    return result.sort((a, b) => b.priority - a.priority);
  }

  async process(stage: PipelineStage, ctx: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();
    const hookList = this.getHooks(stage);

    log.debug(
      { stage, hookCount: hookList.length, sessionId: ctx.sessionId },
      "Processing stage hooks"
    );

    let currentCtx: PipelineContext = { ...ctx, stage, startTime };

    // Run before hooks
    for (const hook of hookList) {
      if (hook.before) {
        try {
          currentCtx = await hook.before(currentCtx);
          log.debug({ hookId: hook.id, stage }, "Before hook executed");
          this.emit("hookBeforeExecuted", { hookId: hook.id, stage });
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error({ hookId: hook.id, error: error.message }, "Before hook error");
          if (hook.onError) {
            hook.onError(currentCtx, error);
          }
          this.emit("hookError", { hookId: hook.id, stage, error: error.message });
        }
      }
    }

    // Run after hooks (post-processing)
    for (const hook of hookList) {
      if (hook.after) {
        try {
          currentCtx = await hook.after(currentCtx);
          log.debug({ hookId: hook.id, stage }, "After hook executed");
          this.emit("hookAfterExecuted", { hookId: hook.id, stage });
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error({ hookId: hook.id, error: error.message }, "After hook error");
          if (hook.onError) {
            hook.onError(currentCtx, error);
          }
          this.emit("hookError", { hookId: hook.id, stage, error: error.message });
        }
      }
    }

    const duration = Date.now() - startTime;
    log.debug({ stage, duration, hookCount: hookList.length }, "Stage hooks complete");
    this.emit("stageProcessed", { stage, duration, hookCount: hookList.length });

    return currentCtx;
  }
}

export interface VoicePipelineHooks extends EventEmitter {
  on(event: "hookRegistered", listener: (hook: PipelineHook) => void): this;
  on(event: "hookUnregistered", listener: (info: { id: string }) => void): this;
  on(event: "hookEnabled" | "hookDisabled", listener: (info: { id: string }) => void): this;
  on(event: "hookBeforeExecuted" | "hookAfterExecuted", listener: (info: { hookId: string; stage: PipelineStage }) => void): this;
  on(event: "hookError", listener: (info: { hookId: string; stage: PipelineStage; error: string }) => void): this;
  on(event: "stageProcessed", listener: (info: { stage: PipelineStage; duration: number; hookCount: number }) => void): this;
  emit(event: "hookRegistered", hook: PipelineHook): boolean;
  emit(event: "hookUnregistered", info: { id: string }): boolean;
  emit(event: "hookEnabled" | "hookDisabled", info: { id: string }): boolean;
  emit(event: "hookBeforeExecuted" | "hookAfterExecuted", info: { hookId: string; stage: PipelineStage }): boolean;
  emit(event: "hookError", info: { hookId: string; stage: PipelineStage; error: string }): boolean;
  emit(event: "stageProcessed", info: { stage: PipelineStage; duration: number; hookCount: number }): boolean;
}

// ─── Built-in Hooks ────────────────────────────────────────────────────────────

/**
 * Create a logging hook for pipeline stages.
 */
export function createLoggingHook(
  stages: PipelineStage[],
  options?: { logInput?: boolean; logOutput?: boolean }
): PipelineHook {
  return {
    id: "builtin-logging-hook",
    name: "Pipeline Logger",
    stages,
    priority: -100, // Run last
    enabled: true,
    before: options?.logInput !== false
      ? (ctx) => {
          log.debug(
            { stage: ctx.stage, transcript: ctx.transcript, intent: ctx.intent },
            `[Hook:logging] Before stage`
          );
          return ctx;
        }
      : undefined,
    after: options?.logOutput !== false
      ? (ctx) => {
          log.debug(
            { stage: ctx.stage, transcript: ctx.transcript, intent: ctx.intent },
            `[Hook:logging] After stage`
          );
          return ctx;
        }
      : undefined,
  };
}

/**
 * Create a metrics recording hook.
 */
export function createMetricsHook(stages: PipelineStage[]): PipelineHook {
  return {
    id: "builtin-metrics-hook",
    name: "Metrics Recorder",
    stages,
    priority: -90,
    enabled: true,
    after: (ctx) => {
      const duration = Date.now() - ctx.startTime;
      // Emit for analytics collection
      return {
        ...ctx,
        metadata: {
          ...ctx.metadata,
          stageDurationMs: duration,
        },
      };
    },
  };
}

/**
 * Create a validation hook that checks required fields.
 */
export function createValidationHook(
  stages: PipelineStage[],
  requirements: Partial<Record<PipelineStage, (keyof PipelineContext)[]>>
): PipelineHook {
  return {
    id: "builtin-validation-hook",
    name: "Pipeline Validator",
    stages,
    priority: 100, // Run first
    enabled: true,
    before: (ctx) => {
      const required = requirements[ctx.stage];
      if (required) {
        for (const field of required) {
          if (ctx[field] === undefined || ctx[field] === null || ctx[field] === "") {
            throw new Error(`Validation failed: stage=${ctx.stage}, missing field=${field}`);
          }
        }
      }
      return ctx;
    },
  };
}

// ─── Singleton Export ──────────────────────────────────────────────────────────

export const voicePipelineHooks: VoicePipelineHooks = new VoicePipelineHooksImpl();

// Register built-in logging hook for all stages
voicePipelineHooks.register(
  createLoggingHook([
    "session_start",
    "wake_detection",
    "vad",
    "stt",
    "intent_parsing",
    "entity_extraction",
    "command_routing",
    "tts",
    "session_end",
  ])
);

voicePipelineHooks.register(createMetricsHook(["stt", "intent_parsing", "command_routing", "tts"]));