/**
 * Demo UC-3: Full Natural Language Pipeline
 * Shows the complete flow: NL → Intent → Plan → Execute → Verify
 *
 * Usage: npx tsx examples/demo-full-pipeline.ts
 */

import {
  classifyIntent,
  planFromIntent,
} from "../packages/gateway/src/planner/intent.js";
import { optimizePlan } from "../packages/gateway/src/planner/optimizer.js";
import { Orchestrator } from "../packages/gateway/src/executor/orchestrator.js";

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
};

const log = {
  header: (msg: string) =>
    console.log(
      `\n${c.magenta}${c.bold}━━━  ${msg}  ━━━${c.reset}\n`
    ),
  section: (label: string) =>
    console.log(`\n  ${c.blue}${c.bold}▶ ${label}${c.reset}`),
  ok: (msg: string) => console.log(`  ${c.green}✓${c.reset}  ${msg}`),
  info: (msg: string) => console.log(`  ${c.gray}→${c.reset}  ${msg}`),
  warn: (msg: string) => console.log(`  ${c.yellow}⚠${c.reset}  ${msg}`),
  err: (msg: string) => console.log(`  ${c.red}✗${c.reset}  ${msg}`),
  kv: (key: string, val: string) =>
    console.log(`    ${c.cyan}${key.padEnd(16)}${c.reset}${val}`),
  divider: () => console.log(`  ${c.dim}${"─".repeat(52)}${c.reset}`),
};

// ---------------------------------------------------------------------------
// Demo commands
// ---------------------------------------------------------------------------
const DEMO_COMMANDS = [
  "list all files in the current directory",
  "check how much disk space is available",
  "show the top 5 processes by CPU usage",
];

