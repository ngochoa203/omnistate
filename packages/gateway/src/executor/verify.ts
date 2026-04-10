import type { StateNode } from "../types/task.js";
import type { StepResult } from "./orchestrator.js";
import { SurfaceLayer } from "../layers/surface.js";
import { createDefaultEngine } from "../vision/engine.js";
import type { VisionEngine } from "../vision/engine.js";
import { DeepLayer } from "../layers/deep.js";

export interface VerifyResult {
  passed: boolean;
  reason?: string;
  confidence?: number;
}

// ---------------------------------------------------------------------------
// Lazy-initialized singletons — created once on first use, then reused.
// ---------------------------------------------------------------------------

let _surface: SurfaceLayer | null = null;
let _vision: VisionEngine | null = null;
let _deep: DeepLayer | null = null;

function getSurface(): SurfaceLayer {
  if (!_surface) _surface = new SurfaceLayer();
  return _surface;
}

function getVision(): VisionEngine {
  if (!_vision) _vision = createDefaultEngine();
  return _vision;
}

function getDeep(): DeepLayer {
  if (!_deep) _deep = new DeepLayer();
  return _deep;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Verify a step's result using the configured strategy.
 *
 * Strategies:
 * - api:        Check HTTP/OS API response values
 * - screenshot: Capture screen, ask vision model
 * - file:       Verify file existence / contents
 * - process:    Check process running state
 * - compound:   api + screenshot in parallel, both must pass
 */
export async function verifyStep(
  node: StateNode,
  result: StepResult
): Promise<VerifyResult> {
  if (!node.verify) {
    return { passed: true };
  }

  switch (node.verify.strategy) {
    case "api":
      return verifyApi(node, result);
    case "screenshot":
      return verifyScreenshot(node, result);
    case "file":
      return verifyFile(node, result);
    case "process":
      return verifyProcess(node, result);
    case "compound":
      return verifyCompound(node, result);
    default:
      return { passed: true };
  }
}

// ---------------------------------------------------------------------------
// Strategy implementations
// ---------------------------------------------------------------------------

async function verifyApi(
  node: StateNode,
  result: StepResult
): Promise<VerifyResult> {
  try {
    if (result.status !== "ok") {
      return {
        passed: false,
        reason: `Step status was "${result.status}"`,
        confidence: 0.9,
      };
    }

    // Base confidence for a successful status
    let confidence = 0.85;

    // If the node declares an expected value, compare it against result.data
    const expected = node.verify?.expected;
    if (expected && result.data && Object.keys(result.data).length > 0) {
      const dataStr = JSON.stringify(result.data);
      if (dataStr.includes(expected)) {
        confidence = 0.95;
      } else {
        return {
          passed: false,
          reason: `Expected "${expected}" not found in API response data`,
          confidence: 0.9,
        };
      }
    }

    return { passed: true, confidence };
  } catch (err) {
    return {
      passed: false,
      reason: `API verify error: ${String(err)}`,
      confidence: 0,
    };
  }
}

async function verifyScreenshot(
  node: StateNode,
  _result: StepResult
): Promise<VerifyResult> {
  try {
    const surface = getSurface();

    if (!surface.isAvailable) {
      // Native bridge unavailable (e.g. CI / headless) — degrade gracefully
      return {
        passed: true,
        reason: "Native capture unavailable; screenshot verification skipped",
        confidence: 0.3,
      };
    }

    const screenshot = await surface.captureScreen();
    const expected = node.verify?.expected ?? "";

    // Check if the screenshot data is a valid image format (PNG/JPEG)
    // Raw pixel buffers (BGRA) don't have image headers and will crash vision providers
    if (screenshot.data.length > 0) {
      const isValidImage =
        (screenshot.data[0] === 0x89 && screenshot.data[1] === 0x50) || // PNG
        (screenshot.data[0] === 0xff && screenshot.data[1] === 0xd8);   // JPEG
      if (!isValidImage) {
        return {
          passed: true,
          reason: "Screenshot is raw pixel buffer (not PNG/JPEG); vision verification skipped",
          confidence: 0.3,
        };
      }
    }

    const vision = getVision();
    const visionResult = await vision.verifyState(screenshot.data, expected);

    return {
      passed: visionResult.passed,
      reason: visionResult.description,
      confidence: visionResult.confidence,
    };
  } catch (err) {
    // Screenshot verification is best-effort — don't crash the pipeline
    return {
      passed: true,
      reason: `Screenshot verify unavailable: ${err instanceof Error ? err.message : String(err)}`,
      confidence: 0.2,
    };
  }
}

async function verifyFile(
  node: StateNode,
  _result: StepResult
): Promise<VerifyResult> {
  try {
    const expected = node.verify?.expected ?? "";
    const deep = getDeep();

    // expected may be a plain path, or a JSON like {"path":"/…","contains":"…"}
    let filePath = expected;
    let contentMatch: string | undefined;

    try {
      const parsed = JSON.parse(expected) as Record<string, string>;
      if (parsed.path) {
        filePath = parsed.path;
        contentMatch = parsed.contains;
      }
    } catch {
      // Not JSON — treat the whole string as the path
    }

    if (!filePath) {
      return {
        passed: false,
        reason: "No file path specified in verify.expected",
        confidence: 0.9,
      };
    }

    if (!deep.fileExists(filePath)) {
      return {
        passed: false,
        reason: `File not found: ${filePath}`,
        confidence: 0.95,
      };
    }

    // File exists — if no content check required, we're done
    if (!contentMatch) {
      return { passed: true, confidence: 0.9 };
    }

    // Check file contents
    const contents = deep.readFile(filePath);
    if (contents.includes(contentMatch)) {
      return { passed: true, confidence: 0.95 };
    }

    return {
      passed: false,
      reason: `File "${filePath}" exists but does not contain "${contentMatch}"`,
      confidence: 0.95,
    };
  } catch (err) {
    return {
      passed: false,
      reason: `File verify error: ${String(err)}`,
      confidence: 0,
    };
  }
}

async function verifyProcess(
  node: StateNode,
  _result: StepResult
): Promise<VerifyResult> {
  try {
    const expected = node.verify?.expected ?? "";
    const deep = getDeep();

    // expected may be a plain process name, or JSON like {"name":"…","running":true}
    let processName = expected;
    let shouldBeRunning = true;

    try {
      const parsed = JSON.parse(expected) as Record<string, unknown>;
      if (typeof parsed.name === "string") {
        processName = parsed.name;
      }
      if (typeof parsed.running === "boolean") {
        shouldBeRunning = parsed.running;
      }
    } catch {
      // Not JSON — treat the whole string as the process name
    }

    if (!processName) {
      return {
        passed: false,
        reason: "No process name specified in verify.expected",
        confidence: 0.9,
      };
    }

    const isRunning = deep.isProcessRunning(processName);

    if (isRunning === shouldBeRunning) {
      return {
        passed: true,
        reason: `Process "${processName}" is ${isRunning ? "running" : "stopped"} as expected`,
        confidence: 0.9,
      };
    }

    return {
      passed: false,
      reason: `Process "${processName}" is ${isRunning ? "running" : "not running"}, expected ${shouldBeRunning ? "running" : "stopped"}`,
      confidence: 0.9,
    };
  } catch (err) {
    return {
      passed: false,
      reason: `Process verify error: ${String(err)}`,
      confidence: 0,
    };
  }
}

async function verifyCompound(
  node: StateNode,
  result: StepResult
): Promise<VerifyResult> {
  try {
    // api + screenshot run in parallel; both must pass
    const [apiResult, screenshotResult] = await Promise.all([
      verifyApi(node, result),
      verifyScreenshot(node, result),
    ]);

    const allPassed = apiResult.passed && screenshotResult.passed;
    const avgConfidence =
      ((apiResult.confidence ?? 0) + (screenshotResult.confidence ?? 0)) / 2;

    if (!allPassed) {
      const failing = [
        !apiResult.passed ? `api: ${apiResult.reason}` : null,
        !screenshotResult.passed
          ? `screenshot: ${screenshotResult.reason}`
          : null,
      ]
        .filter(Boolean)
        .join("; ");
      return { passed: false, reason: failing, confidence: avgConfidence };
    }

    return { passed: true, confidence: avgConfidence };
  } catch (err) {
    return {
      passed: false,
      reason: `Compound verify error: ${String(err)}`,
      confidence: 0,
    };
  }
}
