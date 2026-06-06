import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { logger } from "../utils/logger.js";
import type { WakeEngine } from "../llm/runtime-config.js";

export type { WakeEngine };

export interface WakeConfig {
  enabled: boolean;
  phrase: string;
  cooldownMs: number;
  commandWindowSec: number;
  engine?: WakeEngine;
  aliases?: string[];
  modelPath?: string;
  threshold?: number;
  maxRestarts?: number;
  phrases?: string[];
  phraseEndpoints?: Record<string, string>;
}

export interface WakeManagerOptions {
  config: WakeConfig;
  endpoint: string;
  token: string;
}

export interface RestartEntry {
  timestamp: number;
  reason: string;
}

export interface HealthStatus {
  detectionRate: number;
  falsePositiveRate: number;
  isHealthy: boolean;
  issue?: string;
  currentThreshold: number;
  totalDetections: number;
  recentDetections: number;
  recentFalsePositives: number;
  restartHistory: RestartEntry[];
}

export class WakeManager {
  private child: ChildProcess | null = null;
  private lastOptions: WakeManagerOptions | null = null;
  private restartCount = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private firstExitTime = 0;

  // Adaptive threshold state
  private detectionWindow: Array<{ timestamp: number; isFalsePositive: boolean }> = [];
  private currentThreshold = 0.5;

  // Health monitoring counters
  private totalDetections = 0;
  private recentDetections = 0;
  private recentFalsePositives = 0;

  // Restart history
  private restartHistory: RestartEntry[] = [];

  // Command window validation
  private _lastWakeTimestamp = 0;
  private commandWindowSec = 30;

  isRunning(): boolean {
    return this.child !== null;
  }

  private get maxRestarts(): number {
    return this.lastOptions?.config.maxRestarts ?? 3;
  }

  private resolvePythonExecutable(): string {
    const explicit = process.env.OMNISTATE_WAKE_PYTHON?.trim();
    if (explicit) return explicit;

    const pyenvVersion = process.env.PYENV_VERSION?.trim();
    const pyenvRoot = process.env.PYENV_ROOT?.trim() || `${process.env.HOME ?? ""}/.pyenv`;
    if (pyenvVersion && pyenvRoot) {
      return `${pyenvRoot}/versions/${pyenvVersion}/bin/python3`;
    }

    return "python3";
  }

  /**
   * Get the endpoint for a specific phrase, or return the default endpoint.
   */
  getEndpointForPhrase(phrase: string): string {
    if (this.lastOptions?.config.phraseEndpoints?.[phrase]) {
      return this.lastOptions.config.phraseEndpoints[phrase];
    }
    return this.lastOptions?.endpoint ?? "http://127.0.0.1:19801/api/wake/event";
  }

  /**
   * Check if a command timestamp is within the valid command window.
   */
  isCommandWithinWindow(lastWakeTime: number): boolean {
    return (Date.now() - lastWakeTime) / 1000 <= this.commandWindowSec;
  }

  /**
   * Record a detected wake phrase timestamp.
   */
  recordWakeTimestamp(): void {
    this._lastWakeTimestamp = Date.now();
  }

  /**
   * Get the last wake timestamp.
   */
  getLastWakeTimestamp(): number {
    return this._lastWakeTimestamp;
  }

  /**
   * Extend the command window by 2 seconds when still speaking.
   */
  extendWindowIfStillSpeaking(): void {
    this.commandWindowSec += 2;
    logger.info(`[Wake] Command window extended to ${this.commandWindowSec}s`);
  }

  /**
   * Adjust threshold based on false positive rate over the sliding window.
   */
  adjustThreshold(): void {
    const now = Date.now();
    const windowMs = 5 * 60 * 1000; // 5 minutes

    // Remove old entries outside the window
    this.detectionWindow = this.detectionWindow.filter(
      (entry) => now - entry.timestamp < windowMs
    );

    if (this.detectionWindow.length === 0) return;

    const recentFP = this.detectionWindow.filter((e) => e.isFalsePositive).length;
    const fpRate = recentFP / this.detectionWindow.length;

    const oldThreshold = this.currentThreshold;

    if (fpRate > 0.15) {
      // Increase threshold by 0.05, max 0.9
      this.currentThreshold = Math.min(0.9, this.currentThreshold + 0.05);
      logger.info(`[Wake] High FP rate (${(fpRate * 100).toFixed(1)}%), increasing threshold: ${oldThreshold.toFixed(2)} -> ${this.currentThreshold.toFixed(2)}`);
    } else if (fpRate < 0.05) {
      // Decrease threshold by 0.02, min 0.3
      this.currentThreshold = Math.max(0.3, this.currentThreshold - 0.02);
      logger.info(`[Wake] Low FP rate (${(fpRate * 100).toFixed(1)}%), decreasing threshold: ${oldThreshold.toFixed(2)} -> ${this.currentThreshold.toFixed(2)}`);
    }
  }

