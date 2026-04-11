#!/usr/bin/env npx tsx
/**
 * OmniState Interactive REPL — test all use cases via text & voice.
 *
 * Usage:
 *   npx tsx packages/gateway/scripts/test-repl.ts
 *
 * Commands:
 *   <any text>        → sends as a task to the gateway (NL command)
 *   /voice            → start voice recording (Whisper local)
 *   /voice-native     → start voice recording (macOS native dictation)
 *   /speak <text>     → text-to-speech
 *   /health           → run health check
 *   /status           → gateway status
 *   /test-domain-a    → run Domain A sample tests
 *   /test-domain-b    → run Domain B sample tests
 *   /test-domain-c    → run Domain C sample tests
 *   /test-domain-d    → run Domain D sample tests
 *   /test-all         → run all domain tests
 *   /quit             → exit
 */

import { createInterface } from "node:readline";
import { exec, spawn, execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ─── Config ──────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATEWAY_DIR = resolve(__dirname, "..");
const PROJECT_ROOT = resolve(GATEWAY_DIR, "../..");

// Load .env
import { loadDotEnv } from "../src/index.js";
loadDotEnv(resolve(PROJECT_ROOT, ".env"));

// Import modules directly (no gateway needed for direct testing)
import { DeepLayer } from "../src/layers/deep.js";
import { DeepOSLayer } from "../src/layers/deep-os.js";
import { DeepSystemLayer } from "../src/layers/deep-system.js";
import { AdvancedHealthMonitor } from "../src/health/advanced-health.js";
import { classifyIntent, planFromIntent } from "../src/planner/intent.js";
import { Orchestrator } from "../src/executor/orchestrator.js";

const deep = new DeepLayer();
const deepOS = new DeepOSLayer(deep);
const deepSystem = new DeepSystemLayer(deep);
const health = new AdvancedHealthMonitor();
const orchestrator = new Orchestrator();

// ─── Colors ──────────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function log(color: string, label: string, msg: string) {
  console.log(`${color}[${label}]${c.reset} ${msg}`);
}

// ─── Voice Input ─────────────────────────────────────────────────────────────

async function voiceInputWhisperLocal(): Promise<string | null> {
  log(c.magenta, "VOICE", "Recording... Press ENTER to stop.");

  const tmpFile = `/tmp/omnistate-voice-${Date.now()}.wav`;

  // Start recording with sox (if available) or macOS rec
  const recorder = spawn("rec", [
    tmpFile,
    "rate", "16k",
    "channels", "1",
    "trim", "0", "30", // max 30 seconds
  ], { stdio: ["pipe", "pipe", "pipe"] });

  // Wait for ENTER
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => {
      recorder.kill("SIGINT");
      resolve();
    });
  });

  // Small delay for file write
  await new Promise((r) => setTimeout(r, 500));

  log(c.magenta, "VOICE", "Transcribing with Whisper...");

  try {
    // Try whisper CLI (Python)
    const { stdout } = await execAsync(
      `python3 -c "
import whisper
model = whisper.load_model('base')
result = model.transcribe('${tmpFile}')
print(result['text'].strip())
"`,
      { timeout: 60000 }
    );
    const text = stdout.trim();
    log(c.green, "VOICE", `Transcribed: "${text}"`);
    return text || null;
  } catch {
    log(c.yellow, "VOICE", "Whisper not available. Trying macOS dictation...");
    return voiceInputNative();
  }
}

async function voiceInputNative(): Promise<string | null> {
  log(c.magenta, "VOICE", "Using macOS dictation. Recording 5 seconds...");

  const tmpFile = `/tmp/omnistate-voice-${Date.now()}.wav`;

  try {
    // Record with macOS built-in
    execSync(
      `rec ${tmpFile} rate 16k channels 1 trim 0 5 2>/dev/null || ` +
      `sox -d -r 16000 -c 1 ${tmpFile} trim 0 5 2>/dev/null || ` +
      `ffmpeg -f avfoundation -i ":0" -t 5 -ar 16000 -ac 1 ${tmpFile} -y 2>/dev/null`,
      { timeout: 10000 }
    );

    // Try macOS speech recognition via AppleScript
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to return (do shell script "say -v ? 2>/dev/null | head -1")'`,
      { timeout: 5000 }
    );

    // Fallback: use Whisper if available
    try {
      const { stdout: text } = await execAsync(
        `python3 -c "import whisper; m=whisper.load_model('base'); print(m.transcribe('${tmpFile}')['text'].strip())"`,
        { timeout: 60000 }
      );
      return text.trim() || null;
    } catch {
      log(c.yellow, "VOICE", "No STT engine available. Install: pip install openai-whisper");
      return null;
    }
  } catch {
    log(c.red, "VOICE", "Recording failed. Install sox: brew install sox");
    return null;
  }
}