// ---------------------------------------------------------------------------
// Confidence bar
// ---------------------------------------------------------------------------
function confidenceBar(conf: number): string {
  const filled = Math.round(conf * 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);
  const pct = `${(conf * 100).toFixed(0)}%`;
  const color = conf >= 0.8 ? c.green : conf >= 0.5 ? c.yellow : c.red;
  return `${color}${bar}${c.reset} ${c.dim}${pct}${c.reset}`;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function badge(status: "complete" | "failed"): string {
  return status === "complete"
    ? `${c.green}${c.bold}COMPLETE${c.reset}`
    : `${c.red}${c.bold}FAILED${c.reset}`;
}

// ---------------------------------------------------------------------------
// Unique layers used in a plan
// ---------------------------------------------------------------------------
function planLayers(nodes: { layer: string }[]): string {
  return [...new Set(nodes.map((n) => n.layer))].join(", ");
}

// ---------------------------------------------------------------------------
// Main demo
// ---------------------------------------------------------------------------
async function main() {
  log.header("OmniState · UC-3 · Full Natural Language Pipeline");
  console.log(
    `${c.dim}Flow: NL command → Intent → Plan → Optimize → Execute → Result${c.reset}\n`
  );

  const orchestrator = new Orchestrator();

  // Track summary stats
  const summary: Array<{
    command: string;
    intentType: string;
    confidence: number;
    nodes: number;
    status: "complete" | "failed";
    steps: number;
    totalMs: number;
  }> = [];

  for (let i = 0; i < DEMO_COMMANDS.length; i++) {
    const command = DEMO_COMMANDS[i];

    console.log(
      `\n${c.bold}${c.white}Command ${i + 1} / ${DEMO_COMMANDS.length}${c.reset}`
    );
    console.log(
      `  ${c.yellow}${c.bold}"${command}"${c.reset}`
    );
    log.divider();

    const pipelineStart = Date.now();

    // ── Phase A: Classify Intent ─────────────────────────────────────────────
    log.section("Phase A · Classify Intent");
    let intent;
    try {
      const t0 = Date.now();
      intent = await classifyIntent(command);
      const latency = Date.now() - t0;

      log.kv("Intent type", `${c.bold}${intent.type}${c.reset}`);
      log.kv("Confidence", confidenceBar(intent.confidence));
      log.kv("Latency", `${latency} ms`);

      const entityKeys = Object.keys(intent.entities);
      if (entityKeys.length > 0) {
        log.kv(
          "Entities",
          entityKeys
            .map(
              (k) =>
                `${c.cyan}${k}${c.reset}=${c.yellow}${intent.entities[k].value}${c.reset}`
            )
            .join("  ")
        );
      } else {
        log.kv("Entities", `${c.dim}none${c.reset}`);
      }
    } catch (err) {
      log.err(`Intent classification failed: ${err}`);
      summary.push({
        command,
        intentType: "error",
        confidence: 0,
        nodes: 0,
        status: "failed",
        steps: 0,
        totalMs: Date.now() - pipelineStart,
      });
      continue;
    }

    // ── Phase B: Build Plan ──────────────────────────────────────────────────
    log.section("Phase B · Build Plan");
    let plan;
    try {
      const t0 = Date.now();
      plan = await planFromIntent(intent);
      const latency = Date.now() - t0;

      log.kv("Task ID", `${c.dim}${plan.taskId}${c.reset}`);
      log.kv("Goal", plan.goal);
      log.kv("Nodes", `${plan.nodes.length}`);
      log.kv("Layers", planLayers(plan.nodes));
      log.kv("Est. duration", plan.estimatedDuration);
      log.kv("Latency", `${latency} ms`);
    } catch (err) {
      log.err(`Plan generation failed: ${err}`);
      summary.push({
        command,
        intentType: intent.type,
        confidence: intent.confidence,
        nodes: 0,
        status: "failed",
        steps: 0,
        totalMs: Date.now() - pipelineStart,
      });
      continue;
    }

    // ── Phase C: Optimize Plan ───────────────────────────────────────────────
    log.section("Phase C · Optimize Plan");
    const t0 = Date.now();
    const optimized = optimizePlan(plan);
    const optLatency = Date.now() - t0;

    const verifiedCount = optimized.nodes.filter((n) => n.verify).length;
    log.kv(
      "Nodes (in/out)",
      `${plan.nodes.length} → ${optimized.nodes.length}`
    );
    log.kv("Verified nodes", `${verifiedCount} / ${optimized.nodes.length}`);
    log.kv("Latency", `${optLatency} ms`);

    // ── Phase D: Execute Plan ────────────────────────────────────────────────
    log.section("Phase D · Execute Plan");
    let result;
    try {
      const t1 = Date.now();
      result = await orchestrator.executePlan(optimized);
      const execLatency = Date.now() - t1;

      log.kv("Status", badge(result.status));
      log.kv(
        "Steps",
        `${result.completedSteps} / ${result.totalSteps} completed`
      );
      log.kv("Exec latency", `${execLatency} ms`);
      if (result.error) {
        log.kv("Error", `${c.red}${result.error}${c.reset}`);
      }

      summary.push({
        command,
        intentType: intent.type,
        confidence: intent.confidence,
        nodes: optimized.nodes.length,
        status: result.status,
        steps: result.completedSteps,
        totalMs: Date.now() - pipelineStart,
      });
    } catch (err) {
      log.err(`Execution failed: ${err}`);
      summary.push({
        command,
        intentType: intent.type,
        confidence: intent.confidence,
        nodes: optimized.nodes.length,
        status: "failed",
        steps: 0,
        totalMs: Date.now() - pipelineStart,
      });
    }

    log.divider();
    console.log(
      `  ${c.dim}Pipeline total: ${Date.now() - pipelineStart} ms${c.reset}`
    );
  }

  // ── Overall Summary ────────────────────────────────────────────────────────
  log.header("Pipeline Summary");

  const colW = [36, 16, 8, 8, 8];
  const row = (cols: string[]) =>
    "  " +
    cols
      .map((col, i) => col.padEnd(colW[i] ?? 10).slice(0, colW[i] ?? 10))
      .join("  ");

  console.log(
    c.bold +
      row(["Command", "Intent", "Conf", "Nodes", "Status"]) +
      c.reset
  );
  console.log(
    `  ${c.dim}${"─".repeat(colW.reduce((a, b) => a + b + 2, 0))}${c.reset}`
  );

  let passed = 0;
  for (const s of summary) {
    if (s.status === "complete") passed++;
    const statusCol =
      s.status === "complete"
        ? `${c.green}✓ OK${c.reset}`
        : `${c.red}✗ ERR${c.reset}`;
    const confStr = `${(s.confidence * 100).toFixed(0)}%`;
    console.log(
      "  " +
        `${c.yellow}${s.command.slice(0, colW[0] - 1).padEnd(colW[0])}${c.reset}` +
        "  " +
        `${c.cyan}${s.intentType.slice(0, colW[1] - 1).padEnd(colW[1])}${c.reset}` +
        "  " +
        confStr.padEnd(colW[2]) +
        "  " +
        String(s.nodes).padEnd(colW[3]) +
        "  " +
        statusCol
    );
  }

  console.log();
  const allMs = summary.reduce((a, b) => a + b.totalMs, 0);
  log.kv(
    "Commands run",
    `${summary.length}`
  );
  log.kv(
    "Passed / Failed",
    `${c.green}${passed}${c.reset} / ${c.red}${summary.length - passed}${c.reset}`
  );
  log.kv("Total wall time", `${allMs} ms`);

  console.log(
    `\n${c.green}${c.bold}✔  Demo complete!${c.reset}  ${c.dim}UC-3 · Full Natural Language Pipeline${c.reset}\n`
  );
}

main().catch((err) => {
  console.error(`\n${c.red}${c.bold}Fatal error:${c.reset}`, err);
  process.exit(1);
});
