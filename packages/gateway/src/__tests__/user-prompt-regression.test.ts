import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockRejectedValue(new Error("LLM disabled for regression tests")),
}));

import { classifyIntent } from "../planner/classify.js";
import { planFromIntent } from "../planner/planning.js";
import { checkSecurity } from "../planner/security-guard.js";

const originalRequireLlm = process.env.OMNISTATE_REQUIRE_LLM;

beforeEach(() => {
  process.env.OMNISTATE_REQUIRE_LLM = "false";
});

afterEach(() => {
  if (originalRequireLlm === undefined) {
    delete process.env.OMNISTATE_REQUIRE_LLM;
  } else {
    process.env.OMNISTATE_REQUIRE_LLM = originalRequireLlm;
  }
});

async function planFor(prompt: string) {
  const intent = await classifyIntent(prompt);
  return planFromIntent(intent);
}

function tools(plan: Awaited<ReturnType<typeof planFor>>): string[] {
  return plan.nodes.map((node) => node.action.tool);
}

describe("User prompt regression suite", () => {
  it("plans deep OS port cleanup without falling back to generic execution", async () => {
    const plan = await planFor("Kiểm tra xem cổng 5173 (Vite) có đang bị chiếm không. Nếu có, hãy tìm process ID và kill nó đi để chuẩn bị chạy dev server.");
    expect(tools(plan)).toContain("shell.exec");
    expect(JSON.stringify(plan.nodes)).toContain("lsof -ti tcp:5173");
    expect(tools(plan)).not.toContain("generic.execute");
  });

  it("plans structured file edits and log cleanup", async () => {
    const editPlan = await planFor("Đọc nội dung file /Users/hoahn/.claude/settings.json, tìm key 'theme' và đổi giá trị của nó sang 'dark' rồi lưu lại.");
    expect(JSON.stringify(editPlan.nodes)).toContain("settings.json");
    expect(JSON.stringify(editPlan.nodes)).toContain("theme");

    const cleanupPlan = await planFor("Tìm tất cả các file có đuôi .log lớn hơn 50MB trong thư mục dự án OmniState và xóa chúng đi.");
    expect(JSON.stringify(cleanupPlan.nodes)).toContain("find /Users/hoahn/Project/omnistate");
    expect(JSON.stringify(cleanupPlan.nodes)).toContain("-size +50M");
  });

  it("keeps hardware/audio multi-actions as ordered DAGs", async () => {
    const wifiPlan = await planFor("Tắt Wifi, đợi khoảng 3 giây rồi bật lại. Đồng thời tắt luôn Bluetooth.");
    expect(tools(wifiPlan)).toEqual(["shell.exec", "ui.wait", "shell.exec", "shell.exec"]);
    expect(wifiPlan.nodes[2].dependencies).toEqual(["wait-3s"]);

    const audioPlan = await planFor("Chỉnh âm lượng hệ thống xuống 20% và bật chế độ Do Not Disturb (Không làm phiền) của macOS.");
    expect(tools(audioPlan)).toEqual(["audio.volume", "shell.exec"]);
    expect(audioPlan.nodes[0].action.params.level).toBe(20);
  });

  it("plans surface-layer GUI prompts with a11y/vision actions", async () => {
    const zaloPlan = await planFor("Mở ứng dụng Zalo, tìm hộp thoại 'My Documents' và gửi một tin nhắn với nội dung: 'Test hệ thống OmniState lần 1'.");
    expect(tools(zaloPlan)).toEqual(["app.launch", "ui.find", "ui.click", "ui.type", "ui.key"]);

    const calculatorPlan = await planFor("Mở ứng dụng Calculator (Máy tính) của Mac, lần lượt bấm các số 2, 0, 2, 6, dấu cộng, rồi số 5 và lấy kết quả trên màn hình đọc cho tôi nghe.");
    expect(tools(calculatorPlan)).toContain("vision.ocr");
    expect(tools(calculatorPlan)).toContain("hybrid.speak");

    const settingsPlan = await planFor("Mở System Settings (Cài đặt hệ thống), tìm mục 'Displays' và click vào nút thay đổi độ phân giải (Resolution).");
    expect(tools(settingsPlan)).toEqual(["shell.exec", "ui.find", "ui.click"]);
  });

  it("plans complex chained tasks without generic single-step collapse", async () => {
    const devPlan = await planFor("Vào chế độ code: Mở Terminal tại thư mục packages/web, chạy lệnh pnpm dev, sau đó tự động mở trình duyệt truy cập http://localhost:5173 và thu nhỏ các ứng dụng khác lại.");
    expect(tools(devPlan)).toEqual(["app.script", "shell.exec", "app.script"]);
    expect(devPlan.nodes[1].dependencies).toEqual(["open-terminal-web"]);

    const youtubePlan = await planFor("Chụp ảnh màn hình hiện tại. Nếu thấy giao diện YouTube đang phát video thì bấm dừng (pause), sau đó mở tab mới trên trình duyệt và tìm kiếm 'cách làm bún đậu mắm tôm'.");
    expect(tools(youtubePlan)).toEqual(["screen.capture", "vision.ocr", "ui.key", "ui.key", "ui.type"]);

    const tailscalePlan = await planFor("Tìm một bài viết hướng dẫn setup Tailscale trên mạng, copy đoạn lệnh cài đặt dành cho macOS, và tự động dán đoạn lệnh đó vào Terminal nhưng không được nhấn Enter.");
    expect(tools(tailscalePlan)).toEqual(["shell.exec", "clipboard.set", "app.launch", "ui.key"]);
    expect(JSON.stringify(tailscalePlan.nodes)).toContain("brew install --cask tailscale");
  });

  it("plans context and memory style prompts", async () => {
    const bugPlan = await planFor("Tôi vừa copy một đoạn code báo lỗi ở StackOverflow khoảng 5 phút trước. Hãy tạo một file bug_report.txt trên Desktop và dán đoạn code đó vào.");
    expect(JSON.stringify(bugPlan.nodes)).toContain("pbpaste > ~/Desktop/bug_report.txt");

    const screenPlan = await planFor("Hãy quét toàn bộ nội dung text trên màn hình hiện tại. Tóm tắt cho tôi xem tài liệu này đang nói về cái gì bằng 2 câu tiếng Việt.");
    expect(tools(screenPlan)).toEqual(["screen.capture", "vision.ocr", "hybrid.summarize"]);

    const memoryPlan = await planFor("Tìm lại thư mục chứa các file mã nguồn liên quan đến chức năng 'voice-encoder' mà tôi đã làm việc hôm qua và mở thư mục đó trên Finder.");
    expect(JSON.stringify(memoryPlan.nodes)).toContain("voice-encoder");
    expect(JSON.stringify(memoryPlan.nodes)).toContain("open -R");
  });

  it("blocks destructive Documents deletion and gates large downloads on disk health", async () => {
    const security = checkSecurity("Thực thi lệnh xóa toàn bộ thư mục /Users/hoahn/Documents.");
    expect(security.blocked).toBe(true);
    expect(security.category).toBe("DESTRUCTIVE_SYSTEM");

    const downloadPlan = await planFor("Tải một file video giả định dung lượng 10GB về máy. Trước khi tải, hãy kiểm tra xem ổ cứng có còn trống trên 20GB không, nếu không thì báo lỗi hủy bỏ.");
    expect(tools(downloadPlan)).toEqual(["shell.exec", "generic.execute"]);
    expect(downloadPlan.nodes[1].dependencies).toEqual(["check-free-space"]);
    expect(JSON.stringify(downloadPlan.nodes)).toContain("20971520");
  });
});
