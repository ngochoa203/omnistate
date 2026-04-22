import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { logger } from "../utils/logger.js";
export interface WakeConfig {
  enabled: boolean;
  phrase: string;
  cooldownMs: number;
  commandWindowSec: number;
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

    const scriptPath = resolve(process.cwd(), "packages/gateway/scripts/wake_listener.py");
    if (!existsSync(scriptPath)) {
      logger.warn(`[OmniState] Wake listener script missing: ${scriptPath}`);
      return;
    }

    this.child = spawn(
      this.resolvePythonExecutable(),
      [
        scriptPath,
        "--phrase",
        options.config.phrase,
        "--endpoint",
        options.endpoint,
        "--token",
        options.token,
        "--cooldown-ms",
        String(options.config.cooldownMs),
        "--command-window-sec",
        String(options.config.commandWindowSec),
      ],
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
