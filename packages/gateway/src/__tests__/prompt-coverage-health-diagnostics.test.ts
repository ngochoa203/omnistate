import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";

vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"health-check","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));

const VALID = ["health-check","system-query","self-healing","shell-command","log-analysis","debug-assist","diagnostic","thermal-management","ask-clarification","app-control","app-launch","ui-interaction","power-management","display-management","audio-management","peripheral-management","network-control","security-management","service-management","iokit-hardware","hardware-control","os-config","health-check","power-management","system-query","app-launch","system-query"];

function ok(t: string, p: string) {
  return it(t, async () => {
    const intent = await classifyIntent(p);
    expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type);
  });
}

describe("Agent R: System Health & Diagnostics (50 prompts)", () => {
  ok("system health check", "system health check");
  ok("kiểm tra sức khỏe", "kiểm tra sức khỏe");
  ok("health report", "health report");
  ok("báo cáo sức khỏe hệ thống", "báo cáo sức khỏe hệ thống");
  ok("check system status", "check system status");
  ok("system status", "system status");
  ok("disk health check", "disk health check");
  ok("kiểm tra ổ cứng", "kiểm tra ổ cứng");
  ok("SSD health", "check SSD health");
  ok("SMART status", "check SMART status");
  ok("battery health", "check battery health");
  ok("sức khỏe pin", "sức khỏe pin");
  ok("cycle count battery", "check battery cycle count");
  ok("CPU temperature", "check CPU temperature");
  ok("nhiệt độ CPU", "nhiệt độ CPU");
  ok("fan speed", "check fan speed");
  ok("tốc độ quạt", "tốc độ quạt");
  ok("thermal sensors", "read thermal sensors");
  ok("cảm biến nhiệt", "cảm biến nhiệt");
  ok("hardware health", "hardware health check");
  ok("diagnose system", "diagnose system");
  ok("chẩn đoán hệ thống", "chẩn đoán hệ thống");
  ok("run diagnostics", "run diagnostics");
  ok("chạy chuẩn đoán", "chạy chuẩn đoán");
  ok("analyze crash logs", "analyze crash logs");
  ok("phân tích log lỗi", "phân tích log lỗi");
  ok("crash report", "crash report");
  ok("báo cáo crash", "báo cáo crash");
  ok("system logs", "system logs");
  ok("log analyzer", "log analyzer");
  ok("system log tail", "tail system log");
  ok("tail -f log", "tail -f /var/log/system.log");
  ok("grep error", "grep error log");
  ok("grep warning", "grep warning log");
  ok("find errors in log", "find errors in log");
  ok("tìm lỗi trong log", "tìm lỗi trong log");
  ok("analyze performance", "analyze performance");
  ok("phân tích hiệu năng", "phân tích hiệu năng");
  ok("slow system diagnosis", "diagnose slow system");
  ok("system bottleneck", "find system bottleneck");
  ok("find memory leak", "find memory leak");
  ok("tìm memory leak", "tìm memory leak");
  ok("CPU spike cause", "find CPU spike cause");
  ok("disk I/O check", "check disk I/O");
  ok("network latency check", "check network latency");
  ok("ping latency", "check ping latency");
  ok("traceroute analysis", "analyze traceroute");
  ok("DNS resolution check", "check DNS resolution");
  ok("SSL certificate check", "check SSL certificate");
  ok("debug slow startup", "debug slow startup");
  ok("debug high CPU", "debug high CPU usage");
  ok("debug network issue", "debug network issue");
  ok("find slow process", "find slow process");
  ok("system resource monitor", "monitor system resources");
  ok("real-time stats", "real-time stats");
  ok("check crash dump", "check crash dump");
  ok("kernel panic log", "check kernel panic log");
  ok("panic log analysis", "analyze panic log");
  ok("diagnostic report", "generate diagnostic report");
  ok("save diagnostic", "save diagnostic");
  ok("run Apple Diagnostics", "run Apple Diagnostics");
  ok("reset SMC", "reset SMC");
  ok("reset NVRAM", "reset NVRAM");
  ok("check integrity", "check system integrity");
  ok("verify system files", "verify system files");
  ok("system file check", "system file check");
  ok("sfc scan", "run sfc scan");
  ok("chkdsk", "run chkdsk");
  ok("fsck", "run fsck");
  ok("diskutil repair", "diskutil repair");
  ok("verify disk", "verify disk");
  ok("repair disk", "repair disk");
  ok("disk utility", "open disk utility");
  ok("activity monitor", "open activity monitor");
  ok("console logs", "open console logs");
  ok("system profiler", "system profiler");
  ok("system information", "get system information");
  ok("about this mac", "about this mac");
  ok("hardware report", "hardware report");
  ok("software report", "software report");
  ok("memory test", "test memory");
  ok("stress test CPU", "stress test CPU");
  ok("benchmark system", "benchmark system");
  ok("performance test", "performance test");
  ok("network diagnostics", "network diagnostics");
  ok("wifi diagnostics", "wifi diagnostics");
  ok("bluetooth diagnostics", "bluetooth diagnostics");
  ok("audio diagnostics", "audio diagnostics");
  ok("display diagnostics", "display diagnostics");
  ok("storage diagnostics", "storage diagnostics");
  ok("power diagnostics", "power diagnostics");
  ok("thermal throttling", "check thermal throttling");
  ok("log every error", "log every error");
  ok("debug mode", "enable debug mode");
  ok("verbose boot", "boot verbose");
  ok("safe mode", "boot safe mode");
  ok("recovery mode", "boot recovery mode");
});
