import type { StateNode } from "../types/task.js";
import type { StepResult } from "./orchestrator.js";
import { SurfaceLayer } from "../layers/surface.js";
import { BrowserLayer } from "../layers/browser.js";
import { createDefaultEngine } from "../vision/engine.js";
import type { VisionEngine } from "../vision/engine.js";
import { DeepLayer } from "../layers/deep.js";
import type { VerificationEvidence, VerificationResult } from "@omnistate/shared";

export interface VerifyResult {
  passed: boolean;
  reason?: string;
  verification: VerificationResult;
}

// ---------------------------------------------------------------------------
// Lazy-initialized singletons — created once on first use, then reused.
// Bug fix #11: expose _resetVerifySingletons() so tests can clear shared state
// between runs and avoid cross-test pollution.
// ---------------------------------------------------------------------------

let _surface: SurfaceLayer | null = null;
let _vision: VisionEngine | null = null;
let _deep: DeepLayer | null = null;
let _browser: BrowserLayer | null = null;

/** @internal — for test teardown only */
export function _resetVerifySingletons(): void {
  _surface = null;
  _vision = null;
  _deep = null;
  _browser = null;
}

// Exported for test mocking — replace these to stub dependencies
export function _getSurface(): SurfaceLayer {
  if (!_surface) _surface = new SurfaceLayer();
  return _surface;
}

export function _getVision(): VisionEngine {
  if (!_vision) _vision = createDefaultEngine();
  return _vision;
}

export function _getDeep(): DeepLayer {
  if (!_deep) _deep = new DeepLayer();
  return _deep;
}

export function _getBrowser(): BrowserLayer {
  if (!_browser) _browser = new BrowserLayer();
  return _browser;
}

/** @internal — factory used internally; exported for test stubbing */
const getSurface = _getSurface;
/** @internal */
const getVision = _getVision;
/** @internal */
const getDeep = _getDeep;
/** @internal */
const getBrowser = _getBrowser;

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
 * - browser-state: Verify active tab/browser state such as URL and title
 * - compound:   api + screenshot in parallel, both must pass
 */
export async function verifyStep(
  node: StateNode,
  result: StepResult
): Promise<VerifyResult> {
  if (!node.verify) {
    return {
      passed: true,
      verification: makeVerification("unsupported", "heuristic", 0, "No verification configured", [
        evidence("heuristic-note", "Step has no verify configuration"),
      ]),
    };
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
    case "browser-state":
      return verifyBrowserState(node, result);
    case "compound":
      return verifyCompound(node, result);
    default:
      return {
        passed: true,
        verification: makeVerification("unsupported", "heuristic", 0, `Unknown verification strategy "${String(node.verify.strategy)}"`, [
          evidence("heuristic-note", `Unknown verification strategy "${String(node.verify.strategy)}"`),
        ]),
      };
  }
}

function evidence(
  type: VerificationEvidence["type"],
  summary: string,
  details?: Record<string, unknown>,
): VerificationEvidence {
  return { type, summary, ...(details ? { details } : {}) };
}

