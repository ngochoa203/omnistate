#!/usr/bin/env node
/**
 * OmniState CLI — control your computer with natural language.
 *
 * Commands:
 *   omnistate start [--port <n>] [--config <path>] [--no-health]
 *   omnistate run "<NL command>"
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
function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);

    const timer = setTimeout(() => {
      ws.terminate();
      reject(
        new Error(
          `Cannot reach gateway at ${WS_URL} — is it running? Try: omnistate start`
        )
      );
    }, CONNECT_TIMEOUT_MS);

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

// ─── Command: run ─────────────────────────────────────────────────────────────

async function cmdRun(goal: string): Promise<void> {
  if (!goal.trim()) {
    console.error(red('omnistate run: goal cannot be empty. Usage: omnistate run "<command>"'));
    process.exit(1);
  }

  let ws: WebSocket;
  try {
    ws = await connect();
  } catch (err) {
    console.error(red(`✗ ${(err as Error).message}`));
    process.exit(1);
  }

  console.log(`${cyan("[omnistate]")} Sending task: ${bold(goal)}`);

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
          console.log(dim(`  [${m.taskId.slice(0, 8)}] Task accepted`));
          break;
        }

        case "task.step": {
          const m = msg as TaskStepMessage;
          const icon =
            m.status === "completed" ? green("✓") :
            m.status === "failed" ? red("✗") :
            yellow("▸");
          console.log(
            `  ${icon} Step ${bold(String(m.step))} — ${m.status} ${dim(`[${m.layer}]`)}`
          );
          break;
        }

        case "task.verify": {
          const m = msg as TaskVerifyMessage;
          const icon =
            m.result === "pass" ? green("✓") :
            m.result === "fail" ? red("✗") :
            yellow("?");
          const conf = m.confidence !== undefined
            ? dim(` (confidence: ${(m.confidence * 100).toFixed(0)}%)`)
            : "";
          console.log(`  ${icon} Verify step ${m.step}: ${m.result}${conf}`);
          break;
        }

        case "task.complete": {
          const m = msg as TaskCompleteMessage;
          console.log(`\n${green("✓")} ${bold("Task complete")} ${dim(`[${(taskId ?? "").slice(0, 8)}]`)}`);
          const resultStr = JSON.stringify(m.result, null, 2);
          if (resultStr !== "{}") {
            console.log(dim("Result:"));
            console.log(resultStr);
          }
          ws.close();
          resolve();
          break;
        }

        case "task.error": {
          const m = msg as TaskErrorMessage;
          console.error(`\n${red("✗")} ${bold("Task failed")}: ${m.error}`);
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
          console.error(red(`✗ Gateway error: ${m.message}`));
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

  ${cyan('run "<goal>"')}       Send a natural-language task and stream progress

  ${cyan("status")}             Show gateway status (clients, queue, uptime)

  ${cyan("health")}             Run a single health check and print sensor table

  ${cyan("stop")}               Gracefully stop the gateway daemon

  ${cyan("--help")}             Print this help message

${bold("EXAMPLES")}
  omnistate start --port 19800
  omnistate run "open Safari and navigate to github.com"
  omnistate status
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
      const goal = rest.join(" ").replace(/^["']|["']$/g, "");
      await cmdRun(goal);
      break;
    }

    case "status":
      await cmdStatus();
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
