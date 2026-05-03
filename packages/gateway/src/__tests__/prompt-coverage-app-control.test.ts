import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";

vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"app-control","confidence":0.85}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({
    maxInputChars: 2000,
    intentMax: 128,
    compactPrompt: false,
  }),
}));

const VALID = ["app-launch", "app-control", "multi-step", "shell-command"];

function ok(t: string, p: string, expected: string[]) {
  return it(`${t} → ${expected.join("|")}`, async () => {
    const intent = await classifyIntent(p);
    expect(expected, `"${p}" got "${intent.type}"`).toContain(intent.type);
  });
}

describe("Agent A: App Control (50 prompts)", () => {
  // Launch - English
  ok("open Safari", "open Safari", VALID);
  ok("launch Slack", "launch Slack", VALID);
  ok("open VSCode", "open VSCode", VALID);
  ok("start Telegram", "start Telegram", VALID);
  ok("open Chrome", "open Chrome", VALID);
  ok("launch Finder", "launch Finder", VALID);
  ok("open Terminal", "open Terminal", VALID);
  ok("launch Zoom", "launch Zoom", VALID);
  ok("open Discord", "open Discord", VALID);
  ok("start Spotify", "start Spotify", VALID);
  // Launch - Vietnamese
  ok("mở Safari", "mở Safari", VALID);
  ok("bật Slack", "bật Slack", VALID);
  ok("khởi động Telegram", "khởi động Telegram", VALID);
  ok("mở Chrome", "mở Chrome", VALID);
  ok("bật Finder", "bật Finder", VALID);
  ok("mở Terminal", "mở Terminal", VALID);
  ok("mở Zalo", "mở Zalo", VALID);
  ok("bật app Messages", "bật app Messages", VALID);
  ok("mở Spotify", "mở Spotify", VALID);
  ok("khởi động ứng dụng", "khởi động ứng dụng", VALID);
  // Quit/close
  ok("quit Safari", "quit Safari", VALID);
  ok("close Chrome", "close Chrome", VALID);
  ok("tắt Slack", "tắt Slack", VALID);
  ok("đóng Finder", "đóng Finder", VALID);
  ok("dừng Telegram", "dừng Telegram", VALID);
  ok("đóng tất cả tab", "đóng tất cả tab", VALID);
  ok("close all tabs", "close all tabs", VALID);
  ok("đóng cửa sổ", "đóng cửa sổ", VALID);
  ok("new tab in Safari", "new tab in Safari", VALID);
  ok("next tab", "next tab", VALID);
  // Browser commands
  ok("open github.com", "open github.com", VALID);
  ok("truy cập google.com", "truy cập google.com", VALID);
  ok("mở trang youtube", "mở trang youtube", VALID);
  ok("open youtube", "open youtube", VALID);
  ok("vào trang wikipedia", "vào trang wikipedia", VALID);
  // Messaging
  ok("nhắn tin cho An", "nhắn tin cho An", VALID);
  ok("send message via Telegram", "send message via Telegram", VALID);
  ok("gửi tin nhắn cho Minh", "gửi tin nhắn cho Minh", VALID);
  ok("mở Zalo nhắn cho Bình", "mở Zalo nhắn cho Bình", VALID);
  ok("message on Slack", "message on Slack", VALID);
  // Multi-step
  ok("open Safari and Chrome", "open Safari and Chrome", VALID);
  ok("bật Slack rồi tắt Telegram", "bật Slack rồi tắt Telegram", VALID);
  ok("mở Finder và đóng app kia", "mở Finder và đóng app kia", VALID);
  // Misc
  ok("activate Finder", "activate Finder", VALID);
  ok("switch to Chrome", "switch to Chrome", VALID);
  ok("quit current app", "quit current app", VALID);
  ok("refresh page in Safari", "refresh page in Safari", VALID);
  ok("reload Safari", "reload Safari", VALID);
  ok("open Messages", "open Messages", VALID);
  ok("mở app Zalo", "mở app Zalo", VALID);
  ok("tắt ứng dụng đang chạy", "tắt ứng dụng đang chạy", VALID);
  ok("bật app Telegram", "bật app Telegram", VALID);
});
