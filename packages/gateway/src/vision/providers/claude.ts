/**
 * Claude Vision Provider — uses Claude's Computer Use capability
 * for UI element detection and state verification.
 *
 * TODO: Integrate with @anthropic-ai/sdk when implementing.
 */

import type { VisionProvider, VerifyResult } from "../engine.js";
import type { DetectedElement } from "../../layers/surface.js";

export class ClaudeVisionProvider implements VisionProvider {
  name = "claude";

  // @ts-expect-error - API key will be used when implementing
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async detectElements(
    _screenshot: Buffer,
    _query: string
  ): Promise<DetectedElement[]> {
    // TODO: Send screenshot to Claude with computer use tool
    // Prompt: "Identify the location and bounding box of: {query}"
    return [];
  }

  async verifyState(
    _screenshot: Buffer,
    _expected: string
  ): Promise<VerifyResult> {
    // TODO: Send screenshot to Claude
    // Prompt: "Does the current screen show: {expected}? Answer yes/no with confidence."
    return {
      passed: false,
      confidence: 0,
      description: "Claude vision provider not yet implemented",
    };
  }
}
