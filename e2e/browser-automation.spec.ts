/**
 * Phase 4.2 - Browser Automation E2E Tests
 *
 * Tests for Safari/Chrome browser automation including YouTube multi-step commands.
 * These tests require a running macOS system with the gateway server.
 *
 * To run:
 *   pnpm test:e2e
 *
 * Prerequisites:
 *   - Gateway server running on ws://127.0.0.1:19800 (default)
 *     Override: set OMNISTATE_E2E_WS_PORT env var
 *   - Alternatively: node scripts/dev/e2e-setup.mjs (auto-starts gateway)
 *   - Safari or Chrome installed on macOS
 *   - Automation permissions granted to Terminal in System Settings
 *
 * Gateway/web not running: tests skip gracefully with a clear message.
 * Fix: run pnpm app:run:all OR node scripts/dev/e2e-setup.mjs
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Helper: Connect to gateway WebSocket
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile);

interface GatewayMessage {
  type: string;
  taskId?: string;
  goal?: string;
  result?: unknown;
  message?: string;
  step?: number;
  status?: string;
  data?: unknown;
  verification?: VerificationResult;
  contractRef?: TaskCapabilityRef;
}

interface VerificationEvidence {
  type: string;
  summary: string;
  details?: Record<string, unknown>;
}

interface VerificationResult {
  status: "verified" | "unverified" | "contradicted" | "unsupported";
  confidence: number;
  verifier: string;
  evidence: VerificationEvidence[];
  summary?: string;
  timestamp: string;
}

interface TaskCapabilityRef {
  capabilityId: string;
  tool?: string;
  status?: "implemented" | "experimental" | "unsupported" | "flagged";
}

interface TaskCompleteResult {
  goal: string;
  mode: string;
  stepsCompleted: number;
  intentType: string;
  confidence: number;
  output?: string;
  stepData: Array<Record<string, unknown>>;
  claimStatus?: "verified" | "unverified" | "unsupported";
  verificationSummary?: VerificationResult;
  capabilities?: TaskCapabilityRef[];
}

async function runGatewayTask(goal: string): Promise<GatewayMessage[]> {
  return new Promise((resolve, reject) => {
    const wsPort = process.env.OMNISTATE_E2E_WS_PORT ?? "19800";
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    const messages: GatewayMessage[] = [];
    let taskId: string | undefined;

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for gateway task completion: ${goal}`));
    }, 90_000);

    const cleanup = () => {
      clearTimeout(timeout);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("open", onOpen);
      try { ws.close(); } catch { /* ignore */ }
    };

    const onOpen = () => {
      ws.send(JSON.stringify({ type: "task", goal }));
    };

    const onError = () => {
      cleanup();
      reject(new Error(`Gateway WebSocket connection failed for goal: ${goal}`));
    };

    const onMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as GatewayMessage;
        if (msg.type === "task.accepted" && msg.goal === goal && msg.taskId) {
          taskId = msg.taskId;
          messages.push(msg);
          return;
        }

        if (taskId && msg.taskId === taskId) {
          messages.push(msg);
          if (msg.type === "task.complete") {
            cleanup();
            resolve(messages);
            return;
          }
          if (msg.type === "error") {
            cleanup();
            reject(new Error(msg.message ?? `Gateway task failed: ${goal}`));
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onError);
    ws.addEventListener("message", onMessage);
  });
}

async function isProcessRunning(name: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-x", name]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function getCompletedMessage(messages: GatewayMessage[]): GatewayMessage & { result: TaskCompleteResult } {
  const completed = messages.find((msg) => msg.type === "task.complete");
  expect(completed, "expected task.complete message").toBeDefined();
  expect(completed?.result, "expected typed task.complete result").toBeDefined();
  return completed as GatewayMessage & { result: TaskCompleteResult };
}

function getTaskVerifyMessages(messages: GatewayMessage[]): GatewayMessage[] {
  return messages.filter((msg) => msg.type === "task.verify");
}

function expectVerificationAwareCompletion(
  messages: GatewayMessage[],
  expectedCapabilityIds: string[],
): TaskCompleteResult {
  const completed = getCompletedMessage(messages);
  const capabilityIds = completed.result.capabilities?.map((capability) => capability.capabilityId) ?? [];
  const verifyMessages = getTaskVerifyMessages(messages);

  expect(completed.result.claimStatus).toBeDefined();
  expect(completed.result.verificationSummary).toBeDefined();
  expect(completed.result.verificationSummary?.evidence.length ?? 0).toBeGreaterThan(0);
  expect(verifyMessages.length).toBeGreaterThan(0);
  expect(
    verifyMessages.some((msg) => msg.result === "pass"),
    `expected at least one task.verify pass event; saw ${verifyMessages.map((msg) => String(msg.result)).join(", ")}`,
  ).toBe(true);
  expect(
    expectedCapabilityIds.some((capabilityId) => capabilityIds.includes(capabilityId)),
    `expected one of capabilities ${expectedCapabilityIds.join(", ")}; got ${capabilityIds.join(", ")}`,
  ).toBe(true);

  return completed.result;
}

// ---------------------------------------------------------------------------
// Test: Open Safari + YouTube on new tab
// ---------------------------------------------------------------------------

