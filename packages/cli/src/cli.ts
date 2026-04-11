#!/usr/bin/env node
/**
 * OmniState CLI — control your computer with natural language.
 *
 * Commands:
 *   omnistate start [--port <n>] [--config <path>] [--no-health]
 *   omnistate run "<NL command>" [--inline]
 *   omnistate config [subcommand]
 *   omnistate model [name]
 *   omnistate session [subcommand]
 *   omnistate clear | reset | new [name]
 *   omnistate whoami | commands
 *   omnistate think [low|medium|high]
 *   omnistate fast [on|off]
 *   omnistate verbose [on|off]
 *   omnistate status
 *   omnistate health
 *   omnistate stop
 *   omnistate --help
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import WebSocket from "ws";

// ─── Constants ────────────────────────────────────────────────────────────────

const WS_HOST = "127.0.0.1";
const WS_PORT = 19800;
const WS_URL = `ws://${WS_HOST}:${WS_PORT}`;
const CONNECT_TIMEOUT_MS = 5_000;
const INLINE_DETECT_TIMEOUT_MS = 300;

// ─── Types (inline subset of gateway protocol) ───────────────────────────────

interface ConnectMessage {
  type: "connect";
  auth: { token?: string };
  role: "cli";
}

interface TaskMessage {
  type: "task";
  goal: string;
  layer?: "deep" | "surface" | "auto";
}

interface StatusQueryMessage {
  type: "status.query";
}

interface ShutdownMessage {
  type: "admin.shutdown";
}

type ClientMessage =
  | ConnectMessage
  | TaskMessage
  | StatusQueryMessage
  | ShutdownMessage;

interface ConnectedMessage {
  type: "connected";
  clientId: string;
  capabilities: string[];
}

interface TaskAcceptedMessage {
  type: "task.accepted";
  taskId: string;
  goal: string;
}

interface TaskStepMessage {
  type: "task.step";
  taskId: string;
  step: number;
  status: "executing" | "completed" | "failed";
  layer: "deep" | "surface" | "fleet";
  data?: Record<string, unknown>;
}

interface TaskVerifyMessage {
  type: "task.verify";
  taskId: string;
  step: number;
  result: "pass" | "fail" | "ambiguous";
  confidence?: number;
}

interface TaskCompleteMessage {
  type: "task.complete";
  taskId: string;
  result: Record<string, unknown>;
}

interface TaskErrorMessage {
  type: "task.error";
  taskId: string;
  error: string;
}

interface StatusReplyMessage {
  type: "status.reply";
  connectedClients: number;
  queueDepth: number;
  uptime: number;
}

interface GatewayShutdownMessage {
  type: "gateway.shutdown";
  reason: string;
}

interface ErrorMessage {
  type: "error";
  message: string;
}

type ServerMessage =
  | ConnectedMessage
  | TaskAcceptedMessage
  | TaskStepMessage
  | TaskVerifyMessage
  | TaskCompleteMessage
  | TaskErrorMessage
  | StatusReplyMessage
  | GatewayShutdownMessage
  | ErrorMessage
  | { type: string; [key: string]: unknown };

// ─── Utilities ────────────────────────────────────────────────────────────────

function send(ws: WebSocket, msg: ClientMessage): void {
  ws.send(JSON.stringify(msg));
}

/**
 * Open a WebSocket to the gateway and wait for the `connected` handshake.
 * Rejects with a clear error if the gateway is not reachable.
 */
