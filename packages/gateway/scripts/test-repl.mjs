#!/usr/bin/env node
/**
 * OmniState Interactive REPL — test all use cases via text & voice.
 *
 * Usage:
 *   node packages/gateway/scripts/test-repl.mjs
 *   # or from project root:
 *   pnpm repl
 *
 * Commands:
 *   <any text>        → sends as NL task (intent → plan → execute)
 *   /voice            → record & transcribe with Whisper
 *   /speak <text>     → text-to-speech via macOS say
 *   /health           → thermal + battery status
 *   /battery          → battery info
 *   /wifi             → WiFi status
 *   /packages         → list brew packages
 *   /services         → list system services
 *   /network          → network interfaces
 *   /sysinfo          → system information
 *   /deep <cmd>       → run shell command directly
 *   /test-b           → test Domain B samples
 *   /test-c           → test Domain C samples
 *   /test-d           → test Domain D samples
 *   /quit             → exit
 */

import { createInterface } from "node:readline";
import { exec, execSync, spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const GATEWAY_DIR = resolve(__dirname, "..");
const PROJECT_ROOT = resolve(GATEWAY_DIR, "../..");

// ─── Load .env ───────────────────────────────────────────────────────────────

const { loadDotEnv } = await import(resolve(GATEWAY_DIR, "dist/index.js"));
loadDotEnv(resolve(PROJECT_ROOT, ".env"));

// ─── Import modules ──────────────────────────────────────────────────────────

const { DeepLayer } = await import(resolve(GATEWAY_DIR, "dist/layers/deep.js"));
const { DeepOSLayer } = await import(resolve(GATEWAY_DIR, "dist/layers/deep-os.js"));
const { DeepSystemLayer } = await import(resolve(GATEWAY_DIR, "dist/layers/deep-system.js"));
const { AdvancedHealthMonitor } = await import(resolve(GATEWAY_DIR, "dist/health/advanced-health.js"));
const { classifyIntent, planFromIntent } = await import(resolve(GATEWAY_DIR, "dist/planner/intent.js"));
const { Orchestrator } = await import(resolve(GATEWAY_DIR, "dist/executor/orchestrator.js"));

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

function log(color, label, msg) {
  console.log(`${color}[${label}]${c.reset} ${msg}`);
}

// ─── Voice ───────────────────────────────────────────────────────────────────

async function recordAndTranscribe() {
  const tmpFile = `/tmp/omnistate-voice-${Date.now()}.wav`;

  // Check for recording tools
  let recorder;
  try {
    execSync("which sox", { stdio: "pipe" });
    log(c.magenta, "VOICE", "Recording... press Ctrl+C or wait 10s");
    recorder = "sox";
  } catch {
    try {
      execSync("which ffmpeg", { stdio: "pipe" });
      log(c.magenta, "VOICE", "Recording with ffmpeg... 8 seconds");
      recorder = "ffmpeg";
    } catch {
      log(c.red, "VOICE", "No recorder found. Install: brew install sox");
      return null;
    }
  }

  try {
    if (recorder === "sox") {
      execSync(`sox -d -r 16000 -c 1 -b 16 ${tmpFile} trim 0 10 2>/dev/null`, {
        timeout: 15000,
        stdio: "pipe",
      });
    } else {
      execSync(`ffmpeg -f avfoundation -i ":0" -t 8 -ar 16000 -ac 1 ${tmpFile} -y 2>/dev/null`, {
        timeout: 15000,
        stdio: "pipe",
      });
    }
  } catch {
    // sox exits non-zero on Ctrl+C which is expected
  }

  if (!existsSync(tmpFile)) {
    log(c.red, "VOICE", "Recording failed — no audio file created");
    return null;
  }

  log(c.magenta, "VOICE", "Transcribing...");

  // Try Whisper
  try {
    const { stdout } = await execAsync(
      `python3 -c "
import whisper, sys
model = whisper.load_model('base')
result = model.transcribe('${tmpFile}')
print(result['text'].strip())
"`,
      { timeout: 120000 }
    );
    const text = stdout.trim();
    if (text) {
      log(c.green, "VOICE", `"${text}"`);
      return text;
    }
  } catch {
    log(c.yellow, "VOICE", "Whisper not available. Install: pip install openai-whisper");
  }

  // Try Whisper API (OpenAI-compatible)
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL) {
    try {
      const { stdout } = await execAsync(
        `curl -s ${process.env.OPENAI_BASE_URL}/audio/transcriptions ` +
        `-H "Authorization: Bearer ${process.env.OPENAI_API_KEY}" ` +
        `-F file=@${tmpFile} -F model=whisper-1`,
        { timeout: 30000 }
      );
      const result = JSON.parse(stdout);
      if (result.text) {
        log(c.green, "VOICE", `"${result.text}"`);
        return result.text;
      }
    } catch {
      log(c.yellow, "VOICE", "Whisper API also unavailable");
    }
  }

  return null;
}

