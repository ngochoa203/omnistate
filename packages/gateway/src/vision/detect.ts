/**
 * Element detection — multi-strategy pipeline.
 *
 * Priority order:
 * 1. Fingerprint — ~0ms, structural identity match, survives visual redesigns
 * 2. Accessibility API — fast (0-5ms), structured, free, but only a11y-enabled apps
 * 3. Local OCR — medium (100-500ms), text-only, free, works on any app
 * 4. Claude Vision — slow (1-3s), semantic understanding, costs API call
 * 5. Template match — fast (<10ms), but requires pre-cached patterns
 *
 * Each strategy is tried in order. First result above confidence threshold wins.
 */

import type { DetectedElement } from "../layers/surface.js";
import * as bridge from "../platform/bridge.js";
import { ClaudeVisionProvider } from "./providers/claude.js";
import { LocalVisionProvider } from "./providers/local.js";
import { findComponent, type ComponentFingerprint } from "./fingerprint.js";

export type DetectionStrategy =
  | "fingerprint"
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
  strategies: ["fingerprint", "accessibility", "ocr", "vision-model"],
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
    case "fingerprint":
      return runFingerprintDetection(query);
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

// ---------------------------------------------------------------------------
// Fingerprint strategy
// ---------------------------------------------------------------------------

/**
 * Find an element using component fingerprinting.
 *
 * Fingerprinting uses structural identity (role + position in tree + siblings)
 * rather than text/visual matching, so it survives colour/theme changes.
 * The store must be populated first via fingerprintTree() in surface.ts.
 */
export function detectByFingerprint(query: string): DetectedElement | null {
  // 1. Try exact text match.
  let fp = findComponent({ text: query });

  // 2. Try semantic role match (caller may pass "action-submit", "input-text", …).
  if (!fp || fp.matchConfidence < 0.3) {
    fp = findComponent({ semanticRole: query.toLowerCase() });
  }

  // 3. Try role match (caller may pass "AXButton", "button", …).
  if (!fp || fp.matchConfidence < 0.3) {
    fp = findComponent({ role: query });
  }

  if (!fp || fp.matchConfidence < 0.3) return null;

  return fingerprintToElement(fp);
}

/**
 * Internal — run fingerprint detection as a strategy, returning an array
 * so it plugs into the existing runStrategy() dispatch uniformly.
 */
function runFingerprintDetection(query: string): Promise<DetectedElement[]> {
  const result = detectByFingerprint(query);
  return Promise.resolve(result ? [result] : []);
}

/** Convert a ComponentFingerprint to the DetectedElement shape. */
function fingerprintToElement(fp: ComponentFingerprint): DetectedElement {
  return {
    id: fp.id,
    type: mapRoleToElementType(fp.role),
    bounds: fp.bounds,
    text: fp.text ?? undefined,
    confidence: fp.matchConfidence,
    detectionMethod: "fingerprint",
  };
}

/** Map an accessibility role to a simplified element type string. */
function mapRoleToElementType(role: string): string {
  const r = role.toLowerCase();
  if (r.includes("button")) return "button";
  if (r.includes("searchfield")) return "input";
  if (r.includes("textfield") || r.includes("textarea")) return "input";
  if (r.includes("statictext") || r.includes("label")) return "text";
  if (r.includes("image") || r.includes("icon")) return "image";
  if (r.includes("link")) return "link";
  if (r.includes("checkbox")) return "checkbox";
  if (r.includes("radiobutton")) return "radio";
  if (r.includes("combobox") || r.includes("popupbutton")) return "select";
  if (r.includes("slider")) return "slider";
  if (r.includes("window")) return "window";
  if (r.includes("toolbar") || r.includes("tabbar")) return "toolbar";
  if (r.includes("menubar") || r.includes("menu")) return "menubar";
  if (r.includes("group") || r.includes("box")) return "group";
  if (r.includes("list")) return "list";
  if (r.includes("table") || r.includes("grid")) return "table";
  return "other";
}

// ---------------------------------------------------------------------------
// Accessibility strategy
// ---------------------------------------------------------------------------

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
