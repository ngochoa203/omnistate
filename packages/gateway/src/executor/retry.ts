import type { StateNode } from "../types/task.js";
import type { StepResult } from "./orchestrator.js";

/**
 * Retry engine with escalating strategies.
 *
 * On failure:
 * 1. Same strategy (up to maxRetries)
 * 2. Alternative strategy if configured
 * 3. Escalate to user
 */
export class RetryEngine {
  private defaultMaxRetries = 3;
  private backoffMs = [1000, 3000, 10000];

  async attemptRetry(
    node: StateNode,
    lastResult: StepResult,
    executor: (node: StateNode) => Promise<StepResult>
  ): Promise<StepResult> {
    const maxRetries =
      node.onFailure.maxRetries ?? this.defaultMaxRetries;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Wait with backoff
      const delay =
        this.backoffMs[Math.min(attempt - 1, this.backoffMs.length - 1)];
      await this.sleep(delay);

      const result = await executor(node);
      if (result.status === "ok") {
        return result;
      }
    }

    // All retries exhausted
    return {
      nodeId: node.id,
      status: "failed",
      layer: lastResult.layer,
      durationMs: lastResult.durationMs,
      error: `Failed after ${maxRetries} retries: ${lastResult.error}`,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
