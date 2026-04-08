import type { StatePlan } from "../types/task.js";

/**
 * Intent classification — convert natural language to structured intent.
 *
 * This module will integrate with Claude/GPT to parse user commands
 * into actionable intents with entities.
 */

export interface Intent {
  type: string;
  entities: Record<string, Entity>;
  confidence: number;
  rawText: string;
}

export interface Entity {
  type: "file" | "app" | "url" | "person" | "text" | "command";
  value: string;
  metadata?: Record<string, unknown>;
}

/**
 * Classify a natural language command into a structured intent.
 *
 * TODO: Integrate with Claude API for real NL understanding.
 * For now, returns a basic pass-through intent.
 */
export async function classifyIntent(text: string): Promise<Intent> {
  // Placeholder — will be replaced with LLM-based classification
  return {
    type: "generic",
    entities: {
      command: { type: "text", value: text },
    },
    confidence: 0.5,
    rawText: text,
  };
}

/**
 * Build a StatePlan from a classified intent.
 */
export async function planFromIntent(intent: Intent): Promise<StatePlan> {
  return {
    taskId: `task-${Date.now()}`,
    goal: intent.rawText,
    estimatedDuration: "unknown",
    nodes: [
      {
        id: "execute",
        type: "action",
        layer: "auto",
        action: {
          description: intent.rawText,
          tool: "generic.execute",
          params: { intent },
        },
        dependencies: [],
        onSuccess: null,
        onFailure: { strategy: "escalate" },
        estimatedDurationMs: 30000,
        priority: "normal",
      },
    ],
  };
}
