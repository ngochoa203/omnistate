/**
 * Demo UC-1: Visual UI Interaction
 * Opens Safari, navigates to URL bar, types a search query, verifies results.
 *
 * Usage: npx tsx examples/demo-safari-search.ts
 */

import { DeepLayer } from "../packages/gateway/src/layers/deep.js";
import { SurfaceLayer } from "../packages/gateway/src/layers/surface.js";

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
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Main demo
// ---------------------------------------------------------------------------
async function main() {
  log.header("OmniState · UC-1 · Visual UI Interaction");
  console.log(
    `${c.dim}Opens Safari, searches for "OmniState AI agent", captures result.${c.reset}\n`
  );

  const deep = new DeepLayer();
  const surface = new SurfaceLayer();

  // Guard: check native bridge availability up front
  if (!surface.isAvailable) {
    log.warn("Native bridge is not available in this environment.");
    log.info(
      "The Rust N-API bindings require a compiled .node addon (pnpm build)."
    );
    log.info(
      "Surface-layer calls (keyTap, typeText, captureScreen) will be skipped."
    );
    log.info(
      "Deep-layer calls (launchApp) will still run via shell exec."
    );
    console.log();
  }

  // Step 1 — Launch Safari
  log.step(1, "Launching Safari…");
  const t0 = Date.now();
  const launched = await deep.launchApp("Safari");
  if (launched) {
    log.ok(`Safari launched  ${c.dim}(${Date.now() - t0} ms)${c.reset}`);
  } else {
    log.err("Failed to launch Safari — is it installed?");
    process.exit(1);
  }

  // Step 2 — Wait for app to load
  log.step(2, "Waiting 2 s for Safari to load…");
  await sleep(2000);
  log.ok("Wait complete");

  // Step 3 — Focus the URL / search bar (Cmd+L)
  log.step(3, `Focusing URL bar via ${c.yellow}Cmd+L${c.reset}…`);
  if (surface.isAvailable) {
    await surface.keyTap("l", { meta: true });
    log.ok("URL bar focused");
  } else {
    log.warn("Skipped (native bridge unavailable)");
  }

  // Step 4 — Short pause so the bar is ready
  await sleep(500);

  // Step 5 — Type search query
  const query = "OmniState AI agent";
  log.step(4, `Typing query: ${c.yellow}"${query}"${c.reset}`);
  if (surface.isAvailable) {
    await surface.typeText(query);
    log.ok("Text entered");
  } else {
    log.warn("Skipped (native bridge unavailable)");
  }

  // Step 6 — Submit
  log.step(5, "Pressing Return to search…");
  if (surface.isAvailable) {
    await surface.keyTap("Return", {});
    log.ok("Return key sent");
  } else {
    log.warn("Skipped (native bridge unavailable)");
  }

  // Step 7 — Wait for page load
  log.step(6, "Waiting 3 s for page to load…");
  await sleep(3000);
  log.ok("Wait complete");

  // Step 8 — Capture screen
  log.step(7, "Capturing screen…");
  if (surface.isAvailable) {
    const t1 = Date.now();
    const capture = await surface.captureScreen();
    const latencyMs = Date.now() - t1;

    log.ok(`Capture complete`);
    console.log();
    console.log(`  ${c.bold}Screenshot details${c.reset}`);
    console.log(
      `  ${c.cyan}Dimensions   ${c.reset}${capture.width} × ${capture.height} px`
    );
    console.log(
      `  ${c.cyan}Method       ${c.reset}${capture.captureMethod}`
    );
    console.log(`  ${c.cyan}Latency      ${c.reset}${latencyMs} ms`);
    if (capture.bytesPerRow) {
      console.log(
        `  ${c.cyan}Bytes/row    ${c.reset}${capture.bytesPerRow}`
      );
    }
    if (capture.pixelFormat) {
      console.log(
        `  ${c.cyan}Pixel format ${c.reset}${capture.pixelFormat}`
      );
    }
    console.log(
      `  ${c.cyan}Buffer size  ${c.reset}${(capture.data.length / 1024).toFixed(1)} KB`
    );
  } else {
    log.warn("Screen capture skipped (native bridge unavailable)");
  }

  // Done
  console.log(
    `\n${c.green}${c.bold}✔  Demo complete!${c.reset}  ${c.dim}UC-1 · Visual UI Interaction${c.reset}\n`
  );
}

main().catch((err) => {
  console.error(`\n${c.red}${c.bold}Fatal error:${c.reset}`, err);
  process.exit(1);
});
