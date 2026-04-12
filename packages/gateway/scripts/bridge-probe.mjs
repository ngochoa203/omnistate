#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, realpathSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mode = process.argv[2] || "tree";
const latencyProfile = process.argv[3] || "full";
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

function countNodes(node) {
  if (!node) return 0;
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
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

async function getProcessContext() {
  const resolveExecutablePath = async (command) => {
    const token = String(command || "").trim().split(/\s+/, 1)[0] || "";
    if (!token) return null;

    if (token.startsWith("/")) {
      if (!existsSync(token)) return token;
      try {
        return realpathSync(token);
      } catch {
        return token;
      }
    }

    try {
      const { stdout } = await execFileAsync("which", [token], {
        timeout: 1500,
        maxBuffer: 64 * 1024,
      });
      const resolved = stdout.trim();
      if (!resolved) return token;
      if (!existsSync(resolved)) return resolved;
      try {
        return realpathSync(resolved);
      } catch {
        return resolved;
      }
    } catch {
      return token;
    }
  };

  const getPsRow = async (pid) => {
    const { stdout } = await execFileAsync("ps", [
      "-p",
      String(pid),
      "-o",
      "pid=,ppid=,tty=,command=",
    ], {
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    });

    const line = stdout.trim();
    const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) return null;

    const parsedPid = Number.parseInt(match[1], 10);
    const parsedPpid = Number.parseInt(match[2], 10);
    const tty = match[3] || "?";
    const command = match[4] || "";
    return {
      pid: Number.isFinite(parsedPid) ? parsedPid : null,
      ppid: Number.isFinite(parsedPpid) ? parsedPpid : null,
      tty,
      command,
      interactiveSession: !tty.includes("?"),
      executablePath: await resolveExecutablePath(command),
    };
  };

  try {
    const current = await getPsRow(process.pid);
    if (!current) {
      return {
        pid: process.pid,
        ppid: null,
        tty: null,
        command: process.argv.join(" "),
        interactiveSession: null,
        executablePath: await resolveExecutablePath(process.argv.join(" ")),
        parentProcess: null,
        grantTargets: [],
      };
    }

    const parentProcess =
      typeof current.ppid === "number" && current.ppid > 0
        ? await getPsRow(current.ppid)
        : null;

    const grantTargets = [
      current.executablePath
        ? { scope: "current", path: current.executablePath }
        : null,
      parentProcess?.executablePath
        ? { scope: "parent", path: parentProcess.executablePath }
        : null,
    ].filter(Boolean);

    return {
      pid: current.pid,
      ppid: current.ppid,
      tty: current.tty,
      command: current.command,
      interactiveSession: current.interactiveSession,
      executablePath: current.executablePath,
      parentProcess,
      grantTargets,
    };
  } catch {
    return {
      pid: process.pid,
      ppid: null,
      tty: null,
      command: process.argv.join(" "),
      interactiveSession: null,
      executablePath: null,
      parentProcess: null,
      grantTargets: [],
    };
  }
}

async function probeScreenRecordingPermission() {
  const output = join(tmpdir(), `omnistate-sr-probe-${process.pid}.png`);
  try {
    await execFileAsync("screencapture", ["-x", output], {
      timeout: 5000,
      maxBuffer: 256 * 1024,
    });
    try {
      await unlink(output);
    } catch {
      // ignore cleanup failures for probe artifacts
    }
    return { granted: true, method: "screencapture" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      granted: false,
      method: "screencapture",
      error: message,
    };
  }
}

