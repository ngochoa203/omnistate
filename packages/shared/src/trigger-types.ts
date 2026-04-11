export type TriggerConditionType =
  | "cpu_threshold"
  | "memory_threshold"
  | "cron"
  | "filesystem_change"
  | "process_event"
  | "webhook";

export interface TriggerCondition {
  type: TriggerConditionType;
  config: Record<string, unknown>;
}

export interface CpuThresholdConfig {
  metric: "usage" | "load";
  operator: "gt" | "lt";
  value: number;
}

export interface MemoryThresholdConfig {
  operator: "gt" | "lt";
  value: number;
  unit: "percent" | "mb";
}

export interface CronConfig {
  expression: string;
  timezone?: string;
}

export interface FilesystemChangeConfig {
  path: string;
  events: ("create" | "modify" | "delete")[];
}

export interface ProcessEventConfig {
  name: string;
  event: "start" | "stop" | "crash";
}

export interface WebhookConfig {
  path: string;
  secret?: string;
}

export interface TriggerAction {
  type: "execute_task";
  goal: string;
  layer?: "deep" | "surface" | "auto";
}

export interface Trigger {
  id: string;
  userId: string;
  name: string;
  description?: string;
  condition: TriggerCondition;
  action: TriggerAction;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastFiredAt?: string;
  fireCount: number;
  cooldownMs?: number;
}

export interface TriggerLogEntry {
  id: string;
  triggerId: string;
  userId: string;
  firedAt: string;
  conditionSnapshot: Record<string, unknown>;
  taskId?: string;
  status: "fired" | "executed" | "failed" | "skipped";
  error?: string;
}
