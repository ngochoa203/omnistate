import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const log = childLogger("voice-macro-recorder");

export interface MacroStep {
  action: string;
  params: Record<string, unknown>;
  delayMs?: number;
  description?: string;
}

export interface VoiceMacro {
  id: string;
  name: string;
  trigger: string;
  steps: MacroStep[];
  createdAt: number;
  updatedAt: number;
  usageCount: number;
  enabled: boolean;
  category: string;
}

export type RecordingState = "idle" | "recording" | "paused" | "playing";

export interface VoiceMacroRecorder {
  startRecording(name: string, trigger: string, category?: string): void;
  stopRecording(): VoiceMacro | null;
  pauseRecording(): void;
  resumeRecording(): void;
  playMacro(id: string, context?: Record<string, unknown>): Promise<void>;
  stopPlayback(): void;
  deleteMacro(id: string): void;
  updateMacro(id: string, updates: Partial<VoiceMacro>): void;
  listMacros(): VoiceMacro[];
  findByTrigger(trigger: string): VoiceMacro | null;
  incrementUsage(id: string): void;
  importMacros(macros: VoiceMacro[]): void;
  exportMacros(): VoiceMacro[];
}

interface RecordingSession {
  name: string;
  trigger: string;
  category: string;
  steps: MacroStep[];
  startedAt: number;
  pausedAt?: number;
}

interface MacroData {
  macros: Record<string, VoiceMacro>;
}

const MACROS_FILE = join(homedir(), ".omnistate", "voice-macros.json");
const MAX_STEPS_PER_MACRO = 50;
const MAX_MACROS = 20;
const DEFAULT_STEP_DELAY_MS = 1000;

class VoiceMacroRecorderImpl extends EventEmitter implements VoiceMacroRecorder {
  private macros = new Map<string, VoiceMacro>();
  private recordingState: RecordingState = "idle";
  private currentRecording: RecordingSession | null = null;
  private playbackAbortController: AbortController | null = null;

  constructor() {
    super();
    this.loadFromFile();
  }

  private loadFromFile(): void {
    try {
      if (!existsSync(MACROS_FILE)) return;

      const raw = readFileSync(MACROS_FILE, "utf-8");
      const data = JSON.parse(raw) as MacroData;

      if (data.macros) {
        for (const [id, macro] of Object.entries(data.macros)) {
          this.macros.set(id, macro as VoiceMacro);
        }
      }

      log.info({ count: this.macros.size }, "Macros loaded from file");
    } catch (err) {
      log.warn({ err }, "Failed to load macros");
    }
  }

  private saveToFile(): void {
    try {
      const dir = join(homedir(), ".omnistate");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data: MacroData = {
        macros: Object.fromEntries(this.macros),
      };

      writeFileSync(MACROS_FILE, JSON.stringify(data, null, 2), "utf-8");
      log.debug({ count: this.macros.size }, "Macros saved");
    } catch (err) {
      log.warn({ err }, "Failed to save macros");
    }
  }

  startRecording(name: string, trigger: string, category = "custom"): void {
    if (this.recordingState !== "idle") {
      log.warn("Already recording");
      return;
    }

    if (this.macros.size >= MAX_MACROS) {
      log.warn({ max: MAX_MACROS }, "Maximum macros reached");
      this.emit("maxMacrosReached");
      return;
    }

    this.currentRecording = {
      name,
      trigger,
      category,
      steps: [],
      startedAt: Date.now(),
    };

    this.recordingState = "recording";

    log.info({ name, trigger, category }, "Macro recording started");
    this.emit("recordingStarted", { name, trigger });
  }

  stopRecording(): VoiceMacro | null {
    if (this.recordingState === "idle" || !this.currentRecording) {
      return null;
    }

    const { name, trigger, category, steps, startedAt } = this.currentRecording;
    const now = Date.now();

    if (steps.length === 0) {
      log.warn("No steps recorded");
      this.recordingState = "idle";
      this.currentRecording = null;
      return null;
    }

    const macro: VoiceMacro = {
      id: `macro-${Date.now()}`,
      name,
      trigger,
      steps,
      createdAt: startedAt,
      updatedAt: now,
      usageCount: 0,
      enabled: true,
      category,
    };

    this.macros.set(macro.id, macro);
    this.saveToFile();

    this.recordingState = "idle";
    this.currentRecording = null;

    log.info({ id: macro.id, name, stepCount: steps.length }, "Macro recording stopped");
    this.emit("recordingStopped", { macroId: macro.id });
    this.emit("macroCreated", macro);

    return macro;
  }

