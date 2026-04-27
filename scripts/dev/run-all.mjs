#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  let stubborn = await waitForPortsFree(ports, 1200);
  if (stubborn.size > 0) {
    log(`Force-killing stubborn listeners: ${[...stubborn].join(", ")}`);
    for (const pid of stubborn) forceKillPid(pid);
    stubborn = await waitForPortsFree(ports, 1200);
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
  await freePorts([19800, 19801, 5173, 5174, 5175]);

  const runtimeEnv = { ...process.env };
  const voicePython = resolve(repoRoot, ".venv-voice/bin/python");
  if (!runtimeEnv.OMNISTATE_RTC_PYTHON && existsSync(voicePython)) {
    runtimeEnv.OMNISTATE_RTC_PYTHON = voicePython;
    log(`Using voice python: OMNISTATE_RTC_PYTHON=${voicePython}`);
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

  web.on("exit", (code) => {
    if (code && code !== 0) {
      log(`Web exited with code ${code}`);
    }
    shutdown();
  });

  log("Run all ready: web http://localhost:5175 · gateway ws://127.0.0.1:19800");
}

main().catch((err) => {
  log(`run-all failed: ${err instanceof Error ? err.message : String(err)}`);
  shutdown();
});
