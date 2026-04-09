/**
 * OmniState Performance Benchmarks
 *
 * Measures latency of core operations:
 * - Shell execution (deep layer)
 * - System info collection
 * - Process list enumeration
 * - Intent classification (regex fallback, no API)
 * - Plan building
 * - Full orchestrator pipeline
 * - Health check cycle
 *
 * Usage: npx tsx examples/bench.ts
 */

import { performance } from "node:perf_hooks";
import { arch, platform } from "node:os";

import { DeepLayer } from "../packages/gateway/src/layers/deep.js";
import { classifyIntent, planFromIntent } from "../packages/gateway/src/planner/intent.js";
import { Orchestrator } from "../packages/gateway/src/executor/orchestrator.js";
import { HealthMonitor } from "../packages/gateway/src/health/monitor.js";
import * as bridge from "../packages/gateway/src/platform/bridge.js";

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  cyan:   "\x1b[36m",
  yellow: "\x1b[33m",
  green:  "\x1b[32m",
  magenta:"\x1b[35m",
  red:    "\x1b[31m",
  white:  "\x1b[37m",
  gray:   "\x1b[90m",
} as const;

const bold   = (s: string) => `${C.bold}${s}${C.reset}`;
const cyan   = (s: string) => `${C.cyan}${s}${C.reset}`;
const yellow = (s: string) => `${C.yellow}${s}${C.reset}`;
const green  = (s: string) => `${C.green}${s}${C.reset}`;
const gray   = (s: string) => `${C.gray}${s}${C.reset}`;
const dim    = (s: string) => `${C.dim}${s}${C.reset}`;

// ---------------------------------------------------------------------------
// Benchmark harness
// ---------------------------------------------------------------------------

interface Stats {
  operation: string;
  min: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
  iterations: number;
  error?: string;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function bench(
  name: string,
  fn: () => Promise<void> | void,
  iterations = 10,
): Promise<Stats> {
  const timings: number[] = [];

  // Warm-up (1 run, not counted)
  try {
    await fn();
  } catch {
    // ignore warm-up errors
  }

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    try {
      await fn();
    } catch {
      // Record time even on error so we get realistic failure latency
    }
    timings.push(performance.now() - t0);
  }

  timings.sort((a, b) => a - b);

  return {
    operation: name,
    min: timings[0],
    avg: timings.reduce((s, v) => s + v, 0) / timings.length,
    p50: percentile(timings, 50),
    p95: percentile(timings, 95),
    max: timings[timings.length - 1],
    iterations,
  };
}

