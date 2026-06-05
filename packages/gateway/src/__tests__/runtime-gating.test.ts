/**
 * Runtime-gating tests.
 *
 * Validates that the orchestrator enforces policy.allowedByDefault at execution
 * time — flagged/experimental capabilities that require explicit enablement must
 * fail before execution, not after.
 *
 * Run with:
 *   pnpm --filter @omnistate/gateway test src/__tests__/runtime-gating.test.ts
 */

import { describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../executor/orchestrator.js";
import type { StatePlan, StateNode } from "../types/task.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlan(nodes: StateNode[]): StatePlan {
  return {
    taskId: `runtime-gate-test-${Date.now()}`,
    goal: "runtime-gating validation",
    estimatedDuration: "1s",
    nodes,
  };
}

function makeDeepNode(id: string, tool: string, params: Record<string, unknown> = {}): StateNode {
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

describe("runtime policy gate", () => {
  it("shell.exec (flagged, allowedByDefault=false) fails before execution", async () => {
    const orch = new Orchestrator();
    const plan = makePlan([
      makeDeepNode("step1", "shell.exec", { command: "echo this-should-not-run" }),
    ]);

    const result = await orch.executePlan(plan);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("flagged and blocked by default");
    expect(result.error).toContain("shell.exec");
    expect(result.completedSteps).toBe(0);
  });

  it("kernel.sysctl.set (flagged, allowedByDefault=false) fails before execution", async () => {
    const orch = new Orchestrator();
    const plan = makePlan([
      makeDeepNode("sysctl", "kernel.sysctl.set", { key: "net.inet.tcp.sack", value: "1" }),
    ]);

    const result = await orch.executePlan(plan);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("flagged and blocked by default");
    expect(result.error).toContain("kernel.sysctl.set");
    expect(result.completedSteps).toBe(0);
  });

  it("wifi.capture.handshake (flagged, allowedByDefault=false) fails before execution", async () => {
    const orch = new Orchestrator();
    const plan = makePlan([
      makeDeepNode("wifi-handshake", "wifi.capture.handshake", {
        bssid: "AA:BB:CC:DD:EE:FF",
        channel: 6,
        outputFile: "/tmp/handshake.cap",
      }),
    ]);

    const result = await orch.executePlan(plan);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("flagged and blocked by default");
    expect(result.error).toContain("wifi.capture.handshake");
    expect(result.completedSteps).toBe(0);
  });

  it("wifi.tools.install (flagged, allowedByDefault=false) fails before execution", async () => {
    const orch = new Orchestrator();
    const plan = makePlan([
      makeDeepNode("wifi-tools", "wifi.tools.install", { tools: ["aircrack-ng"] }),
    ]);

    const result = await orch.executePlan(plan);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("flagged and blocked by default");
    expect(result.error).toContain("wifi.tools.install");
    expect(result.completedSteps).toBe(0);
  });

  it("verify.* tools bypass the runtime gate (no policy denial)", async () => {
    // verify.screenshot is experimental/allowedByDefault=false but verify.*
    // must pass through to verifyStep() unchanged — no policy denial error.
    const orch = new Orchestrator();
    const plan = makePlan([
      {
        id: "v-step",
        type: "verify",
        layer: "surface",
        action: { description: "verify", tool: "verify.screenshot", params: { expected: "loaded" } },
        verify: { strategy: "screenshot", expected: "loaded", timeoutMs: 100 },
        dependencies: [],
        onSuccess: null,
        onFailure: { strategy: "abort" },
        estimatedDurationMs: 100,
        priority: "normal",
      },
    ]);

    const result = await orch.executePlan(plan);

    // Should NOT produce a "flagged and blocked by default" error — verify.* bypasses the gate
    expect(result.error).toBeFalsy();
  });

  it("unsupported.capability bypasses the runtime gate", async () => {
    const orch = new Orchestrator();
    // unsupported.capability has status=unsupported — bypasses the gate and
    // is handled by the orchestrator's own unsupported handler.
    const plan = makePlan([
      makeDeepNode("unsupported-step", "unsupported.capability", {
        unsupportedReason: "some unimplemented capability",
      }),
    ]);

    const result = await orch.executePlan(plan);

    // unsupported.capability must not trigger a policy-denial gate error.
    // The orchestrator handles it with its own unsupported handler.
    expect(result.error).toBeFalsy();
  });

  it("iokit.thermals (read-only, allowedByDefault=true) passes the runtime gate", async () => {
    const orch = new Orchestrator() as any;

    // Mock the iokit layer so it doesn't require native bindings
    orch.iokit = {
      getThermals: vi.fn().mockResolvedValue({ cpuTemp: 45, gpuTemp: 38 }),
      isAvailable: vi.fn().mockReturnValue(true),
    };

    const plan = makePlan([makeDeepNode("thermals", "iokit.thermals")]);

    const result = await orch.executePlan(plan);

    // Should pass the runtime gate — no flagged/blocked error
    expect(result.error).toBeUndefined();
  });

  it("system.info (implemented, allowedByDefault=true) passes the runtime gate", async () => {
    const orch = new Orchestrator();
    // system.info is implemented with allowedByDefault=true in contracts
    const plan = makePlan([makeDeepNode("sysinfo", "system.info")]);

    const result = await orch.executePlan(plan);

    // Should pass the runtime gate — allowedByDefault=true tools are not blocked
    expect(result.error).toBeUndefined();
  });
});