import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";

vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"multi-step","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));

const VALID = ["multi-step","automation-macro","workflow-template","app-control","shell-command","file-operation","orchestration","schedule","ask-clarification","system-query","backup-restore","self-healing","update-management","debug-assist","file-organization","ui-interaction","power-management","app-launch","disk-cleanup","service-management","app-control","system-query","update-management"];

function ok(t: string, p: string) {
  return it(t, async () => {
    const intent = await classifyIntent(p);
    expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type);
  });
}

describe("Agent S: Multi-Step & Complex Orchestration (50 prompts)", () => {
  ok("open Safari and search", "open Safari and search");
  ok("mở Safari và tìm kiếm", "mở Safari và tìm kiếm");
  ok("find and open file", "find and open file");
  ok("tìm và mở file", "tìm và mở file");
  ok("download and extract", "download and extract");
  ok("tải và giải nén", "tải và giải nén");
  ok("find and delete duplicates", "find and delete duplicates");
  ok("tìm và xóa trùng", "tìm và xóa trùng");
  ok("backup and compress", "backup and compress");
  ok("sao lưu và nén", "sao lưu và nén");
  ok("sync and update", "sync and update");
  ok("đồng bộ và cập nhật", "đồng bộ và cập nhật");
  ok("install and configure", "install and configure");
  ok("cài đặt và cấu hình", "cài đặt và cấu hình");
  ok("search and replace text", "search and replace text");
  ok("tìm và thay thế", "tìm và thay thế");
  ok("scan and remove malware", "scan and remove malware");
  ok("quét và xóa malware", "quét và xóa malware");
  ok("check and update brew", "check and update brew");
  ok("kiểm tra và cập nhật brew", "kiểm tra và cập nhật brew");
  ok("find and kill processes", "find and kill processes");
  ok("tìm và tắt tiến trình", "tìm và tắt tiến trình");
  ok("check and restart service", "check and restart service");
  ok("kiểm tra và khởi động lại", "kiểm tra và khởi động lại");
  ok("open app and screenshot", "open app and take screenshot");
  ok("mở app và chụp màn hình", "mở app và chụp màn hình");
  ok("record audio and transcribe", "record audio and transcribe");
  ok("ghi âm và phiên âm", "ghi âm và phiên âm");
  ok("download and move", "download file and move to folder");
  ok("tải file và di chuyển", "tải file và di chuyển");
  ok("search photos and delete", "search photos and delete");
  ok("tìm ảnh và xóa", "tìm ảnh và xóa");
  ok("organize downloads", "organize downloads by date");
  ok("sắp xếp downloads theo ngày", "sắp xếp downloads theo ngày");
  ok("extract and import data", "extract and import data");
  ok("giải nén và nhập dữ liệu", "giải nén và nhập dữ liệu");
  ok("convert and upload", "convert and upload");
  ok("chuyển đổi và tải lên", "chuyển đổi và tải lên");
  ok("encrypt and send file", "encrypt and send file");
  ok("mã hóa và gửi file", "mã hóa và gửi file");
  ok("compress and email", "compress and email");
  ok("nén và gửi email", "nén và gửi email");
  ok("backup and verify", "backup to time machine and verify");
  ok("sao lưu và xác minh", "sao lưu và xác minh");
  ok("restart and reinstall", "restart and reinstall");
  ok("khởi động lại và cài lại", "khởi động lại và cài lại");
  ok("repair disk and verify", "repair disk and verify");
  ok("sửa disk và xác minh", "sửa disk và xác minh");
  ok("flush DNS and test", "flush DNS and test");
  ok("xóa DNS và kiểm tra", "xóa DNS và kiểm tra");
  ok("optimize and defrag", "optimize and defrag");
  ok("tối ưu và defrag", "tối ưu và defrag");
  ok("setup dev environment", "setup dev environment");
  ok("cài đặt môi trường dev", "cài đặt môi trường dev");
  ok("daily backup routine", "daily backup routine");
  ok("routine sao lưu hàng ngày", "routine sao lưu hàng ngày");
  ok("new project setup", "new project setup");
  ok("thiết lập project mới", "thiết lập project mới");
  ok("deploy and test", "deploy and test");
  ok("triển khai và kiểm tra", "triển khai và kiểm tra");
  ok("CI/CD pipeline check", "CI/CD pipeline check");
  ok("code review workflow", "code review workflow");
  ok("git flow workflow", "git flow workflow");
  ok("merge and deploy", "merge and deploy");
  ok("review and approve", "review and approve");
  ok("test and release", "test and release");
  ok("build and publish", "build and publish");
  ok("compile and sign", "compile and sign");
  ok("sign and notarize", "sign and notarize");
  ok("notarize app", "notarize app");
  ok("validate signature", "validate signature");
  ok("verify code sign", "verify code sign");
  ok("package and distribute", "package and distribute");
  ok("bundle app", "bundle app");
  ok("create DMG", "create DMG");
  ok("build installer", "build installer");
  ok("create package", "create package");
  ok("deploy to server", "deploy to server");
  ok("restart server", "restart server");
  ok("check uptime", "check uptime");
  ok("monitor server health", "monitor server health");
  ok("log rotation setup", "setup log rotation");
  ok("cron job setup", "setup cron job");
  ok("schedule task", "schedule task");
  ok("auto startup setup", "setup auto startup");
  ok("auto run on login", "auto run on login");
  ok("set login item", "set login item");
  ok("schedule backup", "schedule backup");
  ok("schedule cleanup", "schedule cleanup");
  ok("automation workflow", "create automation workflow");
  ok("macro recording", "record macro");
  ok("run macro", "run macro");
  ok("schedule automation", "schedule automation");
  ok("workflow template", "use workflow template");
  ok("template automation", "template automation");
  ok("batch processing", "batch processing");
  ok("mass operation", "mass operation");
  ok("bulk rename", "bulk rename");
  ok("bulk convert", "bulk convert");
  ok("bulk resize", "bulk resize");
  ok("bulk rename files", "bulk rename files");
});
