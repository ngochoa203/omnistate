export { OmniStateGateway } from "./gateway/server.js";
export type { GatewayConfig } from "./config/schema.js";
export { classifyIntent, planFromIntent } from "./planner/intent.js";
export { optimizePlan } from "./planner/optimizer.js";
export { Orchestrator } from "./executor/orchestrator.js";
export type { StepResult, ExecutionResult } from "./executor/orchestrator.js";

// ─── Domain B: Deep OS Layer ─────────────────────────────────────────────────
export { DeepOSLayer } from "./layers/deep-os.js";
export { DeepSystemLayer } from "./layers/deep-system.js";

// ─── Domain A: Advanced Vision ───────────────────────────────────────────────
export { AdvancedVision } from "./vision/advanced.js";

// ─── Domain C: Advanced Health & Self-Healing ────────────────────────────────
export { AdvancedHealthMonitor } from "./health/advanced-health.js";

// ─── Domain D: Hybrid Automation & Tooling ───────────────────────────────────
export * as HybridAutomation from "./hybrid/automation.js";
export * as HybridTooling from "./hybrid/tooling.js";

// ─── Daemon entry point ───────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { loadConfig } from "./config/loader.js";
import { HealthMonitor } from "./health/monitor.js";
import type { ServerMessage } from "./gateway/protocol.js";
import { runLlmPreflight, shouldRequireLlm } from "./llm/preflight.js";

// ─── .env loader (no external deps) — exported for CLI inline use ──────────

export function loadDotEnv(envPath: string = ".env"): void {
  const abs = resolve(envPath);
  if (!existsSync(abs)) return;

  const lines = readFileSync(abs, "utf-8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    // Skip blank lines and comments
    if (!line || line.startsWith("#")) continue;

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    // Strip optional inline quotes from value
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Never overwrite values already set in the environment
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ─── CLI arg parser (no external deps) ──────────────────────────────────────

interface CliArgs {
  port: number | null;
  configPath: string | null;
  noHealth: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { port: null, configPath: null, noHealth: false };
  // Skip node and the script path itself
  const tokens = argv.slice(2);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "--port" && tokens[i + 1] !== undefined) {
      const n = Number(tokens[++i]);
      if (!Number.isNaN(n) && n > 0 && n <= 65535) args.port = n;
      else console.warn(`[OmniState] Invalid --port value: ${tokens[i]}`);
    } else if (tok === "--config" && tokens[i + 1] !== undefined) {
      args.configPath = tokens[++i];
    } else if (tok === "--no-health") {
      args.noHealth = true;
    }
  }

  return args;
}

async function isPortAvailable(bind: string, port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createServer();

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, bind);
  });
}

// ─── startGateway ────────────────────────────────────────────────────────────

export async function startGateway(): Promise<void> {
  // 1. Load .env before anything else
  loadDotEnv();

  // 2. Parse CLI args
  const args = parseArgs(process.argv);

  // 3. Load and optionally patch config
  const config = loadConfig(args.configPath ?? undefined);
  if (args.port !== null) {
    config.gateway.port = args.port;
  }

  // 3.5. If LLM is required, fail fast on auth/credits/network issues.
  const preflight = await runLlmPreflight();
  if (shouldRequireLlm() && !preflight.ok) {
    throw new Error(preflight.message);
  }

  const available = await isPortAvailable(config.gateway.bind, config.gateway.port);
  if (!available) {
    console.error(
      `[OmniState] Port ${config.gateway.port} on ${config.gateway.bind} is already in use. ` +
        "Stop the existing daemon or start with --port <other-port>."
    );
    return;
  }

  // 4. Import gateway here (after config is ready)
  const { OmniStateGateway } = await import("./gateway/server.js");
  const gateway = new OmniStateGateway(config);

  // 5. Start gateway
  gateway.start();
  console.log(
    `[OmniState] Daemon started — pid=${process.pid} port=${config.gateway.port}`
  );

  // 6. Health monitor
  let health: HealthMonitor | null = null;
  const healthEnabled = config.health.enabled && !args.noHealth;

  if (healthEnabled) {
    health = new HealthMonitor(config.health.intervalMs, config.health.autoRepair);

    // Wire health monitor into gateway for health.query support
    gateway.setHealthMonitor(health);

    // Wire health alerts to gateway broadcast
    health.onReport((report) => {
      if (report.alerts.length === 0) return;
      const msg: ServerMessage = {
        type: "health.alert",
        overall: report.overall,
        alerts: report.alerts,
        timestamp: report.timestamp,
      } as unknown as ServerMessage;
      gateway.broadcast(msg);
    });

    health.start();
    console.log(
      `[OmniState] Health monitor active — interval=${config.health.intervalMs}ms autoRepair=${config.health.autoRepair}`
    );
  }

  // 7. Graceful shutdown on SIGINT / SIGTERM
  let shuttingDown = false;

  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[OmniState] ${signal} received — shutting down…`);
    health?.stop();
    gateway.stop();
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ─── Auto-start when run as main module ─────────────────────────────────────

const isMain = process.argv[1]?.endsWith("index.js");
if (isMain) {
  startGateway().catch(console.error);
}
