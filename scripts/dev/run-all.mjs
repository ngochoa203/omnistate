#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");

function log(msg) {
  process.stdout.write(`[run-all] ${msg}\n`);
}

function listPidsOnPort(port) {
  try {
    const out = execSync(`lsof -nP -tiTCP:${port} -sTCP:LISTEN`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!out) return [];
    return out
      .split(/\s+/g)
      .map((x) => Number.parseInt(x, 10))
      .filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

function isListening(port) {
  return listPidsOnPort(port).length > 0;
}

function terminatePid(pid) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }
  return true;
}

function forceKillPid(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return false;
  }
  return true;
}

// ─── Port availability helpers ─────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a port until it is no longer in LISTEN state, up to maxMs.
 * Returns true if freed, false if still occupied after timeout.
 */
async function waitForPort(port, maxMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    if (!isListening(port)) return true;
    await sleep(100);
  }
  return !isListening(port);
}

/**
 * Returns true if the given port has no TCP listener on 127.0.0.1.
 */
function checkPortFree(port) {
  return !isListening(port);
}

async function collectPortPids(ports) {
  const pids = new Set();
  for (const port of ports) {
    for (const pid of listPidsOnPort(port)) pids.add(pid);
  }
  return pids;
}

async function waitForPortsFree(ports, timeoutMs) {
  const started = Date.now();
  let remaining = new Set();
  while (Date.now() - started < timeoutMs) {
    remaining = await collectPortPids(ports);
    if (remaining.size === 0) return remaining;
    await sleep(100);
  }
  return collectPortPids(ports);
}

async function freePorts(ports) {
  const allPids = await collectPortPids(ports);
  if (allPids.size === 0) {
    log(`No occupied ports to clear: ${ports.join(", ")}`);
    return;
  }
  log(`Clearing occupied ports ${ports.join(", ")} (pids: ${[...allPids].join(", ")})`);
  for (const pid of allPids) terminatePid(pid);

  let stubborn = await waitForPortsFree(ports, 3000);
  if (stubborn.size > 0) {
    log(`Force-killing stubborn listeners: ${[...stubborn].join(", ")}`);
    for (const pid of stubborn) forceKillPid(pid);
    stubborn = await waitForPortsFree(ports, 3000);
  }

  if (stubborn.size > 0) {
    throw new Error(`Cannot free required ports. Still occupied by pids: ${[...stubborn].join(", ")}`);
  }
}

async function waitForGatewayReady({ gatewayProcess, apiPort, wsPort, timeoutMs = 30000, intervalMs = 500 } = {}) {
  const healthUrls = [
    `http://127.0.0.1:${apiPort}/healthz`,
    `http://127.0.0.1:${apiPort}/health`,
  ];
  log(`Health probe targets: ${healthUrls.join(", ")}; WS port: ${wsPort}`);

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (gatewayProcess && gatewayProcess.exitCode !== null) {
      if (gatewayProcess.exitCode !== 0) {
        log(`Gateway launcher exited with code ${gatewayProcess.exitCode} before readiness.`);
        return false;
      }
      // Launcher may exit 0 after daemonizing; keep probing readiness via health + WS port.
      log("Gateway launcher exited 0; continuing readiness checks for daemonized gateway...");
      gatewayProcess = null;
    }
    if (gatewayProcess && gatewayProcess.signalCode !== null) {
      log(`Gateway launcher terminated by signal ${gatewayProcess.signalCode} before readiness.`);
      return false;
    }

    let apiReady = false;
    for (const url of healthUrls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          apiReady = true;
          break;
        }
      } catch {
        // gateway not ready yet
      }
    }

    if (apiReady && isListening(wsPort)) {
      log(`Gateway ready: API health on ${apiPort}, WS listener on ${wsPort}`);
      return true;
    }

    await sleep(intervalMs);
  }
  return false;
}

try {
  const skipNative = process.env.OMNISTATE_SKIP_NATIVE_BUILD === "1";
  if (skipNative) {
    log(`Building gateway + cli in ${repoRoot} (native skipped by OMNISTATE_SKIP_NATIVE_BUILD=1)...`);
    execSync("pnpm --filter @omnistate/gateway build && pnpm --filter @omnistate/cli build", {
      stdio: "inherit",
      cwd: repoRoot,
    });
  } else {
    log(`Building native + gateway + cli in ${repoRoot}...`);
    execSync("pnpm build:native && pnpm --filter @omnistate/gateway build && pnpm --filter @omnistate/cli build", {
      stdio: "inherit",
      cwd: repoRoot,
    });
  }
} catch (err) {
  log("Build failed. Abort.");
  process.exit(1);
}

let gateway = null;
let web = null;
let gatewayReady = false;

