#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

function log(msg) {
  process.stdout.write(`[run-all] ${msg}\n`);
}

function listPidsOnPort(port) {
  try {
    const out = execSync(`lsof -ti tcp:${port}`, {
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

async function freePorts(ports) {
  const allPids = new Set();
  for (const port of ports) {
    for (const pid of listPidsOnPort(port)) allPids.add(pid);
  }
  if (allPids.size === 0) {
    log(`No occupied ports to clear: ${ports.join(", ")}`);
    return;
  }
  log(`Clearing occupied ports ${ports.join(", ")} (pids: ${[...allPids].join(", ")})`);
  for (const pid of allPids) terminatePid(pid);

  await sleep(350);

  const stubborn = new Set();
  for (const port of ports) {
    for (const pid of listPidsOnPort(port)) stubborn.add(pid);
  }
  if (stubborn.size > 0) {
    log(`Force-killing stubborn listeners: ${[...stubborn].join(", ")}`);
    for (const pid of stubborn) forceKillPid(pid);
    await sleep(200);
  }

  const remaining = new Set();
  for (const port of ports) {
    for (const pid of listPidsOnPort(port)) remaining.add(pid);
  }
  if (remaining.size > 0) {
    throw new Error(`Cannot free required ports. Still occupied by pids: ${[...remaining].join(", ")}`);
  }
}

async function waitForGatewayReady({ timeoutMs = 30000, intervalMs = 500 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch("http://127.0.0.1:19801/healthz");
      if (res.ok) return true;
    } catch {
      // gateway not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
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

  log("Starting gateway (19800 WS, 19801 API)...");
  gateway = spawn("pnpm", ["start"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });

  gateway.on("exit", (code) => {
    if (code && code !== 0) {
      log(`Gateway exited with code ${code}`);
    }
    shutdown();
  });

  log("Waiting for gateway health endpoint...");
  const ready = await waitForGatewayReady();
  if (!ready) {
    log("Gateway did not become ready within 30s. Abort.");
    shutdown();
    return;
  }

  log("Gateway is ready. Starting web dev server on fixed port 5175...");
  web = spawn(
    "pnpm",
    ["--dir", "packages/web", "dev", "--port", "5175", "--strictPort"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
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