async function speak(text: string): Promise<void> {
  try {
    const escaped = text.replace(/"/g, '\\"').replace(/'/g, "'\\''");
    await execAsync(`say "${escaped}"`, { timeout: 30000 });
  } catch {
    log(c.yellow, "TTS", "say command failed");
  }
}

// ─── Domain Test Runners ─────────────────────────────────────────────────────

async function testDomainA() {
  log(c.blue, "TEST-A", "Domain A: Computer Vision & UI Automation");
  const tests = [
    "list all windows on screen",
    "take a screenshot",
    "what app is currently focused",
  ];
  for (const t of tests) await runTask(t);
}

async function testDomainB() {
  log(c.blue, "TEST-B", "Domain B: Deep OS Layer");
  const tests = [
    "list all running processes sorted by CPU",
    "what is my OS version",
    "show disk usage",
    "what packages are installed with brew",
    "list my WiFi status",
    "what is my battery level",
    "show my shell aliases",
    "what docker containers are running",
    "check volume level",
    "list login items",
  ];
  for (const t of tests) await runTask(t);
}

async function testDomainC() {
  log(c.blue, "TEST-C", "Domain C: Self-Healing");
  const tests = [
    "check system health",
    "find largest files on disk",
    "check thermal status of my Mac",
    "check battery health",
    "diagnose network issues",
  ];
  for (const t of tests) await runTask(t);
}

async function testDomainD() {
  log(c.blue, "TEST-D", "Domain D: Hybrid");
  const tests = [
    "generate a bash script to find all large files",
    "suggest what I should do next",
    "run a compliance check on this machine",
    "look up documentation for the ls command",
    "predict when my disk will be full",
  ];
  for (const t of tests) await runTask(t);
}

// ─── Task Execution ──────────────────────────────────────────────────────────

