import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { logger } from "../utils/logger.js";
export type WakeEngine = "legacy" | "oww" | "personal" | "porcupine";

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

    if (!options.config.enabled) return;
    if (!options.token) {
      logger.warn("[OmniState] Wake listener not started: siri token is empty");
      return;
    }

    const DEFAULT_ALIASES = ["mimi", "hey mimi", "ok mimi", "mimi ơi", "mimi oi", "mi mi"];
    const engine: WakeEngine = options.config.engine ?? "oww";

    const homeDir = process.env.HOME ?? "";
    const personalTemplate = options.config.modelPath?.endsWith("personal_template.json")
      ? options.config.modelPath
      : `${homeDir}/.omnistate/wake-samples/personal_template.json`;

    // oww requires a custom ONNX model — without one it falls back to hey_jarvis which
    // will never trigger on "hey mimi". Auto-degrade to legacy STT-based keyword matching.
    const hasCustomModel = !!(options.config.modelPath && existsSync(options.config.modelPath))
      || !!(process.env.OMNISTATE_WAKE_MODEL_PATH && existsSync(process.env.OMNISTATE_WAKE_MODEL_PATH));
    const resolvedEngine: WakeEngine =
      engine === "oww" && !hasCustomModel ? "legacy" : engine;

    if (engine === "oww" && !hasCustomModel) {
      logger.warn(
        "[OmniState] No custom OWW model found — falling back to legacy STT keyword matching. " +
        "To use oww, set OMNISTATE_WAKE_MODEL_PATH or config.modelPath to a valid .onnx file."
      );
    }

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
    const scriptPath = resolve(process.cwd(), `packages/gateway/scripts/${scriptName}`);
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
        : "http://127.0.0.1:19800/api/wake/event";
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
        if (code !== 0 && code !== null) {
          logger.warn(`[OmniState] Wake listener exited with code ${code}`);
        }
        this.child = null;
      });
      logger.info("[OmniState] Wake listener started");
      return;
    }

    const aliases = options.config.aliases ?? DEFAULT_ALIASES;
    const modelPath = resolvedEngine === "personal"
      ? personalTemplate
      : (options.config.modelPath ?? process.env.OMNISTATE_WAKE_MODEL_PATH ?? "");
    const threshold = options.config.threshold ?? (resolvedEngine === "personal" ? 0.78 : 0.5);

    // Personal listener targets the wake-event broadcast endpoint, NOT the Siri command bridge.
    // Wake is a UI trigger; executing the literal phrase as a goal would confuse the planner
    // (e.g. "hey mimi" → Safari search). The /api/wake/event handler broadcasts to WS clients.
    const personalEndpoint = options.endpoint.includes("/api/wake/event")
      ? options.endpoint
      : "http://127.0.0.1:19800/api/wake/event";

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

    const owwExtras =
      resolvedEngine === "oww"
        ? [
            "--aliases",
            JSON.stringify(aliases),
            "--threshold",
            String(threshold),
            ...(modelPath ? ["--model-path", modelPath] : []),
          ]
        : [];

    this.child = spawn(
      this.resolvePythonExecutable(),
      [...baseArgs, ...owwExtras],
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
      if (code !== 0 && code !== null) {
        logger.warn(`[OmniState] Wake listener exited with code ${code}`);
      }
      this.child = null;
    });

    logger.info("[OmniState] Wake listener started");
  }

  stop(): void {
    if (!this.child) return;
    try {
      this.child.kill("SIGTERM");
    } catch {
      // ignore
    }
    this.child = null;
  }
}
