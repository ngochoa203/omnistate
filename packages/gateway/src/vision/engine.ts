/**
 * Vision Engine — coordinator for screen perception.
 *
 * Combines multiple detection strategies:
 * 1. Accessibility API (structured, reliable)
 * 2. Vision Language Model (semantic understanding)
 * 3. OCR + spatial reasoning
 * 4. Template matching (cached patterns)
 */

import type { DetectedElement } from "../layers/surface.js";
import { ClaudeVisionProvider } from "./providers/claude.js";
import { LocalVisionProvider } from "./providers/local.js";

export interface VisionProvider {
  name: string;
  detectElements(screenshot: Buffer, query: string): Promise<DetectedElement[]>;
  verifyState(screenshot: Buffer, expected: string): Promise<VerifyResult>;
}

export interface VerifyResult {
  passed: boolean;
  confidence: number;
  description: string;
}

export class VisionEngine {
  private providers: VisionProvider[] = [];

  /** Register a vision provider. */
  registerProvider(provider: VisionProvider): void {
    this.providers.push(provider);
  }

  /**
   * Detect UI elements matching a query using all registered providers.
   * Returns the highest-confidence result.
   */
  async detectElements(
    screenshot: Buffer,
    query: string
  ): Promise<DetectedElement[]> {
    const allResults = await Promise.allSettled(
      this.providers.map((p) => p.detectElements(screenshot, query))
    );

    const elements: DetectedElement[] = [];
    for (const result of allResults) {
      if (result.status === "fulfilled") {
        elements.push(...result.value);
      }
    }

    // Deduplicate and rank by confidence
    return elements.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Verify the current screen state matches an expectation.
   * Asks all providers and aggregates results.
   */
  async verifyState(
    screenshot: Buffer,
    expected: string
  ): Promise<VerifyResult> {
    if (this.providers.length === 0) {
      return {
        passed: false,
        confidence: 0,
        description: "No vision providers registered",
      };
    }

    const results = await Promise.allSettled(
      this.providers.map((p) => p.verifyState(screenshot, expected))
    );

    const successful = results
      .filter(
        (r): r is PromiseFulfilledResult<VerifyResult> =>
          r.status === "fulfilled"
      )
      .map((r) => r.value);

    if (successful.length === 0) {
      return {
        passed: false,
        confidence: 0,
        description: "All vision providers failed",
      };
    }

    // Aggregate: pass if majority pass with > 0.5 confidence
    const passingCount = successful.filter((r) => r.passed).length;
    const avgConfidence =
      successful.reduce((sum, r) => sum + r.confidence, 0) /
      successful.length;

    return {
      passed: passingCount > successful.length / 2,
      confidence: avgConfidence,
      description: successful.map((r) => r.description).join("; "),
    };
  }
}

/**
 * Create a VisionEngine with default providers registered.
 *
 * Provider priority (all run in parallel, highest confidence wins):
 * 1. Local OCR — free, fast (~100-500ms), text-only
 * 2. Claude Vision — costs API call, slower (~1-3s), semantic understanding
 *
 * @param anthropicApiKey - Optional. Falls back to ANTHROPIC_API_KEY env var.
 */
export function createDefaultEngine(
  anthropicApiKey?: string
): VisionEngine {
  const engine = new VisionEngine();

  // Local OCR — always available, no API key needed
  engine.registerProvider(new LocalVisionProvider());

  // Claude Vision — only if API key is available
  const claude = new ClaudeVisionProvider({
    apiKey: anthropicApiKey,
  });
  if (claude.isAvailable) {
    engine.registerProvider(claude);
  }

  return engine;
}
