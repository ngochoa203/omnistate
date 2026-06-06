import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateScript } from "../hybrid/automation-browser.js";
import { parseVerifyResponse } from "../vision/providers/claude.js";

function makeResponse(text: string): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-20250514",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
    },
  } as Anthropic.Message;
}

describe("product honesty guards", () => {
  it("rejects script generation without LLM when no quick action matches", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    await expect(
      generateScript("write a custom bash script that checks two random folders")
    ).rejects.toThrow(/requires an LLM or a mapped quick action/i);

    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });

  it("still allows mapped quick actions without an LLM", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const script = await generateScript("dark-mode-toggle");
    expect(script.code).not.toContain("TODO: implement");
    expect(script.code.length).toBeGreaterThan(0);

    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });

  it("does not treat plain success text as a verified state", () => {
    const result = parseVerifyResponse(makeResponse("Success, the dialog opened and everything is working."));
    expect(result.passed).toBe(false);
    expect(result.confidence).toBe(0.1);
    expect(result.description).toContain("Unstructured verification response");
  });

  it("accepts explicit verification JSON only", () => {
    const result = parseVerifyResponse(
      makeResponse('{"passed":true,"confidence":0.92,"description":"Submit button is visible"}')
    );
    expect(result).toEqual({
      passed: true,
      confidence: 0.92,
      description: "Submit button is visible",
    });
  });

  it("fails invalid verification JSON instead of guessing success", () => {
    const result = parseVerifyResponse(makeResponse('{"passed": tru'));
    expect(result.passed).toBe(false);
    expect(result.confidence).toBe(0.1);
    expect(result.description).toContain("Invalid verification JSON");
  });
});