function connect(timeoutMs: number = CONNECT_TIMEOUT_MS): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);

    const timer = setTimeout(() => {
      ws.terminate();
      reject(
        new Error(
          `Cannot reach gateway at ${WS_URL} — is it running? Try: omnistate start`
        )
      );
    }, timeoutMs);

    ws.once("open", () => {
      const msg: ConnectMessage = {
        type: "connect",
        auth: {},
        role: "cli",
      };
      ws.send(JSON.stringify(msg));
    });

    ws.once("message", (raw) => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(raw.toString()) as ServerMessage;
        if (data.type === "connected") {
          resolve(ws);
        } else {
          ws.terminate();
          reject(new Error(`Unexpected handshake response: ${raw.toString()}`));
        }
      } catch {
        ws.terminate();
        reject(new Error(`Invalid handshake JSON: ${raw.toString()}`));
      }
    });

    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Cannot connect to gateway at ${WS_URL} — is it running? (${err.message})`
        )
      );
    });
  });
}

/**
 * Quick probe: can we reach the daemon within a short timeout?
 */
async function isDaemonRunning(): Promise<boolean> {
  try {
    const ws = await connect(INLINE_DETECT_TIMEOUT_MS);
    ws.close();
    return true;
  } catch {
    return false;
  }
}

// ─── ANSI colour helpers ──────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;

function clr(code: number, text: string): string {
  return isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
}

const bold = (t: string) => clr(1, t);
const dim = (t: string) => clr(2, t);
const green = (t: string) => clr(32, t);
const yellow = (t: string) => clr(33, t);
const red = (t: string) => clr(31, t);
const cyan = (t: string) => clr(36, t);

// ─── Output formatting ─────────────────────────────────────────────────────

/** Pretty-print step data — extracts output/info and prints it cleanly. */
function printStepOutput(data: Record<string, unknown>): void {
  // Shell output
  if (typeof data.output === "string" && data.output.trim()) {
    console.log(data.output.trimEnd());
    return;
  }

  // System info
  if (data.info && typeof data.info === "object") {
    const info = data.info as Record<string, unknown>;
    for (const [key, val] of Object.entries(info)) {
      console.log(`  ${dim(padR(key, 16))} ${val}`);
    }
    return;
  }

  // Process list
  if (Array.isArray(data.processes)) {
    for (const p of data.processes as Array<Record<string, unknown>>) {
      console.log(`  ${dim(String(p.pid ?? ""))} ${p.name} ${dim(`cpu=${p.cpu}% mem=${p.memory}%`)}`);
    }
    return;
  }

  // Generic: show as JSON if non-empty and contains useful data
  const keys = Object.keys(data).filter((k) => data[k] !== undefined && data[k] !== null && data[k] !== "");
  if (keys.length > 0 && !(keys.length === 1 && data.success === true)) {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ─── Command: start ───────────────────────────────────────────────────────────

async function cmdStart(argv: string[]): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Locate the gateway entry point: packages/gateway/dist/index.js
  const gatewayEntry = resolve(__dirname, "../../gateway/dist/index.js");

  // Forward recognised flags verbatim to the gateway process
  const forwardedFlags: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if ((tok === "--port" || tok === "--config") && argv[i + 1] !== undefined) {
      forwardedFlags.push(tok, argv[++i]);
    } else if (tok === "--no-health") {
      forwardedFlags.push(tok);
    }
  }

  console.log(`${cyan("[omnistate]")} Starting gateway…`);
  console.log(dim(`  entry : ${gatewayEntry}`));
  if (forwardedFlags.length) {
    console.log(dim(`  flags : ${forwardedFlags.join(" ")}`));
  }

  // Spawn detached so the CLI process can exit while the daemon keeps running.
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", `import { startGateway } from ${JSON.stringify(gatewayEntry)}; await startGateway();`, ...forwardedFlags],
    {
      detached: true,
      stdio: "ignore",
    }
  );

  child.unref();
  console.log(green(`✓ Gateway daemon spawned (pid=${child.pid})`));
}

// ─── Command: run (daemon mode via WebSocket) ───────────────────────────────

async function cmdRunDaemon(goal: string): Promise<void> {
  let ws: WebSocket;
  try {
    ws = await connect();
  } catch (err) {
    console.error(red(`✗ ${(err as Error).message}`));
    process.exit(1);
  }

  console.log(`${cyan("[omnistate]")} ${dim("(daemon)")} ${bold(goal)}`);

  send(ws, { type: "task", goal });

  let taskId: string | null = null;
  let exitCode = 0;

  await new Promise<void>((resolve) => {
    ws.on("message", (raw) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw.toString()) as ServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "task.accepted": {
          const m = msg as TaskAcceptedMessage;
          taskId = m.taskId;
          console.log(dim(`  task ${m.taskId.slice(0, 8)}`));
          break;
        }

        case "task.step": {
          const m = msg as TaskStepMessage;
          if (m.status === "completed" && m.data) {
            printStepOutput(m.data);
          } else if (m.status === "failed") {
            console.error(red(`  ✗ Step ${m.step} failed`));
          }
          break;
        }

        case "task.verify": {
          // Silent on pass; only show failures
          const m = msg as TaskVerifyMessage;
          if (m.result !== "pass") {
            const icon = m.result === "fail" ? red("✗") : yellow("?");
            console.log(`  ${icon} Verify: ${m.result}`);
          }
          break;
        }

        case "task.complete": {
          const m = msg as TaskCompleteMessage;
          // Print aggregated output if step messages didn't already show it
          if (typeof m.result.output === "string" && m.result.output.trim()) {
            // Only print if we haven't seen step-level data
            // (the output field aggregates all steps)
          }
          console.log(dim(`\n  done ${dim(`[${(taskId ?? "").slice(0, 8)}]`)}`));
          ws.close();
          resolve();
          break;
        }

        case "task.error": {
          const m = msg as TaskErrorMessage;
          console.error(`\n${red("✗")} ${m.error}`);
          exitCode = 1;
          ws.close();
          resolve();
          break;
        }

        case "gateway.shutdown": {
          const m = msg as GatewayShutdownMessage;
          console.error(red(`✗ Gateway shut down: ${m.reason}`));
          exitCode = 1;
          resolve();
          break;
        }

        case "error": {
          const m = msg as ErrorMessage;
          console.error(red(`✗ ${m.message}`));
          exitCode = 1;
          ws.close();
          resolve();
          break;
        }
      }
    });

    ws.on("close", () => resolve());
    ws.on("error", (err) => {
      console.error(red(`✗ WebSocket error: ${err.message}`));
      exitCode = 1;
      resolve();
    });
  });

  process.exit(exitCode);
}

// ─── Command: run (inline mode — no daemon needed) ──────────────────────────

async function cmdRunInline(goal: string): Promise<void> {
  console.log(`${cyan("[omnistate]")} ${dim("(inline)")} ${bold(goal)}\n`);

  // Locate the gateway dist directory
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const gatewayDist = resolve(__dirname, "../../gateway/dist");

  // Load .env before anything else
  try {
    const { loadDotEnv } = (await import(
      resolve(gatewayDist, "index.js")
    )) as { loadDotEnv: (path?: string) => void };
    loadDotEnv();
  } catch {
    // .env loading is optional
  }

  // Import gateway modules directly
  let classifyIntent: (text: string) => Promise<{ type: string; entities: Record<string, unknown>; confidence: number; rawText: string }>;
  let planFromIntent: (intent: unknown) => Promise<{ taskId: string; goal: string; estimatedDuration: string; nodes: Array<{ id: string; type: string; layer: string; action: { description: string; tool: string; params: Record<string, unknown> }; verify?: unknown; dependencies: string[]; onSuccess: string | null; onFailure: unknown; estimatedDurationMs: number; priority: string }> }>;
  let optimizePlan: (plan: unknown) => unknown;
  let Orchestrator: new () => { executePlan(plan: unknown): Promise<{ taskId: string; status: string; completedSteps: number; totalSteps: number; error?: string; stepResults?: Array<{ nodeId: string; status: string; layer: string; durationMs: number; data?: Record<string, unknown>; error?: string }> }> };

  try {
    const intentMod = await import(resolve(gatewayDist, "planner/intent.js"));
    classifyIntent = intentMod.classifyIntent;
    planFromIntent = intentMod.planFromIntent;

    const optimizerMod = await import(resolve(gatewayDist, "planner/optimizer.js"));
    optimizePlan = optimizerMod.optimizePlan;

    const orchMod = await import(resolve(gatewayDist, "executor/orchestrator.js"));
    Orchestrator = orchMod.Orchestrator;
  } catch (err) {
    console.error(
      red("✗ Cannot load gateway modules.") +
      `\n  Is the gateway built? Try: ${cyan("pnpm build")}`
    );
    console.error(dim((err as Error).message));
    process.exit(1);
  }

  try {
    // 1. Classify intent
    const startMs = Date.now();
    const intent = await classifyIntent(goal);
    console.log(dim(`  intent: ${intent.type} (${(intent.confidence * 100).toFixed(0)}%)`));

    // 2. Build plan
    const rawPlan = await planFromIntent(intent);
    const plan = optimizePlan(rawPlan) as typeof rawPlan;
    console.log(dim(`  plan: ${plan.nodes.length} step(s)\n`));

    // 3. Execute
    const orchestrator = new Orchestrator();
    const result = await orchestrator.executePlan(plan);
    const elapsed = Date.now() - startMs;

    if (result.status === "failed") {
      console.error(`${red("✗")} ${result.error ?? "Execution failed"}`);

      // Show any partial output from completed steps
      if (result.stepResults) {
        for (const step of result.stepResults) {
          if (step.data && step.status === "ok") {
            printStepOutput(step.data);
          }
        }
      }
      process.exit(1);
    }

    // Print output from all steps
    if (result.stepResults) {
      for (const step of result.stepResults) {
        if (step.data) {
          printStepOutput(step.data);
        }
      }
    }

    console.log(dim(`\n  done (${elapsed}ms)`));
  } catch (err) {
    console.error(`${red("✗")} ${(err as Error).message}`);
    process.exit(1);
  }
}

// ─── Command: run (auto-detect daemon vs inline) ────────────────────────────

async function cmdRun(goal: string, forceInline: boolean = false): Promise<void> {
  if (!goal.trim()) {
    console.error(red('Usage: omnistate run "<command>"'));
    process.exit(1);
  }

  if (forceInline) {
    await cmdRunInline(goal);
    return;
  }

  // Auto-detect: try daemon first, fall back to inline
  const daemonUp = await isDaemonRunning();

  if (daemonUp) {
    await cmdRunDaemon(goal);
  } else {
    await cmdRunInline(goal);
  }
}

// ─── Command: config ─────────────────────────────────────────────────────────

async function cmdConfig(args: string[]): Promise<void> {
  const goal = ["omnistate", "config", ...args].join(" ").trim();
  const daemonUp = await isDaemonRunning();
  if (!daemonUp) {
    console.error(red("✗ `omnistate config` requires gateway daemon. Start it with: omnistate start"));
    process.exit(1);
  }
  await cmdRunDaemon(goal);
}

async function cmdModel(args: string[]): Promise<void> {
  const goal = ["/model", ...args].join(" ").trim();
  const daemonUp = await isDaemonRunning();
  if (!daemonUp) {
    console.error(red("✗ `omnistate model` requires gateway daemon. Start it with: omnistate start"));
    process.exit(1);
  }
  await cmdRunDaemon(goal);
}

async function cmdSession(args: string[]): Promise<void> {
  const goal = ["/session", ...args].join(" ").trim();
  const daemonUp = await isDaemonRunning();
  if (!daemonUp) {
    console.error(red("✗ `omnistate session` requires gateway daemon. Start it with: omnistate start"));
    process.exit(1);
  }
  await cmdRunDaemon(goal);
}

async function cmdClear(): Promise<void> {
  const daemonUp = await isDaemonRunning();
  if (!daemonUp) {
    console.error(red("✗ `omnistate clear` requires gateway daemon. Start it with: omnistate start"));
    process.exit(1);
  }
  await cmdRunDaemon("/clear");
}

async function cmdGatewaySlash(goal: string, requiresDaemon: boolean = true): Promise<void> {
  if (requiresDaemon) {
    const daemonUp = await isDaemonRunning();
    if (!daemonUp) {
      console.error(red(`✗ \'${goal}\' requires gateway daemon. Start it with: omnistate start`));
      process.exit(1);
    }
    await cmdRunDaemon(goal);
    return;
  }
  await cmdRun(goal, false);
}

