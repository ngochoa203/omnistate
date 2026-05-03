import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";
vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"maintenance.diskCleanup","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));
const VALID = ["maintenance.diskCleanup","health-check","self-healing","disk-cleanup","shell-command","backup.start","update.check","backup-restore","app-control","app-launch","multi-step","file-organization","maintenance.clearBrowserCache","file-operation","maintenance.clearAppCache","maint.clearBrowserCache","maint.getLargeFiles","disk-management"];
function ok(t: string, p: string) { return it(t, async () => { const intent = await classifyIntent(p); expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type); }); }
describe("Agent J: Maintenance/Health (50 prompts)", () => {
  ok("dọn disk","dọn disk"); ok("clean disk space","clean disk space"); ok("disk cleanup","disk cleanup"); ok("xóa file rác","xóa file rác");
  ok("empty trash","empty trash"); ok("dọn thùng rác","dọn thùng rác"); ok("clean temp files","clean temp files"); ok("xóa cache trình duyệt","xóa cache trình duyệt");
  ok("clear browser cache","clear browser cache"); ok("xóa bộ nhớ cache","xóa bộ nhớ cache"); ok("clean downloads folder","clean downloads folder"); ok("dọn thư mục Downloads","dọn thư mục Downloads");
  ok("large files on disk","large files on disk"); ok("file nặng trên 1GB","file nặng trên 1GB"); ok("find large files > 100MB","find large files > 100MB"); ok("disk usage analysis","disk usage analysis");
  ok("system health","system health"); ok("kiểm tra sức khỏe máy","kiểm tra sức khỏe máy"); ok("health report","health report"); ok("báo cáo sức khỏe hệ thống","báo cáo sức khỏe hệ thống");
  ok("repair disk","repair disk"); ok("verify disk","verify disk"); ok("repair permissions","repair permissions"); ok("sửa quyền hệ thống","sửa quyền hệ thống");
  ok("backup now","backup now"); ok("time machine backup","time machine backup"); ok("sao lưu ngay","sao lưu ngay"); ok("list backups","list backups"); ok("khôi phục backup","khôi phục backup");
  ok("restore from backup","restore from backup"); ok("kiểm tra cập nhật","kiểm tra cập nhật"); ok("check for updates","check for updates"); ok("update macOS","update macOS");
  ok("cập nhật phần mềm","cập nhật phần mềm"); ok("software update","software update"); ok("upgrade brew","upgrade brew"); ok("system update","system update");
  ok("fix network","fix network"); ok("sửa mạng","sửa mạng"); ok("repair network","repair network"); ok("flush dns cache","flush dns cache"); ok("renew dhcp lease","renew dhcp lease");
  ok("rebuild spotlight","rebuild spotlight"); ok("optimize disk","optimize disk"); ok("trim ssd","trim ssd"); ok("TRIM enable","TRIM enable"); ok("clean log files","clean log files");
  ok("dọn log","dọn log"); ok("log size","log size"); ok("system log","system log");
});