  /**
   * Record a detection event and update health metrics.
   */
  recordDetection(isFalsePositive = false): void {
    const now = Date.now();
    this.detectionWindow.push({ timestamp: now, isFalsePositive });
    this.totalDetections++;
    this.recentDetections++;

    if (isFalsePositive) {
      this.recentFalsePositives++;
    }

    // Adjust threshold based on recent performance
    this.adjustThreshold();
  }

  /**
   * Get current health status of the wake manager.
   */
  getHealthStatus(): HealthStatus {
    const now = Date.now();
    const windowMs = 5 * 60 * 1000;

    // Clean old entries for rate calculation
    const recentEntries = this.detectionWindow.filter(
      (entry) => now - entry.timestamp < windowMs
    );

    const detectionRate = recentEntries.length > 0
      ? recentEntries.filter((e) => !e.isFalsePositive).length / recentEntries.length
      : 0;
    const falsePositiveRate = recentEntries.length > 0
      ? recentEntries.filter((e) => e.isFalsePositive).length / recentEntries.length
      : 0;

    // Detect "not firing when should be" issue
    let issue: string | undefined;
    const isHealthy = this.recentDetections > 0 || recentEntries.length === 0;

    if (this.recentDetections === 0 && this.totalDetections > 0) {
      issue = "not_firing_when_should_be";
    }

    return {
      detectionRate,
      falsePositiveRate,
      isHealthy,
      issue,
      currentThreshold: this.currentThreshold,
      totalDetections: this.totalDetections,
      recentDetections: this.recentDetections,
      recentFalsePositives: this.recentFalsePositives,
      restartHistory: [...this.restartHistory],
    };
  }