test.describe("Safari/YouTube Browser Automation", () => {
  test.beforeEach(() => {
    // Skip if not on macOS
    test.skip(
      process.platform !== "darwin",
      "Browser automation tests only run on macOS"
    );
  });

  test("opens Safari through the gateway task pipeline", async () => {
    const messages = await runGatewayTask("open Safari");
    const result = expectVerificationAwareCompletion(messages, ["app.launch"]);
    expect(result.intentType).toBe("app-launch");
    expect(result.claimStatus).not.toBe("unsupported");
    expect(result.verificationSummary?.status).not.toBe("contradicted");
    expect(await isProcessRunning("Safari")).toBe(true);
  });

  test("opens a URL in Safari through the gateway task pipeline", async () => {
    const messages = await runGatewayTask("in Safari, open https://www.youtube.com");
    const result = expectVerificationAwareCompletion(messages, ["app.launch", "browser.open", "app.script"]);
    expect(result.stepsCompleted).toBeGreaterThanOrEqual(2);
    expect(result.intentType).toBe("app-control");
    expect(result.verificationSummary?.status).not.toBe("contradicted");
    expect(await isProcessRunning("Safari")).toBe(true);
  });

  test("handles special characters in browser goals without AppleScript parse errors", async () => {
    const goals = [
      'in Safari, open https://example.com/path?param=value',
      'in Safari, open https://example.com/results?search_query=test+with+quotes',
      'in Safari, open https://example.com?q=test%22quote',
    ];

    for (const goal of goals) {
      const messages = await runGatewayTask(goal);
      const result = expectVerificationAwareCompletion(messages, ["app.launch", "browser.open", "app.script"]);
      expect(result.output ?? "").not.toContain("-2741");
    }
  });

  test.setTimeout(120_000);

  test("opens the first YouTube result through the real gateway task flow", async () => {
    // Uses an existing planner phrase: Vietnamese search ("tìm" = search) +
    // "mở kết quả đầu tiên" (open first result) via Safari.
    // Exercises: classify → plan → execute → verify → task.complete.
    //
    // Honest assertions — if the pipeline cannot yet prove verification,
    // the test surfaces that rather than weakening.
    const goal = "tìm video React rồi mở kết quả đầu tiên";
    const messages = await runGatewayTask(goal);

    // ── Gateway responded with task.complete ───────────────────────────────
    const completed = getCompletedMessage(messages);
    const completedTyped = completed as GatewayMessage & { result: TaskCompleteResult };

    // claimStatus and verificationSummary must be present so callers can
    // distinguish verified vs unverified outcomes without guessing.
    expect(completed.result.claimStatus).toBeDefined();
    expect(completed.result.verificationSummary).toBeDefined();

    const verifyMessages = getTaskVerifyMessages(messages);
    expect(verifyMessages.length, "expected at least one task.verify event").toBeGreaterThan(0);

    const passEvents = verifyMessages.filter((msg) => {
      // task.verify result field: "pass" | "fail" | "ambiguous"
      const r = (msg as { result?: string }).result;
      return r === "pass";
    });
    expect(
      passEvents.length,
      `expected at least one task.verify pass; got: ${verifyMessages.map((m) => (m as { result?: string }).result).join(", ")}`,
    ).toBeGreaterThan(0);

    // intentType must be a known value; "multi-step" is not a real intent type
    // in this codebase — the real types are "app-control", "app-launch", etc.
    const validIntentTypes = ["app-control", "app-launch", "browser-control", "command", "task", "multi-step"];
    expect(
      validIntentTypes.includes(completed.result.intentType),
      `intentType must be one of ${validIntentTypes.join(", ")}; got "${completed.result.intentType}"`,
    ).toBe(true);

    // "unsupported" claimStatus means the planner could not route the phrase —
    // this is a legitimate failure to expose, not suppress.
    expect(completed.result.claimStatus, "planner should route this phrase, not mark unsupported").not.toBe("unsupported");

    // At least one capability must be advertised to prove the pipeline ran.
    const capabilityIds = completed.result.capabilities?.map((c) => c.capabilityId) ?? [];
    expect(capabilityIds.length, `expected at least one capability; got: ${capabilityIds.join(", ")}`).toBeGreaterThan(0);

    // ── watch-url evidence ─────────────────────────────────────────────────
    const watchUrlPattern = /youtube\.com\/watch\?v=/;
    const evidence = completedTyped.result.verificationSummary?.evidence ?? [];
    const browserEvidence = evidence.find((item) => item.type === "window-state");
    const actualUrl = typeof browserEvidence?.details?.actualUrl === "string"
      ? browserEvidence.details.actualUrl
      : null;

    expect(
      actualUrl,
      `Expected browser-state verification to surface the active watch URL.\n` +
        `Evidence: ${JSON.stringify(evidence)}`,
    ).not.toBeNull();
    expect(actualUrl!.toLowerCase()).toMatch(watchUrlPattern);
  });
});

// ---------------------------------------------------------------------------
// Regression: AppleScript escaping bug (-2741)
// ---------------------------------------------------------------------------

test.describe("AppleScript Escaping Regression", () => {
  test("temp file approach avoids -2741 error with complex scripts", async () => {
    const goals = [
      "in Safari, open https://youtube.com",
      "in Safari, open https://example.com?q=test%22quote",
      "in Safari, open https://example.com?q=test%5Cbackslash",
    ];

    for (const goal of goals) {
      const messages = await runGatewayTask(goal);
      const result = expectVerificationAwareCompletion(messages, ["app.launch", "browser.open", "app.script"]);
      expect(result.output ?? "").not.toContain("-2741");
    }
  });
});
