import type { ExecutionLayer, TaskStatus } from "./task.js";

/** Session key format for routing. */
export type SessionKey =
  | `task:${string}`
  | `scheduled:${string}`
  | `fleet:${string}:${string}:${string}`
  | `health:${string}`
  | `interactive:${string}:${string}`;

/** Origin channel for a task. */
export type OriginChannel =
  | "cli"
  | "telegram"
  | "web"
  | "voice"
  | "cron"
  | "fleet"
  | "health";

/** A session entry in the session store. */
export interface SessionEntry {
  sessionId: string;
  sessionKey: SessionKey;
  status: TaskStatus;

  goal: string;
  currentNodeId?: string;

  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  estimatedDurationMs?: number;
  actualDurationMs?: number;

  layer: ExecutionLayer;
  agentId: string;

  stepsCompleted: number;
  stepsTotal: number;
  retryCount: number;
  lastError?: string;

  screenshotCount: number;
  llmTokensUsed: number;

  origin: {
    channel: OriginChannel;
    from?: string;
  };
}

/** A single entry in the JSONL transcript file. */
export type TranscriptEntry =
  | StepStartEntry
  | StepActionEntry
  | StepResultEntry
  | StepVerifyEntry
  | StepEndEntry
  | StepCaptureEntry
  | StepRetryEntry
  | TaskCompleteEntry;

interface StepStartEntry {
  type: "step.start";
  ts: string;
  nodeId: string;
  layer: ExecutionLayer;
}

interface StepActionEntry {
  type: "step.action";
  ts: string;
  nodeId: string;
  tool: string;
  params: Record<string, unknown>;
}

interface StepResultEntry {
  type: "step.result";
  ts: string;
  nodeId: string;
  status: "ok" | "error";
  data?: Record<string, unknown>;
  error?: string;
}

interface StepVerifyEntry {
  type: "step.verify";
  ts: string;
  nodeId: string;
  strategy: string;
  result: "pass" | "fail" | "ambiguous";
  confidence?: number;
}

interface StepEndEntry {
  type: "step.end";
  ts: string;
  nodeId: string;
  durationMs: number;
}

interface StepCaptureEntry {
  type: "step.capture";
  ts: string;
  nodeId: string;
  screenshot: string;
}

interface StepRetryEntry {
  type: "step.retry";
  ts: string;
  nodeId: string;
  attempt: number;
  reason: string;
  strategy: string;
}

interface TaskCompleteEntry {
  type: "task.complete";
  ts: string;
  totalDurationMs: number;
  stepsCompleted: number;
  retriesUsed: number;
}
