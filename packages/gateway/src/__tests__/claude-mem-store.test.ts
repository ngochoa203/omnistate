import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ClaudeMemStore } from "../session/claude-mem-store.js";

describe("ClaudeMemStore", () => {
  it("persists each session as a separate local file", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "omnistate-claude-mem-"));
    const legacyPath = join(baseDir, "legacy-session-memory.json");

    try {
      const store = new ClaudeMemStore(baseDir, legacyPath);
      const state = store.saveState({
        sharedMemorySummary: "shared",
        sharedMemoryLog: ["line-1"],
        sessionStateByConversation: {
          "conv-a": { memorySummary: "a", memoryLog: ["a1"], provider: "anthropic" },
          "conv-b": { memorySummary: "b", memoryLog: ["b1"], provider: "router9" },
        },
      });

      expect(state.payload.sessionStateByConversation["conv-a"]?.memorySummary).toBe("a");
      expect(existsSync(join(baseDir, "shared.json"))).toBe(true);
      expect(existsSync(join(baseDir, "sessions", "conv-a.json"))).toBe(true);
      expect(existsSync(join(baseDir, "sessions", "conv-b.json"))).toBe(true);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("migrates from legacy monolithic file", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "omnistate-claude-mem-migrate-"));
    const legacyPath = join(baseDir, "legacy-session-memory.json");

    try {
      writeFileSync(
        legacyPath,
        JSON.stringify(
          {
            updatedAt: "2026-04-13T00:00:00.000Z",
            payload: {
              sharedMemorySummary: "legacy",
              sharedMemoryLog: ["legacy-log"],
              sessionStateByConversation: {
                "conv-legacy": { memorySummary: "legacy-session", memoryLog: ["x"] },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const store = new ClaudeMemStore(baseDir, legacyPath);
      const loaded = store.loadState();

      expect(loaded.payload.sharedMemorySummary).toBe("legacy");
      expect(loaded.payload.sessionStateByConversation["conv-legacy"]?.memorySummary).toBe("legacy-session");
      expect(existsSync(join(baseDir, "shared.json"))).toBe(true);
      expect(existsSync(join(baseDir, "sessions", "conv-legacy.json"))).toBe(true);
      expect(existsSync(legacyPath)).toBe(false);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
