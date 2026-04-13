import { describe, expect, it } from "vitest";
import { buildMemoryEntry, buildTaskGoalWithMemory, summarizeMemory } from "./session-memory";

describe("session-memory", () => {
  it("builds contextual goal with shared and session memory", () => {
    const goal = buildTaskGoalWithMemory({
      goal: "open YouTube and show trending",
      provider: "router9",
      model: "cx/gpt-5.4",
      sharedMemorySummary: "- User likes concise output",
      sessionMemorySummary: "- Last task checked browser health",
    });

    expect(goal).toContain("open YouTube and show trending");
    expect(goal).toContain("provider=router9");
    expect(goal).toContain("Shared memory");
    expect(goal).toContain("Session memory");
  });

  it("creates compact memory entry", () => {
    const entry = buildMemoryEntry("Check disk usage and clean tmp files", "Disk at 70%, removed 120MB temp data");
    expect(entry).toContain("U:");
    expect(entry).toContain("A:");
    expect(entry.length).toBeLessThanOrEqual(320);
  });

  it("summarizes memory and keeps recent lines when long", () => {
    let summary = "";
    for (let i = 0; i < 20; i += 1) {
      summary = summarizeMemory(summary, `entry-${i}`);
    }

    expect(summary).toContain("entry-19");
    expect(summary.length).toBeLessThanOrEqual(1600);
  });
});
