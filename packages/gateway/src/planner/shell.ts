// ── NL → Shell command extraction extracted from intent.ts ──────────────────

import type { Intent } from "./types.js";

// ============================================================================
// NL → Command mapping
// ============================================================================

export const NL_TO_COMMAND: Array<{ pattern: RegExp; command: string | ((m: RegExpMatchArray) => string) }> = [
  {
    pattern: /\bcreate\b.*\breact\b.*\bvite\b.*\bprojects\b/i,
    command: 'cd "$HOME/Projects" && npm create vite@latest react-vite-app -- --template react',
  },
  {
    pattern: /\bcreate\b.*\breact\b.*\bvite\b/i,
    command: "npm create vite@latest react-vite-app -- --template react",
  },
  { pattern: /\b(?:check|show|view|get|monitor)\s+(?:the\s+)?(?:cpu|processor)\b(?!\s+usage.*process)/i, command: "top -l 1 -s 0 | grep -E 'CPU usage|Load Avg'" },
  { pattern: /\b(?:check|show)\s+(?:ram|memory)\s+(?:usage)?\b/i, command: "vm_stat | head -10" },
  { pattern: /\bcpu\s+(?:and\s+)?memory\b|\bsystem\s+status\b/i, command: "top -l 1 -s 0 | grep -E 'CPU usage|Load Avg'" },
  { pattern: /\blist (?:all )?files?\b/i, command: "ls -la" },
  { pattern: /\blist (?:all )?director(?:y|ies)\b/i, command: "ls -d */" },
  { pattern: /\bdisk ?(?:space|usage)\b/i, command: "df -h /" },
  { pattern: /\btop (\d+) process/i, command: (m) => `ps -eo pid,pcpu,pmem,comm -r | head -${parseInt(m[1]) + 1}` },
  { pattern: /\bprocess(?:es)?\b.*\bcpu\b/i, command: "ps -eo pid,pcpu,pmem,comm -r | head -11" },
  { pattern: /\bmemory\b.*\busage\b/i, command: "vm_stat" },
  { pattern: /\bwho(?:ami| am i)\b/i, command: "whoami" },
  { pattern: /\bhostname\b/i, command: "hostname" },
  { pattern: /\buptime\b/i, command: "uptime" },
  { pattern: /\bcurrent dir(?:ectory)?\b/i, command: "pwd" },
  { pattern: /\bwhat dir/i, command: "pwd" },
  { pattern: /\bwhere am i\b/i, command: "pwd" },
  { pattern: /\bfree (?:disk )?space\b/i, command: "df -h /" },
  { pattern: /\bnetwork\b.*\binterface/i, command: "ifconfig | head -30" },
  { pattern: /\bip addr/i, command: "ifconfig | grep 'inet ' | grep -v 127.0.0.1" },
  { pattern: /\bdate\b.*\btime\b|\bwhat time\b|\bcurrent date\b/i, command: "date" },
  { pattern: /\bshow (?:all )?env/i, command: "env | head -30" },
  {
    pattern: /\b(?:unzip|extract)\b(?:\s+(?:file|archive))?\s+([a-zA-Z0-9._~\/-]+\.zip)(?:\s+(?:to|into)\s+([a-zA-Z0-9._~\/-]+))?/i,
    command: (m) => {
      const zipFile = (m[1] ?? "").replace(/[^a-zA-Z0-9._~\/-]/g, "");
      const dest = (m[2] ?? "").replace(/[^a-zA-Z0-9._~\/-]/g, "");
      return dest ? `unzip -o "${zipFile}" -d "${dest}"` : `unzip -o "${zipFile}"`;
    },
  },
  {
    pattern: /\b(?:(?<!un)zip|compress)\b(?:\s+(?:folder|directory|dir|file))?\s+([a-zA-Z0-9._~\/-]+)(?:\s+(?:to|into|as)\s+([a-zA-Z0-9._-]+(?:\.zip)?))?/i,
    command: (m) => {
      const source = (m[1] ?? "").replace(/[^a-zA-Z0-9._~\/-]/g, "");
      const sourceBase = source.split("/").filter(Boolean).pop() || "archive";
      const archiveRaw = (m[2] ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
      const archive = archiveRaw
        ? (archiveRaw.endsWith(".zip") ? archiveRaw : `${archiveRaw}.zip`)
        : `${sourceBase}.zip`;
      return `zip -r "${archive}" "${source}"`;
    },
  },
  { pattern: /\b(?:git\s+)?status\b/i, command: "git status --short --branch" },
  {
    pattern: /\bcommit\b(?:\s+all\s+changes?)?(?:.*\bmessage\s*[:=]\s*["']?([^"']+)["']?)?/i,
    command: (m) => {
      const msg = (m[1] ?? "update from omnistate").replace(/"/g, '\\"').trim();
      return `git add -A && git commit -m "${msg || "update from omnistate"}"`;
    },
  },
  {
    pattern: /\b(?:git\s+)?push\b(?:\s+to\s+([a-zA-Z0-9._/-]+))?(?:\s+branch\s+([a-zA-Z0-9._/-]+))?/i,
    command: (m) => {
      const remote = (m[1] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      const branch = (m[2] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      if (remote && branch) return `git push ${remote} ${branch}`;
      if (branch) return `git push origin ${branch}`;
      return "git push";
    },
  },
  {
    pattern: /\b(?:git\s+)?pull\b(?:\s+from\s+([a-zA-Z0-9._/-]+))?(?:\s+branch\s+([a-zA-Z0-9._/-]+))?/i,
    command: (m) => {
      const remote = (m[1] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      const branch = (m[2] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      if (remote && branch) return `git pull ${remote} ${branch}`;
      if (branch) return `git pull origin ${branch}`;
      return "git pull --rebase";
    },
  },
  {
    pattern: /\b(?:create|new)\s+branch\s+([a-zA-Z0-9._/-]+)\b/i,
    command: (m) => {
      const branch = (m[1] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      return `git checkout -b ${branch}`;
    },
  },
  {
    pattern: /\b(?:checkout|switch\s+to)\s+branch\s+([a-zA-Z0-9._/-]+)\b/i,
    command: (m) => {
      const branch = (m[1] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      return `git checkout ${branch}`;
    },
  },
  {
    pattern: /\bmerge\s+branch\s+([a-zA-Z0-9._/-]+)\b/i,
    command: (m) => {
      const branch = (m[1] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      return `git merge ${branch}`;
    },
  },
  {
    pattern: /\brebase\s+branch\s+([a-zA-Z0-9._/-]+)\b/i,
    command: (m) => {
      const branch = (m[1] ?? "").replace(/[^a-zA-Z0-9._/-]/g, "");
      return `git rebase ${branch}`;
    },
  },
  { pattern: /\bstash\b/i, command: "git stash push -m 'omnistate-stash'" },

  // ── Developer extras ──
  {
    pattern: /\bssh\b(?:\s+(?:into|to|vào))?\s+(?:server\s+)?(?:with\s+(?:username\s+)?)?([a-zA-Z0-9_.-]+)(?:@([a-zA-Z0-9._-]+))?/i,
    command: (m) => {
      const user = (m[1] ?? "admin").replace(/[^a-zA-Z0-9_.-]/g, "");
      const host = (m[2] ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
      const target = host ? `${user}@${host}` : user;
      return `osascript -e 'tell application "Terminal" to do script "ssh ${target}"' && tell application "Terminal" to activate`;
    },
  },
  {
    pattern: /\b(curl|test\s*endpoint|gọi\s*api)\b.*\b(proxy)\b/i,
    command: (m) => {
      const input = m.input ?? "";
      const urlMatch = input.match(/\bhttps?:\/\/[^\s"']+/i);
      const url = urlMatch?.[0] ?? "https://httpbin.org/get";
      return `curl \${HTTPS_PROXY:+-x "$HTTPS_PROXY"} -s -H "Content-Type: application/json" "${url}" 2>&1 | head -200`;
    },
  },
  {
    pattern: /\b(?:kill|free|release|tắt\s+cổng|giải\s*phóng\s+cổng)\b.*?\b(?:port|cổng|localhost:?)?(\d{4,5})\b/i,
    command: (m) => {
      const port = parseInt(m[1] ?? "8080", 10);
      if (port < 1024 || port > 65535) return "echo 'Invalid port number'";
      return `lsof -ti:${port} | xargs kill -9 2>/dev/null && echo 'Port ${port} freed' || echo 'Port ${port} is not in use'`;
    },
  },
  {
    pattern: /\b(?:find|search|tìm)\b.*\b(TODO|FIXME|HACK|BUG)\b/i,
    command: (m) => {
      const keyword = (m[1] ?? "TODO").toUpperCase();
      return `grep -rn "${keyword}" . --include="*.ts" --include="*.js" --include="*.py" --include="*.swift" --include="*.java" --include="*.go" 2>/dev/null | head -30 || echo "No ${keyword} found in current directory"`;
    },
  },
  {
    pattern: /\b(?:run|chạy|execute)\b\s+(?:script\s+)?([a-zA-Z0-9_.-]+\.sh)\b/i,
    command: (m) => {
      const script = (m[1] ?? "").replace(/[^a-zA-Z0-9_.-]/g, "");
      return `bash ~/${script} 2>&1 || bash ./${script} 2>&1 || echo 'Script not found: ${script}'`;
    },
  },
  {
    pattern: /\b(?:open|mở)\b.*?\b([\w.-]+\.(?:json|txt|md|yaml|yml|env|config|toml|ini|conf))\b.*\b(?:text\s+editor|editor|trình\s*soạn)\b/i,
    command: (m) => {
      const file = (m[1] ?? "").replace(/[^a-zA-Z0-9_.-]/g, "");
      return `open -t ~/${file} 2>/dev/null || open -t ./${file} 2>/dev/null || echo "File not found: ${file}"`;
    },
  },
  {
    pattern: /\b(?:open|mở)\b.*(?:(?:with|using|bằng)\s+(?:vscode|code|visual\s+studio)|in\s+(?:vscode|code))\b/i,
    command: (m) => {
      const input = m.input ?? "";
      const fileMatch = input.match(/\b([\w./~-]+\.[\w]{1,6})\b/);
      const file = fileMatch?.[1]?.replace(/[^a-zA-Z0-9_./~-]/g, "") ?? ".";
      return `code "${file}" || open -a "Visual Studio Code" "${file}"`;
    },
  },
  {
    pattern: /\b(?:rename|đổi\s+tên)\b\s+(?:file\s+)?([a-zA-Z0-9_\s.-]+?\.\w{2,5})\s+(?:thành|to|as|→)\s+([a-zA-Z0-9_\s.-]+?\.\w{2,5})\b/i,
    command: (m) => {
      const src = (m[1] ?? "").trim().replace(/[^a-zA-Z0-9_.@-]/g, "_");
      const dst = (m[2] ?? "").trim().replace(/[^a-zA-Z0-9_.@-]/g, "_");
      return `mv ~/"${src}" ~/"${dst}" 2>/dev/null || mv ./"${src}" ./"${dst}" 2>/dev/null || echo 'File not found: ${src}'`;
    },
  },
  {
    pattern: /\b(?:xóa|delete|remove)\b.*?\*?\.(tmp|log|bak|cache|DS_Store)\b/i,
    command: (m) => {
      const ext = (m[1] ?? "tmp").replace(/[^a-zA-Z0-9_]/g, "");
      return `find . -name "*.${ext}" -delete 2>/dev/null && echo "All .${ext} files deleted from current directory"`;
    },
  },
  {
    pattern: /\b(?:eject|đẩy|unmount)\b.*?\b(?:usb|ổ\s*cứng|disk|drive|external)\b/i,
    command: "diskutil list external && DISK=$(diskutil list external | grep -o 'disk[0-9]*' | head -1); if [ -n \"$DISK\" ]; then diskutil unmountDisk /dev/$DISK && echo \"Ejected /dev/$DISK\"; else echo 'No external disk found'; fi",
  },
  {
    pattern: /\b(?:tự\s*động|auto|automatically)\b.*?\b(?:chuyển|move)\b.*?\b(?:downloads?|tải\s*về)\b.*?\b(?:To_Sort|to[\s_]sort)\b/i,
    command: `mkdir -p ~/To_Sort && cat > /tmp/omnistate-auto-move.sh << 'SHEOF'
#!/bin/bash
for f in ~/Downloads/*; do
  [ -f "$f" ] && mv "$f" ~/To_Sort/ 2>/dev/null
done
SHEOF
chmod +x /tmp/omnistate-auto-move.sh
cat > /tmp/com.omnistate.automove.plist << 'PEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.omnistate.automove</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>/tmp/omnistate-auto-move.sh</string></array>
  <key>WatchPaths</key><array><string>/Users/$USER/Downloads</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PEOF
cp /tmp/com.omnistate.automove.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.omnistate.automove.plist 2>/dev/null && echo 'Auto-move watcher installed for Downloads → To_Sort'`,
  },
  {
    pattern: /\b(?:mở\s+tất\s*cả|open\s+all)\b.*?\b(?:ứng\s*dụng|apps?|công\s*việc|work)\b/i,
    command: `open -a "Visual Studio Code" && open -a Terminal && open -a Safari && open -a Zalo && echo "Work apps launched: VSCode, Terminal, Safari, Zalo"`,
  },
  {
    pattern: /\b(?:file\s*nặng\s*hơn|tìm\s+file\s+lớn|find\s+large\s+files?|nặng\s*hơn|larger?\s*than)\b.*?\b(?:1\s*GB|1\s*gigabyte)\b/i,
    command: `find ~ -size +1G -not -path "*/Library/*" -not -path "*/.Trash/*" 2>/dev/null | xargs du -sh 2>/dev/null | sort -hr | head -20 || echo "No files larger than 1GB found (outside Library)"`,
  },
  {
    pattern: /\b(?:kiểm\s+tra\s+cập\s*nhật|check\s+(?:for\s+)?updates?|software\s*update|cập\s*nhật\s*macos)\b/i,
    command: "softwareupdate --list 2>&1 | head -30",
  },
  {
    pattern: /\b(?:dung\s+lượng|disk\s*space|ổ\s*cứng\s*còn\s*trống|free\s*space|storage\s+left)\b/i,
    command: "df -h / && echo '---' && du -sh ~/Desktop ~/Downloads ~/Documents ~/Pictures 2>/dev/null | sort -hr | head -10",
  },
  {
    pattern: /\b(?:ping|kiểm\s*tra\s*kết\s*nối)\b.*\b(?:server|địa\s*chỉ|IP)\b\s+([a-zA-Z0-9._-]+)\b/i,
    command: (m) => {
      const host = (m[1] ?? "8.8.8.8").replace(/[^a-zA-Z0-9._-]/g, "");
      return `ping -c 5 ${host}`;
    },
  },
  // ── Siri-class shortcuts: alarm / timer via Clock app UI ──
  {
    pattern: /.*\b(cài\s*báo\s*thức|đặt\s*báo\s*thức|set\s*alarm|đặt\s*alarm|create\s*alarm|set\s*timer|đặt\s*hẹn\s*giờ|hẹn\s*giờ|alarm\s*set)\b.*/i,
    command: (m) => {
      const text = m.input ?? "";
      // Parse time: 17h10, 17h, 17:10, 5:30pm, 5pm, etc.
      const timeMatch = text.match(/\b(\d{1,2})\s*h(?:r)?\s*(\d{0,2})|\b(\d{1,2}):(\d{2})(?:\s*(am|pm|sáng|chiều|tối))?\b/i);
      let hour = 12, minute = 0;
      if (timeMatch) {
        if (timeMatch[3]) {
          hour = parseInt(timeMatch[3], 10);
          minute = parseInt(timeMatch[4] ?? "0", 10);
          const suffix = text.match(/\b(am|pm|sáng|chiều|tối)\b/i)?.[1]?.toLowerCase();
          if (suffix === "pm" && hour < 12) hour += 12;
          if (suffix === "sáng" && hour === 12) hour = 0;
          if (suffix === "chiều" && hour < 12) hour += 12;
        } else {
          hour = parseInt(timeMatch[1] ?? "12", 10);
          const minStr = timeMatch[2] ?? "0";
          minute = minStr ? parseInt(minStr.padEnd(2, "0").slice(0, 2), 10) : 0;
        }
      }
      const label = text.replace(/.*\b(cài\s*báo\s*thức|đặt\s*báo\s*thức|set\s*alarm|đặt\s*alarm|create\s*alarm|set\s*timer|đặt\s*hẹn\s*giờ|hẹn\s*giờ|alarm\s*set)\b\s*/i, "").replace(/\s*$/, "").trim() || "Báo thức";
      const safeLabel = label.replace(/"/g, '\\"').slice(0, 80);
      const hh = String(hour).padStart(2, "0");
      const min = String(minute).padStart(2, "0");
      // Use Python-based sleep+notification which is reliable across all macOS versions
      return `python3 - << 'PY'
import datetime, subprocess, os, shlex
now = datetime.datetime.now()
target = now.replace(hour=${hour}, minute=${minute}, second=0, microsecond=0)
if target <= now:
    target += datetime.timedelta(days=1)
delay = int((target - now).total_seconds())
label = ${JSON.stringify(safeLabel)}
notif_script = f"display notification \\"{label}\\" with title \\"⏰ Báo thức ${hh}:${min}\\" sound name \\"Glass\\""
cmd = f"sleep {delay} && osascript -e \\'{notif_script}\\'"
subprocess.Popen(cmd, shell=True)
print(f"Alarm set for {label} at {hh}:{min} (in {delay}s on {target.strftime('%Y-%m-%d %H:%M')})")
PY`;
    },
  },
];

/**
 * Extract a real shell command from an intent.
 * If the raw text looks like an actual command (starts with known binary), use it directly.
 * Otherwise, try NL→command mapping. Falls back to raw text.
 */
export function extractShellCommand(intent: Intent): string {
  const text = intent.rawText.trim();

  if (/^[.\/~]|^(ls|cd|cat|echo|grep|find|ps|df|du|top|kill|rm|cp|mv|mkdir|chmod|curl|wget|git|npm|pnpm|yarn|cargo|python|node|make)\b/.test(text)) {
    return text;
  }

  for (const rule of NL_TO_COMMAND) {
    const match = text.match(rule.pattern);
    if (match) {
      return typeof rule.command === "function" ? rule.command(match) : rule.command;
    }
  }

  const cmdEntity = Object.values(intent.entities).find(e => e.type === "command");
  if (cmdEntity?.value) return cmdEntity.value;

  return text;
}
