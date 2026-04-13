import { describe, expect, it } from "vitest";
import { buildClaudeMemPayloadFromState } from "./chat-store";

describe("claude-mem payload", () => {
  it("builds payload from store shape and trims logs", () => {
    const payload = buildClaudeMemPayloadFromState({
      sharedMemorySummary: "shared summary",
      sharedMemoryLog: ["line 1", " line 2 "],
      sessionStateByConversation: {
        "conv-1": {
          provider: "anthropic",
          model: "claude-haiku-4.5",
          memorySummary: "session summary",
          memoryLog: [" s1 ", "s2"],
          updatedAt: 123,
        },
      },
    });

    expect(payload.sharedMemorySummary).toBe("shared summary");
    expect(payload.sharedMemoryLog).toEqual(["line 1", "line 2"]);
    expect(payload.sessionStateByConversation["conv-1"]?.memoryLog).toEqual(["s1", "s2"]);
    expect(payload.sessionStateByConversation["conv-1"]?.provider).toBe("anthropic");
  });
});
