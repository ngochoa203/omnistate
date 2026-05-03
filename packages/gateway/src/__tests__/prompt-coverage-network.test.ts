import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";

vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"network-control","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));

const VALID = ["network-control", "network.wifiConnect", "shell-command", "security-management", "multi-step", "app-control", "system-query", "app-launch"];

function ok(t: string, p: string) {
  return it(t, async () => {
    const intent = await classifyIntent(p);
    expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type);
  });
}

describe("Agent D: Network (50 prompts)", () => {
  ok("check wifi", "check wifi");
  ok("bật wifi", "bật wifi");
  ok("tắt wifi", "tắt wifi");
  ok("wifi status", "wifi status");
  ok("kết nối wifi", "kết nối wifi");
  ok("connect to wifi", "connect to wifi");
  ok("disconnect wifi", "disconnect wifi");
  ok("wifi password", "wifi password");
  ok("ping google.com", "ping google.com");
  ok("ping 8.8.8.8", "ping 8.8.8.8");
  ok("check internet", "check internet");
  ok("kiểm tra mạng", "kiểm tra mạng");
  ok("mạng có không", "mạng có không");
  ok("dns check", "dns check");
  ok("flush dns", "flush dns");
  ok("renew dhcp", "renew dhcp");
  ok("firewall status", "firewall status");
  ok("tường lửa", "tường lửa");
  ok("bật firewall", "bật firewall");
  ok("tắt firewall", "tắt firewall");
  ok("network speed", "network speed");
  ok("bandwidth", "bandwidth");
  ok("open ports", "open ports");
  ok("kiểm tra cổng mạng", "kiểm tra cổng mạng");
  ok("vpn status", "vpn status");
  ok("connect vpn", "connect vpn");
  ok("disconnect vpn", "disconnect vpn");
  ok("wifi networks", "wifi networks");
  ok("scan wifi", "scan wifi");
  ok("quét wifi", "quét wifi");
  ok("tốc độ mạng", "tốc độ mạng");
  ok("internet speed test", "internet speed test");
  ok("traceroute", "traceroute");
  ok("check dns", "check dns");
  ok("đổi dns", "đổi dns");
  ok("set dns to 8.8.8.8", "set dns to 8.8.8.8");
  ok("whois domain", "whois domain");
  ok("network connections", "network connections");
  ok("netstat", "netstat");
  ok("lsof -i", "lsof -i");
  ok("bật chế độ máy bay", "bật chế độ máy bay");
  ok("tắt chế độ máy bay", "tắt chế độ máy bay");
  ok("airplane mode on", "airplane mode on");
  ok("wifi signal strength", "wifi signal strength");
  ok("cường độ wifi", "cường độ wifi");
  ok("disconnect from wifi", "disconnect from wifi");
  ok("wifi connected?", "wifi connected?");
  ok("test ping", "test ping");
  ok("check network connection", "check network connection");
  ok("proxy settings", "proxy settings");
  ok("bật proxy", "bật proxy");
});
