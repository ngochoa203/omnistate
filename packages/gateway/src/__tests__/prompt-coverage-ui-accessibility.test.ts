import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";

vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"ui-interaction","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));

const VALID = ["ui-interaction","shell-command","system-query","clipboard-management","app-control","multi-step","ask-clarification","screenshot","accessibility","app-launch","voice-control","media.play"];

function ok(t: string, p: string) {
  return it(t, async () => {
    const intent = await classifyIntent(p);
    expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type);
  });
}

describe("Agent P: UI & Accessibility (50 prompts)", () => {
  ok("take screenshot", "take screenshot");
  ok("chụp màn hình", "chụp màn hình");
  ok("full page screenshot", "full page screenshot");
  ok("chụp toàn trang", "chụp toàn trang");
  ok("screenshot area", "screenshot area");
  ok("region screenshot", "screenshot region");
  ok("annotated screenshot", "annotated screenshot");
  ok("screenshot and copy", "screenshot and copy");
  ok("screenshot with delay", "screenshot with delay");
  ok("chụp sau 5 giây", "chụp sau 5 giây");
  ok("OCR screenshot", "OCR screenshot");
  ok("recognize text from image", "recognize text from image");
  ok("trích xuất text từ ảnh", "trích xuất text từ ảnh");
  ok("translate screen", "translate screen");
  ok("dịch màn hình", "dịch màn hình");
  ok("translate selected text", "translate selected text");
  ok("dịch đoạn văn", "dịch đoạn văn");
  ok("detect language", "detect language");
  ok("nhận diện ngôn ngữ", "nhận diện ngôn ngữ");
  ok("read aloud", "read aloud");
  ok("đọc văn bản", "đọc văn bản");
  ok("voice over text", "voice over text");
  ok("speak this", "speak this");
  ok("turn on voiceOver", "turn on voiceOver");
  ok("bật voiceOver", "bật voiceOver");
  ok("zoom in", "zoom in");
  ok("zoom out", "zoom out");
  ok("zoom to 200%", "zoom to 200%");
  ok("invert colors", "invert colors");
  ok("enable high contrast", "enable high contrast");
  ok("increase contrast", "increase contrast");
  ok("reduce motion", "reduce motion");
  ok("bật reduce motion", "bật reduce motion");
  ok("sticky keys on", "sticky keys on");
  ok("slow keys on", "slow keys on");
  ok("mouse keys on", "mouse keys on");
  ok("accessibility shortcuts", "accessibility shortcuts");
  ok("voice control commands", "voice control commands");
  ok("control with voice", "control with voice");
  ok("Siri commands", "Siri commands");
  ok("tap screen", "tap screen");
  ok("nhấn vào", "nhấn vào");
  ok("click at position", "click at position");
  ok("double click", "double click");
  ok("right click", "right click");
  ok("drag element", "drag element");
  ok("scroll element", "scroll element");
  ok("kéo xuống", "kéo xuống");
  ok("scroll up page", "scroll up page");
  ok("go to top", "go to top");
  ok("về đầu trang", "về đầu trang");
  ok("close modal", "close modal");
  ok("đóng popup", "đóng popup");
  ok("dismiss dialog", "dismiss dialog");
  ok("accept alert", "accept alert");
  ok("click OK", "click OK");
  ok("fill field", "fill field");
  ok("điền vào ô", "điền vào ô");
  ok("type in field", "type in field");
  ok("nhập văn bản", "nhập văn bản");
  ok("clear field", "clear field");
  ok("xóa nội dung", "xóa nội dung");
  ok("submit form", "submit form");
  ok("nhấn submit", "nhấn submit");
  ok("press enter", "press enter");
  ok("nhấn Enter", "nhấn Enter");
  ok("select dropdown", "select dropdown");
  ok("check checkbox", "check checkbox");
  ok("uncheck checkbox", "uncheck checkbox");
  ok("toggle switch", "toggle switch");
  ok("navigate back", "navigate back");
  ok("go back", "go back");
  ok("quay lại", "quay lại");
  ok("navigate forward", "navigate forward");
  ok("forward", "forward");
  ok("refresh page", "refresh page");
  ok("tải lại trang", "tải lại trang");
  ok("scroll down", "scroll down");
  ok("scroll to bottom", "scroll to bottom");
  ok("scroll to element", "scroll to element");
  ok("capture window", "capture window");
  ok("screenshot window", "screenshot window");
  ok("record screen", "record screen");
  ok("quay màn hình", "quay màn hình");
  ok("screen recording", "screen recording");
  ok("quicktime screen recording", "quicktime screen recording");
  ok("stop recording", "stop recording");
  ok("start recording", "start recording");
  ok("use accessibility", "use accessibility features");
  ok("voice control on", "voice control on");
  ok("switch control", "switch control");
  ok("assistive touch", "assistive touch");
  ok("full keyboard access", "enable full keyboard access");
  ok("tab through items", "tab through items");
});
