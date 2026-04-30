/**
 * Vietnamese intent recognition smoke tests.
 *
 * Sets OMNISTATE_REQUIRE_LLM=false so classifyIntent always uses the regex
 * heuristic fallback — no network calls, deterministic, fast.
 */
import { describe, it, expect, afterAll } from "vitest";

// Force heuristic-only path before importing the module
const savedRequireLlm = process.env.OMNISTATE_REQUIRE_LLM;
process.env.OMNISTATE_REQUIRE_LLM = "false";
// Also clear API keys so classifyWithLLM early-exits without needing a mock
const savedApiKey = process.env.ANTHROPIC_API_KEY;
const savedRouter9Key = process.env.OMNISTATE_ROUTER9_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OMNISTATE_ROUTER9_API_KEY;

import { classifyIntent } from "../planner/intent.js";

afterAll(() => {
  if (savedRequireLlm !== undefined) process.env.OMNISTATE_REQUIRE_LLM = savedRequireLlm;
  else delete process.env.OMNISTATE_REQUIRE_LLM;
  if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey;
  if (savedRouter9Key !== undefined) process.env.OMNISTATE_ROUTER9_API_KEY = savedRouter9Key;
});

describe("Vietnamese intent recognition — heuristic path", () => {
  it("mở Safari → app-launch or app-control", async () => {
    const r = await classifyIntent("mở Safari");
    expect(["app-launch", "app-control", "multi-step"]).toContain(r.type);
  });

  it("mở Facebook → app-launch or app-control", async () => {
    const r = await classifyIntent("mở Facebook");
    expect(["app-launch", "app-control", "multi-step"]).toContain(r.type);
  });

  it("mở messenger nhắn cho Linh → app-control (messaging keyword)", async () => {
    // "nhắn" matches /nh[aắ]n\s*tin|g[iử]i/ in messaging pattern → app-control
    // Fallback heuristic: messaging pattern fires before app-launch
    const r = await classifyIntent("mở messenger nhắn cho Linh");
    // Heuristic may give app-control (messaging) or multi-step — not shell/file
    expect(["app-control", "app-launch", "multi-step"]).toContain(r.type);
    expect(r.type).not.toBe("shell-command");
    expect(r.type).not.toBe("file-operation");
  });

  it("tắt nhạc → not shell-command (stop/mute intent)", async () => {
    // "tắt" = turn off. No direct Vi keyword for 'stop music' in heuristic yet.
    const r = await classifyIntent("tắt nhạc");
    expect(r.type).not.toBe("shell-command");
  });

  it("tăng âm lượng → audio-management or app-control (volume keyword)", async () => {
    // "âm lượng" = volume; PHRASE_PATTERNS and HEURISTIC_RULES both match /volume/
    const r = await classifyIntent("tăng âm lượng");
    expect(["audio-management", "app-control", "system-query", "multi-step"]).toContain(r.type);
  });

  it("phát nhạc → audio-management or app-control (play/music keyword)", async () => {
    // "phát nhạc" = play music → audio-management (preLlmRule) or app-control fallback
    const r = await classifyIntent("phát nhạc");
    expect(["audio-management", "app-control", "app-launch", "multi-step"]).toContain(r.type);
  });

  it("đóng tất cả tab → app-control or multi-step", async () => {
    // "đóng" = close; heuristic English pattern /close/ won't match Vi "đóng"
    const r = await classifyIntent("đóng tất cả tab");
    expect(["app-control", "multi-step"]).toContain(r.type);
  });

  it("chụp màn hình → ui-interaction (screenshot)", async () => {
    // PHRASE_PATTERNS has /screenshot|screen\s*capture/ — Vi "chụp màn hình"
    // not yet covered, may fall to multi-step
    const r = await classifyIntent("chụp màn hình");
    expect(["ui-interaction", "multi-step"]).toContain(r.type);
  });

  it("dịch màn hình này → ui-interaction (translate screen)", async () => {
    // PHRASE_PATTERNS: /dịch\s*(?:màn\s*hình|...)/ → ui-interaction
    const r = await classifyIntent("dịch màn hình này");
    expect(r.type).toBe("ui-interaction");
  });

  it("đặt báo thức 7 giờ sáng → app-control or alarm intent", async () => {
    // "báo thức" matches /báo\s*thức/ heuristic → app-control
    // Actual type depends on which rule fires first
    const r = await classifyIntent("đặt báo thức 7 giờ sáng");
    expect(["app-control", "voice-control", "multi-step"]).toContain(r.type);
  });

  it("ghi chú: mua sữa → app-control, file-operation, or multi-step", async () => {
    // "ghi chú" = note; no dedicated Vi pattern yet
    const r = await classifyIntent("ghi chú: mua sữa");
    expect(["app-control", "file-operation", "multi-step"]).toContain(r.type);
  });

  it.skip("tìm kiếm tin tức công nghệ → requires LLM for search intent", () => {
    // "tìm kiếm" = search; no heuristic pattern covers general search intent.
    // Would need LLM to correctly classify as app-launch (browser/search).
  });
});
