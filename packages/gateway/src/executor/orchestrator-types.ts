import type { ExecutionLayer } from "../types/task.js";

export interface ExecutionError {
  code: string;
  message: string;
  nodeId?: string;
  layer?: ExecutionLayer;
  retryable?: boolean;
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
  stepResults?: StepResult[];
}
