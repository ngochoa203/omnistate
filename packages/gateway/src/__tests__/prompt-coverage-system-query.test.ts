import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";

vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"system-query","confidence":0.85}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));

const VALID = ["system-query", "hardware.getBatteryStatus", "hardware.health", "shell-command", "power-management", "iokit-hardware"];

function ok(t: string, p: string, expected: string[]) {
  return it(`${t}`, async () => {
    const intent = await classifyIntent(p);
    expect(expected, `"${p}" → got "${intent.type}"`).toContain(intent.type);
  });
}

describe("Agent B: System Query (50 prompts)", () => {
  ok("check CPU", "check CPU usage", VALID);
  ok("xem CPU", "xem CPU", VALID);
  ok("memory usage", "memory usage", VALID);
  ok("RAM bao nhiêu", "RAM bao nhiêu", VALID);
  ok("battery status", "battery status", VALID);
  ok("kiểm tra pin", "kiểm tra pin", VALID);
  ok("pin còn bao nhiêu", "pin còn bao nhiêu", VALID);
  ok("system info", "system info", VALID);
  ok("thông tin hệ thống", "thông tin hệ thống", VALID);
  ok("máy tôi bao nhiêu RAM", "máy tôi bao nhiêu RAM", VALID);
  ok("uptime", "uptime", VALID);
  ok("máy đã bật bao lâu", "máy đã bật bao lâu", VALID);
  ok("disk space", "disk space", VALID);
  ok("dung lượng ổ cứng", "dung lượng ổ cứng", VALID);
  ok("storage left", "storage left", VALID);
  ok("who am i", "who am i", VALID);
  ok("hostname", "hostname", VALID);
  ok("tên máy là gì", "tên máy là gì", VALID);
  ok("mac address", "mac address", VALID);
  ok("IP address", "IP address", VALID);
  ok("địa chỉ IP", "địa chỉ IP", VALID);
  ok("what apps are running", "what apps are running", VALID);
  ok("running processes", "running processes", VALID);
  ok("top processes", "top processes", VALID);
  ok("ps aux", "ps aux", VALID);
  ok("df -h", "df -h", VALID);
  ok("du -sh", "du -sh", VALID);
  ok("free memory", "free memory", VALID);
  ok("memory pressure", "memory pressure", VALID);
  ok("máy nóng không", "máy nóng không", VALID);
  ok("thermal status", "thermal status", VALID);
  ok("nhiệt độ CPU", "nhiệt độ CPU", VALID);
  ok("fan speed", "fan speed", VALID);
  ok("health check", "health check", VALID);
  ok("kiểm tra tình trạng máy", "kiểm tra tình trạng máy", VALID);
  ok("máy tôi có khỏe không", "máy tôi có khỏe không", VALID);
  ok("how long has system been up", "how long has system been up", VALID);
  ok("system uptime check", "system uptime check", VALID);
  ok("which OS version", "which OS version", VALID);
  ok("macOS version", "macOS version", VALID);
  ok("phiên bản hệ điều hành", "phiên bản hệ điều hành", VALID);
  ok("display resolution", "display resolution", VALID);
  ok("screen size", "screen size", VALID);
  ok("CPU model", "CPU model", VALID);
  ok("CPU bao nhân", "CPU bao nhân", VALID);
  ok("total RAM", "total RAM", VALID);
  ok("RAM tổng cộng", "RAM tổng cộng", VALID);
  ok("used memory", "used memory", VALID);
  ok("swap usage", "swap usage", VALID);
  ok("disk usage", "disk usage", VALID);
  ok("battery health", "battery health", VALID);
  ok("sức khỏe pin", "sức khỏe pin", VALID);
});