async function benchSafe(
  name: string,
  fn: () => Promise<void> | void,
  iterations = 10,
): Promise<Stats> {
  try {
    return await bench(name, fn, iterations);
  } catch (err) {
    return {
      operation: name,
      min: 0, avg: 0, p50: 0, p95: 0, max: 0,
      iterations,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------

const COL_WIDTHS = {
  operation: 38,
  min:  9,
  avg:  9,
  p50:  9,
  p95:  9,
  max:  9,
};

function fmt(ms: number): string {
  if (ms < 1)   return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function pad(s: string, width: number, right = false): string {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, ""); // strip ANSI for width calc
  const pad = " ".repeat(Math.max(0, width - plain.length));
  return right ? pad + s : s + pad;
}

function renderHeader(): string {
  const { operation, min, avg, p50, p95, max } = COL_WIDTHS;
  const sep = gray("│");
  return [
    gray("┌" + "─".repeat(operation + 2) + "┬" + ["min","avg","p50","p95","max"].map((_,i) => "─".repeat([min,avg,p50,p95,max][i] + 2)).join("┬") + "┐"),
    `${gray("│")} ${bold(cyan(pad("Operation", operation)))} ${sep} ${bold(yellow(pad("Min", min, true)))} ${sep} ${bold(yellow(pad("Avg", avg, true)))} ${sep} ${bold(yellow(pad("P50", p50, true)))} ${sep} ${bold(yellow(pad("P95", p95, true)))} ${sep} ${bold(yellow(pad("Max", max, true)))} ${gray("│")}`,
    gray("├" + "─".repeat(operation + 2) + "┼" + ["min","avg","p50","p95","max"].map((_,i) => "─".repeat([min,avg,p50,p95,max][i] + 2)).join("┼") + "┤"),
  ].join("\n");
}

function renderRow(s: Stats): string {
  const { operation, min, avg, p50, p95, max } = COL_WIDTHS;
  const sep = gray("│");

  if (s.error) {
    const errMsg = `${C.red}ERROR: ${s.error.slice(0, 60)}${C.reset}`;
    return `${gray("│")} ${pad(s.operation, operation)} ${sep} ${pad(errMsg, min + avg + p50 + p95 + max + 10, true)} ${gray("│")}`;
  }

  const colorTime = (ms: number, baseline: number): string => {
    const v = fmt(ms);
    if (ms > baseline * 3)  return `${C.red}${v}${C.reset}`;
    if (ms > baseline * 1.5) return `${C.yellow}${v}${C.reset}`;
    return `${C.green}${v}${C.reset}`;
  };

  return `${gray("│")} ${pad(s.operation, operation)} ${sep} ${pad(colorTime(s.min, s.avg), min, true)} ${sep} ${pad(colorTime(s.avg, s.avg), avg, true)} ${sep} ${pad(colorTime(s.p50, s.avg), p50, true)} ${sep} ${pad(colorTime(s.p95, s.avg), p95, true)} ${sep} ${pad(colorTime(s.max, s.avg), max, true)} ${gray("│")}`;
}

function renderFooter(): string {
  const { operation, min, avg, p50, p95, max } = COL_WIDTHS;
  return gray("└" + "─".repeat(operation + 2) + "┴" + ["min","avg","p50","p95","max"].map((_,i) => "─".repeat([min,avg,p50,p95,max][i] + 2)).join("┴") + "┘");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const suiteStart = performance.now();

  // ── Environment header ──────────────────────────────────────────────────────
  console.log("\n" + bold(cyan("  ╔══════════════════════════════════════╗")));
  console.log(bold(cyan("  ║   OmniState Performance Benchmarks    ║")));
  console.log(bold(cyan("  ╚══════════════════════════════════════╝")) + "\n");

  console.log(`  ${dim("Node.js")}  ${green(process.version)}`);
  console.log(`  ${dim("Platform")} ${green(`${platform()}/${arch()}`)}`);
  console.log(`  ${dim("Native")}   ${bridge.isNativeAvailable() ? green("available") : yellow("not available (run pnpm build:native)")}`);
  if (!bridge.isNativeAvailable()) {
    const nativeErr = bridge.getNativeError();
    if (nativeErr) console.log(`  ${dim("Reason")}   ${gray(nativeErr.slice(0, 80))}`);
  }
  console.log();

  // ── Fixtures ────────────────────────────────────────────────────────────────
  const deep = new DeepLayer();
  const orchestrator = new Orchestrator();
  const monitor = new HealthMonitor(60_000, false); // long interval, no auto-repair

  // Pre-classify an intent for plan / pipeline benchmarks (avoids LLM calls)
  const BENCH_TEXT = "run ls -la /tmp";
  const cachedIntent = await classifyIntent(BENCH_TEXT); // warms regex path
  const cachedPlan   = await planFromIntent(cachedIntent);

  // ── Core benchmarks ─────────────────────────────────────────────────────────
  const results: Stats[] = [];

  console.log(`  ${bold("Running benchmarks")} ${dim("(10 iterations each, 1 warm-up)")}\n`);

  results.push(await benchSafe(
    "shell exec  (echo hello)",
    () => deep.exec("echo hello"),
  ));

  results.push(await benchSafe(
    "shell execAsync  (echo hello)",
    () => deep.execAsync("echo hello"),
  ));

  results.push(await benchSafe(
    "system info collection",
    () => { deep.getSystemInfo(); },
  ));

  results.push(await benchSafe(
    "process list enumeration  (ps)",
    () => deep.getProcessList(),
  ));

  results.push(await benchSafe(
    "intent classify  (regex fallback)",
    // Force heuristic path — no API key in bench env
    async () => {
      const orig = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try { await classifyIntent(BENCH_TEXT); }
      finally { if (orig !== undefined) process.env.ANTHROPIC_API_KEY = orig; }
    },
  ));

  results.push(await benchSafe(
    "plan build  (shell-command intent)",
    () => planFromIntent(cachedIntent),
  ));

  results.push(await benchSafe(
    "orchestrator pipeline  (shell plan)",
    () => orchestrator.executePlan(cachedPlan),
  ));

  results.push(await benchSafe(
    "health check cycle  (all sensors)",
    () => monitor.runCheck(),
  ));

  // ── Native benchmarks (conditional) ─────────────────────────────────────────
  if (bridge.isNativeAvailable()) {
    console.log(`  ${dim("Native bindings available — adding screen capture benchmarks…")}\n`);

    results.push(await benchSafe(
      "screen capture  (CGDisplay metadata)",
      () => { bridge.captureScreen(); },
    ));

    results.push(await benchSafe(
      "screen capture  (raw Buffer)",
      () => { bridge.captureScreenBuffer(); },
    ));

    results.push(await benchSafe(
      "zero-copy capture  (IOSurface metadata)",
      () => { bridge.captureFrameZeroCopy(); },
    ));

    results.push(await benchSafe(
      "zero-copy capture  (raw Buffer)",
      () => { bridge.captureFrameZeroCopyBuffer(); },
    ));
  }

  // ── Print table ─────────────────────────────────────────────────────────────
  console.log(renderHeader());
  for (const r of results) {
    console.log(renderRow(r));
  }
  console.log(renderFooter());

  // ── Summary ─────────────────────────────────────────────────────────────────
  const totalMs = performance.now() - suiteStart;
  const errors  = results.filter((r) => r.error).length;

  console.log();
  console.log(`  ${dim("Total duration")}  ${green(fmt(totalMs))}`);
  console.log(`  ${dim("Benchmarks run")}  ${green(String(results.length))}`);
  if (errors > 0) {
    console.log(`  ${dim("Errors")}          ${`${C.red}${errors}${C.reset}`}`);
  }
  console.log();
}

main().catch((err) => {
  console.error(`\n${C.red}Fatal error:${C.reset}`, err);
  process.exit(1);
});