function inferHostScreenCaptureTargets(processContext) {
  const targets = [];
  const seen = new Set();

  const add = (appName, bundleId) => {
    const key = `${appName}|${bundleId}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ appName, bundleId });
  };

  const termProgram = String(process.env.TERM_PROGRAM || "").toLowerCase();
  if (termProgram.includes("apple_terminal")) add("Terminal", "com.apple.Terminal");
  if (termProgram.includes("iterm")) add("iTerm", "com.googlecode.iterm2");
  if (termProgram.includes("vscode")) add("Visual Studio Code", "com.microsoft.VSCode");

  const commandBlob = [
    String(processContext?.command || ""),
    String(processContext?.parentProcess?.command || ""),
  ]
    .join(" ")
    .toLowerCase();

  if (commandBlob.includes("terminal")) add("Terminal", "com.apple.Terminal");
  if (commandBlob.includes("iterm")) add("iTerm", "com.googlecode.iterm2");
  if (commandBlob.includes("code")) add("Visual Studio Code", "com.microsoft.VSCode");

  return targets;
}

async function main() {
  const bridge = await import("../dist/platform/bridge.js");
  const getUiElements = bridge.getUiElements;
  const getUiTree = bridge.getUiTree;
  const captureScreenBuffer = bridge.captureScreenBuffer;
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
      // Try AppleScript fallback before giving up
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
            accessibilityTrusted: false,
            totalElements: snap.totalElements,
            tree,
            fallback: "applescript",
            warning:
              "Native accessibility not trusted; returned AppleScript summary. Grant Accessibility permission for full tree.",
            permissionNeeded: "accessibility",
          }),
        );
        return;
      } catch {
        // AppleScript also failed — return the structured error
        process.stdout.write(
          JSON.stringify({
            ok: false,
            code: "ACCESSIBILITY_NOT_TRUSTED",
            error: "Accessibility permission is not granted for OmniState gateway process.",
            details:
              "Enable System Settings → Privacy & Security → Accessibility for your terminal/Node process, then restart gateway.",
            permissionNeeded: "accessibility",
          }),
        );
        return;
      }
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
    const processContext = await getProcessContext();
    const hostScreenCaptureTargets = inferHostScreenCaptureTargets(processContext);
    const profile = latencyProfile === "frame-only" ? "frame-only" : "full";
    const rounds = profile === "frame-only" ? 24 : 10;
    const warmupRounds = profile === "frame-only" ? 2 : 1;
    const frameSamples = [];
    const treeSamples = [];
    let treeAvailable = trusted && profile !== "frame-only";
    let treeError;
    let screenRecordingGranted = true;
    let screenRecordingError;
    let captureFailureCategory = null;
    let permissionProbe = null;
    let captureMethod = "zero-copy-iosurface";

    const canFallbackCapture = typeof captureScreenBuffer === "function";
    const captureFrame = () => {
      if (captureMethod === "screen-buffer-fallback") {
        captureScreenBuffer();
        return;
      }
      // captureFrameZeroCopyBuffer already performs a full frame capture.
      // Calling captureFrameZeroCopy beforehand would trigger a second capture per round.
      captureFrameZeroCopyBuffer?.();
    };

    // Test screen capture first
    try {
      captureFrame();
    } catch (err) {
      screenRecordingError = err instanceof Error ? err.message : String(err);
      permissionProbe = await probeScreenRecordingPermission();
      if (permissionProbe.granted) {
        if (canFallbackCapture) {
          try {
            captureMethod = "screen-buffer-fallback";
            captureFrame();
            screenRecordingGranted = true;
            screenRecordingError = undefined;
          } catch (fallbackErr) {
            screenRecordingGranted = true;
            screenRecordingError = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            captureFailureCategory = "capture_pipeline";
          }
        } else {
          screenRecordingGranted = true;
          captureFailureCategory = "capture_pipeline";
        }
      } else {
        screenRecordingGranted = false;
        captureFailureCategory = "screen_recording_permission";
      }
    }

    if (screenRecordingGranted) {
      for (let i = 0; i < rounds + warmupRounds; i += 1) {
        const f0 = performance.now();
        try {
          captureFrame();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (captureMethod !== "screen-buffer-fallback" && canFallbackCapture) {
            try {
              captureMethod = "screen-buffer-fallback";
              captureFrame();
            } catch (fallbackErr) {
              screenRecordingGranted = false;
              screenRecordingError = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
              captureFailureCategory = "capture_pipeline";
              break;
            }
          } else {
            screenRecordingGranted = false;
            screenRecordingError = message;
            captureFailureCategory = "capture_pipeline";
            break;
          }
        }
        const f1 = performance.now();

        let treeMs = 0;
        if (treeAvailable && profile !== "frame-only") {
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
          frameSamples.push(Number((f1 - f0).toFixed(2)));
          if (treeAvailable) treeSamples.push(treeMs);
        }
      }
    } else if (trusted) {
      // No screen recording but AX works — measure tree only
      for (let i = 0; i < rounds + warmupRounds; i += 1) {
        if (!treeAvailable) break;
        const t0 = performance.now();
        try {
          getUiElements();
          const t1 = performance.now();
          const elapsed = t1 - t0;
          // If single call takes >2s, skip remaining (avoid timeout)
          if (elapsed > 2000) { treeAvailable = false; treeError = `Single call too slow: ${elapsed.toFixed(0)}ms`; break; }
          if (i >= warmupRounds) treeSamples.push(Number(elapsed.toFixed(2)));
        } catch (err) {
          treeAvailable = false;
          treeError = err instanceof Error ? err.message : String(err);
        }
      }
    }

    const frame = frameSamples.length > 0 ? summarize(frameSamples) : null;
    const treeStats = treeSamples.length > 0 ? summarize(treeSamples) : null;
    const likelyHeadless = processContext.interactiveSession === false;
    const recommendations = [];
    const remediationCommands = [];
    const permissionTargets = Array.isArray(processContext.grantTargets)
      ? [...new Set(processContext.grantTargets.map((x) => x.path).filter(Boolean))]
      : [];
    if (!screenRecordingGranted) {
      if (hostScreenCaptureTargets.length > 0) {
        recommendations.push(
          `Grant Screen Recording for host app(s): ${hostScreenCaptureTargets
            .map((t) => `${t.appName} (${t.bundleId})`)
            .join(", ")}. Then fully quit and reopen that app.`,
        );

        for (const target of hostScreenCaptureTargets) {
          remediationCommands.push(`tccutil reset ScreenCapture ${target.bundleId}`);
        }
        recommendations.push(
          "If permission still fails after toggling in Settings, run the reset command(s) above, fully quit the host app, reopen it, and accept the permission prompt again.",
        );
      } else {
        recommendations.push(
          permissionTargets.length > 0
            ? `Grant Screen Recording for executable(s): ${permissionTargets.join(", ")}. Then restart that app/process.`
            : "Grant Screen Recording permission for the exact app launching Node (Terminal/iTerm/VS Code) and restart that app.",
        );
      }

      if (likelyHeadless) {
        recommendations.push(
          "Current process looks headless (no TTY). Run gateway from an on-screen user session terminal, not launchd/pm2/ssh.",
        );
      }
    } else if (captureFailureCategory === "capture_pipeline") {
      recommendations.push(
        "Screen Recording appears granted, but native zero-copy capture failed. Rebuild native module and retry.",
      );
      recommendations.push(
        "If issue persists, use a non-zero-copy fallback path for latency checks or inspect ScreenCaptureKit pixel buffer compatibility.",
      );
    }

    process.stdout.write(JSON.stringify({
      ok: true,
      accessibilityTrusted: trusted,
      screenRecordingGranted,
      ...(screenRecordingError ? { screenRecordingError } : {}),
      ...(screenRecordingError
        ? {
            warning:
              screenRecordingGranted
                ? "Native frame capture failed although Screen Recording probe succeeded. This looks like a capture pipeline issue, not a permission denial."
                : "Screen Recording permission not granted. Grant for your host app (Terminal/iTerm/VS Code) in System Settings → Privacy & Security → Screen Recording, then fully restart that app and gateway.",
            ...(screenRecordingGranted ? {} : { permissionNeeded: "screenRecording" }),
          }
        : {}),
      ...(captureFailureCategory ? { captureFailureCategory } : {}),
      ...(permissionProbe ? { permissionProbe } : {}),
      captureMethod,
      processContext,
      ...(hostScreenCaptureTargets.length > 0
        ? { hostScreenCaptureTargets }
        : {}),
      ...(remediationCommands.length > 0
        ? { remediationCommands }
        : {}),
      likelyHeadless,
      recommendations,
      rounds: frameSamples.length,
      frame,
      tree: treeAvailable && treeStats ? { samples: treeSamples, ...treeStats } : null,
      treeAvailable,
      ...(treeError ? { treeError } : {}),
      ...(frame ? {
        p50: frame.p50,
        p95: frame.p95,
        max: frame.max,
        under50Rate: frame.under50Rate,
        passUnder50msP95: frame.p95 < 50,
      } : {}),
      profile,
      note:
        profile === "frame-only"
          ? "Frame-only profile skips UI tree calls to expose raw capture latency."
          : "Measured in isolated worker. Primary SLO uses frame capture p95.",
    }));
    return;
  }

  if (mode === "hierarchy") {
    if (!trusted) {
      // Try AppleScript fallback before giving up
      try {
        const snap = await getAppleScriptUiSnapshot();
        const fallbackTree = {
          id: "root",
          role: "AXApplication",
          title: snap.appName,
          children: snap.summary.map((item, idx) => ({
            id: `fallback-role-${idx + 1}`,
            role: item.role,
            title: `${item.role} (${item.count})`,
            children: [],
          })),
        };
        process.stdout.write(
          JSON.stringify({
            ok: true,
            mode: "hierarchy",
            accessibilityTrusted: false,
            totalElements: snap.totalElements,
            tree: fallbackTree,
            fallback: "applescript",
            warning:
              "Native accessibility not trusted; returned AppleScript summary. Grant Accessibility permission for full tree.",
            permissionNeeded: "accessibility",
          }),
        );
        return;
      } catch {
        // AppleScript also failed — return the structured error
        process.stdout.write(
          JSON.stringify({
            ok: false,
            code: "ACCESSIBILITY_NOT_TRUSTED",
            error: "Accessibility permission is not granted for OmniState gateway process.",
            details:
              "Enable System Settings → Privacy & Security → Accessibility for your terminal/Node process, then restart gateway.",
            permissionNeeded: "accessibility",
          }),
        );
        return;
      }
    }

    let tree;
    try {
      tree = getUiTree?.();
    } catch (err) {
      // Fall back to flat tree mode on native error
      try {
        const snap = await getAppleScriptUiSnapshot();
        const fallbackTree = {
          id: "root",
          role: "AXApplication",
          title: snap.appName,
          children: snap.summary.map((item, idx) => ({
            id: `fallback-role-${idx + 1}`,
            role: item.role,
            title: `${item.role} (${item.count})`,
            children: [],
          })),
        };
        process.stdout.write(
          JSON.stringify({
            ok: true,
            mode: "hierarchy",
            accessibilityTrusted: trusted,
            totalElements: snap.totalElements,
            tree: fallbackTree,
            fallback: "applescript",
            warning: "Native accessibility tree failed; returned AppleScript summary instead.",
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

    if (!tree) {
      process.stdout.write(
        JSON.stringify(
          fail(
            "HIERARCHY_UNAVAILABLE",
            "getUiTree() is not available in this native build.",
            "Rebuild native binary with get_ui_tree support.",
          ),
        ),
      );
      return;
    }

    process.stdout.write(
      JSON.stringify({
        ok: true,
        mode: "hierarchy",
        accessibilityTrusted: Boolean(isAccessibilityTrusted()),
        totalElements: countNodes(tree),
        tree,
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