// ─── Command: status ──────────────────────────────────────────────────────────

async function cmdStatus(): Promise<void> {
  let ws: WebSocket;
  try {
    ws = await connect();
  } catch {
    // Gateway not reachable — report stopped
    console.log(`${bold("Gateway:")} ${red("stopped")}  ${dim(`(${WS_URL})`)}`);
    process.exit(0);
  }

  console.log(`${bold("Gateway:")} ${green("running")}  ${dim(`(${WS_URL})`)}`);

  // Send a status query; if the gateway doesn't implement it we still report
  // "running" (already printed above) and close cleanly after a short wait.
  send(ws, { type: "status.query" } as ClientMessage);

  const timer = setTimeout(() => {
    console.log(dim("  (gateway did not return status details)"));
    ws.close();
  }, 2_000);

  ws.on("message", (raw) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw.toString()) as ServerMessage;
    } catch {
      return;
    }

    if (msg.type === "status.reply") {
      clearTimeout(timer);
      const m = msg as StatusReplyMessage;
      const uptimeSec = Math.floor(m.uptime / 1000);
      console.log(`  ${dim("clients :")} ${m.connectedClients}`);
      console.log(`  ${dim("queue   :")} ${m.queueDepth}`);
      console.log(`  ${dim("uptime  :")} ${uptimeSec}s`);
      ws.close();
    }
  });

  ws.on("close", () => process.exit(0));
  ws.on("error", () => process.exit(0));
}

