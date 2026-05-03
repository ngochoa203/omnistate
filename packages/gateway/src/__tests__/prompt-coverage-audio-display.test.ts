import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";
vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"audio-management","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));
const VALID = ["audio-management","display-management","hardware.setVolume","hardware.setBrightness","hardware.mute","audio.mute","audio.toggleMute","display.brightness"];
function ok(t: string, p: string) { return it(t, async () => { const intent = await classifyIntent(p); expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type); }); }
describe("Agent E: Audio/Display (50 prompts)", () => {
  ok("tăng volume","tăng volume"); ok("giảm volume","giảm volume"); ok("bật tiếng","bật tiếng"); ok("tắt tiếng","tắt tiếng");
  ok("mute","mute"); ok("unmute","unmute"); ok("âm lượng 50%","âm lượng 50%"); ok("set volume 80","set volume 80");
  ok("volume up","volume up"); ok("volume down","volume down"); ok("tăng âm lượng","tăng âm lượng"); ok("giảm âm lượng","giảm âm lượng");
  ok("màn hình sáng hơn","màn hình sáng hơn"); ok("màn hình tối hơn","màn hình tối hơn"); ok("brightness 70%","brightness 70%");
  ok("chỉnh brightness","chỉnh brightness"); ok("tăng độ sáng","tăng độ sáng"); ok("giảm độ sáng","giảm độ sáng");
  ok("display brightness max","display brightness max"); ok("tối độ sáng","tối độ sáng"); ok("độ sáng 50%","độ sáng 50%");
  ok("bật âm thanh","bật âm thanh"); ok("tắt âm thanh","tắt âm thanh"); ok("âm thanh bật","âm thanh bật"); ok("âm thanh tắt","âm thanh tắt");
  ok("speaker volume","speaker volume"); ok("output audio","output audio"); ok("default audio device","default audio device");
  ok("list audio devices","list audio devices"); ok("đổi loa ra","đổi loa ra"); ok("chọn loa ngoài","chọn loa ngoài");
  ok("display list","display list"); ok("list displays","list displays"); ok("external monitor","external monitor");
  ok("resolution 1920x1080","resolution 1920x1080"); ok("đổi độ phân giải","đổi độ phân giải"); ok("night shift","night shift");
  ok("bật night shift","bật night shift"); ok("dark mode","dark mode"); ok("chế độ tối","chế độ tối"); ok("light mode","light mode");
  ok("chế độ sáng","chế độ sáng"); ok("toggle mute","toggle mute"); ok("microphone volume","microphone volume");
  ok("độ nhạy mic","độ nhạy mic"); ok("input volume","input volume"); ok("webcam brightness","webcam brightness");
  ok("keyboard backlight","keyboard backlight"); ok("đèn bàn phím","đèn bàn phím"); ok("volume mute toggle","volume mute toggle");
});
