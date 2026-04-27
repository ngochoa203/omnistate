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
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
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

interface ToolsListMessage {
  type: "tools.list";
}

type ClientMessage =
  | ConnectMessage
  | TaskMessage
  | StatusQueryMessage
  | ShutdownMessage
  | ToolsListMessage;

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

interface ToolsReportMessage {
  type: "tools.report";
  tools: Array<{ name: string; description: string; group: string }>;
  skills: Array<{ name: string; group: string }>;
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
  | ToolsReportMessage
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
          if (typeof m.result.output === "string" && m.result.output.trim()) {
            console.log(m.result.output.trimEnd());
          } else if (m.result && typeof m.result === "object") {
            const success = (m.result as Record<string, unknown>).success;
            const error = (m.result as Record<string, unknown>).error;
            if (success === false || typeof error === "string") {
              console.log(JSON.stringify(m.result, null, 2));
            }
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

async function cmdRunAll(): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const scriptPath = resolve(__dirname, "../../../scripts/run-all.mjs");
  const repoRoot = resolve(__dirname, "../../..");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: "inherit",
      env: process.env,
      cwd: repoRoot,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`run all failed with exit code ${code}`));
    });
  });
}

async function runCommand(
  command: string,
  args: string[],
  cwd?: string
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
      cwd,
    });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

interface MacAppPaths {
  repoRoot: string;
  appRoot: string;
  appBinary: string;
  distApp: string;
  contentsDir: string;
  infoPlistTemplate: string;
  resourcesDir: string;
}

function getMacAppPaths(): MacAppPaths {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const repoRoot = resolve(__dirname, "../../..");
  const appRoot = resolve(repoRoot, "apps/macos/OmniState");
  const appName = "OmniState";
  const distApp = resolve(appRoot, `dist/${appName}.app`);
  const contentsDir = resolve(distApp, "Contents");
  return {
    repoRoot,
    appRoot,
    appBinary: resolve(appRoot, `.build/release/${appName}`),
    distApp,
    contentsDir,
    infoPlistTemplate: resolve(appRoot, "OmniState/Info.plist"),
    resourcesDir: resolve(appRoot, "OmniState/Resources"),
  };
}

async function cmdInstall(args: string[]): Promise<void> {
  const noOpen = args.includes("--no-open");
  const paths = getMacAppPaths();
  const appName = "OmniState";
  const appBundleId = "com.omnistate.app";

  if (process.platform !== "darwin") {
    console.error(red("✗ `omnistate install` is only supported on macOS."));
    process.exit(1);
  }

  console.log("[1/5] Build web assets");
  console.log("Skipping web asset build (native UI mode)");

  console.log("[2/5] Build release binary (native)");
  await runCommand("swift", ["build", "-c", "release", "--package-path", paths.appRoot], paths.repoRoot);

  console.log("[3/5] Package .app bundle");
  rmSync(paths.distApp, { recursive: true, force: true });
  mkdirSync(resolve(paths.contentsDir, "MacOS"), { recursive: true });
  mkdirSync(resolve(paths.contentsDir, "Resources"), { recursive: true });

  copyFileSync(paths.appBinary, resolve(paths.contentsDir, "MacOS", appName));
  chmodSync(resolve(paths.contentsDir, "MacOS", appName), 0o755);

  const infoPlist = readFileSync(paths.infoPlistTemplate, "utf-8")
    .replaceAll("$(EXECUTABLE_NAME)", appName)
    .replaceAll("$(PRODUCT_BUNDLE_IDENTIFIER)", appBundleId)
    .replaceAll("$(PRODUCT_NAME)", appName);
  writeFileSync(resolve(paths.contentsDir, "Info.plist"), infoPlist, "utf-8");

  cpSync(paths.resourcesDir, resolve(paths.contentsDir, "Resources"), {
    recursive: true,
  });

  console.log("[4/5] Codesign (ad-hoc)");
  await runCommand("codesign", ["--force", "--deep", "--sign", "-", paths.distApp], paths.repoRoot);
  await runCommand("plutil", ["-lint", resolve(paths.contentsDir, "Info.plist")], paths.repoRoot);
  await runCommand("codesign", ["--verify", "--deep", "--strict", paths.distApp], paths.repoRoot);

  if (!noOpen) {
    console.log("[5/5] Open app");
    await runCommand("open", [paths.distApp], paths.repoRoot);
  } else {
    console.log("[5/5] Open app");
    console.log("Skipped (--no-open)");
  }

  console.log(`Done: ${paths.distApp}`);
}

