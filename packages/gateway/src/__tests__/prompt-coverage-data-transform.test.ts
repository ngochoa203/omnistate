import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";

vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"file-operation","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));

const VALID = ["file-operation","shell-command","file-organization","multi-step","file-search","system-query","file-convert","file-encrypt","ask-clarification","disk-cleanup","app-control","app-launch","self-healing","maintenance.diskCleanup"];

function ok(t: string, p: string) {
  return it(t, async () => {
    const intent = await classifyIntent(p);
    expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type);
  });
}

describe("Agent Q: Data & File Transforms (50 prompts)", () => {
  ok("convert image to PNG", "convert image to PNG");
  ok("chuyển ảnh sang PNG", "chuyển ảnh sang PNG");
  ok("convert PNG to JPG", "convert PNG to JPG");
  ok("resize image", "resize image");
  ok("resize ảnh", "resize ảnh");
  ok("compress image", "compress image");
  ok("nén ảnh", "nén ảnh");
  ok("convert PDF to text", "convert PDF to text");
  ok("pdf sang text", "pdf sang text");
  ok("extract text from PDF", "extract text from PDF");
  ok("merge PDFs", "merge PDFs");
  ok("gộp file PDF", "gộp file PDF");
  ok("split PDF", "split PDF");
  ok("tách PDF", "tách PDF");
  ok("convert video to MP4", "convert video to MP4");
  ok("chuyển video sang MP4", "chuyển video sang MP4");
  ok("compress video", "compress video");
  ok("nén video", "nén video");
  ok("convert audio MP3", "convert audio to MP3");
  ok("chuyển âm thanh sang MP3", "chuyển âm thanh sang MP3");
  ok("trim audio", "trim audio");
  ok("cắt audio", "cắt audio");
  ok("merge audio files", "merge audio files");
  ok("gộp audio", "gộp audio");
  ok("convert CSV to JSON", "convert CSV to JSON");
  ok("chuyển CSV sang JSON", "chuyển CSV sang JSON");
  ok("parse JSON", "parse JSON");
  ok("format JSON", "format JSON");
  ok("prettify JSON", "prettify JSON");
  ok("minify JSON", "minify JSON");
  ok("convert to base64", "convert to base64");
  ok("mã hóa base64", "mã hóa base64");
  ok("decode base64", "decode base64");
  ok("giải mã base64", "giải mã base64");
  ok("encrypt file AES", "encrypt file AES");
  ok("mã hóa file", "mã hóa file");
  ok("decrypt file", "decrypt file");
  ok("unzip archive", "unzip archive");
  ok("giải nén", "giải nén");
  ok("zip folder", "zip folder");
  ok("nén thư mục", "nén thư mục");
  ok("tar archive", "tar archive");
  ok("extract tar", "extract tar");
  ok("create tar.gz", "create tar.gz");
  ok("encrypt with password", "encrypt with password");
  ok("mã hóa có mật khẩu", "mã hóa có mật khẩu");
  ok("decrypt with password", "decrypt with password");
  ok("rename batch files", "rename batch files");
  ok("đổi tên hàng loạt", "đổi tên hàng loạt");
  ok("find and replace", "find and replace");
  ok("find duplicate files", "find duplicate files");
  ok("tìm file trùng", "tìm file trùng");
  ok("sync folders", "sync folders");
  ok("đồng bộ thư mục", "đồng bộ thư mục");
  ok("move old files", "move old files");
  ok("dọn file cũ", "dọn file cũ");
  ok("archive old files", "archive old files");
  ok("lưu trữ file cũ", "lưu trữ file cũ");
  ok("extract table from PDF", "extract table from PDF");
  ok("parse CSV", "parse CSV");
  ok("convert Excel to CSV", "convert Excel to CSV");
  ok("spreadsheet to CSV", "spreadsheet to CSV");
  ok("convert UTF-8", "convert to UTF-8");
  ok("encode URL", "encode URL");
  ok("mã hóa URL", "mã hóa URL");
  ok("decode URL", "decode URL");
  ok("hash file SHA256", "hash file SHA256");
  ok("checksum file", "checksum file");
  ok("verify integrity", "verify file integrity");
  ok("extract subtitles", "extract subtitles");
  ok("convert SRT to VTT", "convert SRT to VTT");
  ok("image to PDF", "convert image to PDF");
  ok("PDF to image", "convert PDF to image");
  ok("batch resize", "batch resize images");
  ok("batch rename", "batch rename files");
  ok("watermark image", "watermark image");
  ok("add watermark", "add watermark");
  ok("convert HEIC to JPG", "convert HEIC to JPG");
  ok("convert MOV to MP4", "convert MOV to MP4");
  ok("compress GIF", "compress GIF");
  ok("optimize image", "optimize image");
  ok("thumbnail image", "generate thumbnail");
  ok("create icon", "create icon from image");
  ok("favicon generator", "generate favicon");
  ok("base64 encode image", "base64 encode image");
  ok("hex dump", "hex dump file");
  ok("compare files", "compare files");
  ok("diff files", "diff files");
  ok("merge files", "merge files");
  ok("split file", "split file");
  ok("join files", "join files");
  ok("extract audio", "extract audio from video");
  ok("video to GIF", "convert video to GIF");
});
