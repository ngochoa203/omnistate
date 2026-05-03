import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";
vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"app-control","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));
const VALID = ["app-control","multi-step","browser.open","media.play","media.pause","media.next","media.nextTrack","media.previous","media.previousTrack","shell-command","ui-interaction","file-organization","app-launch"];
function ok(t: string, p: string) { return it(t, async () => { const intent = await classifyIntent(p); expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type); }); }
describe("Agent G: Browser & Media (50 prompts)", () => {
  ok("open github.com","open github.com"); ok("mở trang youtube","mở trang youtube"); ok("truy cập google.com","truy cập google.com");
  ok("browse to wikipedia","browse to wikipedia"); ok("open twitter","open twitter"); ok("vào trang facebook","vào trang facebook");
  ok("mở video trên youtube","mở video trên youtube"); ok("tìm video con mèo","tìm video con mèo"); ok("play song on youtube","play song on youtube");
  ok("phát nhạc","phát nhạc"); ok("bật nhạc","bật nhạc"); ok("tắt nhạc","tắt nhạc"); ok("pause music","pause music");
  ok("next track","next track"); ok("bài tiếp theo","bài tiếp theo"); ok("previous track","previous track"); ok("bài trước","bài trước");
  ok("tăng nhạc","tăng nhạc"); ok("giảm nhạc","giảm nhạc"); ok("play playlist","play playlist"); ok("shuffle music","shuffle music");
  ok("open spotify","open spotify"); ok("mở nhạc trên spotify","mở nhạc trên spotify"); ok("tìm kiếm trên google","tìm kiếm trên google");
  ok("google search AI","google search AI"); ok("search for climate change","search for climate change"); ok("scrape webpage","scrape webpage");
  ok("download file from url","download file from url"); ok("save page as bookmark","save page as bookmark"); ok("chụp màn hình trang web","chụp màn hình trang web");
  ok("scroll down","scroll down"); ok("kéo xuống","kéo xuống"); ok("scroll up","scroll up"); ok("fill form","fill form");
  ok("điền form đăng nhập","điền form đăng nhập"); ok("click button login","click button login"); ok("navigate to settings","navigate to settings");
  ok("back button","back button"); ok("go back","go back"); ok("forward button","forward button"); ok("reload page","reload page");
  ok("tải ảnh từ trang","tải ảnh từ trang"); ok("download image","download image"); ok("get page title","get page title");
  ok("lấy tiêu đề trang","lấy tiêu đề trang"); ok("switch tab","switch tab"); ok("đóng tab","đóng tab"); ok("new tab","new tab");
  ok("capture full page","capture full page"); ok("chụp toàn trang","chụp toàn trang"); ok("open incognito","open incognito");
});
