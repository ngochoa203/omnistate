import { describe, it, expect } from "vitest";

import {
  requestApproval,
  approveRequest,
  rejectRequest,
  getPendingApprovals,
} from "../vision/approval-center.js";

describe("ApprovalCenter", () => {
  it("queues a pending approval", () => {
    const promise = requestApproval({ intent: `test-queue-${Date.now()}`, risk: "low", context: "ctx", userId: "u1" });
    const pending = getPendingApprovals();
    const found = pending.find((p) => p.intent.startsWith("test-queue-"));
    expect(found).toBeTruthy();
    // Clean up
    if (found) rejectRequest(found.id);
    return promise.then((r) => expect(r.approved).toBe(false));
  });

  it("approves a request and resolves promise", async () => {
    const intent = `approve-test-${Date.now()}`;
    const promise = requestApproval({ intent, risk: "medium", context: "ctx", userId: "u2" });
    const item = getPendingApprovals().find((p) => p.intent === intent);
    expect(item).toBeTruthy();
    approveRequest(item!.id);
    const result = await promise;
    expect(result.approved).toBe(true);
    expect(result.autoApproved).toBe(false);
  });

  it("rejects a request and resolves promise", async () => {
    const intent = `reject-test-${Date.now()}`;
    const promise = requestApproval({ intent, risk: "high", context: "ctx", userId: "u3" });
    const item = getPendingApprovals().find((p) => p.intent === intent);
    rejectRequest(item!.id);
    const result = await promise;
    expect(result.approved).toBe(false);
  });

  it("times out after specified duration", async () => {
    const result = await requestApproval({
      intent: `timeout-test-${Date.now()}`,
      risk: "low",
      context: "will timeout",
      userId: "u4",
      timeoutMs: 80,
    });
    expect(result.approved).toBe(false);
    expect(result.autoApproved).toBe(false);
  }, 3000);

  it("auto-approves after reaching threshold (3 manual approvals)", async () => {
    const userId = `whitelist-user-${Date.now()}`;
    const intent = `whitelist-intent-${Date.now()}`;

    for (let i = 0; i < 3; i++) {
      const p = requestApproval({ intent, risk: "low", context: "ctx", userId });
      const item = getPendingApprovals().find((x) => x.intent === intent && x.userId === userId);
      if (item) approveRequest(item.id);
      await p;
    }

    const result = await requestApproval({ intent, risk: "low", context: "ctx", userId });
    expect(result.approved).toBe(true);
    expect(result.autoApproved).toBe(true);
  }, 10000);
});
