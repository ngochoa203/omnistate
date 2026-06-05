#!/usr/bin/env node
/**
 * e2e-setup.mjs — Bootstraps the gateway + web stack for Playwright E2E tests.
 *
 * Usage:
 *   node scripts/dev/e2e-setup.mjs           # start, wait for ready, then exit
 *   node scripts/dev/e2e-setup.mjs --watch  # keep running until Ctrl+C
 *
 * The gateway and web processes are spawned as children. On clean exit or
 * SIGINT/SIGTERM, all child processes are terminated.
 *
 * After running this, run e2e tests with:
 *   pnpm test:e2e
 *
 * Exit codes:
 *   0  — stack is ready and --watch was not set
 *   0  — stopped via SIGINT/SIGTERM (--watch mode)
 *   1  — build failed or stack did not become ready within 60s
 */

import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, openSync, closeSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");

const WATCH = process.argv.includes("--watch");
const LOCK_DIR = resolve(repoRoot, ".omnistate");
const LOCK_PATH = resolve(LOCK_DIR, "e2e-setup.lock");

// Gateway ports (must match what e2e tests expect)
const API_PORT = 19801;
const WS_PORT = 19800;
const WEB_PORT = 5173;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  process.stdout.write(`[e2e-setup] ${msg}\n`);
}

