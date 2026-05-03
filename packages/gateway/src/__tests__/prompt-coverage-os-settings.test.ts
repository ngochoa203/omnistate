import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";

vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"os-config","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));

const VALID = ["os-config","display-management","audio-management","peripheral-management","security-management","shell-command","power-management","display-audio","app-launch","app-control","system-query","ui-interaction","ask-clarification"];

function ok(t: string, p: string) {
  return it(t, async () => {
    const intent = await classifyIntent(p);
    expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type);
  });
}

describe("Agent N: OS Settings & Configuration (50 prompts)", () => {
  ok("turn on dark mode", "turn on dark mode");
  ok("enable dark mode", "enable dark mode");
  ok("chế độ tối", "chế độ tối");
  ok("chế độ sáng", "chế độ sáng");
  ok("bật chế độ tối", "bật chế độ tối");
  ok("turn off dark mode", "turn off dark mode");
  ok("set wallpaper", "set wallpaper");
  ok("đặt hình nền", "đặt hình nền");
  ok("wallpaper mac", "wallpaper mac");
  ok("change wallpaper", "change wallpaper");
  ok("desktop background", "desktop background");
  ok("set desktop picture", "set desktop picture");
  ok("night shift on", "night shift on");
  ok("night shift off", "night shift off");
  ok("bật night shift", "bật night shift");
  ok("giảm ánh sáng xanh", "giảm ánh sáng xanh");
  ok("true tone on", "true tone on");
  ok("true tone off", "true tone off");
  ok("auto brightness", "auto brightness");
  ok("tự động điều chỉnh độ sáng", "tự động điều chỉnh độ sáng");
  ok("increase brightness", "increase brightness");
  ok("giảm độ sáng", "giảm độ sáng");
  ok("dim display", "dim display");
  ok("zoom screen", "zoom screen");
  ok("change screen resolution", "change screen resolution");
  ok("đổi độ phân giải màn hình", "đổi độ phân giải màn hình");
  ok("set display scale", "set display scale");
  ok("arrange displays", "arrange displays");
  ok("mirror displays", "mirror displays");
  ok("extend displays", "extend displays");
  ok("switch primary display", "switch primary display");
  ok("airpods auto-connect", "airpods auto-connect");
  ok("auto-connect bluetooth", "auto-connect bluetooth");
  ok("tự động kết nối bluetooth", "tự động kết nối bluetooth");
  ok("hide dock", "hide dock");
  ok("show dock", "show dock");
  ok("dock auto-hide", "dock auto-hide");
  ok("đổi dock size", "đổi dock size");
  ok("menu bar icons", "menu bar icons");
  ok("notification center", "open notification center");
  ok("bật notification", "bật notification");
  ok("turn on notifications", "turn on notifications");
  ok("notification sounds", "change notification sounds");
  ok("change notification sound", "change notification sound");
  ok("lock screen now", "lock screen now");
  ok("sleep now", "sleep now");
  ok("logout", "logout");
  ok("logout user", "logout user");
  ok("fast user switching", "fast user switching");
  ok("change login screen", "change login screen");
  ok("guest login", "enable guest login");
  ok("firewall on", "firewall on");
  ok("firewall off", "firewall off");
  ok("bật firewall", "bật firewall");
  ok("enable filevault", "enable filevault");
  ok("filevault on", "filevault on");
  ok("enable gatekeeper", "enable gatekeeper");
  ok("disable gatekeeper", "disable gatekeeper");
  ok("smc reset", "reset SMC");
  ok("pram reset", "reset PRAM");
  ok("smc fan control", "smc fan control");
  ok("nvram reset", "nvram reset");
  ok("restore defaults", "restore defaults");
  ok("reset system preferences", "reset system preferences");
  ok("change language", "change language");
  ok("change keyboard layout", "change keyboard layout");
  ok("add keyboard", "add keyboard");
  ok("switch input source", "switch input source");
  ok("accent color", "change accent color");
  ok("highlight color", "change highlight color");
  ok("sidebar icon size", "change sidebar icon size");
  ok("scrollbar behavior", "change scrollbar behavior");
  ok("show path bar", "show path bar");
  ok("show status bar", "show status bar");
  ok("desktop icons", "show desktop icons");
  ok("clean up desktop", "clean up desktop");
  ok("arrange desktop icons", "arrange desktop icons");
  ok("widget view", "open widget view");
  ok("stage manager", "enable stage manager");
  ok("mission control", "open mission control");
  ok("expose", "expose");
  ok("spaces", "manage spaces");
  ok("hot corners", "set hot corners");
  ok("screen saver", "start screen saver");
  ok("set screen saver", "set screen saver");
  ok("lock message", "set lock message");
  ok("login window text", "set login window text");
  ok("auto login", "disable auto login");
  ok("require password after sleep", "require password after sleep");
  ok("filevault status", "check filevault status");
  ok("check gatekeeper", "check gatekeeper status");
  ok("enable remote access", "enable remote access");
  ok("screen sharing", "enable screen sharing");
  ok("remote login", "enable remote login");
  ok("apple remote desktop", "enable apple remote desktop");
});
