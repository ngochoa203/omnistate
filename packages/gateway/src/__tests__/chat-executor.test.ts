import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "../executor/orchestrator.js";

// Minimal stub — only the parts openChatWithPerson needs
function makeOrchestrator() {
  const execAsync = vi.fn().mockResolvedValue("");
  // @ts-expect-error — we're providing only what's needed
  const orc = new Orchestrator({} as never);
  // @ts-expect-error
  orc.deep = { execAsync };
  return { orc, execAsync };
}

describe("Orchestrator.openChatWithPerson", () => {
  let orc: Orchestrator;
  let execAsync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ orc, execAsync } = makeOrchestrator());
  });

  it("messenger: ASCII username → deep-links to messenger.com/t/<username>", async () => {
    const result = await orc.openChatWithPerson("messenger", "linh.nguyen");
    expect(result.ok).toBe(true);
    expect(result.opened).toContain("messenger.com/t/linh.nguyen");
    expect(result.notice).toBeUndefined();
    const cmd: string = execAsync.mock.calls[0][0];
    expect(cmd).toContain("messenger.com/t/linh.nguyen");
  });

  it("messenger: Vietnamese display name → opens inbox + notice", async () => {
    const result = await orc.openChatWithPerson("messenger", "Linh");
    expect(result.ok).toBe(true);
    expect(result.notice).toMatch(/Cannot deep-link/);
    const cmd: string = execAsync.mock.calls[0][0];
    expect(cmd).toContain("Messenger");
  });

  it("zalo: any name → opens Zalo app + notice", async () => {
    const result = await orc.openChatWithPerson("zalo", "Nguyễn Văn A");
    expect(result.ok).toBe(true);
    expect(result.notice).toMatch(/manually/);
    const cmd: string = execAsync.mock.calls[0][0];
    expect(cmd).toContain("Zalo");
  });

  it("imessage: Vietnamese mobile number 0389027907 → imessage: scheme with +84", async () => {
    const result = await orc.openChatWithPerson("imessage", "0389027907");
    expect(result.ok).toBe(true);
    expect(result.opened).toContain("imessage:");
    expect(result.opened).toContain("84389027907");
    const cmd: string = execAsync.mock.calls[0][0];
    expect(cmd).toContain("imessage:");
  });

  it("telegram: @duck → tg://resolve?domain=duck", async () => {
    const result = await orc.openChatWithPerson("telegram", "@duck");
    expect(result.ok).toBe(true);
    expect(result.opened).toMatch(/tg:\/\/resolve\?domain=duck/);
    const cmd: string = execAsync.mock.calls[0][0];
    expect(cmd).toContain("tg://resolve?domain=duck");
  });

  it("whatsapp: +84389027907 → wa.me URL with stripped +", async () => {
    const result = await orc.openChatWithPerson("whatsapp", "+84389027907", "Hello");
    expect(result.ok).toBe(true);
    expect(result.opened).toContain("wa.me/84389027907");
    expect(result.opened).toContain("text=Hello");
    const cmd: string = execAsync.mock.calls[0][0];
    expect(cmd).toContain("wa.me/84389027907");
  });
});