const shutdown = () => {
  log("Stopping all processes...");
  try { gateway?.kill("SIGTERM"); } catch {}
  try { web?.kill("SIGTERM"); } catch {}
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  // Kill any existing gateway/OmniState processes before freeing ports.
  // Strategy: kill by port (lsof) first — reliable regardless of node binary path.
  // pkill patterns are supplemental for processes not yet bound to ports.
  try {
    // 1. Hard-kill anything listening on gateway ports right now (most reliable)
    execSync(
      'lsof -nP -t -iTCP:19800 -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true',
      { stdio: "pipe" }
    );
    execSync(
      'lsof -nP -t -iTCP:19801 -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true',
      { stdio: "pipe" }
    );
    // 2. pkill supplemental — catches processes starting up but not yet listening
    execSync('pkill -9 -f "omnistate" 2>/dev/null || true', { stdio: "pipe" });
    execSync('pkill -9 -f "gateway/dist/index" 2>/dev/null || true', { stdio: "pipe" });
    execSync('pkill -9 -f "packages/gateway/dist/index" 2>/dev/null || true', { stdio: "pipe" });
    // 3. Wait for OS to release sockets — SIGKILL is instant but
    //    macOS TIME_WAIT can linger ~60s, so poll with a generous timeout.
    await waitForPort(19800, 3000);
    await waitForPort(19801, 3000);
  } catch {}

  // freePorts() will SIGTERM → wait → SIGKILL any remaining stragglers on all required ports
  await freePorts([19800, 19801, 5173, 5174, 5175]);

  if (isListening(19800)) {
    log(
      "⚠️  Port 19800 still in use after cleanup. If OmniState.app is running, quit it first (Cmd+Q), then retry."
    );
    throw new Error("Port 19800 still in use after cleanup");
  }

  const runtimeEnv = { ...process.env };
  const voicePython = resolve(repoRoot, ".venv-voice/bin/python");
  if (!runtimeEnv.OMNISTATE_RTC_PYTHON && existsSync(voicePython)) {
    runtimeEnv.OMNISTATE_RTC_PYTHON = voicePython;
    log(`Using voice python: OMNISTATE_RTC_PYTHON=${voicePython}`);
    // Verify faster-whisper is installed; install if missing
    try {
      execSync(`${voicePython} -c "import faster_whisper"`, { stdio: "pipe" });
    } catch {
      log("Installing faster-whisper and voice dependencies...");
      execSync(`${voicePython} -m pip install -r "${resolve(repoRoot, "scripts/voice/requirements.txt")}"`, {
        stdio: "inherit",
        cwd: repoRoot,
      });
    }
  }
  if (!runtimeEnv.WHISPER_DEVICE && process.platform === "darwin" && process.arch === "arm64") {
    runtimeEnv.WHISPER_DEVICE = "cpu";
    log("Using WHISPER_DEVICE=cpu (macOS arm64 safe default)");
  }
  if (runtimeEnv.WHISPER_MODEL === "large_v3") {
    runtimeEnv.WHISPER_MODEL = "large-v3";
    log("Normalized WHISPER_MODEL from large_v3 to large-v3");
  }
  if (!runtimeEnv.WHISPER_MODEL) {
    runtimeEnv.WHISPER_MODEL = "large-v3";
    log("Using WHISPER_MODEL=large-v3 (default for app:run:all)");
  }

  log("Starting gateway (19800 WS, 19801 API)...");
  gateway = spawn("pnpm", ["app:start"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: runtimeEnv,
  });

  gateway.on("exit", (code) => {
    if (code && code !== 0) {
      log(`Gateway exited with code ${code}`);
      shutdown();
      return;
    }
    if (!gatewayReady) {
      log("Gateway launcher exited before readiness; waiting for daemon health/port checks...");
      return;
    }
    log("Gateway launcher exited after readiness (likely daemonized); keeping run-all alive.");
  });

  log("Waiting for gateway API health and WS listener...");
  const ready = await waitForGatewayReady({ gatewayProcess: gateway, apiPort: 19801, wsPort: 19800 });
  if (!ready) {
    log("Gateway did not become ready on API 19801 and WS 19800 within 30s. Abort.");
    shutdown();
    return;
  }
  gatewayReady = true;

  log("Gateway API and WS are ready. Starting web dev server on fixed port 5175...");
  web = spawn(
    "pnpm",
    ["--dir", "packages/web", "dev", "--port", "5175", "--strictPort"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: runtimeEnv,
    },
  );

  let webRetries = 0;
  const MAX_WEB_RETRIES = 3;
  web.on("exit", (code) => {
    if (code && code !== 0) {
      webRetries++;
      if (webRetries < MAX_WEB_RETRIES) {
        log(`Web process exited with code ${code}. Retrying (${webRetries}/${MAX_WEB_RETRIES})...`);
        web = spawn("pnpm", ["--dir", "packages/web", "dev", "--port", "5175", "--strictPort"], {
          cwd: repoRoot,
          stdio: "inherit",
          env: runtimeEnv,
        });
      } else {
        log(`Web process failed after ${MAX_WEB_RETRIES} retries. Giving up.`);
        shutdown();
      }
    } else {
      shutdown();
    }
  });

  log("Run all ready: web http://localhost:5175 · gateway ws://127.0.0.1:19800");
}

main().catch((err) => {
  log(`run-all failed: ${err instanceof Error ? err.message : String(err)}`);
  shutdown();
});
