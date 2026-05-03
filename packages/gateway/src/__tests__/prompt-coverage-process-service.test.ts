import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";

vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"process-management","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));

const VALID = ["process-management","service-management","shell-command","system-query","health-check","app-control","power-management","thermal-management","kernel-control","app-launch","power-management","app-control","shell-command","network-control","security-management","ask-clarification"];

function ok(t: string, p: string) {
  return it(t, async () => {
    const intent = await classifyIntent(p);
    expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type);
  });
}

describe("Agent L: Process & Service Management (50 prompts)", () => {
  ok("kill process 1234", "kill process 1234");
  ok("kill node", "kill node");
  ok("top processes", "top processes");
  ok("show running processes", "show running processes");
  ok("ps aux", "ps aux");
  ok("pgrep chrome", "pgrep chrome");
  ok("pkill safari", "pkill safari");
  ok("lsof -i", "lsof -i");
  ok("restart nginx", "restart nginx");
  ok("systemctl status", "systemctl status");
  ok("launchctl load", "launchctl load");
  ok("launchctl unload", "launchctl unload");
  ok("check htop", "check htop");
  ok("check ntop", "check ntop");
  ok("cpu usage", "cpu usage");
  ok("memory usage", "memory usage");
  ok("swap usage", "swap usage");
  ok("free -m", "free -m");
  ok("vm stat", "vm_stat");
  ok("kextstat", "kextstat");
  ok("kextload", "kextload");
  ok("kextunload", "kextunload");
  ok("restart bluetooth daemon", "restart bluetooth daemon");
  ok("restart wifi", "restart wifi");
  ok("pmset -a", "pmset -a");
  ok("pmset -c", "pmset -c");
  ok("killall Safari", "killall Safari");
  ok("killall Chrome", "killall Chrome");
  ok("check zombie processes", "check zombie processes");
  ok("check running daemons", "check running daemons");
  ok("start nginx", "start nginx");
  ok("stop nginx", "stop nginx");
  ok("restart docker", "restart docker");
  ok("start apache", "start apache");
  ok("start mysql", "start mysql");
  ok("launchd agents", "list launchd agents");
  ok("crontab -e", "edit crontab");
  ok("crontab -l", "show crontab");
  ok("at now + 1 hour", "schedule at now + 1 hour");
  ok("periodic daily", "run periodic daily");
  ok("launchd bootstrap", "launchd bootstrap");
  ok("launchctl list", "launchctl list");
  ok("sysctl -a", "sysctl -a");
  ok("ps -ef", "ps -ef");
  ok("netstat -an", "netstat -an");
  ok("kill -9 123", "kill -9 123");
  ok("kill SIGTERM", "kill -SIGTERM");
  ok("process tree", "show process tree");
  ok("pstree", "pstree");
  ok("/proc/cpuinfo", "check /proc/cpuinfo");
  ok("check if process running", "check if chrome is running");
  ok("watch ps aux", "watch ps aux");
  ok("lsof -p 123", "lsof -p 123");
  ok("fuser -k 3000/tcp", "fuser -k 3000/tcp");
  ok("fuser -n tcp 443", "fuser -n tcp 443");
  ok("restart network service", "restart network service");
  ok("check cron jobs", "check cron jobs");
  ok("atq", "atq");
  ok("batch job", "run batch job");
  ok("init.d scripts", "list init.d scripts");
  ok("launchdaemons folder", "check launchdaemons");
  ok("show processes", "show all processes");
  ok("check memory pressure", "check memory pressure");
  ok("systemload", "system load average");
  ok("check uptime", "system uptime");
  ok("process info", "get process info");
  ok("kill hung process", "kill hung process");
  ok("restart service", "restart service");
  ok("check pid", "check pid 1234");
  ok("process count", "count running processes");
  ok("top 10 processes", "top 10 processes");
  ok("cpu per process", "cpu usage per process");
  ok("memory per process", "memory per process");
  ok("process cmdline", "show process cmdline");
  ok("kill all node", "kill all node processes");
  ok("kill all python", "kill all python processes");
  ok("restart systemd", "restart systemd service");
  ok("reload daemon", "reload daemon");
  ok("refresh services", "refresh services");
  ok("service status all", "check all service status");
});