  pauseRecording(): void {
    if (this.recordingState !== "recording") return;

    this.recordingState = "paused";
    this.currentRecording!.pausedAt = Date.now();

    log.debug("Macro recording paused");
    this.emit("recordingPaused");
  }

  resumeRecording(): void {
    if (this.recordingState !== "paused") return;

    this.recordingState = "recording";
    delete this.currentRecording!.pausedAt;

    log.debug("Macro recording resumed");
    this.emit("recordingResumed");
  }

  async playMacro(id: string, context: Record<string, unknown> = {}): Promise<void> {
    const macro = this.macros.get(id);
    if (!macro) {
      throw new Error(`Macro not found: ${id}`);
    }

    if (!macro.enabled) {
      throw new Error(`Macro disabled: ${id}`);
    }

    if (this.recordingState === "recording") {
      throw new Error("Cannot play macro while recording");
    }

    this.recordingState = "playing";
    this.playbackAbortController = new AbortController();

    log.info({ id, name: macro.name, stepCount: macro.steps.length }, "Macro playback started");
    this.emit("playbackStarted", { macroId: id });

    try {
      for (let i = 0; i < macro.steps.length; i++) {
        if (this.playbackAbortController?.signal.aborted) {
          log.info({ id }, "Macro playback aborted");
          break;
        }

        const step = macro.steps[i]!;
        await this.executeStep(step, context);

        // Wait for delay before next step
        const delay = step.delayMs ?? DEFAULT_STEP_DELAY_MS;
        if (delay > 0 && i < macro.steps.length - 1) {
          await this.delay(delay);
        }
      }

      this.incrementUsage(id);

      log.info({ id }, "Macro playback completed");
      this.emit("playbackCompleted", { macroId: id });
    } catch (err) {
      log.error({ id, err }, "Macro playback error");
      this.emit("playbackError", { macroId: id, error: String(err) });
      throw err;
    } finally {
      this.recordingState = "idle";
      this.playbackAbortController = null;
    }
  }