function makeVerification(
  status: VerificationResult["status"],
  verifier: VerificationResult["verifier"],
  confidence: number,
  summary: string,
  evidenceItems: VerificationEvidence[],
): VerificationResult {
  return {
    status,
    confidence,
    verifier,
    summary,
    evidence: evidenceItems,
    timestamp: new Date().toISOString(),
  };
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
        verification: makeVerification("contradicted", "api", 0.9, `Step status was "${result.status}"`, [
          evidence("api-response", `Execution step failed with status ${result.status}`),
        ]),
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
          verification: makeVerification("contradicted", "api", 0.9, `Expected "${expected}" not found in API response data`, [
            evidence("api-response", `Expected value "${expected}" missing from step data`),
          ]),
        };
      }
    }

    return {
      passed: true,
      verification: makeVerification("verified", "api", confidence, "API verification matched expected state", [
        evidence("api-response", "API/state output matched the verification expectation"),
      ]),
    };
  } catch (err) {
    return {
      passed: false,
      reason: `API verify error: ${String(err)}`,
      verification: makeVerification("contradicted", "api", 0, `API verify error: ${String(err)}`, [
        evidence("api-response", "API verification threw an exception", { error: String(err) }),
      ]),
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
      return {
        passed: true,
        verification: makeVerification("unsupported", "vision", 0.3, "Native capture unavailable; screenshot verification skipped", [
          evidence("heuristic-note", "Native screen capture bridge is unavailable in this environment"),
        ]),
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
          verification: makeVerification("unverified", "vision", 0.3, "Screenshot is a raw pixel buffer; vision verification skipped", [
            evidence("image-region", "Capture returned raw pixels instead of a PNG/JPEG artifact"),
          ]),
        };
      }
    }

    const vision = getVision();
    const visionResult = await vision.verifyState(screenshot.data, expected);

    return {
      passed: visionResult.passed,
      reason: visionResult.description,
      verification: makeVerification(
        visionResult.passed ? "verified" : "contradicted",
        "vision",
        visionResult.confidence,
        visionResult.description,
        [evidence("image-region", visionResult.description)],
      ),
    };
  } catch (err) {
    return {
      passed: false,
      reason: `Screenshot verify error: ${err instanceof Error ? err.message : String(err)}`,
      verification: makeVerification("contradicted", "vision", 0, `Screenshot verification threw an exception`, [
        evidence("heuristic-note", "Screenshot verifier threw an exception — cannot confirm step success", {
          error: err instanceof Error ? err.message : String(err),
        }),
      ]),
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
        verification: makeVerification("contradicted", "file", 0.9, "No file path specified in verify.expected", [
          evidence("file-state", "Verification config did not include a file path"),
        ]),
      };
    }

    if (!deep.fileExists(filePath)) {
      return {
        passed: false,
        reason: `File not found: ${filePath}`,
        verification: makeVerification("contradicted", "file", 0.95, `File not found: ${filePath}`, [
          evidence("file-state", `Expected file "${filePath}" was not found`),
        ]),
      };
    }

    // File exists — if no content check required, we're done
    if (!contentMatch) {
      return {
        passed: true,
        verification: makeVerification("verified", "file", 0.9, `File "${filePath}" exists`, [
          evidence("file-state", `File "${filePath}" exists`),
        ]),
      };
    }

    // Check file contents
    const contents = deep.readFile(filePath);
    if (contents.includes(contentMatch)) {
      return {
        passed: true,
        verification: makeVerification("verified", "file", 0.95, `File "${filePath}" contains expected content`, [
          evidence("file-state", `File "${filePath}" contains the expected content snippet`),
        ]),
      };
    }

    return {
      passed: false,
      reason: `File "${filePath}" exists but does not contain "${contentMatch}"`,
      verification: makeVerification("contradicted", "file", 0.95, `File "${filePath}" exists but does not contain "${contentMatch}"`, [
        evidence("file-state", `File "${filePath}" was present but did not contain the expected text`),
      ]),
    };
  } catch (err) {
    return {
      passed: false,
      reason: `File verify error: ${String(err)}`,
      verification: makeVerification("contradicted", "file", 0, `File verify error: ${String(err)}`, [
        evidence("file-state", "File verification threw an exception", { error: String(err) }),
      ]),
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
        verification: makeVerification("contradicted", "process", 0.9, "No process name specified in verify.expected", [
          evidence("process-state", "Verification config did not include a process name"),
        ]),
      };
    }

    const isRunning = deep.isProcessRunning(processName);

    if (isRunning === shouldBeRunning) {
      return {
        passed: true,
        reason: `Process "${processName}" is ${isRunning ? "running" : "stopped"} as expected`,
        verification: makeVerification("verified", "process", 0.9, `Process "${processName}" is ${isRunning ? "running" : "stopped"} as expected`, [
          evidence("process-state", `Process "${processName}" matched expected running state`),
        ]),
      };
    }

    return {
      passed: false,
      reason: `Process "${processName}" is ${isRunning ? "running" : "not running"}, expected ${shouldBeRunning ? "running" : "stopped"}`,
      verification: makeVerification("contradicted", "process", 0.9, `Process "${processName}" is ${isRunning ? "running" : "not running"}, expected ${shouldBeRunning ? "running" : "stopped"}`, [
        evidence("process-state", `Process "${processName}" did not match expected running state`),
      ]),
    };
  } catch (err) {
    return {
      passed: false,
      reason: `Process verify error: ${String(err)}`,
      verification: makeVerification("contradicted", "process", 0, `Process verify error: ${String(err)}`, [
        evidence("process-state", "Process verification threw an exception", { error: String(err) }),
      ]),
    };
  }
}

