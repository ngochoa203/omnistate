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
}

export interface WakeManagerOptions {
  config: WakeConfig;
  endpoint: string;
  token: string;
}

export class WakeManager {
  private child: ChildProcess | null = null;
  private lastOptions: WakeManagerOptions | null = null;
  private restartCount = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_RESTARTS = 3;
  private static readonly RESTART_WINDOW_MS = 60_000;
  private firstExitTime = 0;

  isRunning(): boolean {
    return this.child !== null;
  }

  private resolvePythonExecutable(): string {
    // Allow explicit override to avoid launchd PATH/env mismatches.
    const explicit = process.env.OMNISTATE_WAKE_PYTHON?.trim();
    if (explicit) return explicit;

    // Fallback for pyenv users where launchd may not resolve shims correctly.
    const pyenvVersion = process.env.PYENV_VERSION?.trim();
    const pyenvRoot = process.env.PYENV_ROOT?.trim() || `${process.env.HOME ?? ""}/.pyenv`;
    if (pyenvVersion && pyenvRoot) {
      return `${pyenvRoot}/versions/${pyenvVersion}/bin/python3`;
    }

    return "python3";
  }

  start(options: WakeManagerOptions): void {
    this.stop();
    this.lastOptions = options;
    this.restartCount = 0;
    this.firstExitTime = 0;

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

    // oww requires a custom ONNX model — without one it silently fell back to legacy
    // STT-keyword matching, which is NOT a real wake engine and never fires reliably.
    // We now refuse to start so the UI/operator sees a clear error.
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
    // Wake is a UI trigger; executing the literal phrase as a goal would confuse the planner
    // (e.g. "hey mimi" → Safari search). The /api/wake/event handler broadcasts to WS clients.
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

    // For oww: pass aliases as JSON + threshold + model-path.
    // For legacy: pass aliases as comma-separated string (no threshold; script doesn't accept it).
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
    if (!this.lastOptions) return;
    const now = Date.now();
    if (this.firstExitTime === 0) this.firstExitTime = now;
    if (now - this.firstExitTime > WakeManager.RESTART_WINDOW_MS) {
      // Reset window
      this.restartCount = 0;
      this.firstExitTime = now;
    }
    this.restartCount++;
    if (this.restartCount > WakeManager.MAX_RESTARTS) {
      logger.error(`[Wake] Exceeded ${WakeManager.MAX_RESTARTS} restarts in ${WakeManager.RESTART_WINDOW_MS / 1000}s, giving up`);
      return;
    }
    const delayMs = Math.min(2000 * Math.pow(2, this.restartCount - 1), 15000);
    logger.info(`[Wake] Restarting in ${delayMs}ms (attempt ${this.restartCount}/${WakeManager.MAX_RESTARTS})`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.lastOptions) this.start(this.lastOptions);
    }, delayMs);
  }

  stop(): void {
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
