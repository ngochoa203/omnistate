import type { StatePlan, StateNode, ExecutionLayer } from "../types/task.js";
import { ExecutionQueue } from "./queue.js";
import { RetryEngine } from "./retry.js";
import { verifyStep } from "./verify.js";

/**
 * Execution Orchestrator — coordinates the three execution layers.
 *
 * Walks through a StatePlan's DAG, executing each step on the
 * appropriate layer, verifying results, and handling retries.
 */
export class Orchestrator {
  private queue: ExecutionQueue;
  private retry: RetryEngine;

  constructor() {
    this.queue = new ExecutionQueue();
    this.retry = new RetryEngine();
  }

  /** Get current queue depth. */
  get queueDepth(): number {
    return this.queue.depth;
  }

  /**
   * Execute a complete plan.
   *
   * TODO: Integrate with actual Deep/Surface/Fleet layers.
   */
  async executePlan(plan: StatePlan): Promise<ExecutionResult> {
    const completed = new Set<string>();
    const results: Map<string, StepResult> = new Map();

    for (const node of plan.nodes) {
      const result = await this.executeNode(node, results);
      results.set(node.id, result);

      if (result.status === "ok") {
        completed.add(node.id);
      } else {
        // Attempt retry
        const retried = await this.retry.attemptRetry(
          node,
          result,
          (n) => this.executeNode(n, results)
        );
        if (retried.status === "ok") {
          completed.add(node.id);
          results.set(node.id, retried);
        } else {
          return {
            taskId: plan.taskId,
            status: "failed",
            completedSteps: completed.size,
            totalSteps: plan.nodes.length,
            error: retried.error,
          };
        }
      }
    }

    return {
      taskId: plan.taskId,
      status: "complete",
      completedSteps: completed.size,
      totalSteps: plan.nodes.length,
    };
  }

  private async executeNode(
    node: StateNode,
    _context: Map<string, StepResult>
  ): Promise<StepResult> {
    const layer = this.selectLayer(node);

    // TODO: Route to actual execution layer
    // For now, placeholder
    const result: StepResult = {
      nodeId: node.id,
      status: "ok",
      layer,
      durationMs: 0,
      data: {},
    };

    // Verify if configured
    if (node.verify) {
      const verified = await verifyStep(node, result);
      if (!verified.passed) {
        return { ...result, status: "failed", error: verified.reason };
      }
    }

    return result;
  }

  private selectLayer(node: StateNode): ExecutionLayer {
    if (node.layer !== "auto") return node.layer;
    // Auto-select: prefer deep layer when possible
    return "deep";
  }
}

export interface StepResult {
  nodeId: string;
  status: "ok" | "failed";
  layer: ExecutionLayer;
  durationMs: number;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ExecutionResult {
  taskId: string;
  status: "complete" | "failed";
  completedSteps: number;
  totalSteps: number;
  error?: string;
}
