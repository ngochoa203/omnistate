import type { StateNode } from "../types/task.js";
import type { StepResult } from "./orchestrator.js";

export interface VerifyResult {
  passed: boolean;
  reason?: string;
  confidence?: number;
}

/**
 * Verify a step's result using the configured strategy.
 *
 * Strategies:
 * - screenshot: Capture screen, ask vision model (TODO)
 * - api: Check via OS API (file exists, process running, etc.)
 * - file: Verify file contents
 * - process: Check process state
 * - compound: Multiple methods combined
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

async function verifyApi(
  _node: StateNode,
  result: StepResult
): Promise<VerifyResult> {
  // Basic: if execution reported OK, pass
  return {
    passed: result.status === "ok",
    confidence: 0.8,
  };
}

async function verifyScreenshot(
  _node: StateNode,
  _result: StepResult
): Promise<VerifyResult> {
  // TODO: Capture screen and send to vision model
  return {
    passed: true,
    reason: "Screenshot verification not yet implemented",
    confidence: 0.5,
  };
}

async function verifyFile(
  _node: StateNode,
  _result: StepResult
): Promise<VerifyResult> {
  // TODO: Check file existence and contents
  return { passed: true, confidence: 0.5 };
}

async function verifyProcess(
  _node: StateNode,
  _result: StepResult
): Promise<VerifyResult> {
  // TODO: Check process state
  return { passed: true, confidence: 0.5 };
}

async function verifyCompound(
  node: StateNode,
  result: StepResult
): Promise<VerifyResult> {
  // Run all strategies and aggregate
  const results = await Promise.all([
    verifyApi(node, result),
    verifyScreenshot(node, result),
  ]);
  const allPassed = results.every((r) => r.passed);
  const avgConfidence =
    results.reduce((sum, r) => sum + (r.confidence ?? 0), 0) /
    results.length;
  return {
    passed: allPassed,
    confidence: avgConfidence,
  };
}