async function cmdApp(args: string[]): Promise<void> {
  const sub = args[0] ?? "";
  const paths = getMacAppPaths();

  if (process.platform !== "darwin") {
    console.error(red("✗ `omnistate app` is only supported on macOS."));
    process.exit(1);
  }

  if (sub === "build") {
    await runCommand("swift", ["build", "-c", "release", "--package-path", paths.appRoot], paths.repoRoot);
    return;
  }

  if (sub === "run") {
    await runCommand(resolve(paths.appRoot, ".build/release/OmniState"), [], paths.appRoot);
    return;
  }

  if (sub === "open") {
    if (!existsSync(paths.distApp)) {
      console.error(red("✗ App bundle not found. Run: omnistate install"));
      process.exit(1);
    }
    await runCommand("open", [paths.distApp], paths.repoRoot);
    return;
  }

  if (sub === "reset-permissions") {
    const bundleId = "com.omnistate.app";
    const services = [
      "Accessibility",
      "ScreenCapture",
      "AppleEvents",
      "Microphone",
      "Camera",
      "SpeechRecognition",
      "ListenEvent",
    ];

    for (const service of services) {
      try {
        await runCommand("tccutil", ["reset", service, bundleId], paths.repoRoot);
      } catch {
        // Continue best-effort; some services are unavailable on older macOS versions.
      }
    }

    console.log(green(`✓ Reset privacy permissions for ${bundleId}`));
    console.log(dim("Re-open OmniState and grant permissions again in System Settings if prompted."));
    return;
  }

  console.error(red("✗ Usage: omnistate app <build|run|open|reset-permissions>"));
  process.exit(1);
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

// ─── Command: repl / chat ─────────────────────────────────────────────────────

const REPL_SLASH_COMMANDS = [
  "/tools", "/skills", "/status", "/health", "/config",
  "/model", "/clear", "/quit", "/exit", "/help",
];

const TOOL_GROUPS = [
  { group: "browser",   count: 42 },
  { group: "file",      count: 32 },
  { group: "system",    count: 28 },
  { group: "network",   count: 16 },
  { group: "security",  count: 11 },
  { group: "process",   count: 9  },
  { group: "media",     count: 8  },
  { group: "git",       count: 7  },
  { group: "docker",    count: 6  },
  { group: "calendar",  count: 5  },
];

const SKILL_GROUPS = [
  "timer", "note", "reminder", "calendar", "app", "shell",
  "git", "docker", "media", "browser", "clipboard", "screenshot",
];

function printReplBanner(mode: string, model: string, context: string, sessionId: string): void {
  const modelLine   = `Model: ${model}    Context: ${context}    Session: ${sessionId}`;
  const modeLabel   = dim(`  [${mode}]`);
  console.log(cyan(bold(
    "╔══════════════════════════════════════════════════════════════╗\n" +
    "║                    OMNISTATE                                ║\n" +
    "║            AI-Powered System Control                        ║\n" +
    "╠══════════════════════════════════════════════════════════════╣\n" +
    `║  ${modelLine.padEnd(60)}║\n` +
    "╚══════════════════════════════════════════════════════════════╝"
  )));
  console.log(modeLabel);
}

function printReplToolList(): void {
  const toolStr = TOOL_GROUPS.map((g) => `${g.group}(${g.count})`).join(" ");
  console.log(`  ${dim("Tools:")} ${toolStr}`);
  const skillStr = SKILL_GROUPS.join(" ");
  console.log(`  ${dim("Skills:")} ${skillStr}`);
}

function printReplHelp(): void {
  console.log(
    `  ${cyan("/tools")} — list all tools    ` +
    `${cyan("/status")} — gateway status    ` +
    `${cyan("/health")} — health check\n` +
    `  ${cyan("/model")} — current model     ` +
    `${cyan("/config")} — show config       ` +
    `${cyan("/clear")} — clear screen\n` +
    `  ${cyan("/quit")} — exit`
  );
}

async function cmdRepl(args: string[]): Promise<void> {
  const inlineMode = args.includes("--inline");
  const mode = inlineMode ? "inline" : "daemon";

  printReplBanner(mode, "detecting...", "detecting...", "detecting...");
  console.log();
  printReplToolList();
  console.log();
  printReplHelp();
  console.log();

  // In daemon mode, establish a persistent WS connection
  let ws: WebSocket | null = null;

  if (!inlineMode) {
    try {
      ws = await connect();
      console.log(green(`✓ Connected to gateway at ${WS_URL}`));
    } catch (err) {
      console.log(yellow(`⚠  Gateway not reachable: ${(err as Error).message}`));
      console.log(dim("  Falling back to inline mode for NL tasks."));
    }
  } else {
    console.log(dim("  Running in inline mode — no gateway required."));
  }

  console.log();

  const promptStr = isTTY ? `${cyan("omni>")} ` : "omni> ";

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: promptStr,
    completer: (line: string): [string[], string] => {
      const hits = REPL_SLASH_COMMANDS.filter((c) => c.startsWith(line));
      return [hits.length ? hits : REPL_SLASH_COMMANDS, line];
    },
  });

  // Handle WS close events during REPL session
  if (ws) {
    ws.on("close", () => {
      console.log(yellow("\n⚠  Gateway connection closed. Reconnect or use inline fallback."));
      ws = null;
      rl.prompt();
    });
    ws.on("error", (err) => {
      console.error(red(`\n✗ WS error: ${err.message}`));
      ws = null;
      rl.prompt();
    });
  }

  rl.prompt();

  rl.on("line", async (rawLine) => {
    const input = rawLine.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    try {
      // ── slash commands ──────────────────────────────────────────────────────
      if (input.startsWith("/")) {
        const cmd = input.split(" ")[0]!.toLowerCase();

        switch (cmd) {
          case "/tools": {
            console.log(`\n${bold("Tool groups:")}`);
            for (const g of TOOL_GROUPS) {
              console.log(`  ${cyan(g.group.padEnd(12))} ${dim(`${g.count} tools`)}`);
            }
            // If connected, request live list from gateway
            if (ws && ws.readyState === WebSocket.OPEN) {
              send(ws, { type: "tools.list" } as ClientMessage);
            }
            break;
          }

          case "/skills": {
            console.log(`\n${bold("Skill categories:")}`);
            for (const s of SKILL_GROUPS) {
              console.log(`  ${cyan(s)}`);
            }
            break;
          }

          case "/status": {
            if (ws && ws.readyState === WebSocket.OPEN) {
              send(ws, { type: "status.query" } as ClientMessage);
              // Response printed by message handler
            } else if (inlineMode) {
              console.log(dim("  Running in inline mode — no gateway status available."));
            } else {
              console.log(yellow("  Gateway not connected. Try: omnistate start"));
            }
            break;
          }

          case "/health":
            await cmdHealth();
            break;

          case "/config":
            await cmdConfig(["show"]);
            break;

          case "/model":
            await cmdModel([]);
            break;

          case "/clear":
            console.clear();
            printReplBanner(mode, "detecting...", "detecting...", "detecting...");
            printReplToolList();
            printReplHelp();
            console.log();
            break;

          case "/quit":
          case "/exit":
            console.log("Goodbye!");
            if (ws) ws.close();
            rl.close();
            return;

          case "/help":
          default:
            printReplHelp();
            break;
        }

        rl.prompt();
        return;
      }

      // ── natural-language input ──────────────────────────────────────────────
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Daemon mode: send over WS and stream response
        send(ws, { type: "task", goal: input });
        const startMs = Date.now();

        await new Promise<void>((resolveTask) => {
          const onMsg = (raw: Buffer | string) => {
            let msg: ServerMessage;
            try {
              msg = JSON.parse(raw.toString()) as ServerMessage;
            } catch {
              return;
            }

            switch (msg.type) {
              case "task.accepted": {
                const m = msg as TaskAcceptedMessage;
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
              case "task.complete": {
                const m = msg as TaskCompleteMessage;
                if (typeof m.result.output === "string" && m.result.output.trim()) {
                  console.log(m.result.output.trimEnd());
                }
                const elapsed = Date.now() - startMs;
                console.log(dim(`\n  done (${elapsed}ms)`));
                ws!.off("message", onMsg);
                resolveTask();
                break;
              }
              case "task.error": {
                const m = msg as TaskErrorMessage;
                console.error(`\n${red("✗")} ${m.error}`);
                ws!.off("message", onMsg);
                resolveTask();
                break;
              }
              case "tools.report": {
                const m = msg as ToolsReportMessage;
                console.log(`\n${bold("Live tools from gateway:")} ${m.tools.length} tools, ${m.skills.length} skills`);
                ws!.off("message", onMsg);
                resolveTask();
                break;
              }
              case "status.reply": {
                const m = msg as StatusReplyMessage;
                const uptimeSec = Math.floor(m.uptime / 1000);
                console.log(`  ${dim("clients:")} ${m.connectedClients}  ${dim("queue:")} ${m.queueDepth}  ${dim("uptime:")} ${uptimeSec}s`);
                ws!.off("message", onMsg);
                resolveTask();
                break;
              }
              case "error": {
                const m = msg as ErrorMessage;
                console.error(red(`✗ ${m.message}`));
                ws!.off("message", onMsg);
                resolveTask();
                break;
              }
            }
          };

          ws!.on("message", onMsg);

          // Safety timeout: re-prompt after 60s if no terminal event arrives
          const timeout = setTimeout(() => {
            ws!.off("message", onMsg);
            resolveTask();
          }, 60_000);

          const origResolve = resolveTask;
          resolveTask = () => {
            clearTimeout(timeout);
            origResolve();
          };
        });

      } else {
        // Inline fallback mode
        try {
          await cmdRunInlineRepl(input);
        } catch (err) {
          console.error(`${red("✗")} ${(err as Error).message}`);
        }
      }
    } catch (err) {
      console.error(`${red("✗")} ${(err as Error).message}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    if (ws) ws.close();
    console.log("\nGoodbye!");
    process.exit(0);
  });
}

/**
 * Inline execution for REPL — same as cmdRunInline but does NOT call process.exit().
 */
async function cmdRunInlineRepl(goal: string): Promise<void> {
  console.log(`${cyan("[omnistate]")} ${dim("(inline)")} ${bold(goal)}\n`);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const gatewayDist = resolve(__dirname, "../../gateway/dist");

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
    throw new Error(
      `Cannot load gateway modules. Is the gateway built? Try: pnpm build\n${(err as Error).message}`
    );
  }

  const startMs = Date.now();
  const intent = await classifyIntent(goal);
  console.log(dim(`  intent: ${intent.type} (${(intent.confidence * 100).toFixed(0)}%)`));

  const rawPlan = await planFromIntent(intent);
  const plan = optimizePlan(rawPlan) as typeof rawPlan;
  console.log(dim(`  plan: ${plan.nodes.length} step(s)\n`));

  const orchestrator = new Orchestrator();
  const result = await orchestrator.executePlan(plan);
  const elapsed = Date.now() - startMs;

  if (result.status === "failed") {
    console.error(`${red("✗")} ${result.error ?? "Execution failed"}`);
    if (result.stepResults) {
      for (const step of result.stepResults) {
        if (step.data && step.status === "ok") printStepOutput(step.data);
      }
    }
    return;
  }

  if (result.stepResults) {
    for (const step of result.stepResults) {
      if (step.data) printStepOutput(step.data);
    }
  }

  console.log(dim(`\n  done (${elapsed}ms)`));
}

// ─── Command: voiceprint ─────────────────────────────────────────────────────

async function cmdVoiceprint(args: string[]): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const scriptPath = resolve(__dirname, "../../gateway/scripts/speechbrain_voiceprint.py");
  const pythonBin = process.env.OMNISTATE_PYTHON || `${process.env.HOME}/.pyenv/versions/3.12.12/bin/python3`;

  if (args.length === 0) {
    console.log("Usage: omnistate voiceprint <enroll|verify> [options]");
    process.exit(1);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(pythonBin, [scriptPath, ...args], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`voiceprint command failed with exit code ${code}`));
    });
  });
}

// ─── Command: doctor ─────────────────────────────────────────────────────────

async function cmdDoctor(): Promise<void> {
  const os = await import("node:os");
  const fs = await import("node:fs");
  const profilePath = `${process.env.HOME}/.omnistate/voice_profile.json`;
  const pythonBin = process.env.OMNISTATE_PYTHON || `${process.env.HOME}/.pyenv/versions/3.12.12/bin/python3`;

  console.log(`${cyan("[doctor]")} OmniState quick diagnostics`);

  const daemonUp = await isDaemonRunning();
  console.log(`  gateway        : ${daemonUp ? green("running") : red("stopped")}`);

  let profileCount = 0;
  let backend = "unknown";
  if (fs.existsSync(profilePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(profilePath, "utf-8")) as Record<string, unknown>;
      backend = typeof raw.speakerBackend === "string" ? raw.speakerBackend : "legacy";
      if (Array.isArray(raw.speakerProfiles)) profileCount = raw.speakerProfiles.length;
    } catch {
      // ignore parse error
    }
  }
  console.log(`  voice backend  : ${backend}`);
  console.log(`  speaker profiles: ${profileCount}`);

  const checkScript = `import importlib.util\nmods=['speechbrain','torch','torchaudio']\nprint(' '.join([m+':'+('ok' if importlib.util.find_spec(m) else 'missing') for m in mods]))`;
  await new Promise<void>((resolve) => {
    const child = spawn(pythonBin, ["-c", checkScript], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.on("close", () => {
      console.log(`  python deps    : ${out.trim() || "unavailable"}`);
      resolve();
    });
    child.on("error", () => {
      console.log("  python deps    : unavailable");
      resolve();
    });
  });

  console.log(`  host           : ${os.hostname()}`);
  console.log(green("✓ doctor finished"));
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

  ${cyan('run all')}            Start full stack (gateway + web), auto-free ports

  ${cyan('run "<goal>"')}       Execute a natural-language task
    ${dim("--inline")}           Force inline mode (skip daemon check)
    ${dim("(auto)")}             Tries daemon first, falls back to inline

  ${cyan("chat")}               Interactive REPL mode (Hermes Agent-style)
  ${cyan("repl")}               Alias for chat
    ${dim("--inline")}           Run gateway in-process (no daemon needed)

  ${cyan("status")}             Show gateway status (clients, queue, uptime)

  ${cyan("config")}             Runtime config (provider/model/base URL/API key)

  ${cyan("health")}             Run a single health check and print sensor table
  ${cyan("doctor")}             Run diagnostics (gateway, voice backend, python deps)
  ${cyan("voiceprint")}         Enroll/verify voiceprint from audio files
  ${cyan("install")}            Build, package, sign, and open macOS OmniState app
    ${dim("--no-open")}          Build/package only (do not auto-open)
  ${cyan("app")}                macOS app helpers: build | run | open | reset-permissions

  ${cyan("model")}              Show or switch active model
  ${cyan("session")}            Show/list/new/use runtime sessions
  ${cyan("clear")}              Clear current session counters and task history
  ${cyan("whoami")}             Show active provider/model identity
  ${cyan("commands")}           Show available slash commands
  ${cyan("think")}              Get/set thinking level (low|medium|high)
  ${cyan("fast")}               Toggle fast mode (on|off)
  ${cyan("verbose")}            Toggle verbose mode (on|off)
  ${cyan("voice")}              Show/update voice config
  ${cyan("wake")}               Show/update wake-word config
  ${cyan("new")}                Create a new runtime session
  ${cyan("reset")}              Reset current session state

  ${cyan("stop")}               Gracefully stop the gateway daemon

  ${cyan("--help")}             Print this help message

${bold("EXAMPLES")}
  omnistate chat
  omnistate repl --inline
  omnistate run all
  omnistate run "list all files"
  omnistate config show
  omnistate config set model cx/gpt-5.4
  omnistate model
  omnistate session list
  omnistate clear
  omnistate voice show
  omnistate wake show
  omnistate health
  omnistate doctor
  omnistate install
  omnistate app open
  omnistate app reset-permissions
  omnistate voiceprint enroll --audio ~/owner.wav --user-id owner --display-name Owner
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
      if (rest.length === 1 && rest[0] === "all") {
        await cmdRunAll();
        break;
      }
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

    case "wake":
      await cmdGatewaySlash(["/wake", ...rest].join(" ").trim() || "/wake");
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

    case "doctor":
      await cmdDoctor();
      break;

    case "install":
      await cmdInstall(rest);
      break;

    case "app":
      await cmdApp(rest);
      break;

    case "voiceprint":
      await cmdVoiceprint(rest);
      break;

    case "chat":
    case "repl":
      await cmdRepl(rest);
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
