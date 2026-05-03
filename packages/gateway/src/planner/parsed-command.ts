/**
 * Structured command output from tool-use intent classification.
 */

// Re-export IntentType from intent.ts would create circular dep — define inline
const INTENT_TYPES = [
  "shell-command", "app-launch", "app-control", "file-operation", "ui-interaction",
  "system-query", "multi-step", "process-management", "service-management",
  "package-management", "network-control", "os-config", "power-management",
  "hardware-control", "security-management", "peripheral-management",
  "container-management", "display-audio", "backup-restore", "update-management",
  // Extended granular hardware/media types
  "audio-management", "display-management", "thermal-management", "disk-management",
  "memory-management", "clipboard-management", "font-locale-management",
  "printer-management", "user-acl-management",
  "health-check", "disk-cleanup", "network-diagnose", "security-scan", "self-healing",
  "voice-control", "script-generation", "automation-macro", "workflow-template",
  "file-organization", "debug-assist", "compliance-check", "resource-forecast",
  "multi-app-orchestration",
] as const;

export type IntentType = (typeof INTENT_TYPES)[number];
export { INTENT_TYPES };

export type SystemAction =
  | "launch" | "close" | "quit" | "stop" | "focus"
  | "play" | "pause" | "mute" | "unmute"
  | "refresh" | "navigate" | "new-tab" | "close-tab"
  | "screenshot" | "type" | "click" | "scroll" | "drag" | "key"
  | "shell" | "file-read" | "file-write"
  | "system-query" | "send-email" | "send-message" | "generic";

export const SYSTEM_ACTIONS: SystemAction[] = [
  "launch", "close", "quit", "stop", "focus",
  "play", "pause", "mute", "unmute",
  "refresh", "navigate", "new-tab", "close-tab",
  "screenshot", "type", "click", "scroll", "drag", "key",
  "shell", "file-read", "file-write",
  "system-query", "send-email", "send-message", "generic",
];

export interface EntityInfo {
  type: "file" | "app" | "url" | "person" | "text" | "command";
  value: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedCommand {
  action: SystemAction;
  intent_type: IntentType;
  confidence: number;
  target_app: string | null;
  platform: "macos" | "web" | "any";
  parameters: Record<string, string | number | boolean | null>;
  context_dependencies: string[];  // e.g. "screen-tree", "file:/path/to/file"
  entities: Record<string, EntityInfo>;
}
