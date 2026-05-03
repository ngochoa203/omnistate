import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";
vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"file-operation","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));
const VALID = ["file-operation","shell-command","file.read","file.write","file.delete","file.copy","file.move","file.mkdir","app-launch","file.search","file-organization","file.zip","file.unzip","ask-clarification","disk-cleanup","maintenance.diskCleanup"];
function ok(t: string, p: string) { return it(t, async () => { const intent = await classifyIntent(p); expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type); }); }
describe("Agent F: File Operations (50 prompts)", () => {
  ok("mở file readme","mở file readme"); ok("xem nội dung file","xem nội dung file"); ok("read file config.json","read file config.json");
  ok("cat /etc/hosts","cat /etc/hosts"); ok("tạo file mới","tạo file mới"); ok("create file test.txt","create file test.txt");
  ok("viết vào file","viết vào file"); ok("write to file output.txt","write to file output.txt"); ok("copy file A to B","copy file A to B");
  ok("chép file","chép file"); ok("di chuyển file","di chuyển file"); ok("move file to folder","move file to folder");
  ok("đổi tên file","đổi tên file"); ok("rename file old.txt to new.txt","rename file old.txt to new.txt"); ok("xóa file","xóa file");
  ok("delete file temp.log","delete file temp.log"); ok("tìm file .log","tìm file .log"); ok("find large files","find large files");
  ok("quản lý thư mục Downloads","quản lý thư mục Downloads"); ok("mở thư mục Desktop","mở thư mục Desktop"); ok("open folder Documents","open folder Documents");
  ok("tạo thư mục mới","tạo thư mục mới"); ok("mkdir newproject","mkdir newproject"); ok("xóa thư mục rỗng","xóa thư mục rỗng");
  ok("nén file thành zip","nén file thành zip"); ok("zip folder","zip folder"); ok("giải nén file zip","giải nén file zip");
  ok("unzip archive.tar.gz","unzip archive.tar.gz"); ok("file size of folder","file size of folder"); ok("du -sh /tmp","du -sh /tmp");
  ok("disk space check","disk space check"); ok("ls -la","ls -la"); ok("list files in directory","list files in directory");
  ok("liệt kê file","liệt kê file"); ok("file permissions","file permissions"); ok("chmod 755 script.sh","chmod 755 script.sh");
  ok("chown file","chown file"); ok("symbolic link","symbolic link"); ok("tạo liên kết","tạo liên kết"); ok("compare two files","compare two files");
  ok("diff file1 file2","diff file1 file2"); ok("xem log file","xem log file"); ok("tail -f log","tail -f log"); ok("grep in file","grep in file");
  ok("find by name","find by name"); ok("tìm kiếm file","tìm kiếm file"); ok("organize Desktop","organize Desktop"); ok("dọn thư mục Downloads","dọn thư mục Downloads");
  ok("file checksum","file checksum"); ok("hash of file","hash of file");
});
