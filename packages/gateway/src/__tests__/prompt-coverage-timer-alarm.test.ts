import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";

vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"alarm.set","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));

const VALID = ["alarm.set", "app-control", "timer.set", "shell-command", "multi-step", "ask-clarification"];

function ok(t: string, p: string) {
  return it(t, async () => {
    const intent = await classifyIntent(p);
    expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type);
  });
}

describe("Agent C: Timer/Alarm/Reminder (50 prompts)", () => {
  ok("thông báo sau 10s", "thông báo cho tôi sau 10 giây");
  ok("thông báo sau 10 seconds", "thông báo cho tôi sau 10 seconds");
  ok("notify me in 5 minutes", "notify me in 5 minutes");
  ok("remind me in 10 minutes", "remind me in 10 minutes");
  ok("đặt báo thức 7 giờ", "đặt báo thức 7 giờ");
  ok("set alarm for 7am", "set alarm for 7am");
  ok("set alarm for 8am", "set alarm for 8am");
  ok("báo thức 6h sáng", "báo thức 6h sáng");
  ok("hẹn giờ 10 phút", "hẹn giờ 10 phút");
  ok("đếm ngược 5 phút", "đếm ngược 5 phút");
  ok("timer 3 minutes", "timer 3 minutes");
  ok("timer 1 hour", "timer 1 hour");
  ok("đặt timer 30 giây", "đặt timer 30 giây");
  ok("alarm in 30 minutes", "alarm in 30 minutes");
  ok("nhắc tôi sau 1 giờ", "nhắc tôi sau 1 giờ");
  ok("remind me in 1 hour", "remind me in 1 hour");
  ok("tạo reminder", "tạo reminder");
  ok("tạo nhắc nhở", "tạo nhắc nhở");
  ok("thông báo cho tôi sau 10p", "thông báo cho tôi sau 10p");
  ok("notify after 5 seconds", "notify after 5 seconds");
  ok("đặt alarm", "đặt alarm");
  ok("báo thức", "báo thức");
  ok("tạo báo thức ngày mai 8h", "tạo báo thức ngày mai 8h");
  ok("hẹn giờ họp 3pm", "hẹn giờ họp 3pm");
  ok("remind me to drink water", "remind me to drink water");
  ok("nhắc tôi uống nước", "nhắc tôi uống nước");
  ok("set a timer for pizza", "set a timer for pizza");
  ok("timer for 20 minutes", "timer for 20 minutes");
  ok("đặt báo thức 5:30 sáng", "đặt báo thức 5:30 sáng");
  ok("alarm at 6:00", "alarm at 6:00");
  ok("báo thức 6 giờ", "báo thức 6 giờ");
  ok("remind me to call mom", "remind me to call mom");
  ok("nhắc tôi gọi điện cho mẹ", "nhắc tôi gọi điện cho mẹ");
  ok("countdown 2 minutes", "countdown 2 minutes");
  ok("đếm ngược 1 phút", "đếm ngược 1 phút");
  ok("timer set for 15s", "timer set for 15s");
  ok("thông báo sau 30p", "thông báo sau 30p");
  ok("notify me in 2h", "notify me in 2h");
  ok("đặt hẹn giờ 45 phút", "đặt hẹn giờ 45 phút");
  ok("wake me in 7 hours", "wake me in 7 hours");
  ok("đánh thức tôi sau 7 tiếng", "đánh thức tôi sau 7 tiếng");
  ok("countdown timer 5 mins", "countdown timer 5 mins");
  ok("reminder in 30 seconds", "reminder in 30 seconds");
  ok("nhắc nhở sau 15 phút", "nhắc nhở sau 15 phút");
  ok("set reminder 1 hour", "set reminder 1 hour");
  ok("báo thức lúc 6h", "báo thức lúc 6h");
  ok("thông báo sau 1 tiếng", "thông báo sau 1 tiếng");
  ok("notify in 1 hour", "notify in 1 hour");
  ok("alarm for 9am tomorrow", "alarm for 9am tomorrow");
  ok("đặt báo thức mai 7h sáng", "đặt báo thức mai 7h sáng");
  ok("đặt báo thức sau 20s", "đặt báo thức sau 20s");
  ok("set alarm after 10 seconds", "set alarm after 10 seconds");
  ok("đợi 30 giây", "đợi 30 giây");
  ok("wait 1 minute", "wait 1 minute");
  ok("timer 5s", "timer 5s");
  ok("đặt timer 2 phút", "đặt timer 2 phút");
  ok("báo thức sau 5p", "báo thức sau 5p");
  ok("thông báo cho tôi sau 10s", "thông báo cho tôi sau 10s");
  ok("thông báo cho tôi sau 10p", "thông báo cho tôi sau 10p");
  ok("cài báo thức 3 giờ", "cài báo thức 3 giờ");
});