function logError(msg) {
  process.stderr.write(`[e2e-setup] ERROR: ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Port checks
// ---------------------------------------------------------------------------

function isListening(port) {
  try {
    const out = execSync(
      `lsof -nP -tiTCP:${port} -sTCP:LISTEN 2>/dev/null | wc -l`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    return parseInt(out, 10) > 0;
  } catch {
    return false;
  }
}

function getListeningPids(port) {
  try {
    const out = execSync(
      `lsof -nP -tiTCP:${port} -sTCP:LISTEN 2>/dev/null`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    return out ? out.split("\n").map((value) => value.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function describePid(pid) {
  try {
    const out = execSync(
      `ps -o comm= -p ${pid} 2>/dev/null && ps -o user= -p ${pid} 2>/dev/null`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    const [comm, user] = out.split("\n").map((s) => s.trim());
    return { comm: comm || "unknown", user: user || "unknown" };
  } catch {
    return { comm: "unknown", user: "unknown" };
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPort(port, label, timeoutMs = 60000) {
  log(`Waiting for ${label} on port ${port}...`);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (isListening(port)) {
      log(`${label} ready on port ${port}`);
      return true;
    }
    await sleep(250);
  }
  logError(`${label} did not appear on port ${port} within ${timeoutMs}ms`);
  return false;
}

// ---------------------------------------------------------------------------
// Build step
// ---------------------------------------------------------------------------

function build() {
  log("Building gateway + web...");
  try {
    execSync("pnpm --filter @omnistate/gateway build", {
      stdio: "inherit",
      cwd: repoRoot,
    });
  } catch (err) {
    logError("Gateway build failed");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Process management
// ---------------------------------------------------------------------------

let gateway = null;
let web = null;
let lockFd = null;

function releaseLock() {
  if (lockFd !== null) {
    try { closeSync(lockFd); } catch {}
    lockFd = null;
  }
  try { unlinkSync(LOCK_PATH); } catch {}
}

function killAll() {
  log("Shutting down processes...");
  for (const p of [gateway, web]) {
    if (p) {
      try { p.kill("SIGTERM"); } catch {}
    }
  }
  releaseLock();
}

process.on("SIGINT", () => { killAll(); process.exit(0); });
process.on("SIGTERM", () => { killAll(); process.exit(0); });

function acquireLock() {
  try {
    if (!existsSync(LOCK_DIR)) mkdirSync(LOCK_DIR, { recursive: true });
    lockFd = openSync(LOCK_PATH, "wx");
    writeFileSync(lockFd, JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
      ports: { ws: WS_PORT, api: API_PORT, web: WEB_PORT },
    }, null, 2));
    return;
  } catch (err) {
    try {
      const raw = readFileSync(LOCK_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.pid && isPidAlive(parsed.pid)) {
        const { comm, user } = describePid(parsed.pid);
        throw new Error(
          `Another e2e-setup instance is already running (pid ${parsed.pid}, ` +
          `user=${user}, comm=${comm}). Stop it before starting a new stack. Lock: ${LOCK_PATH}`
        );
      }
    } catch (readErr) {
      if (readErr instanceof Error && /Another e2e-setup instance/.test(readErr.message)) {
        throw readErr;
      }
    }

    releaseLock();
    lockFd = openSync(LOCK_PATH, "wx");
    writeFileSync(lockFd, JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
      ports: { ws: WS_PORT, api: API_PORT, web: WEB_PORT },
      recoveredStaleLock: true,
    }, null, 2));
    log(`[stale-lock] Removed orphaned lock from previous run and acquired fresh lock.`);
  }
}

function assertPortsFree() {
  const conflicts = [
    { port: WS_PORT, label: "Gateway WebSocket" },
    { port: API_PORT, label: "Gateway API" },
    { port: WEB_PORT, label: "Web dev server" },
  ].flatMap(({ port, label }) =>
    getListeningPids(port).map((pid) => {
      const { comm, user } = describePid(pid);
      return { port, label, pid, comm, user };
    }),
  );

  if (conflicts.length === 0) {
    return;
  }

  const detail = conflicts
    .map(({ label, port, pid, comm, user }) =>
      `${label} port ${port} is already used by pid ${pid} (user=${user}, comm=${comm})`)
    .join("; ");
  throw new Error(`Port contention detected before boot: ${detail}`);
}

// ---------------------------------------------------------------------------
// Start gateway
// ---------------------------------------------------------------------------

async function startGateway() {
  log(`Starting gateway (WS ${WS_PORT}, API ${API_PORT})...`);
  const gatewayEnv = { ...process.env };

  // Use voice python if available
  const voicePython = resolve(repoRoot, ".venv-voice/bin/python");
  if (!gatewayEnv.OMNISTATE_RTC_PYTHON && existsSync(voicePython)) {
    gatewayEnv.OMNISTATE_RTC_PYTHON = voicePython;
  }

  // Whisper defaults for arm64 macOS
  if (!gatewayEnv.WHISPER_DEVICE && process.platform === "darwin" && process.arch === "arm64") {
    gatewayEnv.WHISPER_DEVICE = "cpu";
  }
  if (!gatewayEnv.WHISPER_MODEL) {
    gatewayEnv.WHISPER_MODEL = "large-v3";
  }

  gateway = spawn("node", [resolve(repoRoot, "packages/gateway/dist/index.js")], {
    cwd: repoRoot,
    stdio: "inherit",
    env: gatewayEnv,
  });

  gateway.on("exit", (code) => {
    if (code && code !== 0) {
      logError(`Gateway exited with code ${code}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Start web dev server
// ---------------------------------------------------------------------------

async function startWeb() {
  log(`Starting web dev server (port ${WEB_PORT})...`);
  web = spawn("pnpm", ["--dir", "packages/web", "dev", "--port", String(WEB_PORT), "--strictPort"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env },
  });

  web.on("exit", (code) => {
    if (code && code !== 0) {
      logError(`Web dev server exited with code ${code}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log("e2e-setup: bootstrapping OmniState stack for Playwright E2E tests");
  log(`Gateway ports: WS=${WS_PORT}, API=${API_PORT} | Web port: ${WEB_PORT}`);

  acquireLock();
  assertPortsFree();
  build();

  await startGateway();

  // Wait for gateway readiness before starting web
  const gwReady = await waitForPort(WS_PORT, "Gateway WebSocket", 30000);
  if (!gwReady) {
    logError("Gateway did not start. Check logs above.");
    killAll();
    process.exit(1);
  }

  await startWeb();

  const webReady = await waitForPort(WEB_PORT, "Web dev server", 30000);
  if (!webReady) {
    logError("Web dev server did not start. Check logs above.");
    killAll();
    process.exit(1);
  }

  log("═══════════════════════════════════════════════════════");
  log("Stack ready. Run e2e tests with: pnpm test:e2e");
  log(`  Gateway WS: ws://127.0.0.1:${WS_PORT}`);
  log(`  Gateway API: http://127.0.0.1:${API_PORT}`);
  log(`  Web:         http://localhost:${WEB_PORT}`);
  log("═══════════════════════════════════════════════════════");

  if (WATCH) {
    log("Keeping stack alive (Ctrl+C to stop)...");
    await new Promise(() => {}); // block forever
  } else {
    log("Stack is ready. Exiting setup — tests can now connect.");
    log("(To keep the stack running in the background, use: node scripts/dev/e2e-setup.mjs --watch)");
    killAll();
  }
}

main().catch((err) => {
  logError(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  killAll();
  process.exit(1);
});