  start(options: WakeManagerOptions): void {
    this.stopped = false;
    this.stop();
    this.lastOptions = options;
    this.restartCount = 0;
    this.firstExitTime = 0;

    // Initialize adaptive threshold from config or defaults
    this.currentThreshold = options.config.threshold ?? 0.5;
    this.commandWindowSec = options.config.commandWindowSec;

    if (!options.config.enabled) return;
    if (!options.token) {
      logger.warn(
        "[OmniState] OMNISTATE_SIRI_TOKEN is empty — wake listener starting in dry-run mode " +
        "(wake events will NOT forward commands). Set OMNISTATE_SIRI_TOKEN to enable full mode."
      );
    }

    const DEFAULT_ALIASES = ["mimi", "hey mimi", "ok mimi", "mimi ơi", "mimi oi", "mi mi", "hi mimi", "he mimi", "ê mimi"];
    const engine: WakeEngine = options.config.engine ?? "oww";

    const homeDir = process.env.HOME ?? "";
    const personalTemplate = options.config.modelPath?.endsWith("personal_template.json")
      ? options.config.modelPath
      : `${homeDir}/.omnistate/wake-samples/personal_template.json`;

    const hasCustomModel = !!(options.config.modelPath && existsSync(options.config.modelPath))
      || !!(process.env.OMNISTATE_WAKE_MODEL_PATH && existsSync(process.env.OMNISTATE_WAKE_MODEL_PATH));
    const hasPersonalTemplate = existsSync(personalTemplate);

    if (engine === "oww" && !hasCustomModel) {
      logger.error(
        "[Wake] OWW model missing, refusing to start. " +
        "Set OMNISTATE_WAKE_MODEL_PATH or run onboarding to create personal_template.json"
      );
      return;
    }
    if (engine === "personal" && !hasPersonalTemplate) {
      logger.error(
        `[Wake] personal_template.json missing at ${personalTemplate}, refusing to start. ` +
        `Status: needs_onboarding — run the macOS onboarding wizard to record voice samples.`
      );
      return;
    }

    const resolvedEngine: WakeEngine = engine;

    let scriptName: string;
    if (resolvedEngine === "personal") {
      scriptName = "wake_listener_personal.py";
    } else if (resolvedEngine === "oww") {
      scriptName = "wake_listener_oww.py";
    } else if (resolvedEngine === "porcupine") {
      scriptName = "wake_listener_porcupine.py";
    } else {
      scriptName = "wake_listener.py";
    }
    const scriptPath = resolve(process.cwd(), `scripts/voice/${scriptName}`);
    if (!existsSync(scriptPath)) {
      logger.warn(`[OmniState] Wake listener script missing: ${scriptPath}`);
      return;
    }

    // Porcupine engine — fully separate arg set, no mixing with legacy/oww
    if (resolvedEngine === "porcupine") {
      const accessKey = process.env.PORCUPINE_ACCESS_KEY?.trim() ?? "";
      if (!accessKey) {
        logger.warn("[OmniState] Wake listener not started: PORCUPINE_ACCESS_KEY is empty");
        return;
      }
      const keywordPath = process.env.OMNISTATE_PORCUPINE_KEYWORD_PATH?.trim() ?? "";
      const porcupineEndpoint = options.endpoint.includes("/api/wake/event")
        ? options.endpoint
        : "http://127.0.0.1:19801/api/wake/event";
      const porcupineArgs = [
        scriptPath,
        "--access-key", accessKey,
        "--endpoint", porcupineEndpoint,
        "--token", options.token,
        "--cooldown-ms", String(options.config.cooldownMs),
        "--command-window-sec", String(options.config.commandWindowSec),
        "--phrase", options.config.phrase,
        ...(keywordPath ? ["--keyword-path", keywordPath] : []),
      ];
      this.child = spawn(
        this.resolvePythonExecutable(),
        porcupineArgs,
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            PYTHONWARNINGS: process.env.PYTHONWARNINGS ?? "ignore::DeprecationWarning",
          },
        },
      );
      this.child.stdout?.on("data", (d) => { process.stdout.write(`[Wake] ${String(d)}`); });
      this.child.stderr?.on("data", (d) => { process.stderr.write(`[Wake] ${String(d)}`); });
      this.child.on("exit", (code) => {
        this.child = null;
        if (code !== 0 && code !== null) {
          logger.warn(`[OmniState] Wake listener exited with code ${code}`);
          this.scheduleRestart();
        }
      });
      logger.info("[OmniState] Wake listener started");
      return;
    }

    const aliases = options.config.aliases ?? DEFAULT_ALIASES;
    const modelPath = resolvedEngine === "personal"
      ? personalTemplate
      : (options.config.modelPath ?? process.env.OMNISTATE_WAKE_MODEL_PATH ?? "");
    const threshold = options.config.threshold ?? (resolvedEngine === "personal" ? 0.88 : 0.5);

    // Personal listener targets the wake-event broadcast endpoint, NOT the Siri command bridge.
    const personalEndpoint = options.endpoint.includes("/api/wake/event")
      ? options.endpoint
      : "http://127.0.0.1:19801/api/wake/event";

    const baseArgs =
      resolvedEngine === "personal"
        ? [
            scriptPath,
            "--template", modelPath,
            "--endpoint", personalEndpoint,
            "--token", options.token,
            "--threshold", String(threshold),
            "--cooldown-ms", String(options.config.cooldownMs),
            "--command-window-sec", String(options.config.commandWindowSec),
            "--phrase", options.config.phrase,
            "--aliases", aliases.join(","),
          ]
        : [
            scriptPath,
            "--phrase", options.config.phrase,
            "--endpoint", options.endpoint,
            "--token", options.token,
            "--cooldown-ms", String(options.config.cooldownMs),
            "--command-window-sec", String(options.config.commandWindowSec),
          ];

    const engineExtras =
      resolvedEngine === "oww"
        ? [
            "--aliases",
            JSON.stringify(aliases),
            "--threshold",
            String(threshold),
            ...(modelPath ? ["--model-path", modelPath] : []),
          ]
        : resolvedEngine === "legacy"
        ? ["--aliases", aliases.join(",")]
        : [];

    this.child = spawn(
      this.resolvePythonExecutable(),
      [...baseArgs, ...engineExtras],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONWARNINGS: process.env.PYTHONWARNINGS ?? "ignore::DeprecationWarning",
        },
      },
    );

    this.child.stdout?.on("data", (d) => {
      process.stdout.write(`[Wake] ${String(d)}`);
    });
    this.child.stderr?.on("data", (d) => {
      process.stderr.write(`[Wake] ${String(d)}`);
    });

    this.child.on("exit", (code) => {
      this.child = null;
      if (code !== 0 && code !== null) {
        logger.warn(`[OmniState] Wake listener exited with code ${code}`);
        this.scheduleRestart();
      }
    });

    logger.info("[OmniState] Wake listener started");
  }

  private scheduleRestart(): void {
    if (!this.lastOptions || this.stopped) return;
    const now = Date.now();
    if (this.firstExitTime === 0) this.firstExitTime = now;
    if (now - this.firstExitTime > 60_000) {
      this.restartCount = 0;
      this.firstExitTime = now;
    }
    this.restartCount++;
    if (this.restartCount > this.maxRestarts) {
      logger.error(`[Wake] Exceeded ${this.maxRestarts} restarts in 60s, giving up`);
      return;
    }

    // Apply jitter: delay * (0.5 + random)
    const baseDelayMs = Math.min(2000 * Math.pow(2, this.restartCount - 1), 15000);
    const delayMs = Math.floor(baseDelayMs * (0.5 + Math.random()));

    logger.info(`[Wake] Restarting in ${delayMs}ms (attempt ${this.restartCount}/${this.maxRestarts})`);

    // Record restart in history
    this.restartHistory.push({
      timestamp: now,
      reason: `exit_code_non_zero_restart_${this.restartCount}`,
    });

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.lastOptions) this.start(this.lastOptions);
    }, delayMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.lastOptions = null;
    if (!this.child) return;
    try {
      this.child.kill("SIGTERM");
    } catch {
      // ignore
    }
    this.child = null;
  }
}
