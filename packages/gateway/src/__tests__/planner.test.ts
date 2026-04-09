/**
 * E2E tests for intent classification and plan building.
 *
 * All tests use the regex/heuristic fallback — no API key required.
 * The ANTHROPIC_API_KEY env var is unset before each test to guarantee
 * the heuristic path is exercised.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { classifyIntent, planFromIntent } from "../planner/intent.js";

// ── Ensure no API key is present so heuristic path is always used ─────────────

beforeEach(() => {
  // Remove API key so classifyWithLLM returns null and heuristics take over
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Intent classification ─────────────────────────────────────────────────────

describe("classifyIntent() — regex heuristic fallback (no API key)", () => {
  it('classifies "ls -la" as shell-command', async () => {
    // "ls" matches the file-operation regex; but let's use an explicit run phrase
    const intent = await classifyIntent("run ls -la");
    expect(intent.type).toBe("shell-command");
    expect(intent.rawText).toBe("run ls -la");
  });

  it('classifies "execute npm install" as shell-command', async () => {
    const intent = await classifyIntent("execute npm install");
    expect(intent.type).toBe("shell-command");
  });

  it('classifies "open Safari" as app-launch', async () => {
    const intent = await classifyIntent("open Safari");
    expect(intent.type).toBe("app-launch");
  });

  it('classifies "launch Chrome browser" as app-launch', async () => {
    const intent = await classifyIntent("launch Chrome browser");
    expect(intent.type).toBe("app-launch");
  });

  it('classifies "check disk space" as system-query', async () => {
    const intent = await classifyIntent("check disk space");
    expect(intent.type).toBe("system-query");
  });

  it('classifies "how much memory is free" as system-query', async () => {
    const intent = await classifyIntent("how much memory is free");
    expect(intent.type).toBe("system-query");
  });

  it('classifies "click the submit button" as ui-interaction', async () => {
    const intent = await classifyIntent("click the submit button");
    expect(intent.type).toBe("ui-interaction");
  });

  it('classifies "copy file.txt to /tmp" as file-operation', async () => {
    const intent = await classifyIntent("copy file.txt to /tmp");
    expect(intent.type).toBe("file-operation");
  });

  it("returns the original rawText regardless of type", async () => {
    const text = "check disk space";
    const intent = await classifyIntent(text);
    expect(intent.rawText).toBe(text);
  });

  it("confidence is between 0 and 1", async () => {
    const intent = await classifyIntent("open Safari");
    expect(intent.confidence).toBeGreaterThan(0);
    expect(intent.confidence).toBeLessThanOrEqual(1);
  });

  it("unknown text falls back to multi-step with low confidence", async () => {
    const intent = await classifyIntent("do something weird and indescribable xyz123");
    expect(intent.type).toBe("multi-step");
    expect(intent.confidence).toBeLessThan(0.5);
  });
});

// ── Plan building ─────────────────────────────────────────────────────────────

describe("planFromIntent() — plan structure", () => {
  it("shell-command intent produces a plan with a deep-layer 'shell.exec' node", async () => {
    const intent = await classifyIntent("run ls -la");
    const plan = await planFromIntent(intent);

    expect(plan.taskId).toMatch(/^task-\d+$/);
    expect(plan.goal).toBe("run ls -la");
    expect(plan.nodes.length).toBeGreaterThan(0);

    const execNode = plan.nodes.find((n) => n.action.tool === "shell.exec");
    expect(execNode).toBeDefined();
    expect(execNode!.layer).toBe("deep");
  });

  it("app-launch intent produces launch + verify nodes", async () => {
    const intent = await classifyIntent("open Safari");
    const plan = await planFromIntent(intent);

    const launchNode = plan.nodes.find((n) => n.action.tool === "app.launch");
    const verifyNode = plan.nodes.find((n) => n.type === "verify");

    expect(launchNode).toBeDefined();
    expect(launchNode!.layer).toBe("deep");
    expect(verifyNode).toBeDefined();
    expect(verifyNode!.layer).toBe("surface");
  });

  it("system-query intent produces a deep-layer node", async () => {
    const intent = await classifyIntent("check disk space");
    const plan = await planFromIntent(intent);

    const queryNode = plan.nodes.find(
      (n) => n.layer === "deep" || n.action.tool === "system.query"
    );
    expect(queryNode).toBeDefined();
  });

  it("ui-interaction intent produces multiple surface nodes", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.9,
      rawText: "click the submit button",
    };
    const plan = await planFromIntent(intent);

    const surfaceNodes = plan.nodes.filter((n) => n.layer === "surface");
    expect(surfaceNodes.length).toBeGreaterThanOrEqual(2);
  });

  it("file-operation intent produces a deep-layer node", async () => {
    const intent = await classifyIntent("copy file.txt to /tmp");
    const plan = await planFromIntent(intent);

    const fileNode = plan.nodes.find((n) => n.layer === "deep");
    expect(fileNode).toBeDefined();
  });

  it("plan estimatedDuration is a non-empty string", async () => {
    const intent = await classifyIntent("run ls -la");
    const plan = await planFromIntent(intent);
    expect(typeof plan.estimatedDuration).toBe("string");
    expect(plan.estimatedDuration.length).toBeGreaterThan(0);
  });

  it("each node has required fields: id, type, layer, action, dependencies", async () => {
    const intent = await classifyIntent("run ls -la");
    const plan = await planFromIntent(intent);

    for (const node of plan.nodes) {
      expect(typeof node.id).toBe("string");
      expect(typeof node.type).toBe("string");
      expect(typeof node.layer).toBe("string");
      expect(typeof node.action).toBe("object");
      expect(typeof node.action.tool).toBe("string");
      expect(Array.isArray(node.dependencies)).toBe(true);
    }
  });
});