async function verifyBrowserState(
  node: StateNode,
  result: StepResult,
): Promise<VerifyResult> {
  try {
    if (result.status !== "ok") {
      return {
        passed: false,
        reason: `Step status was "${result.status}"`,
        verification: makeVerification("contradicted", "app-state", 0.9, `Step status was "${result.status}"`, [
          evidence("window-state", `Execution step failed with status ${result.status}`),
        ]),
      };
    }

    const expectedRaw = node.verify?.expected ?? "";
    const browser = getBrowser();

    let expectedUrl = expectedRaw;
    let preferredBrowser: string | undefined;
    let expectedTitleIncludes: string | undefined;

    try {
      const parsed = JSON.parse(expectedRaw) as Record<string, unknown>;
      if (typeof parsed.url === "string") {
        expectedUrl = parsed.url;
      }
      if (typeof parsed.browser === "string") {
        preferredBrowser = parsed.browser;
      }
      if (typeof parsed.titleIncludes === "string") {
        expectedTitleIncludes = parsed.titleIncludes;
      }
    } catch {
      // plain string expected; treat as URL substring
    }

    if (!expectedUrl) {
      return {
        passed: false,
        reason: "No expected browser URL provided",
        verification: makeVerification("contradicted", "app-state", 0.9, "No expected browser URL provided", [
          evidence("window-state", "Browser-state verification requires an expected URL"),
        ]),
      };
    }

    await browser.waitForPageLoad(node.verify?.timeoutMs ?? 10_000, preferredBrowser);
    const activeTab = await browser.getActiveTab(preferredBrowser);

    const urlMatched =
      activeTab.url === expectedUrl ||
      activeTab.url.startsWith(expectedUrl) ||
      activeTab.url.includes(expectedUrl);
    const titleMatched = !expectedTitleIncludes || activeTab.title.includes(expectedTitleIncludes);

    if (urlMatched && titleMatched) {
      return {
        passed: true,
        verification: makeVerification("verified", "app-state", 0.95, "Browser state matched expected tab state", [
          evidence("window-state", `Active tab URL matched expected URL`, {
            expectedUrl,
            actualUrl: activeTab.url,
            browser: preferredBrowser ?? "auto",
          }),
          evidence("text", `Active tab title: ${activeTab.title || "(empty title)"}`),
        ]),
      };
    }

    return {
      passed: false,
      reason: `Browser state mismatch: expected ${expectedUrl} but active tab is ${activeTab.url || "(empty)"}`,
      verification: makeVerification("contradicted", "app-state", 0.9, "Browser state did not match expected tab state", [
        evidence("window-state", "Active tab URL did not match expected URL", {
          expectedUrl,
          actualUrl: activeTab.url,
          expectedTitleIncludes,
          actualTitle: activeTab.title,
          browser: preferredBrowser ?? "auto",
        }),
      ]),
    };
  } catch (err) {
    return {
      passed: false,
      reason: `Browser-state verify error: ${err instanceof Error ? err.message : String(err)}`,
      verification: makeVerification("contradicted", "app-state", 0, `Browser-state verify error: ${err instanceof Error ? err.message : String(err)}`, [
        evidence("window-state", "Browser-state verification threw an exception", {
          error: err instanceof Error ? err.message : String(err),
        }),
      ]),
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
      ((apiResult.verification.confidence ?? 0) + (screenshotResult.verification.confidence ?? 0)) / 2;

    if (!allPassed) {
      const failing = [
        !apiResult.passed ? `api: ${apiResult.reason}` : null,
        !screenshotResult.passed
          ? `screenshot: ${screenshotResult.reason}`
          : null,
      ]
        .filter(Boolean)
        .join("; ");
      return {
        passed: false,
        reason: failing,
        verification: makeVerification("contradicted", "compound", avgConfidence, failing, [
          ...apiResult.verification.evidence,
          ...screenshotResult.verification.evidence,
        ]),
      };
    }

    const compoundStatus =
      apiResult.verification.status === "verified" &&
      screenshotResult.verification.status === "verified"
        ? "verified"
        : apiResult.verification.status === "unsupported" &&
            screenshotResult.verification.status === "unsupported"
          ? "unsupported"
          : "unverified";

    return {
      passed: true,
      verification: makeVerification(compoundStatus, "compound", avgConfidence, "Compound verification completed", [
        ...apiResult.verification.evidence,
        ...screenshotResult.verification.evidence,
      ]),
    };
  } catch (err) {
    return {
      passed: false,
      reason: `Compound verify error: ${String(err)}`,
      verification: makeVerification("contradicted", "compound", 0, `Compound verify error: ${String(err)}`, [
        evidence("heuristic-note", "Compound verification threw an exception", { error: String(err) }),
      ]),
    };
  }
}
