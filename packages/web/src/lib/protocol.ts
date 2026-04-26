/**
 * Re-export all protocol types from the canonical shared package.
 * Web-specific additions (if any) can be added below this line.
 */
export * from "@omnistate/shared";

// ─── Web-specific protocol additions ─────────────────────────────────────────

export interface ToolsListMessage {
  type: "tools.list";
}

export interface ToolsReportMessage {
  type: "tools.report";
  tools: Array<{ name: string; description: string; group: string }>;
  skills: Array<{ name: string; group: string }>;
}