// ─── Command: health ──────────────────────────────────────────────────────────

async function cmdHealth(): Promise<void> {
  // Import HealthMonitor directly (same process, no WS needed)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const monitorPath = resolve(__dirname, "../../gateway/dist/health/monitor.js");

  let HealthMonitor: {
    new (intervalMs?: number, autoRepair?: boolean): {
      runCheck(): Promise<{
        overall: string;
        timestamp: string;
        sensors: Record<string, { status: string; value: number; unit: string; message?: string }>;
        alerts: Array<{ sensor: string; severity: string; message: string }>;
        repairs: Array<{ action: string; target: string; success: boolean }>;
      }>;
    };
  };

  try {
    // Dynamic import — works with Node16 ESM
    const mod = (await import(monitorPath)) as {
      HealthMonitor: typeof HealthMonitor;
    };
    HealthMonitor = mod.HealthMonitor;
  } catch (err) {
    console.error(
      red(`✗ Cannot load HealthMonitor from ${monitorPath}`) +
        `\n  Is the gateway built? Try: pnpm --filter @omnistate/gateway build`
    );
    console.error(dim((err as Error).message));
    process.exit(1);
  }

  console.log(`${cyan("[omnistate]")} Running health check…\n`);

  const monitor = new HealthMonitor(0, false);
  const report = await monitor.runCheck();

  // ── Overall status ──
  const overallColor =
    report.overall === "healthy" ? green :
    report.overall === "degraded" ? yellow :
    red;
  console.log(`${bold("Overall:")} ${overallColor(report.overall.toUpperCase())}`);
  console.log(dim(`Timestamp: ${report.timestamp}\n`));

  // ── Sensor table ──
  const colW = { name: 12, status: 10, value: 10, unit: 8, message: 30 };
  const header =
    bold(padR("Sensor", colW.name)) +
    bold(padR("Status", colW.status)) +
    bold(padR("Value", colW.value)) +
    bold(padR("Unit", colW.unit)) +
    bold("Message");
  console.log(header);
  console.log(dim("─".repeat(70)));

  for (const [name, result] of Object.entries(report.sensors)) {
    const statusColor =
      result.status === "ok" ? green :
      result.status === "warning" ? yellow :
      red;
    const row =
      padR(name, colW.name) +
      statusColor(padR(result.status, colW.status)) +
      padR(String(result.value), colW.value) +
      padR(result.unit, colW.unit) +
      dim(result.message ?? "");
    console.log(row);
  }

  // ── Alerts ──
  if (report.alerts.length > 0) {
    console.log(`\n${bold("Alerts:")} ${report.alerts.length}`);
    for (const alert of report.alerts) {
      const alertColor = alert.severity === "critical" ? red : yellow;
      console.log(`  ${alertColor(`[${alert.severity}]`)} ${alert.sensor}: ${alert.message}`);
    }
  }

  // ── Repairs ──
  if (report.repairs.length > 0) {
    console.log(`\n${bold("Repairs applied:")} ${report.repairs.length}`);
    for (const repair of report.repairs) {
      const icon = repair.success ? green("✓") : red("✗");
      console.log(`  ${icon} ${repair.action} → ${repair.target}`);
    }
  }

  process.exit(report.overall === "critical" ? 1 : 0);
}

