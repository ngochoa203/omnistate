/** Execution layer selection. */
export type ExecutionLayer = "deep" | "surface" | "fleet" | "auto";

/** Task status in the lifecycle. */
export type TaskStatus =
  | "planning"
  | "executing"
  | "paused"
  | "complete"
  | "failed";

/** Failure handling strategy. */
export interface FailureStrategy {
  strategy: "retry" | "alternative" | "escalate" | "abort";
  maxRetries?: number;
  alternativeNodeId?: string;
}

/** Verification configuration for a step. */
export interface VerifyConfig {
  strategy: "screenshot" | "api" | "file" | "process" | "compound";
  expected: string;
  timeoutMs: number;
}

/** A single node in the execution state graph (DAG). */
export interface StateNode {
  id: string;
  type: "action" | "verify" | "branch" | "wait" | "goal";
  layer: ExecutionLayer;

  action: {
    description: string;
    tool: string;
    params: Record<string, unknown>;
  };

  verify?: VerifyConfig;

  dependencies: string[];
  onSuccess: string | null;
  onFailure: FailureStrategy;

  estimatedDurationMs: number;
  priority: "critical" | "normal" | "background";
}

/** A complete execution plan — a DAG of StateNodes. */
export interface StatePlan {
  taskId: string;
  goal: string;
  estimatedDuration: string;
  nodes: StateNode[];
}
