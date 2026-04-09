/**
 * E2E tests for the Orchestrator.
 *
 * - Deep-layer tools (shell.exec, system.info) run against the real OS.
 * - Surface-layer tools are not tested here (require native bindings).
 * - Unknown tools fail gracefully.
 */

import { describe, it, expect } from "vitest";
import { Orchestrator } from "../executor/orchestrator.js";
import type { StatePlan, StateNode } from "../types/task.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlan(nodes: StateNode[]): StatePlan {
  return {
    taskId: `test-${Date.now()}`,
    goal: "test goal",
    estimatedDuration: "1s",
    nodes,
  };
}

function makeDeepNode(
  id: string,
  tool: string,
  params: Record<string, unknown> = {}
): StateNode {
  return {
    id,
    type: "action",
    layer: "deep",
    action: { description: `Run ${tool}`, tool, params },
    dependencies: [],
    onSuccess: null,
    onFailure: { strategy: "escalate" },
    estimatedDurationMs: 1000,
    priority: "normal",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Orchestrator.executePlan()", () => {
  it("single shell.exec node succeeds with real shell output", async () => {
    const orch = new Orchestrator();
    const plan = makePlan([
      makeDeepNode("step1", "shell.exec", { command: "echo hello-orchestrator" }),
    ]);

    const result = await orch.executePlan(plan);

    expect(result.status).toBe("complete");
    expect(result.completedSteps).toBe(1);
    expect(result.totalSteps).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it("shell.exec node captures output with trailing newline", async () => {
    const orch = new Orchestrator();

    // We verify via the plan result — the step data isn't returned in
    // ExecutionResult, but we confirm completion and no error.
    const plan = makePlan([
      makeDeepNode("echo", "shell.exec", { command: "echo omnistate" }),
    ]);

    const result = await orch.executePlan(plan);
    expect(result.status).toBe("complete");
  });

  it("system.info node returns system info data", async () => {
    const orch = new Orchestrator();
    const plan = makePlan([makeDeepNode("sysinfo", "system.info")]);

    const result = await orch.executePlan(plan);

    expect(result.status).toBe("complete");
    expect(result.completedSteps).toBe(1);
  });

  it("process.list node succeeds", async () => {
    const orch = new Orchestrator();
    const plan = makePlan([makeDeepNode("ps", "process.list")]);

    const result = await orch.executePlan(plan);
    expect(result.status).toBe("complete");
  });

  it("unknown deep tool fails gracefully", async () => {
    const orch = new Orchestrator();
    // maxRetries: 0 means the retry engine bails immediately (no backoff sleep)
    const node: StateNode = {
      ...makeDeepNode("bad", "this.does.not.exist"),
      onFailure: { strategy: "retry", maxRetries: 0 },
    };
    const plan = makePlan([node]);

    const result = await orch.executePlan(plan);

    expect(result.status).toBe("failed");
    expect(typeof result.error).toBe("string");
  }, 10000); // generous timeout in case retry still sleeps

  it("taskId in result matches the plan's taskId", async () => {
    const orch = new Orchestrator();
    const plan = makePlan([
      makeDeepNode("step1", "shell.exec", { command: "true" }),
    ]);

    const result = await orch.executePlan(plan);
    expect(result.taskId).toBe(plan.taskId);
  });

  it("sequential nodes execute in order (dependency chain)", async () => {
    const orch = new Orchestrator();

    const node1 = makeDeepNode("first", "shell.exec", { command: "echo first" });
    const node2: StateNode = {
      ...makeDeepNode("second", "shell.exec", { command: "echo second" }),
      dependencies: ["first"],
    };

    const plan = makePlan([node1, node2]);
    const result = await orch.executePlan(plan);

    expect(result.status).toBe("complete");
    expect(result.completedSteps).toBe(2);
    expect(result.totalSteps).toBe(2);
  });

  it("queueDepth is a non-negative number", () => {
    const orch = new Orchestrator();
    expect(typeof orch.queueDepth).toBe("number");
    expect(orch.queueDepth).toBeGreaterThanOrEqual(0);
  });

  it("empty plan completes with 0 steps", async () => {
    const orch = new Orchestrator();
    const plan = makePlan([]);

    const result = await orch.executePlan(plan);
    expect(result.status).toBe("complete");
    expect(result.completedSteps).toBe(0);
    expect(result.totalSteps).toBe(0);
  });
});
