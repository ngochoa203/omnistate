/**
 * Regression tests for unsupported-path guards and shell-first behavior.
 *
 * Coverage:
 * 1. Unsupported tool paths in mapIntentToTool return unsupported nodes (not shell.exec).
 * 2. Planning fallbacks return unsupported nodes for unrecognized commands.
 * 3. app-control fallback returns unsupported.capability (not generic.execute).
 * 4. Vision parseVerifyResponse rejects plain-text responses (product-honesty guard).
 * 5. generateScript product-honesty guard still works (regression).
 */

import { describe, expect, it, vi } from "vitest";
import type { Intent } from "../planner/types.js";

// ── Mock LLM router ───────────────────────────────────────────────────────────

// Mock at module level — no hoisting needed for vi.mock return value
vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({
    text: '{"type":"shell-command"}',
  }),
}));

import {
  mapIntentToTool,
} from "../planner/app-control.js";

// ── Intent factory ────────────────────────────────────────────────────────────

function makeIntent(type: string, rawText: string): Intent {
  return {
    type,
    entities: {},
    confidence: 0.9,
    rawText,
    normalizedText: rawText.toLowerCase(),
    is_valid: true,
  };
}

// ============================================================================
// Part 1: Unsupported tool map in app-control.ts mapIntentToTool
// ============================================================================

describe("unsupported-tool guards in app-control.ts mapIntentToTool", () => {
  it("workflow-template returns unsupported flag", () => {
    const intent = makeIntent("workflow-template", "show workflow templates");
    const result = mapIntentToTool(intent);
    expect(result).not.toBeNull();
    expect(result!.unsupported).toBe(true);
    expect(result!.name).toBe("hybrid.templates");
  });

  it("compliance-check returns unsupported flag", () => {
    const intent = makeIntent("compliance-check", "run compliance check");
    const result = mapIntentToTool(intent);
    expect(result).not.toBeNull();
    expect(result!.unsupported).toBe(true);
    expect(result!.name).toBe("hybrid.compliance");
  });

  it("resource-forecast returns unsupported flag", () => {
    const intent = makeIntent("resource-forecast", "forecast disk usage for next week");
    const result = mapIntentToTool(intent);
    expect(result).not.toBeNull();
    expect(result!.unsupported).toBe(true);
    expect(result!.name).toBe("hybrid.forecast");
  });

  it("multi-app-orchestration returns unsupported flag", () => {
    const intent = makeIntent("multi-app-orchestration", "suggest next app action");
    const result = mapIntentToTool(intent);
    expect(result).not.toBeNull();
    expect(result!.unsupported).toBe(true);
    expect(result!.name).toBe("hybrid.suggestAction");
  });

  // Supported tools should NOT have unsupported flag
  it("network-control does NOT set unsupported flag", () => {
    const intent = makeIntent("network-control", "turn on wifi");
    const result = mapIntentToTool(intent);
    expect(result).not.toBeNull();
    expect(result!.unsupported).toBeUndefined();
    expect(result!.name).toBe("shell.exec");
  });

  it("process-management does NOT set unsupported flag", () => {
    const intent = makeIntent("process-management", "kill process 12345");
    const result = mapIntentToTool(intent);
    expect(result).not.toBeNull();
    expect(result!.unsupported).toBeUndefined();
    expect(result!.name).toBe("shell.exec");
  });

  it("iokit-hardware returns null (no handler)", () => {
    const intent = makeIntent("iokit-hardware", "read IOKit sensor data");
    const result = mapIntentToTool(intent);
    expect(result).toBeNull();
  });
});

// planning.ts mapIntentToTool is not exported — verify unsupported guards via planFromIntent output.

// ============================================================================
// Part 2: Unsupported tool produces unsupported.capability node in plan
// (Covers both planning.ts and app-control.ts mapIntentToTool with unsupported flag)

describe("unsupported tool produces unsupported.capability node in plan", () => {
  it("workflow-template plan uses tool=unsupported.capability", async () => {
    const intent = makeIntent("workflow-template", "show workflow templates");
    const { planFromIntent } = await import("../planner/planning.js");
    const plan = await planFromIntent(intent);
    expect(plan.nodes.length).toBeGreaterThan(0);
    const node = plan.nodes[0];
    expect(node.action?.tool).toBe("unsupported.capability");
  });

  it("compliance-check plan uses tool=unsupported.capability", async () => {
    const intent = makeIntent("compliance-check", "run compliance check");
    const { planFromIntent } = await import("../planner/planning.js");
    const plan = await planFromIntent(intent);
    expect(plan.nodes[0].action?.tool).toBe("unsupported.capability");
  });

  it("resource-forecast plan uses tool=unsupported.capability", async () => {
    const intent = makeIntent("resource-forecast", "forecast disk usage");
    const { planFromIntent } = await import("../planner/planning.js");
    const plan = await planFromIntent(intent);
    expect(plan.nodes[0].action?.tool).toBe("unsupported.capability");
  });

  it("multi-app-orchestration plan uses tool=unsupported.capability", async () => {
    const intent = makeIntent("multi-app-orchestration", "orchestrate across apps");
    const { planFromIntent } = await import("../planner/planning.js");
    const plan = await planFromIntent(intent);
    expect(plan.nodes[0].action?.tool).toBe("unsupported.capability");
  });

  it("unsupported node includes unsupportedReason in params", async () => {
    const intent = makeIntent("workflow-template", "show workflow templates");
    const { planFromIntent } = await import("../planner/planning.js");
    const plan = await planFromIntent(intent);
    const node = plan.nodes[0];
    const params = node.action?.params as Record<string, unknown>;
    expect(params).toBeDefined();
    expect(params?.unsupportedReason).toBeDefined();
    expect(params?.unsupportedReason as string).toContain("implemented");
  });
});

