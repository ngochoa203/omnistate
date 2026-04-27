/**
 * Shared types for the command engine and automation runtime.
 */

export type ActionType =
  | "tap"
  | "swipe"
  | "type"
  | "wait"
  | "screenshot"
  | "find_element"
  | "scroll"
  | "app:open"
  | "app:back"
  | "app:home"
  | "app:recents"
  | "system:notifications"
  | "system:lock"
  | "unknown";

export interface AutomationIntent {
  action: ActionType;
  target?: string;
  params?: Record<string, unknown>;
  confidence: number;
  raw?: string;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  data?: unknown;
  durationMs?: number;
}

export type TriggerType = "voice" | "schedule" | "screen_match" | "manual" | "remote";

export interface MacroTrigger {
  type: TriggerType;
  value?: string;
  cron?: string;
}

export type ConditionType = "text_visible" | "text_gone" | "timeout" | "delay";

export interface ScreenCondition {
  type: ConditionType;
  value?: string;
  timeoutMs?: number;
}

export interface MacroStep {
  id: string;
  action: AutomationIntent;
  delayMs?: number;
  condition?: ScreenCondition;
  retry?: { count: number; intervalMs: number };
  description?: string;
}

export interface Macro {
  id: string;
  name: string;
  description?: string;
  trigger: MacroTrigger;
  steps: MacroStep[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
}

export interface AutomationLog {
  id: string;
  macroId?: string;
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
  data?: unknown;
}
