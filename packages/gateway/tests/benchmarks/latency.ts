/**
 * OmniState Gateway — Latency & Throughput Benchmark
 *
 * Measures six dimensions:
 *   1. WebSocket connection time
 *   2. Message round-trip (status.query → status.result)
 *   3. HTTP endpoint latency (/health, /healthz, /readyz)
 *   4. Auth flow latency (signup + login + token verify)
 *   5. Task dispatch latency (task send → task.accepted)
 *   6. Throughput (messages/sec sustained over N messages)
 *
 * Usage:
 *   node --loader ts-node/esm packages/gateway/tests/benchmarks/latency.ts
 *   WS_PORT=19800 HTTP_PORT=19801 node --loader ts-node/esm ...
 */

import { performance } from "node:perf_hooks";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WS_HOST = process.env.WS_HOST ?? "127.0.0.1";
const WS_PORT = Number(process.env.WS_PORT ?? 19800);
const HTTP_HOST = process.env.HTTP_HOST ?? "127.0.0.1";
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 19801);

/** Iterations for percentile-sensitive benchmarks. */
const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 50);
/** Messages fired in the throughput test. */
const THROUGHPUT_MSGS = Number(process.env.BENCH_THROUGHPUT_MSGS ?? 200);
/** Timeout (ms) waiting for a single WS response. */
const MSG_TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS ?? 5000);
/** Unique email prefix so re-runs don't collide. */
const RUN_ID = Date.now().toString(36);

const WS_URL = `ws://${WS_HOST}:${WS_PORT}`;
const HTTP_BASE = `http://${HTTP_HOST}:${HTTP_PORT}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RESULTS_PATH = join(__dirname, "results.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Sample {
  name: string;
  samples: number[];
  unit: string;
}

interface BenchResult {
  name: string;
  unit: string;
  iterations: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function summarize(sample: Sample): BenchResult {
  const sorted = [...sample.samples].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return {
    name: sample.name,
    unit: sample.unit,
    iterations: sorted.length,
    min: round(sorted[0] ?? 0),
    max: round(sorted[sorted.length - 1] ?? 0),
    mean: round(mean),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
  };
}

function round(n: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/** Resolve a WS message matching a predicate within timeout. */
function waitForMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = MSG_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`waitForMessage timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(data: WebSocket.RawData) {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.off("message", handler);
          resolve(msg);
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.on("message", handler);
  });
}

/** Open a WS, send connect, wait for "connected". Returns [ws, connectLatencyMs]. */
async function openConnectedWs(): Promise<[WebSocket, number]> {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL);

  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  const connectMsg = JSON.stringify({ type: "connect", auth: {}, role: "cli" });
  ws.send(connectMsg);

  await waitForMessage(ws, (m) => m.type === "connected");
  const elapsed = performance.now() - t0;
  return [ws, elapsed];
}

/** HTTP GET — returns latency in ms. */
async function httpGet(path: string): Promise<number> {
  const url = `${HTTP_BASE}${path}`;
  const t0 = performance.now();
  const res = await fetch(url);
  await res.text(); // consume body
  const elapsed = performance.now() - t0;
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return elapsed;
}

