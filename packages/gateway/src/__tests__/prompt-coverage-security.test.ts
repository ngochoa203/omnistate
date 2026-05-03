import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";
vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"security-management","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));
const VALID = ["security-management","security-scan","shell-command","security.vault.get","security.encrypt"];
function ok(t: string, p: string) { return it(t, async () => { const intent = await classifyIntent(p); expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type); }); }
describe("Agent H: Security (50 prompts)", () => {
  ok("firewall status","firewall status"); ok("bật firewall","bật firewall"); ok("tắt firewall","tắt firewall"); ok("check firewall rules","check firewall rules");
  ok("block IP 1.2.3.4","block IP 1.2.3.4"); ok("unblock IP","unblock IP"); ok("allow port 443","allow port 443"); ok("block port 22","block port 22");
  ok("mã hóa file","mã hóa file"); ok("encrypt file","encrypt file"); ok("giải mã file","giải mã file"); ok("decrypt file","decrypt file");
  ok("lock folder","lock folder"); ok("khóa thư mục","khóa thư mục"); ok("unlock folder","unlock folder"); ok("secure delete file","secure delete file");
  ok("xóa an toàn","xóa an toàn"); ok("shred file","shred file"); ok("webcam lock","webcam lock"); ok("khóa webcam","khóa webcam");
  ok("mic lock","mic lock"); ok("khóa mic","khóa mic"); ok("check permissions","check permissions"); ok("quyền truy cập","quyền truy cập");
  ok("password manager","password manager"); ok("bitwarden unlock","bitwarden unlock"); ok("check security","check security"); ok("security scan","security scan");
  ok("kiểm tra bảo mật","kiểm tra bảo mật"); ok("virus scan","virus scan"); ok("malware check","malware check"); ok("check for keyloggers","check for keyloggers");
  ok("vpn connect","vpn connect"); ok("disconnect vpn","disconnect vpn"); ok("vpn status","vpn status"); ok("change VPN server","change VPN server");
  ok("ssh key generate","ssh key generate"); ok("tạo ssh key","tạo ssh key"); ok("check open ports","check open ports"); ok("scan for vulnerabilities","scan for vulnerabilities");
  ok("cert expiry check","cert expiry check"); ok("ssl certificate check","ssl certificate check"); ok("enable SIP","enable SIP"); ok("check SIP status","check SIP status");
  ok("gatekeeper status","gatekeeper status"); ok("filevault status","filevault status"); ok("firevault encrypt disk","firevault encrypt disk"); ok("unlock filevault","unlock filevault");
  ok("quarantine file","quarantine file"); ok("remove quarantine","remove quarantine");
});