async function speak(text) {
  try {
    const escaped = text.replace(/"/g, '\\"');
    await execAsync(`say "${escaped}"`, { timeout: 30000 });
  } catch {
    log(c.yellow, "TTS", "macOS say failed");
  }
}

// ─── Task Execution ──────────────────────────────────────────────────────────

async function runTask(goal) {
  log(c.cyan, "TASK", goal);
  const startMs = Date.now();

  try {
    log(c.dim, "STEP", "Classifying intent...");
    const intent = await classifyIntent(goal);
    log(c.green, "INTENT", `type=${intent.type} confidence=${intent.confidence.toFixed(2)}`);

    log(c.dim, "STEP", "Planning...");
    const plan = await planFromIntent(intent);
    log(c.green, "PLAN", `${plan.nodes.length} step(s)`);
    for (const n of plan.nodes) {
      log(c.dim, "NODE", `${n.action.tool} → ${n.action.description}`);
    }

    log(c.dim, "STEP", "Executing...");
    const result = await orchestrator.executePlan(plan);
    const durationMs = Date.now() - startMs;

    if (result.status === "complete") {
      log(c.green, "DONE", `${result.completedSteps}/${result.totalSteps} steps — ${durationMs}ms`);
      const last = result.stepResults?.[result.stepResults.length - 1];
      if (last?.data) {
        const output = formatOutput(last.data);
        console.log(output);
      }
    } else {
      log(c.red, "FAIL", `${result.error ?? "unknown"} — ${durationMs}ms`);
    }

    return result;
  } catch (err) {
    log(c.red, "ERROR", err.message || String(err));
    return null;
  }
}

function formatOutput(data) {
  if (data.output && typeof data.output === "string") {
    return data.output.trim().slice(0, 2000);
  }
  const json = JSON.stringify(data, null, 2);
  return json.length > 2000 ? json.slice(0, 2000) + "\n... (truncated)" : json;
}

// ─── Direct Commands ─────────────────────────────────────────────────────────

async function handleDirect(input) {
  try {
    if (input.startsWith("/deep ")) {
      const output = deep.exec(input.slice(6));
      console.log(output.trim());
    } else if (input === "/sysinfo") {
      console.log(deep.getSystemInfo());
    } else if (input === "/battery") {
      console.log(await deepSystem.getBatteryInfo());
    } else if (input === "/wifi") {
      console.log(await deepOS.getWiFiStatus());
    } else if (input === "/packages") {
      const pkgs = await deepOS.listInstalledPackages();
      log(c.green, "PKGS", `${pkgs.length} installed`);
      pkgs.slice(0, 15).forEach(p => console.log(`  ${p.name}@${p.version}`));
      if (pkgs.length > 15) console.log(`  ... and ${pkgs.length - 15} more`);
    } else if (input === "/services") {
      const svcs = await deepOS.listServices();
      log(c.green, "SVCS", `${svcs.length} services`);
      svcs.slice(0, 15).forEach(s => console.log(`  ${s.name} — ${s.status}`));
    } else if (input === "/network") {
      console.log(await deepOS.getNetworkInterfaces());
    } else if (input === "/health") {
      const thermal = await health.getThermalStatus();
      const battery = await health.getBatteryInfo();
      console.log("Thermal:", thermal);
      console.log("Battery:", battery);
    } else {
      return false;
    }
    return true;
  } catch (err) {
    log(c.red, "ERROR", err.message || String(err));
    return true;
  }
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

async function testDomainB() {
  log(c.blue, "TEST", "Domain B: Deep OS Layer");
  for (const t of [
    "what is my OS version",
    "show disk usage",
    "list top 5 processes",
    "what is my WiFi status",
    "check volume level",
  ]) {
    await runTask(t);
    console.log("");
  }
}

async function testDomainC() {
  log(c.blue, "TEST", "Domain C: Self-Healing");
  for (const t of [
    "check system health",
    "find largest files on disk",
    "diagnose network issues",
  ]) {
    await runTask(t);
    console.log("");
  }
}

async function testDomainD() {
  log(c.blue, "TEST", "Domain D: Hybrid");
  for (const t of [
    "generate a bash script to find all files larger than 100MB",
    "look up documentation for the chmod command",
  ]) {
    await runTask(t);
    console.log("");
  }
}

// ─── REPL ────────────────────────────────────────────────────────────────────

console.log(`
${c.bold}${c.cyan}╔══════════════════════════════════════════════════════════════╗
║                   🧠 OmniState REPL                          ║
║          Control your Mac with natural language               ║
╠══════════════════════════════════════════════════════════════╣
║  Type any command in natural language to execute              ║
║                                                              ║
║  /voice         — record & transcribe (Whisper)              ║
║  /speak <text>  — text-to-speech                             ║
║  /health        — thermal + battery check                    ║
║  /battery       — battery info                               ║
║  /wifi          — WiFi status                                ║
║  /packages      — installed brew packages                    ║
║  /services      — system services                            ║
║  /network       — network interfaces                         ║
║  /sysinfo       — system information                         ║
║  /deep <cmd>    — run shell command directly                 ║
║  /test-b        — test Domain B (Deep OS)                    ║
║  /test-c        — test Domain C (Self-Healing)               ║
║  /test-d        — test Domain D (Hybrid)                     ║
║  /quit          — exit                                       ║
╚══════════════════════════════════════════════════════════════╝${c.reset}
`);

const info = deep.getSystemInfo();
log(c.green, "READY", `${info.hostname} — ${info.platform}/${info.arch} — ${info.cpuCores} cores — ${info.freeMemoryMB}MB free`);
log(c.green, "LLM", `${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}`);
console.log("");

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `${c.cyan}omni>${c.reset} `,
});

rl.prompt();

rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) { rl.prompt(); return; }

  if (input === "/quit" || input === "/q") {
    console.log("Goodbye!"); process.exit(0);
  }

  if (input === "/voice") {
    const text = await recordAndTranscribe();
    if (text) {
      await runTask(text);
      // Also speak the result
    }
  } else if (input.startsWith("/speak ")) {
    await speak(input.slice(7));
  } else if (input === "/test-b") {
    await testDomainB();
  } else if (input === "/test-c") {
    await testDomainC();
  } else if (input === "/test-d") {
    await testDomainD();
  } else if (input.startsWith("/")) {
    const handled = await handleDirect(input);
    if (!handled) {
      // Unknown slash command — treat as NL
      await runTask(input);
    }
  } else {
    // Natural language command
    await runTask(input);
  }

  console.log("");
  rl.prompt();
});

rl.on("close", () => { console.log("\nGoodbye!"); process.exit(0); });
