/**
 * Demo UC-2: Deep System Administration
 * Checks disk space, memory, running processes, and optionally cleans caches.
 *
 * Usage: npx tsx examples/demo-system-check.ts
 */

import * as readline from "node:readline";
import { DeepLayer } from "../packages/gateway/src/layers/deep.js";

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
};

const log = {
  step: (n: number, msg: string) =>
    console.log(`\n${c.cyan}${c.bold}[${n}]${c.reset} ${msg}`),
  ok: (msg: string) => console.log(`  ${c.green}✓${c.reset}  ${msg}`),
  info: (msg: string) => console.log(`  ${c.gray}→${c.reset}  ${msg}`),
  warn: (msg: string) => console.log(`  ${c.yellow}⚠${c.reset}  ${msg}`),
  err: (msg: string) => console.log(`  ${c.red}✗${c.reset}  ${msg}`),
  header: (msg: string) =>
    console.log(
      `\n${c.magenta}${c.bold}━━━  ${msg}  ━━━${c.reset}\n`
    ),
  kv: (key: string, val: string) =>
    console.log(`  ${c.cyan}${key.padEnd(18)}${c.reset}${val}`),
};

// ---------------------------------------------------------------------------
// Helper: prompt yes/no
// ---------------------------------------------------------------------------
function askYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
  return new Promise((resolve) => {
    rl.question(`\n  ${c.yellow}${question}${c.reset} `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

// ---------------------------------------------------------------------------
// Helper: format bytes
// ---------------------------------------------------------------------------
function fmtMB(mb: number): string {
  return mb >= 1024
    ? `${(mb / 1024).toFixed(1)} GB`
    : `${mb} MB`;
}

// ---------------------------------------------------------------------------
// Main demo
// ---------------------------------------------------------------------------
async function main() {
  log.header("OmniState · UC-2 · Deep System Administration");
  console.log(
    `${c.dim}Checks disk, memory, processes, and optionally cleans caches.${c.reset}\n`
  );

  const deep = new DeepLayer();

  // ── Step 1: System info ────────────────────────────────────────────────────
  log.step(1, "Gathering system information…");
  const info = deep.getSystemInfo();

  log.ok("System info retrieved");
  console.log();
  log.kv("Hostname", info.hostname);
  log.kv("Platform", `${info.platform}  (${info.arch})`);
  log.kv("CPU", `${info.cpuModel}  ×${info.cpuCores}`);
  log.kv(
    "RAM",
    `${fmtMB(info.freeMemoryMB)} free / ${fmtMB(info.totalMemoryMB)} total`
  );
  log.kv("Node version", info.nodeVersion);
  log.kv(
    "Uptime",
    `${Math.floor(info.uptime / 60)} min ${info.uptime % 60} s`
  );

  // ── Step 2: Disk usage ─────────────────────────────────────────────────────
  log.step(2, "Checking disk usage (df -h /)…");
  try {
    const dfOutput = deep.exec("df -h /").trim();
    console.log();
    dfOutput.split("\n").forEach((line) => {
      console.log(`  ${c.dim}${line}${c.reset}`);
    });
    log.ok("Disk usage complete");
  } catch (err) {
    log.err(`df failed: ${err}`);
  }

  // ── Step 3: Cache size ─────────────────────────────────────────────────────
  log.step(3, "Measuring ~/Library/Caches…");
  try {
    const cacheSize = deep
      .exec("du -sh ~/Library/Caches 2>/dev/null || echo 'N/A'")
      .trim();
    log.ok(`Cache directory size: ${c.yellow}${cacheSize}${c.reset}`);
  } catch {
    log.warn("Could not determine cache size (N/A)");
  }

  // ── Step 4: Process list ───────────────────────────────────────────────────
  log.step(4, "Fetching process list (top 10 by CPU)…");
  const processes = await deep.getProcessList();
  const top10 = processes.slice(0, 10);

  console.log();
  // Table header
  console.log(
    `  ${c.bold}${"PID".padStart(6)}  ${"CPU%".padStart(5)}  ${"MEM%".padStart(5)}  Name${c.reset}`
  );
  console.log(`  ${c.dim}${"─".repeat(50)}${c.reset}`);

  for (const proc of top10) {
    const cpuBar = proc.cpu > 10 ? c.red : proc.cpu > 5 ? c.yellow : c.green;
    console.log(
      `  ${c.gray}${String(proc.pid).padStart(6)}${c.reset}` +
        `  ${cpuBar}${String(proc.cpu.toFixed(1)).padStart(5)}${c.reset}` +
        `  ${c.cyan}${String(proc.memory.toFixed(1)).padStart(5)}${c.reset}` +
        `  ${proc.name}`
    );
  }

  console.log();
  log.info(
    `Total processes visible: ${c.bold}${processes.length}${c.reset}`
  );

  // ── Step 5: Optional cache cleanup ────────────────────────────────────────
  const shouldClean = await askYesNo("Clean caches? (y/n)");

  if (shouldClean) {
    log.step(5, "Cleaning safe cache directories…");

    // Only safe, well-known cache dirs
    const safeDirs = [
      "~/Library/Caches/com.apple.dt.Xcode",
      "~/Library/Caches/yarn",
      "~/Library/Caches/pip",
      "~/Library/Caches/pnpm",
      "~/.npm/_cacache",
    ];

    let cleaned = 0;
    for (const dir of safeDirs) {
      try {
        deep.exec(`rm -rf ${dir} 2>/dev/null || true`);
        log.ok(`Removed ${dir}`);
        cleaned++;
      } catch {
        log.warn(`Skipped ${dir} (not found or permission denied)`);
      }
    }

    console.log();
    log.info(`Cleaned ${c.bold}${cleaned}${c.reset} cache directories`);
  } else {
    console.log(`\n  ${c.dim}Skipping cache cleanup.${c.reset}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${c.bold}${c.blue}Summary${c.reset}`);
  console.log(`  ${c.dim}${"─".repeat(40)}${c.reset}`);
  log.kv("Host", info.hostname);
  log.kv(
    "Free RAM",
    `${fmtMB(info.freeMemoryMB)} / ${fmtMB(info.totalMemoryMB)}`
  );
  log.kv("Processes", String(processes.length));
  log.kv("Cache clean", shouldClean ? "yes" : "no");

  console.log(
    `\n${c.green}${c.bold}✔  Demo complete!${c.reset}  ${c.dim}UC-2 · Deep System Administration${c.reset}\n`
  );
}

main().catch((err) => {
  console.error(`\n${c.red}${c.bold}Fatal error:${c.reset}`, err);
  process.exit(1);
});