/** HTTP POST — returns [latency ms, parsed body]. */
async function httpPost(
  path: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<[number, Record<string, unknown>]> {
  const url = `${HTTP_BASE}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const t0 = performance.now();
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const json = (await res.json()) as Record<string, unknown>;
  const elapsed = performance.now() - t0;
  return [elapsed, json];
}

// ---------------------------------------------------------------------------
// Benchmark 1 — WebSocket connection time
// ---------------------------------------------------------------------------

async function benchWsConnect(): Promise<BenchResult> {
  const samples: number[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    const ws = new WebSocket(WS_URL);

    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    samples.push(performance.now() - t0);
    ws.close();
    // Brief pause so we don't hammer the fd table
    await new Promise((r) => setTimeout(r, 10));
  }

  return summarize({ name: "WS connection time", samples, unit: "ms" });
}

// ---------------------------------------------------------------------------
// Benchmark 2 — Message round-trip (status.query)
// ---------------------------------------------------------------------------

async function benchMsgRoundTrip(): Promise<BenchResult> {
  const [ws] = await openConnectedWs();
  const samples: number[] = [];

  try {
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      ws.send(JSON.stringify({ type: "status.query" }));
      // Accept any message back — gateway may respond with status.result or similar
      await waitForMessage(ws, (m) => m.type !== undefined);
      samples.push(performance.now() - t0);
    }
  } finally {
    ws.close();
  }

  return summarize({ name: "WS message round-trip (status.query)", samples, unit: "ms" });
}

// ---------------------------------------------------------------------------
// Benchmark 3 — HTTP endpoint latency
// ---------------------------------------------------------------------------

async function benchHttpEndpoints(): Promise<BenchResult[]> {
  const endpoints = ["/health", "/healthz", "/readyz"] as const;
  const results: BenchResult[] = [];

  for (const endpoint of endpoints) {
    const samples: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      try {
        const ms = await httpGet(endpoint);
        samples.push(ms);
      } catch {
        // endpoint may not be available; skip
      }
    }
    if (samples.length > 0) {
      results.push(summarize({ name: `HTTP GET ${endpoint}`, samples, unit: "ms" }));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Benchmark 4 — Auth flow latency (signup → login → verify)
// ---------------------------------------------------------------------------

async function benchAuthFlow(): Promise<BenchResult[]> {
  const signupSamples: number[] = [];
  const loginSamples: number[] = [];
  const verifySamples: number[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const email = `bench-${RUN_ID}-${i}@test.local`;
    const password = "bench-password-123";

    // --- signup ---
    let signupToken: string | undefined;
    try {
      const [ms, body] = await httpPost("/api/auth/signup", { email, password });
      signupSamples.push(ms);
      const tokens = body["tokens"] as Record<string, unknown> | undefined;
      signupToken = tokens?.["accessToken"] as string | undefined;
    } catch {
      // signup may fail (e.g. user already exists on re-run); skip this iteration
      continue;
    }

    // --- login ---
    let loginToken: string | undefined;
    try {
      const [ms, body] = await httpPost("/api/auth/login", { email, password });
      loginSamples.push(ms);
      const tokens = body["tokens"] as Record<string, unknown> | undefined;
      loginToken = tokens?.["accessToken"] as string | undefined;
    } catch {
      continue;
    }

    // --- verify (GET /api/auth/me with token) ---
    const token = loginToken ?? signupToken;
    if (token) {
      try {
        const url = `${HTTP_BASE}/api/auth/me`;
        const t0 = performance.now();
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        await res.json();
        verifySamples.push(performance.now() - t0);
      } catch {
        // ignore
      }
    }
  }

  const results: BenchResult[] = [];
  if (signupSamples.length > 0)
    results.push(summarize({ name: "Auth: signup", samples: signupSamples, unit: "ms" }));
  if (loginSamples.length > 0)
    results.push(summarize({ name: "Auth: login", samples: loginSamples, unit: "ms" }));
  if (verifySamples.length > 0)
    results.push(summarize({ name: "Auth: token verify (GET /me)", samples: verifySamples, unit: "ms" }));

  return results;
}

// ---------------------------------------------------------------------------
// Benchmark 5 — Task dispatch latency (send → task.accepted)
// ---------------------------------------------------------------------------

async function benchTaskDispatch(): Promise<BenchResult> {
  const [ws] = await openConnectedWs();
  const samples: number[] = [];

  try {
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      ws.send(
        JSON.stringify({
          type: "task",
          goal: "benchmark ping — return immediately",
          mode: "chat",
        }),
      );
      await waitForMessage(ws, (m) => m.type === "task.accepted" || m.type === "task.complete");
      samples.push(performance.now() - t0);
    }
  } finally {
    ws.close();
  }

  return summarize({ name: "Task dispatch (send → task.accepted)", samples, unit: "ms" });
}

// ---------------------------------------------------------------------------
// Benchmark 6 — Throughput (messages/sec)
// ---------------------------------------------------------------------------

async function benchThroughput(): Promise<BenchResult> {
  const [ws] = await openConnectedWs();

  let received = 0;
  const receivedPromise = new Promise<void>((resolve) => {
    ws.on("message", () => {
      received++;
      if (received >= THROUGHPUT_MSGS) resolve();
    });
  });

  const t0 = performance.now();

  for (let i = 0; i < THROUGHPUT_MSGS; i++) {
    ws.send(JSON.stringify({ type: "status.query" }));
  }

  // Wait until all responses are back or 30 s timeout
  await Promise.race([
    receivedPromise,
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("throughput timeout")), 30_000),
    ),
  ]);

  const elapsedMs = performance.now() - t0;
  ws.close();

  const msgsPerSec = (received / elapsedMs) * 1000;

  return summarize({
    name: `Throughput (${received} msgs)`,
    samples: [msgsPerSec],
    unit: "msg/s",
  });
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------

function renderTable(results: BenchResult[]): void {
  const cols = ["Name", "n", "min", "mean", "p50", "p95", "p99", "max", "unit"] as const;
  type Col = (typeof cols)[number];

  const widths: Record<Col, number> = {
    Name: 4,
    n: 1,
    min: 3,
    mean: 4,
    p50: 3,
    p95: 3,
    p99: 3,
    max: 3,
    unit: 4,
  };

  const rows: Record<Col, string>[] = results.map((r) => ({
    Name: r.name,
    n: String(r.iterations),
    min: String(r.min),
    mean: String(r.mean),
    p50: String(r.p50),
    p95: String(r.p95),
    p99: String(r.p99),
    max: String(r.max),
    unit: r.unit,
  }));

  // measure column widths
  for (const col of cols) {
    widths[col] = Math.max(widths[col], col.length);
    for (const row of rows) {
      widths[col] = Math.max(widths[col], row[col].length);
    }
  }

  const sep = cols.map((c) => "-".repeat(widths[c])).join("-+-");
  const header = cols.map((c) => c.padEnd(widths[c])).join(" | ");

  console.log("");
  console.log("  " + header);
  console.log("  " + sep);
  for (const row of rows) {
    const line = cols
      .map((c) => {
        const v = row[c];
        // right-align numeric columns
        return c === "Name" || c === "unit" ? v.padEnd(widths[c]) : v.padStart(widths[c]);
      })
      .join(" | ");
    console.log("  " + line);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  OmniState Gateway — Latency Benchmark");
  console.log(`  WS  → ${WS_URL}`);
  console.log(`  HTTP → ${HTTP_BASE}`);
  console.log(`  iterations=${ITERATIONS}  throughput_msgs=${THROUGHPUT_MSGS}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const allResults: BenchResult[] = [];
  const errors: string[] = [];

  async function run1(label: string, fn: () => Promise<BenchResult | BenchResult[]>) {
    process.stdout.write(`  ⏳ ${label}...`);
    try {
      const r = await fn();
      const arr = Array.isArray(r) ? r : [r];
      allResults.push(...arr);
      console.log(` ✓ (${arr.length} series)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${label}: ${msg}`);
      console.log(` ✗ ${msg}`);
    }
  }

  await run1("1/6  WS connection time", benchWsConnect);
  await run1("2/6  WS message round-trip", benchMsgRoundTrip);
  await run1("3/6  HTTP endpoint latency", benchHttpEndpoints);
  await run1("4/6  Auth flow latency", benchAuthFlow);
  await run1("5/6  Task dispatch latency", benchTaskDispatch);
  await run1("6/6  Throughput", benchThroughput);

  // Results table
  if (allResults.length > 0) {
    renderTable(allResults);
  }

  if (errors.length > 0) {
    console.log("  ⚠️  Errors:");
    for (const e of errors) console.log(`     • ${e}`);
    console.log("");
  }

  // Persist to results.json
  const output = {
    runAt: new Date().toISOString(),
    gateway: { ws: WS_URL, http: HTTP_BASE },
    config: { iterations: ITERATIONS, throughputMsgs: THROUGHPUT_MSGS },
    results: allResults,
    errors,
  };

  try {
    await mkdir(dirname(RESULTS_PATH), { recursive: true });
    await writeFile(RESULTS_PATH, JSON.stringify(output, null, 2));
    console.log(`  📄 Results saved → ${RESULTS_PATH}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ⚠️  Could not save results: ${msg}`);
  }
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