function padR(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

// ─── Command: stop ────────────────────────────────────────────────────────────

async function cmdStop(): Promise<void> {
  let ws: WebSocket;
  try {
    ws = await connect();
  } catch (err) {
    console.error(red(`✗ ${(err as Error).message}`));
    process.exit(1);
  }

  console.log(`${cyan("[omnistate]")} Sending shutdown signal…`);
  send(ws, { type: "admin.shutdown" } as ClientMessage);

  // Wait briefly for the gateway.shutdown echo
  const timer = setTimeout(() => {
    console.log(yellow("⚠  No shutdown confirmation received within 3s."));
    ws.close();
  }, 3_000);

  ws.on("message", (raw) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw.toString()) as ServerMessage;
    } catch {
      return;
    }
    if (msg.type === "gateway.shutdown") {
      clearTimeout(timer);
      console.log(green("✓ Gateway stopped."));
      ws.close();
    }
  });

  ws.on("close", () => process.exit(0));
  ws.on("error", (err) => {
    clearTimeout(timer);
    console.error(red(`✗ ${err.message}`));
    process.exit(1);
  });
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
${bold("OmniState")} — control your computer with natural language

${bold("USAGE")}
  omnistate <command> [options]

${bold("COMMANDS")}
  ${cyan("start")}              Start the gateway daemon
    ${dim("--port <n>")}         Override default port (${WS_PORT})
    ${dim("--config <path>")}    Path to config file
    ${dim("--no-health")}        Disable health monitor

  ${cyan('run "<goal>"')}       Execute a natural-language task
    ${dim("--inline")}           Force inline mode (skip daemon check)
    ${dim("(auto)")}             Tries daemon first, falls back to inline

  ${cyan("status")}             Show gateway status (clients, queue, uptime)

  ${cyan("config")}             Manage LLM provider/model/fallback/session config
    ${dim("show")}               Show current runtime config
    ${dim("set <key> <value>")}  Update api_key/base_url/model/provider/token budget
    ${dim("proxy add ...")}      Add third-party proxy provider
    ${dim("fallback ...")}       Manage fallback provider chain

  ${cyan("health")}             Run a single health check and print sensor table

  ${cyan("model")}              Show or switch active model
  ${cyan("session")}            Show/list/new/use runtime sessions
  ${cyan("clear")}              Clear current session counters and task history
  ${cyan("whoami")}             Show active provider/model identity
  ${cyan("commands")}           Show available slash commands
  ${cyan("think")}              Get/set thinking level (low|medium|high)
  ${cyan("fast")}               Toggle fast mode (on|off)
  ${cyan("verbose")}            Toggle verbose mode (on|off)
  ${cyan("voice")}              Show/update low-latency voice and Siri bridge config
  ${cyan("new")}                Create a new runtime session
  ${cyan("reset")}              Reset current session state

  ${cyan("stop")}               Gracefully stop the gateway daemon

  ${cyan("--help")}             Print this help message

