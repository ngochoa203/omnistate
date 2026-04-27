/**
 * MacroRunner — executes a Macro sequentially step-by-step.
 * Emits events: step_start, step_complete, step_error, macro_complete, macro_error.
 */

import type { Macro, MacroStep, ActionResult } from "./types";
import { ActionExecutor } from "./action-executor";

export type MacroEventType =
  | "macro_start"
  | "step_start"
  | "step_complete"
  | "step_error"
  | "macro_complete"
  | "macro_error"
  | "macro_cancelled";

export interface MacroEvent {
  type: MacroEventType;
  macroId: string;
  stepId?: string;
  stepIndex?: number;
  result?: ActionResult;
  error?: string;
  timestamp: number;
}

type Listener = (event: MacroEvent) => void;

export class MacroRunner {
  private listeners = new Set<Listener>();
  private cancelled = false;
  private paused = false;
  private currentMacroId: string | null = null;

  constructor(private executor: ActionExecutor = new ActionExecutor()) {}

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: Omit<MacroEvent, "timestamp">): void {
    const e: MacroEvent = { ...event, timestamp: Date.now() };
    for (const l of this.listeners) {
      try { l(e); } catch { /* swallow listener errors */ }
    }
  }

  cancel(): void { this.cancelled = true; }
  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }
  isRunning(): boolean { return this.currentMacroId !== null; }

  async run(macro: Macro): Promise<void> {
    if (this.currentMacroId) throw new Error("macro already running");
    this.currentMacroId = macro.id;
    this.cancelled = false;
    this.paused = false;
    this.emit({ type: "macro_start", macroId: macro.id });

    try {
      for (let i = 0; i < macro.steps.length; i++) {
        if (this.cancelled) {
          this.emit({ type: "macro_cancelled", macroId: macro.id, stepIndex: i });
          return;
        }
        while (this.paused) await sleep(100);

        const step = macro.steps[i];
        await this.runStep(macro.id, step, i);
      }
      this.emit({ type: "macro_complete", macroId: macro.id });
    } catch (e) {
      const err = e as Error;
      this.emit({ type: "macro_error", macroId: macro.id, error: err.message });
    } finally {
      this.currentMacroId = null;
    }
  }

  private async runStep(macroId: string, step: MacroStep, index: number): Promise<void> {
    this.emit({ type: "step_start", macroId, stepId: step.id, stepIndex: index });

    if (step.delayMs && step.delayMs > 0) await sleep(step.delayMs);

    if (step.condition) {
      const cond = await this.executor.waitForCondition(step.condition);
      if (!cond.success) {
        this.emit({
          type: "step_error",
          macroId,
          stepId: step.id,
          stepIndex: index,
          error: cond.message,
        });
        if (!step.retry) throw new Error(`condition failed: ${cond.message}`);
      }
    }

    const retries = step.retry?.count ?? 0;
    const retryInterval = step.retry?.intervalMs ?? 500;
    let lastResult: ActionResult = { success: false, message: "not executed" };

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (this.cancelled) return;
      lastResult = await this.executor.execute(step.action);
      if (lastResult.success) break;
      if (attempt < retries) await sleep(retryInterval);
    }

    if (lastResult.success) {
      this.emit({
        type: "step_complete",
        macroId,
        stepId: step.id,
        stepIndex: index,
        result: lastResult,
      });
    } else {
      this.emit({
        type: "step_error",
        macroId,
        stepId: step.id,
        stepIndex: index,
        result: lastResult,
        error: lastResult.message,
      });
      throw new Error(`step ${step.id} failed: ${lastResult.message}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createMacro(
  name: string,
  steps: MacroStep[],
  options: Partial<Pick<Macro, "description" | "tags" | "trigger">> = {},
): Macro {
  const now = Date.now();
  return {
    id: `macro_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    description: options.description,
    tags: options.tags,
    trigger: options.trigger ?? { type: "manual" },
    steps,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}
