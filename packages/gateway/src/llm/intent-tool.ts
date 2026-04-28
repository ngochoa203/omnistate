import type { AnthropicTool } from "./tools.js";
import type { ParsedCommand, SystemAction } from "../planner/parsed-command.js";
import { INTENT_TYPES, SYSTEM_ACTIONS } from "../planner/parsed-command.js";

export const EXTRACT_INTENT_TOOL: AnthropicTool = {
  name: "extract_intent",
  description: "Extract structured intent from a natural language command. Always call this tool with the classification result.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "The primary action to perform",
        enum: [...SYSTEM_ACTIONS],
      },
      intent_type: {
        type: "string",
        description: "High-level intent category",
        enum: [...INTENT_TYPES],
      },
      confidence: {
        type: "number",
        description: "Classification confidence 0-1",
      },
      target_app: {
        type: "string",
        description: "Target application name, or null if not applicable",
      },
      platform: {
        type: "string",
        description: "Target platform",
        enum: ["macos", "web", "any"],
      },
      parameters: {
        type: "object",
        description: "Action-specific parameters (key-value pairs)",
      },
      context_dependencies: {
        type: "array",
        description: "Required context before execution, e.g. 'screen-tree', 'file:/path'",
        items: { type: "string" },
      },
      entities: {
        type: "object",
        description: "Named entities extracted from command (app, file, url, person, text, command)",
      },
    },
    required: ["action", "intent_type", "confidence", "platform"],
  },
};

/** Type guard for ParsedCommand from unknown tool input */
export function isValidParsedCommand(input: unknown): input is ParsedCommand {
  if (!input || typeof input !== "object") return false;
  const obj = input as Record<string, unknown>;

  if (typeof obj.action !== "string" || !SYSTEM_ACTIONS.includes(obj.action as SystemAction)) return false;
  if (typeof obj.intent_type !== "string" || !(INTENT_TYPES as readonly string[]).includes(obj.intent_type)) return false;
  if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) return false;
  if (typeof obj.platform !== "string" || !["macos", "web", "any"].includes(obj.platform)) return false;

  return true;
}

/** Fill defaults for optional ParsedCommand fields */
export function normalizeParsedCommand(input: Record<string, unknown>): ParsedCommand {
  return {
    action: input.action as ParsedCommand["action"],
    intent_type: input.intent_type as ParsedCommand["intent_type"],
    confidence: (input.confidence as number) ?? 0.8,
    target_app: (input.target_app as string) ?? null,
    platform: (input.platform as ParsedCommand["platform"]) ?? "macos",
    parameters: (input.parameters as Record<string, string | number | boolean | null>) ?? {},
    context_dependencies: Array.isArray(input.context_dependencies) ? input.context_dependencies : [],
    entities: (input.entities as Record<string, ParsedCommand["entities"][string]>) ?? {},
  };
}