async function runTask(goal: string) {
  log(c.cyan, "TASK", goal);
  const startMs = Date.now();

  try {
    // 1. Classify intent
    log(c.dim, "STEP", "Classifying intent...");
    const intent = await classifyIntent(goal);
    log(c.green, "INTENT", `type=${intent.type} confidence=${intent.confidence.toFixed(2)}`);

    // 2. Generate plan
    log(c.dim, "STEP", "Generating plan...");
    const plan = await planFromIntent(intent);
    log(c.green, "PLAN", `${plan.nodes.length} step(s) — ${plan.estimatedDuration}`);

    for (const node of plan.nodes) {
      log(c.dim, "NODE", `[${node.id}] ${node.action.tool} → ${node.action.description}`);
    }

    // 3. Execute
    log(c.dim, "STEP", "Executing...");
    const result = await orchestrator.executePlan(plan);

    const durationMs = Date.now() - startMs;

    if (result.status === "complete") {
      log(c.green, "DONE", `Completed ${result.completedSteps}/${result.totalSteps} steps in ${durationMs}ms`);
      // Show last step result
      const lastResult = result.stepResults?.[result.stepResults.length - 1];
      if (lastResult?.data) {
        const output = JSON.stringify(lastResult.data, null, 2);
        // Truncate long output
        if (output.length > 1000) {
          console.log(output.slice(0, 1000) + "\n... (truncated)");
        } else {
          console.log(output);
        }
      }
    } else {
      log(c.red, "FAIL", `${result.error ?? "unknown error"} (${durationMs}ms)`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(c.red, "ERROR", msg);
  }

  console.log(""); // blank line
}

// ─── Direct API Test (no gateway, no WebSocket) ─────────────────────────────

async function runDirectTest(goal: string) {
  log(c.cyan, "DIRECT", `Testing: "${goal}"`);
  const startMs = Date.now();

  try {
    // Quick direct tests without full intent→plan→execute pipeline
    if (goal.startsWith("/deep ")) {
      const cmd = goal.slice(6);
      const output = deep.exec(cmd);
      log(c.green, "OUTPUT", output.slice(0, 500));
    } else if (goal.startsWith("/sysinfo")) {
      const info = deep.getSystemInfo();
      console.log(info);
    } else if (goal.startsWith("/battery")) {
      const info = await deepSystem.getBatteryInfo();
      console.log(info);
    } else if (goal.startsWith("/wifi")) {
      const info = await deepOS.getWiFiStatus();
      console.log(info);
    } else if (goal.startsWith("/packages")) {
      const pkgs = await deepOS.listInstalledPackages();
      log(c.green, "PACKAGES", `${pkgs.length} packages installed`);
      console.log(pkgs.slice(0, 10));
    } else if (goal.startsWith("/services")) {
      const services = await deepOS.listServices();
      log(c.green, "SERVICES", `${services.length} services`);
      console.log(services.slice(0, 10));
    } else if (goal.startsWith("/network")) {
      const ifaces = await deepOS.getNetworkInterfaces();
      console.log(ifaces);
    } else if (goal.startsWith("/health")) {
      log(c.dim, "STEP", "Running health check...");
      const report = await health.getThermalStatus();
      console.log(report);
    } else {
      // Full pipeline
      await runTask(goal);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(c.red, "ERROR", msg);
  }

  const elapsed = Date.now() - startMs;
  log(c.dim, "TIME", `${elapsed}ms`);
  console.log("");
}

// ─── REPL ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`
${c.bold}${c.cyan}╔══════════════════════════════════════════════════════════════╗
║                 🧠 OmniState REPL                            ║
║         Control your Mac with natural language               ║
╠══════════════════════════════════════════════════════════════╣
║  Type any command in natural language to execute             ║
║  /voice         — record & transcribe (Whisper)              ║
║  /voice-native  — record with macOS dictation                ║
║  /speak <text>  — text-to-speech                             ║
║  /health        — system health check                        ║
║  /battery       — battery info                               ║
║  /wifi          — WiFi status                                ║
║  /packages      — list installed packages                    ║
║  /services      — list system services                       ║
║  /network       — network interfaces                         ║
║  /sysinfo       — system information                         ║
║  /deep <cmd>    — run shell command directly                 ║
║  /test-domain-a — test Vision use cases                      ║
║  /test-domain-b — test Deep OS use cases                     ║
║  /test-domain-c — test Self-Healing use cases                ║
║  /test-domain-d — test Hybrid use cases                      ║
║  /test-all      — run all domain tests                       ║
║  /quit          — exit                                       ║
╚══════════════════════════════════════════════════════════════╝${c.reset}
`);

  // Quick system check
  const info = deep.getSystemInfo();
  log(c.green, "SYSTEM", `${info.hostname} — ${info.platform}/${info.arch} — ${info.cpuCores} cores — ${info.freeMemoryMB}MB free`);
  console.log("");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c.cyan}omni>${c.reset} `,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    try {
      switch (true) {
        case input === "/quit" || input === "/exit" || input === "/q":
          console.log("Goodbye!");
          process.exit(0);
          break;

        case input === "/voice":
          const voiceText = await voiceInputWhisperLocal();
          if (voiceText) {
            await runDirectTest(voiceText);
          }
          break;

        case input === "/voice-native":
          const nativeText = await voiceInputNative();
          if (nativeText) {
            await runDirectTest(nativeText);
          }
          break;

        case input.startsWith("/speak "):
          await speak(input.slice(7));
          break;

        case input === "/test-domain-a":
          await testDomainA();
          break;

        case input === "/test-domain-b":
          await testDomainB();
          break;

        case input === "/test-domain-c":
          await testDomainC();
          break;

        case input === "/test-domain-d":
          await testDomainD();
          break;

        case input === "/test-all":
          await testDomainA();
          await testDomainB();
          await testDomainC();
          await testDomainD();
          break;

        default:
          await runDirectTest(input);
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(c.red, "ERROR", msg);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nGoodbye!");
    process.exit(0);
  });
}

main().catch(console.error);
