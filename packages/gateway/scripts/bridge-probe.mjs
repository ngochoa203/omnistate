#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const mode = process.argv[2] || "tree";
const execFileAsync = promisify(execFile);

function fail(code, message, details) {
  return {
    ok: false,
    code,
    error: message,
    details,
  };
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = sorted[Math.max(0, Math.ceil(sorted.length * 0.5) - 1)] ?? 0;
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const under50Rate = Number(
    ((samples.filter((s) => s < 50).length / Math.max(1, samples.length)) * 100).toFixed(2),
  );
  return { p50, p95, max, under50Rate };
}

async function getAppleScriptUiSnapshot() {
  const script = `
set text item delimiters to "|"
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set winCount to (count of windows of frontApp)
  set btnCount to (count of buttons of frontApp)
  set textFieldCount to (count of text fields of frontApp)
  set staticTextCount to (count of static texts of frontApp)
  return appName & "|" & winCount & "|" & btnCount & "|" & textFieldCount & "|" & staticTextCount
end tell
`;

  const { stdout } = await execFileAsync("osascript", ["-e", script], {
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
  const [appName = "FrontmostApp", windows = "0", buttons = "0", textFields = "0", staticTexts = "0"] =
    stdout.trim().split("|");

  const safeNum = (x) => {
    const n = Number.parseInt(String(x), 10);
    return Number.isFinite(n) ? n : 0;
  };

  const summary = [
    { role: "AXWindow", count: safeNum(windows) },
    { role: "AXButton", count: safeNum(buttons) },
    { role: "AXTextField", count: safeNum(textFields) },
    { role: "AXStaticText", count: safeNum(staticTexts) },
  ];

  return {
    appName,
    summary,
    totalElements: summary.reduce((acc, item) => acc + item.count, 0),
  };
}

async function main() {
  const bridge = await import("../dist/platform/bridge.js");
  const getUiElements = bridge.getUiElements;
  const captureFrameZeroCopy = bridge.captureFrameZeroCopy;
  const captureFrameZeroCopyBuffer = bridge.captureFrameZeroCopyBuffer;
  const isAccessibilityTrusted = bridge.isAccessibilityTrusted;
  const isNativeAvailable = bridge.isNativeAvailable;
  const getNativeError = bridge.getNativeError;

  if (!isNativeAvailable()) {
    process.stdout.write(
      JSON.stringify(
        fail(
          "NATIVE_UNAVAILABLE",
          "Native bridge is unavailable.",
          getNativeError?.() ?? "unknown native load error",
        ),
      ),
    );
    return;
  }

  const trusted = (() => {
    try {
      return Boolean(isAccessibilityTrusted());
    } catch {
      return false;
    }
  })();

  if (mode === "tree") {
    if (!trusted) {
      process.stdout.write(
        JSON.stringify(
          fail(
            "ACCESSIBILITY_NOT_TRUSTED",
            "Accessibility permission is not granted for OmniState gateway process.",
            "Enable System Settings -> Privacy & Security -> Accessibility for your terminal/Node process, then restart gateway.",
          ),
        ),
      );
      return;
    }

    let raw;
    try {
      raw = (getUiElements() ?? []);
    } catch (err) {
      // Native AX tree can intermittently fail on some focused apps. Fall back
      // to AppleScript summary so UI still gets structural counts.
      try {
        const snap = await getAppleScriptUiSnapshot();
        const tree = {
          id: "root",
          label: `screen (${snap.appName})`,
          children: snap.summary.map((item, idx) => ({
            id: `fallback-role-${idx + 1}`,
            label: `${item.role} (${item.count})`,
            children: [],
          })),
        };
        process.stdout.write(
          JSON.stringify({
            ok: true,
            accessibilityTrusted: trusted,
            totalElements: snap.totalElements,
            tree,
            fallback: "applescript",
            warning:
              "Native accessibility tree failed; returned AppleScript summary instead.",
            nativeError: err instanceof Error ? err.message : String(err),
          }),
        );
        return;
      } catch (fallbackErr) {
        process.stdout.write(
          JSON.stringify(
            fail(
              "ACCESSIBILITY_QUERY_FAILED",
              err instanceof Error ? err.message : String(err),
              "Grant Accessibility permission for terminal/Node and restart OmniState gateway.",
            ),
          ),
        );
        return;
      }
    }
    const grouped = new Map();
    for (const item of raw) {
      const role = String(item?.role ?? item?.elementType ?? "unknown");
      if (!grouped.has(role)) grouped.set(role, []);
      grouped.get(role).push(item);
    }

    const tree = {
      id: "root",
      label: "screen",
      children: [...grouped.entries()].map(([role, items], roleIdx) => ({
        id: `role-${roleIdx + 1}`,
        label: `${role} (${items.length})`,
        children: items.slice(0, 200).map((item, idx) => ({
          id: `${role}-${idx + 1}`,
          label: String(item?.title ?? item?.text ?? `${role}#${idx + 1}`),
          bounds: item?.bounds ?? null,
        })),
      })),
    };

    process.stdout.write(
      JSON.stringify({
        ok: true,
        accessibilityTrusted: Boolean(isAccessibilityTrusted()),
        totalElements: raw.length,
        tree,
      }),
    );
    return;
  }

  if (mode === "latency") {
    const rounds = 20;
    const warmupRounds = 2;
    const frameSamples = [];
    const treeSamples = [];
    const samples = [];
    let treeAvailable = trusted;
    let treeError;

    for (let i = 0; i < rounds + warmupRounds; i += 1) {
      const f0 = performance.now();
      try {
        captureFrameZeroCopy();
        captureFrameZeroCopyBuffer();
      } catch (err) {
        process.stdout.write(
          JSON.stringify(
            fail(
              "SCREEN_CAPTURE_FAILED",
              err instanceof Error ? err.message : String(err),
              "Grant Screen Recording permission for terminal/Node and restart OmniState gateway.",
            ),
          ),
        );
        return;
      }
      const f1 = performance.now();

      let treeMs = 0;
      if (treeAvailable) {
        const t0 = performance.now();
        try {
          getUiElements();
          const t1 = performance.now();
          treeMs = Number((t1 - t0).toFixed(2));
        } catch (err) {
          treeAvailable = false;
          treeError = err instanceof Error ? err.message : String(err);
        }
      }

      if (i >= warmupRounds) {
        const frameMs = Number((f1 - f0).toFixed(2));
        frameSamples.push(frameMs);
        if (treeAvailable) treeSamples.push(treeMs);
        samples.push(Number((frameMs + treeMs).toFixed(2)));
      }
    }

    const frame = summarize(frameSamples);
    const tree = summarize(treeSamples);
    const combined = summarize(samples);

    process.stdout.write(
      JSON.stringify({
        ok: true,
        accessibilityTrusted: trusted,
        rounds,
        samples,
        p50: frame.p50,
        p95: frame.p95,
        max: frame.max,
        under50Rate: frame.under50Rate,
        frame: { samples: frameSamples, ...frame },
        tree: treeAvailable ? { samples: treeSamples, ...tree } : null,
        combined: { samples, ...combined },
        treeAvailable,
        ...(treeError ? { treeError } : {}),
        passUnder50msP95: frame.p95 < 50,
        note: "Measured in isolated worker. Primary SLO uses frame capture p95.",
      }),
    );
    return;
  }

  process.stderr.write(`Unknown mode: ${mode}`);
  process.exit(2);
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify(
      fail(
        "BRIDGE_PROBE_ERROR",
        err instanceof Error ? err.message : String(err),
      ),
    ),
  );
});
