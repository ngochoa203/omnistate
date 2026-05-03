/**
 * Security guard — blocks dangerous, malicious, or prompt-injection commands
 * before they reach the intent classifier or executor.
 */

export interface SecurityCheckResult {
  blocked: boolean;
  reason?: string;
  category?: SecurityCategory;
  userMessage?: string;
}

export type SecurityCategory =
  | 'PROMPT_INJECTION'
  | 'DESTRUCTIVE_SYSTEM'
  | 'CREDENTIAL_THEFT'
  | 'MALWARE'
  | 'NETWORK_ATTACK'
  | 'PRIVILEGE_ESCALATION'
  | 'FAKE_UI'
  | 'SELF_DESTRUCT'
  | 'CLICKJACKING'
  | 'UNVERIFIED_INSTALL';

const SECURITY_RULES: Array<{
  pattern: RegExp;
  category: SecurityCategory;
  reason: string;
  userMessage_vi: string;
  userMessage_en: string;
}> = [
  {
    pattern: /(?:ignore|phớt\s*lờ|bỏ\s*qua)\s+(?:all\s+)?(?:previous|prior|above|earlier|trước\s*đó|các\s*lệnh\s*trước|system\s+instructions?|system\s+prompt)/i,
    category: 'PROMPT_INJECTION',
    reason: 'Prompt injection: override system instructions',
    userMessage_vi: '⛔ Không thể thực hiện: Đây là lệnh injection cố tình ghi đè hướng dẫn hệ thống.',
    userMessage_en: '⛔ Blocked: This appears to be a prompt injection attempt to override system instructions.',
  },
  {
    pattern: /(?:display|show|print|output|hiển\s*thị|in\s*ra)\s+(?:your\s+)?(?:system\s+)?(?:password|secret|api\s*key|credentials?|mật\s*khẩu\s*hệ\s*thống)/i,
    category: 'CREDENTIAL_THEFT',
    reason: 'Credential extraction attempt',
    userMessage_vi: '⛔ Không thể thực hiện: Không thể hiển thị thông tin bảo mật hệ thống.',
    userMessage_en: '⛔ Blocked: Cannot display system credentials or security information.',
  },
  {
    pattern: /\brm\s+-[a-z]*rf?\s+[/~*]|\brm\s+-[a-z]*f[a-z]*r\s+[/~*]|sudo\s+rm\s+-rf/i,
    category: 'DESTRUCTIVE_SYSTEM',
    reason: 'Destructive rm -rf command',
    userMessage_vi: '⛔ Lệnh nguy hiểm: Không thể xóa toàn bộ hệ thống. Hành động này không thể hoàn tác.',
    userMessage_en: '⛔ Dangerous command: Cannot delete root or home directory. This action is irreversible.',
  },
  {
    pattern: /(?:format|wipe|erase)\s+(?:toàn\s*bộ\s*)?(?:ổ\s*cứng|hard\s*drive|system\s*disk)\b/i,
    category: 'DESTRUCTIVE_SYSTEM',
    reason: 'Full disk format/wipe attempt',
    userMessage_vi: '⛔ Lệnh nguy hiểm: Không thể format/xóa toàn bộ ổ cứng hệ thống.',
    userMessage_en: '⛔ Dangerous command: Cannot format or wipe the system disk.',
  },
  {
    pattern: /(?:đọc\s*trộm|spy\s*on|intercept|steal)\s+(?:tin\s*nhắn|message|email|chat|password|credential)/i,
    category: 'CREDENTIAL_THEFT',
    reason: 'Unauthorized access to private communications',
    userMessage_vi: '⛔ Không thể thực hiện: Không được phép truy cập trái phép tin nhắn hoặc thông tin cá nhân.',
    userMessage_en: '⛔ Blocked: Unauthorized access to private messages or personal data is not permitted.',
  },
  {
    pattern: /\b(?:keylogger|record\s+keystrokes?|capture\s+(?:all\s+)?keystrokes?|ghi\s+lại\s+phím\s+nhấn)\b/i,
    category: 'CREDENTIAL_THEFT',
    reason: 'Keylogger installation attempt',
    userMessage_vi: '⛔ Không thể thực hiện: Không hỗ trợ keylogger hoặc ghi lại thao tác bàn phím.',
    userMessage_en: '⛔ Blocked: Keylogger or keystroke recording is not supported.',
  },
  {
    pattern: /(?:gửi|send)\s+(?:email|file|link)\s+(?:chứa\s*)?(?:mã\s*độc|malware|virus|trojan|ransomware|payload)/i,
    category: 'MALWARE',
    reason: 'Malware distribution attempt',
    userMessage_vi: '⛔ Không thể thực hiện: Không hỗ trợ gửi mã độc hoặc phần mềm có hại.',
    userMessage_en: '⛔ Blocked: Distributing malware or harmful software is not supported.',
  },
  {
    pattern: /\b(?:ransomware|cryptolocker|encrypt\s+all\s+files|mã\s*hóa\s*toàn\s*bộ\s*file)\b/i,
    category: 'MALWARE',
    reason: 'Ransomware command',
    userMessage_vi: '⛔ Không thể thực hiện: Lệnh liên quan đến ransomware bị chặn.',
    userMessage_en: '⛔ Blocked: Ransomware-related commands are blocked.',
  },
  {
    pattern: /(?:vô\s*hiệu\s*hóa|disable|turn\s*off)\s+(?:tường\s*lửa|firewall).*(?:mở|open).*(?:cổng|port).*(?:internet|public|external|bên\s*ngoài)/i,
    category: 'NETWORK_ATTACK',
    reason: 'Disable firewall and expose port to internet',
    userMessage_vi: '⛔ Nguy hiểm bảo mật: Không thể tắt tường lửa và mở cổng ra internet.',
    userMessage_en: '⛔ Security risk: Cannot disable firewall and expose ports to the internet.',
  },
  {
    pattern: /\b(?:ddos|dos\s+attack|flood\s+(?:with\s+)?(?:packets?|requests?|traffic))\b/i,
    category: 'NETWORK_ATTACK',
    reason: 'DDoS/DoS attack',
    userMessage_vi: '⛔ Không thể thực hiện: Tấn công DDoS/DoS bị chặn.',
    userMessage_en: '⛔ Blocked: DDoS/DoS attack commands are not permitted.',
  },
  {
    pattern: /(?:bỏ\s*qua|bypass|skip|circumvent)\s+(?:xác\s*thực|authentication|auth|đăng\s*nhập\b)/i,
    category: 'PRIVILEGE_ESCALATION',
    reason: 'Authentication bypass attempt',
    userMessage_vi: '⛔ Không thể thực hiện: Không hỗ trợ bỏ qua xác thực.',
    userMessage_en: '⛔ Blocked: Bypassing authentication is not permitted.',
  },
  {
    pattern: /(?:cấp|grant)\s+(?:quyền\s*)?(?:root|admin|sudo|superuser)\s+(?:cho\s+)?(?:terminal|shell|process|app)/i,
    category: 'PRIVILEGE_ESCALATION',
    reason: 'Unauthorized root privilege grant',
    userMessage_vi: '⛔ Không thể thực hiện: Không thể cấp quyền root tùy tiện cho process.',
    userMessage_en: '⛔ Blocked: Cannot arbitrarily grant root privileges to processes.',
  },
  {
    pattern: /(?:(?:tạo|làm|giả|đóng\s*giả)\s+(?:giao\s*diện|trang|UI|interface|page)\b.*(?:đăng\s*nhập|login)|(?:đăng\s*nhập|login)\s+(?:giả|mạo|fake))/i,
    category: 'FAKE_UI',
    reason: 'Phishing/fake login UI',
    userMessage_vi: '⛔ Không thể thực hiện: Không hỗ trợ tạo giao diện đăng nhập giả mạo.',
    userMessage_en: '⛔ Blocked: Creating fake login UIs is not permitted.',
  },
  {
    pattern: /(?:xóa|delete|clear|remove)\s+(?:file\s+)?(?:log\s+)?(?:lịch\s*sử|history)\s+hoạt\s*động/i,
    category: 'SELF_DESTRUCT',
    reason: 'Deleting activity logs to cover tracks',
    userMessage_vi: '⛔ Không thể thực hiện: Không thể xóa log hoạt động của hệ thống.',
    userMessage_en: '⛔ Blocked: Cannot delete system activity logs.',
  },
  {
    pattern: /(?:tạo|create|làm|viết).*script.*(?:click|quảng\s*cáo)/i,
    category: 'CLICKJACKING',
    reason: 'Ad fraud auto-click script',
    userMessage_vi: '⛔ Không thể thực hiện: Không hỗ trợ tạo script click quảng cáo tự động.',
    userMessage_en: '⛔ Blocked: Creating ad auto-click scripts is not permitted.',
  },
  {
    pattern: /(?:cài\s*đặt|install)\s+(?:từ|from)\s+(?:file|nguồn)\s+(?:không\s*rõ|unknown|untrusted|unverified)/i,
    category: 'UNVERIFIED_INSTALL',
    reason: 'Install from unverified source',
    userMessage_vi: '⛔ Cảnh báo bảo mật: Không thể cài đặt từ nguồn không rõ ràng. Hãy dùng App Store hoặc Homebrew.',
    userMessage_en: '⛔ Security warning: Cannot install from unknown sources. Use App Store or Homebrew instead.',
  },
  {
    pattern: /(?:cài\s*đặt|install|update|cập\s*nhật)\s+.*(?:file\s*)?(?:cài\s*đặt|install)\s+(?:không\s*rõ|unknown|untrusted|unverified)/i,
    category: 'UNVERIFIED_INSTALL',
    reason: 'Install/update from unverified source',
    userMessage_vi: '⛔ Cảnh báo bảo mật: Không thể cài đặt từ nguồn không rõ ràng. Hãy dùng App Store hoặc Homebrew.',
    userMessage_en: '⛔ Security warning: Cannot install from unknown sources. Use App Store or Homebrew instead.',
  },
];

function isVietnamese(text: string): boolean {
  return /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(text);
}

/**
 * Check if a user command should be blocked for security reasons.
 */
export function checkSecurity(text: string): SecurityCheckResult {
  const vi = isVietnamese(text);
  for (const rule of SECURITY_RULES) {
    if (rule.pattern.test(text)) {
      return {
        blocked: true,
        reason: rule.reason,
        category: rule.category,
        userMessage: vi ? rule.userMessage_vi : rule.userMessage_en,
      };
    }
  }
  return { blocked: false };
}