  private async executeStep(step: MacroStep, context: Record<string, unknown>): Promise<void> {
    log.debug(
      { action: step.action, params: step.params },
      "Executing macro step"
    );

    // In production, would route to voiceCommandRouter or appropriate handler
    // For now, emit event for external handlers
    this.emit("stepExecuting", {
      macroId: Array.from(this.macros.entries()).find(([, m]) => m.steps.includes(step))?.[0],
      step,
      context,
    });

    // Simulate step execution
    await this.delay(100);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stopPlayback(): void {
    if (this.playbackAbortController) {
      this.playbackAbortController.abort();
      log.info("Macro playback stopped");
      this.emit("playbackStopped");
    }
  }

  deleteMacro(id: string): void {
    if (this.macros.has(id)) {
      this.macros.delete(id);
      this.saveToFile();
      log.info({ id }, "Macro deleted");
      this.emit("macroDeleted", { id });
    }
  }

  updateMacro(id: string, updates: Partial<VoiceMacro>): void {
    const existing = this.macros.get(id);
    if (!existing) return;

    const updated: VoiceMacro = {
      ...existing,
      ...updates,
      id: existing.id, // Prevent ID change
      updatedAt: Date.now(),
    };

    // Validate steps
    if (updated.steps && updated.steps.length > MAX_STEPS_PER_MACRO) {
      log.warn({ stepCount: updated.steps.length, max: MAX_STEPS_PER_MACRO }, "Too many steps");
      updated.steps = updated.steps.slice(0, MAX_STEPS_PER_MACRO);
    }

    this.macros.set(id, updated);
    this.saveToFile();

    log.info({ id }, "Macro updated");
    this.emit("macroUpdated", updated);
  }

  listMacros(): VoiceMacro[] {
    return Array.from(this.macros.values()).sort((a, b) => b.usageCount - a.usageCount);
  }

  findByTrigger(trigger: string): VoiceMacro | null {
    const normalizedTrigger = trigger.toLowerCase().trim();

    for (const macro of this.macros.values()) {
      if (!macro.enabled) continue;

      const normalizedMacroTrigger = macro.trigger.toLowerCase();
      if (
        normalizedMacroTrigger === normalizedTrigger ||
        normalizedTrigger.includes(normalizedMacroTrigger) ||
        normalizedMacroTrigger.includes(normalizedTrigger)
      ) {
        return macro;
      }
    }

    return null;
  }

  incrementUsage(id: string): void {
    const macro = this.macros.get(id);
    if (macro) {
      macro.usageCount++;
      macro.updatedAt = Date.now();
      this.saveToFile();
    }
  }

  importMacros(macros: VoiceMacro[]): void {
    let imported = 0;

    for (const macro of macros) {
      if (this.macros.size >= MAX_MACROS) {
        log.warn({ max: MAX_MACROS }, "Max macros reached during import");
        break;
      }

      const validated: VoiceMacro = {
        ...macro,
        id: macro.id || `macro-${Date.now()}-${imported}`,
        steps: macro.steps.slice(0, MAX_STEPS_PER_MACRO),
        createdAt: macro.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        usageCount: macro.usageCount ?? 0,
        enabled: macro.enabled ?? true,
      };

      this.macros.set(validated.id, validated);
      imported++;
    }

    this.saveToFile();
    log.info({ imported, total: this.macros.size }, "Macros imported");
    this.emit("macrosImported", { count: imported });
  }

  exportMacros(): VoiceMacro[] {
    return this.listMacros();
  }

  /**
   * Add a step during recording.
   */
  addRecordingStep(action: string, params: Record<string, unknown> = {}, delayMs?: number): void {
    if (this.recordingState !== "recording" || !this.currentRecording) {
      log.warn("Not currently recording");
      return;
    }

    if (this.currentRecording.steps.length >= MAX_STEPS_PER_MACRO) {
      log.warn({ max: MAX_STEPS_PER_MACRO }, "Max steps reached");
      this.emit("maxStepsReached");
      return;
    }

    const step: MacroStep = {
      action,
      params,
      delayMs,
      description: `${action} ${JSON.stringify(params)}`,
    };

    this.currentRecording.steps.push(step);
    this.emit("stepRecorded", { step, totalSteps: this.currentRecording.steps.length });

    log.debug({ action, totalSteps: this.currentRecording.steps.length }, "Step recorded");
  }

  getRecordingState(): RecordingState {
    return this.recordingState;
  }

  getCurrentRecording(): RecordingSession | null {
    return this.currentRecording;
  }
}

export interface VoiceMacroRecorder extends EventEmitter {
  on(event: "recordingStarted", listener: (info: { name: string; trigger: string }) => void): this;
  on(event: "recordingStopped" | "recordingPaused" | "recordingResumed", listener: () => void): this;
  on(event: "playbackStarted" | "playbackStopped" | "playbackCompleted", listener: (info: { macroId: string }) => void): this;
  on(event: "playbackError", listener: (info: { macroId: string; error: string }) => void): this;
  on(event: "stepRecorded", listener: (info: { step: MacroStep; totalSteps: number }) => void): this;
  on(event: "stepExecuting", listener: (info: { macroId?: string; step: MacroStep; context: Record<string, unknown> }) => void): this;
  on(event: "macroCreated" | "macroUpdated" | "macroDeleted", listener: (info: VoiceMacro | { id: string }) => void): this;
  on(event: "macrosImported", listener: (info: { count: number }) => void): this;
  on(event: "maxMacrosReached" | "maxStepsReached", listener: () => void): this;
  emit(event: "recordingStarted", info: { name: string; trigger: string }): boolean;
  emit(event: "recordingStopped" | "recordingPaused" | "recordingResumed"): boolean;
  emit(event: "playbackStarted" | "playbackStopped" | "playbackCompleted", info: { macroId: string }): boolean;
  emit(event: "playbackError", info: { macroId: string; error: string }): boolean;
  emit(event: "stepRecorded", info: { step: MacroStep; totalSteps: number }): boolean;
  emit(event: "stepExecuting", info: { macroId?: string; step: MacroStep; context: Record<string, unknown> }): boolean;
  emit(event: "macroCreated" | "macroUpdated" | "macroDeleted", info: VoiceMacro | { id: string }): boolean;
  emit(event: "macrosImported", info: { count: number }): boolean;
  emit(event: "maxMacrosReached" | "maxStepsReached"): boolean;
}

// ─── Singleton Export ──────────────────────────────────────────────────────────

export const voiceMacroRecorder: VoiceMacroRecorder = new VoiceMacroRecorderImpl();