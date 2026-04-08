/**
 * Element detection — multi-strategy pipeline.
 *
 * Priority order:
 * 1. Accessibility API — fast (0-5ms), structured, free, but only a11y-enabled apps
 * 2. Local OCR — medium (100-500ms), text-only, free, works on any app
 * 3. Claude Vision — slow (1-3s), semantic understanding, costs API call
 * 4. Template match — fast (<10ms), but requires pre-cached patterns
 *
 * Each strategy is tried in order. First result above confidence threshold wins.
 */

import type { DetectedElement } from "../layers/surface.js";
import * as bridge from "../platform/bridge.js";
import { ClaudeVisionProvider } from "./providers/claude.js";
import { LocalVisionProvider } from "./providers/local.js";

export type DetectionStrategy =
  | "accessibility"
  | "vision-model"
  | "ocr"
  | "template-match";

export interface DetectionConfig {
  strategies: DetectionStrategy[];
  confidenceThreshold: number;
  timeoutMs: number;
}

const DEFAULT_CONFIG: DetectionConfig = {
  strategies: ["accessibility", "ocr", "vision-model"],
  confidenceThreshold: 0.7,
  timeoutMs: 5000,
};

// Lazy-initialized singletons
let claudeProvider: ClaudeVisionProvider | null = null;
let localProvider: LocalVisionProvider | null = null;

function getClaude(): ClaudeVisionProvider {
  if (!claudeProvider) {
    claudeProvider = new ClaudeVisionProvider();
  }
  return claudeProvider;
}

function getLocal(): LocalVisionProvider {
  if (!localProvider) {
    localProvider = new LocalVisionProvider();
  }
  return localProvider;
}

/**
 * Run multi-strategy element detection.
 *
 * Tries strategies in order, returning the first result that meets
 * the confidence threshold. Falls back to best sub-threshold result.
 */
export async function detectElement(
  screenshot: Buffer,
  query: string,
  config: DetectionConfig = DEFAULT_CONFIG
): Promise<DetectedElement | null> {
  const results: DetectedElement[] = [];
  const deadline = Date.now() + config.timeoutMs;

  for (const strategy of config.strategies) {
    if (Date.now() > deadline) break;

    try {
      const elements = await runStrategy(strategy, screenshot, query);
      for (const el of elements) {
        if (el.confidence >= config.confidenceThreshold) {
          return el; // First high-confidence match — return immediately
        }
        results.push(el);
      }
    } catch {
      continue; // Strategy failed, try next
    }
  }

  // Return best sub-threshold result, if any
  return results.sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

/**
 * Run all strategies in parallel and return merged results.
 * Slower startup but lower total latency for multi-strategy detection.
 */
export async function detectElementParallel(
  screenshot: Buffer,
  query: string,
  config: DetectionConfig = DEFAULT_CONFIG
): Promise<DetectedElement[]> {
  const promises = config.strategies.map((s) =>
    runStrategy(s, screenshot, query).catch(() => [] as DetectedElement[])
  );

  const results = await Promise.all(promises);
  return results.flat().sort((a, b) => b.confidence - a.confidence);
}

/** Terminate any background resources (call on shutdown). */
export async function shutdown(): Promise<void> {
  if (localProvider) {
    await localProvider.terminate();
    localProvider = null;
  }
  claudeProvider = null;
}

// ---------------------------------------------------------------------------
// Strategy dispatch
// ---------------------------------------------------------------------------

async function runStrategy(
  strategy: DetectionStrategy,
  screenshot: Buffer,
  query: string
): Promise<DetectedElement[]> {
  switch (strategy) {
    case "accessibility":
      return runAccessibility(query);
    case "ocr":
      return getLocal().detectElements(screenshot, query);
    case "vision-model":
      return getClaude().detectElements(screenshot, query);
    case "template-match":
      return []; // Not yet implemented
    default:
      return [];
  }
}

/**
 * Accessibility strategy — query the OS accessibility tree via Rust N-API.
 *
 * This is the fastest path (~0-5ms) and returns highly accurate
 * bounding boxes. Works for standard UI controls in a11y-enabled apps.
 */
function runAccessibility(query: string): Promise<DetectedElement[]> {
  return new Promise((resolve) => {
    try {
      if (!bridge.isNativeAvailable()) {
        resolve([]);
        return;
      }

      // Try specific element search first
      const found = bridge.findElement(query) as Record<string, unknown> | null;
      if (found && isBounds(found.bounds)) {
        resolve([
          {
            id: String(found.title ?? found.role ?? "a11y-0"),
            type: String(found.role ?? "unknown"),
            text: found.title as string | undefined,
            bounds: found.bounds,
            confidence: 0.95,
            detectionMethod: "accessibility",
          },
        ]);
        return;
      }

      // Fall back to scanning all elements
      const allElements = bridge.getUiElements() as Array<
        Record<string, unknown>
      >;
      const queryLower = query.toLowerCase();

      const matches = allElements
        .filter((el) => {
          const title = String(el.title ?? "").toLowerCase();
          const role = String(el.role ?? "").toLowerCase();
          return (title.includes(queryLower) || role.includes(queryLower)) && isBounds(el.bounds);
        })
        .map((el, i) => ({
          id: String(el.title ?? `a11y-${i}`),
          type: String(el.role ?? "unknown"),
          text: el.title as string | undefined,
          bounds: el.bounds as {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          confidence: 0.9,
          detectionMethod: "accessibility" as const,
        }));

      resolve(matches);
    } catch {
      resolve([]);
    }
  });
}

/** Runtime guard for bounds object shape. */
function isBounds(
  v: unknown
): v is { x: number; y: number; width: number; height: number } {
  return (
    typeof v === "object" &&
    v !== null &&
    ["x", "y", "width", "height"].every(
      (k) => typeof (v as Record<string, unknown>)[k] === "number"
    )
  );
}