// ============================================================================
// Part 4: Supported shell.exec paths still work
// ============================================================================

describe("supported shell.exec paths still work", () => {
  it("process-management kill uses shell.exec", async () => {
    const intent = makeIntent("process-management", "kill process 12345");
    const { planFromIntent } = await import("../planner/planning.js");
    const plan = await planFromIntent(intent);
    expect(plan.nodes[0].action?.tool).toBe("shell.exec");
    expect((plan.nodes[0].action?.params as Record<string, unknown>)?.command as string).toContain("kill");
  });

  it("network-control wifi off uses shell.exec", async () => {
    const intent = makeIntent("network-control", "turn off wifi");
    const { planFromIntent } = await import("../planner/planning.js");
    const plan = await planFromIntent(intent);
    expect(plan.nodes[0].action?.tool).toBe("shell.exec");
    expect((plan.nodes[0].action?.params as Record<string, unknown>)?.command as string).toContain("networksetup");
  });

  it("shell-command routes to shell.exec", async () => {
    const intent = makeIntent("shell-command", "ls -la");
    const { planFromIntent } = await import("../planner/planning.js");
    const plan = await planFromIntent(intent);
    expect(plan.nodes[0].action?.tool).toBe("shell.exec");
    expect((plan.nodes[0].action?.params as Record<string, unknown>)?.command as string).toBe("ls -la");
  });
});

// ============================================================================
// Part 5: Vision parseVerifyResponse plain-text rejection (product-honesty)
// ============================================================================

describe("vision parseVerifyResponse plain-text rejection (product-honesty)", () => {
  it("rejects plain success text as not passed", async () => {
    const { parseVerifyResponse } = await import("../vision/providers/claude.js");
    const result = parseVerifyResponse({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-20250514",
      content: [{ type: "text", text: "Success, the button is visible and clickable." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    } as any);
    expect(result.passed).toBe(false);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("rejects natural language confirmation without JSON", async () => {
    const { parseVerifyResponse } = await import("../vision/providers/claude.js");
    const result = parseVerifyResponse({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-20250514",
      content: [{ type: "text", text: "Yes, the app window is open and the submit button is visible on screen." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    } as any);
    expect(result.passed).toBe(false);
  });

  it("accepts structured JSON verification only", async () => {
    const { parseVerifyResponse } = await import("../vision/providers/claude.js");
    const result = parseVerifyResponse({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-20250514",
      content: [{ type: "text", text: '{"passed":true,"confidence":0.95,"description":"Submit button visible"}' }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    } as any);
    expect(result.passed).toBe(true);
    expect(result.confidence).toBeCloseTo(0.95);
    expect(result.description).toContain("Submit button");
  });

  it("rejects malformed JSON", async () => {
    const { parseVerifyResponse } = await import("../vision/providers/claude.js");
    const result = parseVerifyResponse({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-20250514",
      content: [{ type: "text", text: '{"passed": tru' }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    } as any);
    expect(result.passed).toBe(false);
    expect(result.description).toContain("Invalid verification JSON");
  });
});

// ============================================================================
// Part 6: generateScript product-honesty regression
// ============================================================================

describe("generateScript product-honesty regression", () => {
  it("rejects script generation without LLM and no quick-action match", async () => {
    // Save and clear API key
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const { generateScript } = await import("../hybrid/automation-browser.js");
    await expect(
      generateScript("write a custom script that formats the hard drive")
    ).rejects.toThrow(/requires an LLM or a mapped quick action/i);

    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it("still allows mapped quick actions without LLM", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const { generateScript } = await import("../hybrid/automation-browser.js");
    const script = await generateScript("dark-mode-toggle");
    expect(script.code).not.toContain("TODO: implement");
    expect(script.code.length).toBeGreaterThan(0);

    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    else delete process.env.ANTHROPIC_API_KEY;
  });
});