${bold("EXAMPLES")}
  omnistate run "list all files"
  omnistate run "check disk space"
  omnistate run "show top 5 processes"
  omnistate run "what is my hostname"
  omnistate run "open Safari" --inline
  omnistate config show
  omnistate config set model cx/gpt-5.4
  omnistate config proxy add router9 http://localhost:20128/v1 sk-*** cx/gpt-5.4
  omnistate model
  omnistate model cx/gpt-5.4
  omnistate session list
  omnistate clear
  omnistate whoami
  omnistate think high
  omnistate fast on
  omnistate verbose on
  omnistate voice show
  omnistate voice providers native,whisper-local,whisper-cloud
  omnistate voice siri on
  omnistate new sprint-a
  omnistate reset
  omnistate start --port 19800
  omnistate health
  omnistate stop
`);
}

// ─── Argument parser ──────────────────────────────────────────────────────────

interface ParsedArgs {
  command: string | null;
  rest: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  // argv[0] = node, argv[1] = script path
  const tokens = argv.slice(2);
  if (tokens.length === 0) return { command: null, rest: [] };

  const [command, ...rest] = tokens;
  return { command: command ?? null, rest };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { command, rest } = parseArgs(process.argv);

  switch (command) {
    case "start":
      await cmdStart(rest);
      break;

    case "run": {
      const forceInline = rest.includes("--inline");
      const goalParts = rest.filter((t) => t !== "--inline");
      const goal = goalParts.join(" ").replace(/^["']|["']$/g, "");
      await cmdRun(goal, forceInline);
      break;
    }

    case "status":
      await cmdStatus();
      break;

    case "config":
      await cmdConfig(rest);
      break;

    case "model":
      await cmdModel(rest);
      break;

    case "session":
      await cmdSession(rest);
      break;

    case "clear":
      await cmdClear();
      break;

    case "whoami":
      await cmdGatewaySlash("/whoami");
      break;

    case "commands":
      await cmdGatewaySlash("/commands");
      break;

    case "think":
      await cmdGatewaySlash(["/think", ...rest].join(" ").trim());
      break;

    case "fast":
      await cmdGatewaySlash(["/fast", ...rest].join(" ").trim());
      break;

    case "verbose":
      await cmdGatewaySlash(["/verbose", ...rest].join(" ").trim());
      break;

    case "voice":
      await cmdGatewaySlash(["/voice", ...rest].join(" ").trim() || "/voice");
      break;

    case "new":
      await cmdGatewaySlash(["/new", ...rest].join(" ").trim());
      break;

    case "reset":
      await cmdGatewaySlash("/reset");
      break;

    case "health":
      await cmdHealth();
      break;

    case "stop":
      await cmdStop();
      break;

    case "--help":
    case "-h":
    case "help":
      printHelp();
      break;

    case null:
    case undefined:
      printHelp();
      break;

    default:
      console.error(red(`✗ Unknown command: ${command}`));
      console.error(dim('Run "omnistate --help" for usage.'));
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(red(`✗ Unexpected error: ${(err as Error).message}`));
  process.exit(1);
});
