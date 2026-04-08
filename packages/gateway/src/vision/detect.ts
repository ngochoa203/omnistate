/**
 * Element detection strategies.
 *
 * Multi-strategy detection pipeline:
 * 1. Accessibility API — fast, structured, limited to a11y-enabled apps
 * 2. Vision LM — semantic understanding, slower, any app
 * 3. OCR — text extraction + spatial reasoning
 * 4. Template match — cached UI patterns for known apps
 */

import type { DetectedElement } from "../layers/surface.js";

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
  strategies: ["accessibility", "vision-model", "ocr"],
  confidenceThreshold: 0.7,
  timeoutMs: 5000,
};

/**
 * Run multi-strategy element detection.
 *
 * TODO: Implement each strategy with real bindings.
 */
export async function detectElement(
  _screenshot: Buffer,
  query: string,
  config: DetectionConfig = DEFAULT_CONFIG
): Promise<DetectedElement | null> {
  const results: DetectedElement[] = [];

  for (const strategy of config.strategies) {
    try {
      const element = await runStrategy(strategy, query);
      if (element && element.confidence >= config.confidenceThreshold) {
        return element; // Return first high-confidence match
      }
      if (element) results.push(element);
    } catch {
      // Strategy failed, try next
      continue;
    }
  }

  // Return best result below threshold, if any
  return results.sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

async function runStrategy(
  strategy: DetectionStrategy,
  _query: string
): Promise<DetectedElement | null> {
  switch (strategy) {
    case "accessibility":
      // TODO: Call Rust N-API accessibility binding
      return null;
    case "vision-model":
      // TODO: Call Claude/GPT-4V vision API
      return null;
    case "ocr":
      // TODO: Run local OCR engine
      return null;
    case "template-match":
      // TODO: Compare against cached UI maps
      return null;
    default:
      return null;
  }
}
