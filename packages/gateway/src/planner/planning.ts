// ── Multi-step planning extracted from intent.ts ──────────────────────────────

import type { StatePlan, StateNode } from "../types/task.js";
import type { Intent, IntentType, DecomposedStep } from "./types.js";
import {
  INTENT_TYPES,
  isLlmRequired,
  resolveEffectiveBudget,
  actionNode,
  verifyNode,
  normalizeStepTool,
  inferStepParamsForTool,
} from "./types.js";
import { requestLlmTextWithFallback } from "../llm/router.js";
import { parseLlmJson } from "./types.js";
import { extractShellCommand } from "./shell.js";
import {
  parseUiActionChain,
  buildUiActionChainNodes,
  isNegatedUiInstruction,
} from "./ui-chain.js";
import {
  buildAppControlScript,
  buildKeyboardAction,
  buildWebFormFillScript,
  buildDataEntryWorkflowNodes,
  isDataEntryWorkflowText,
  isMessagingIntentText,
  buildMessagingScriptWithLLM,
  extractAppName,
  normalizeAppName,
  escapeAppleScriptString,
  sanitizeToken,
  SAFE_HOST_PATTERN,
  SAFE_NAME_PATTERN,
  SAFE_DOCKER_TARGET_PATTERN,
} from "./app-control.js";
import { extractCoordinatePairs } from "./nlp.js";
import { EpisodicStore } from "../memory/episodic-store.js";
import { getEmbeddingProvider } from "../memory/embeddings.js";
import { getDb } from "../db/database.js";
import { KnowledgeGraph } from "../memory/knowledge-graph.js";
import { logger } from "../utils/logger.js";

// ============================================================================
// Intent → Tool mapping for Domain B/C/D/E intent types
// ============================================================================

interface ToolResult {
  name: string;
  params: Record<string, unknown>;
}

function mapIntentToTool(intent: Intent): ToolResult | null {
  const text = intent.rawText.toLowerCase();
  const type = intent.type as IntentType;

  switch (type) {
    // ── Network ─────────────────────────────────────────────────────────
    case "network-control": {
      if (/airplane/.test(text)) {
        return { name: "shell.exec", params: { command: "networksetup -setairportpower en0 off && if command -v blueutil >/dev/null 2>&1; then blueutil --power 0; fi && echo 'Airplane mode applied.'" } };
      }
      if (/(turn\s*on|enable|bật).*(wifi|wi-fi|wireless)/.test(text)) {
        return { name: "shell.exec", params: { command: "networksetup -setairportpower en0 on && networksetup -getairportpower en0" } };
      }
      if (/(turn\s*off|disable|tắt).*(wifi|wi-fi|wireless)/.test(text)) {
        return { name: "shell.exec", params: { command: "networksetup -setairportpower en0 off && networksetup -getairportpower en0" } };
      }
      if (/(connect|join|kết\s*nối).*(wifi|wi-fi|wireless)/.test(text)) {
        const ssidMatch = intent.rawText.match(/\b(?:ssid|wifi|network)\s*[:=]\s*['\"]?([^'\"]+)['\"]?/i)
          ?? intent.rawText.match(/\b(?:to|vào)\s+['\"]([^'\"]+)['\"]/i);
        const passMatch = intent.rawText.match(/\b(?:password|pass|mật\s*khẩu)\s*[:=]\s*['\"]?([^'\"]+)['\"]?/i);
        const ssid = ssidMatch?.[1]?.trim();
        const password = passMatch?.[1]?.trim();
        if (ssid) {
          const escapedSsid = ssid.replace(/"/g, '\\"');
          const escapedPass = (password ?? "").replace(/"/g, '\\"');
          const cmd = password
            ? `networksetup -setairportnetwork en0 "${escapedSsid}" "${escapedPass}"`
            : `networksetup -setairportnetwork en0 "${escapedSsid}"`;
          return { name: "shell.exec", params: { command: `${cmd} && echo 'Connected to ${escapedSsid}'` } };
        }
        return { name: "shell.exec", params: { command: "echo 'Specify SSID with: wifi: <name> (and optional password).'; networksetup -listpreferredwirelessnetworks en0 2>/dev/null | head -20" } };
      }
      if (/wifi|wi-fi|wireless|ssid/.test(text)) return { name: "network.wifi", params: {} };
      if (/ping\b/.test(text)) {
        const hostMatch = text.match(/ping\s+(\S+)/);
        const host = sanitizeToken(hostMatch?.[1], SAFE_HOST_PATTERN) ?? "8.8.8.8";
        return { name: "network.ping", params: { host } };
      }
      if (/vpn/.test(text)) return { name: "network.vpn", params: {} };
      if (/firewall/.test(text)) return { name: "network.firewall", params: {} };
      if (/port/.test(text)) return { name: "network.openPorts", params: {} };
      if (/connection|active/.test(text)) return { name: "network.connections", params: {} };
      if (/route|routing/.test(text)) return { name: "network.routes", params: {} };
      if (/dns/.test(text)) return { name: "os.dns", params: {} };
      if (/interface/.test(text)) return { name: "network.interfaces", params: {} };
      return { name: "network.wifi", params: {} };
    }

    // ── Process management ──────────────────────────────────────────────
    case "process-management": {
      if (/kill|terminate|stop/.test(text)) {
        const pidMatch = text.match(/\b(\d{2,})\b/);
        return { name: "shell.exec", params: { command: pidMatch ? `kill ${pidMatch[1]}` : "ps aux --sort=-%cpu | head -10" } };
      }
      if (/top|cpu|sort/.test(text)) {
        const nMatch = text.match(/top\s+(\d+)|(\d+)\s+process/);
        const n = nMatch?.[1] || nMatch?.[2] || "10";
        return { name: "shell.exec", params: { command: `ps aux --sort=-%cpu | head -${parseInt(n) + 1}` } };
      }
      return { name: "shell.exec", params: { command: "ps aux --sort=-%cpu | head -15" } };
    }

    // ── Service management ──────────────────────────────────────────────
    case "service-management": {
      if (/list|show|all/.test(text)) return { name: "service.list", params: {} };
      const nameMatch = text.match(/(?:start|stop|restart|status|enable|disable)\s+(\S+)/);
      const serviceName = sanitizeToken(nameMatch?.[1], SAFE_NAME_PATTERN);
      if (/start\b/.test(text) && serviceName) return { name: "service.start", params: { name: serviceName } };
      if (/stop\b/.test(text) && serviceName) return { name: "service.stop", params: { name: serviceName } };
      if (/restart\b/.test(text) && serviceName) return { name: "service.restart", params: { name: serviceName } };
      if (/status\b/.test(text) && serviceName) return { name: "service.status", params: { name: serviceName } };
      return { name: "service.list", params: {} };
    }

    // ── Package management ──────────────────────────────────────────────
    case "package-management": {
      if (/\b(pip3?)\b.*\binstall\b/i.test(text) || /\b(cài\s*(?:đặt\s*)?thư\s*viện|install\s*(?:python\s*)?package)\b/i.test(text)) {
        const pkgMatch = intent.rawText.match(/\binstall\s+([a-zA-Z0-9_.-]+)\b/i)
          ?? intent.rawText.match(/\bthư\s*viện\s+([a-zA-Z0-9_.-]+)\b/i);
        const pkg = sanitizeToken(pkgMatch?.[1], SAFE_NAME_PATTERN) ?? "requests";
        return { name: "shell.exec", params: { command: `pip3 install ${pkg} 2>&1 | tail -20` } };
      }
      if (/startup\s*apps?|login\s*items?/.test(text)) {
        if (/list|show/.test(text)) {
          return { name: "shell.exec", params: { command: "osascript -e 'tell application \"System Events\" to get name of every login item' && echo '---' && ls ~/Library/LaunchAgents 2>/dev/null | head -30" } };
        }
        return { name: "shell.exec", params: { command: "open 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension' && echo 'Open Login Items settings.'" } };
      }
      if (/list|installed|show/.test(text)) return { name: "package.list", params: {} };
      if (/search\b/.test(text)) {
        const q = text.match(/search\s+(\S+)/);
        const query = sanitizeToken(q?.[1], SAFE_NAME_PATTERN) ?? "";
        return { name: "package.search", params: { query } };
      }
      if (/\binstall\b/.test(text)) {
        const pkg = text.match(/install\s+(\S+)/);
        const name = sanitizeToken(pkg?.[1], SAFE_NAME_PATTERN) ?? "";
        if (/(brew|cask|homebrew|chrome|firefox|slack|notion|docker|visual-studio-code|vscode)/i.test(text) && name) {
          const normalizedName = name === "vscode" ? "visual-studio-code" : name;
          const asCask = /cask|chrome|firefox|slack|notion|docker|visual-studio-code/.test(text + " " + normalizedName);
          return { name: "shell.exec", params: { command: asCask ? `brew install --cask ${normalizedName}` : `brew install ${normalizedName}` } };
        }
        return { name: "package.install", params: { name } };
      }
      if (/\b(?:remove|uninstall)\b/.test(text)) {
        const pkg = text.match(/(?:remove|uninstall)\s+(\S+)/);
        const name = sanitizeToken(pkg?.[1], SAFE_NAME_PATTERN) ?? "";
        if (name && /clean|leftover|residue|gỡ\s*cài\s*đặt|xóa\s*sạch/.test(text)) {
          return { name: "shell.exec", params: { command: `brew uninstall --zap --cask ${name} 2>/dev/null || brew uninstall ${name} 2>/dev/null || true; echo 'Uninstall cleanup attempted for ${name}'` } };
        }
        return { name: "package.remove", params: { name } };
      }
      if (/upgrade\s+all/.test(text)) return { name: "package.upgradeAll", params: {} };
      if (/upgrade\b/.test(text)) {
        const pkg = text.match(/upgrade\s+(\S+)/);
        const name = sanitizeToken(pkg?.[1], SAFE_NAME_PATTERN) ?? "";
        return { name: "package.upgrade", params: { name } };
      }
      return { name: "package.list", params: {} };
    }

    // ── Power management ────────────────────────────────────────────────
    case "power-management": {
      if (/\b(pin|battery)\b.*\b(dưới|below|under)\s*\d+%/i.test(intent.rawText)) {
        return { name: "shell.exec", params: { command: "BATT=$(pmset -g batt | grep -o '[0-9]*%' | head -1 | tr -d '%'); if [ -n \"$BATT\" ] && [ \"$BATT\" -lt 20 ]; then pmset -a lowpowermode 1; echo 'Low power mode enabled'; fi" } };
      }
      if (/low\s*power|power\s*save|tiết\s*kiệm\s*pin/.test(text)) return { name: "shell.exec", params: { command: "pmset -a lowpowermode 1 && echo 'Low power mode enabled'" } };
      if (/battery|charge|level|pin/.test(text)) return { name: "health.battery", params: {} };
      if (/sleep\b|ngủ\b/.test(text)) return { name: "shell.exec", params: { command: "pmset sleepnow" } };
      if (/shutdown|power off|tắt\s*máy/.test(text)) return { name: "shell.exec", params: { command: "osascript -e 'tell application \"System Events\" to shut down'" } };
      if (/restart|reboot|khởi\s*động\s*lại/.test(text)) return { name: "shell.exec", params: { command: "osascript -e 'tell application \"System Events\" to restart'" } };
      return { name: "health.battery", params: {} };
    }

    // ── Health check ────────────────────────────────────────────────────
    case "health-check": {
      if (/thermal|temperature|heat|fan/.test(text)) return { name: "health.thermal", params: {} };
      if (/battery/.test(text)) return { name: "health.battery", params: {} };
      if (/fsck|filesystem|file\s*system|integrity|chkdsk/.test(text)) {
        return { name: "health.filesystem", params: { volume: "/", autoRepair: false } };
      }
      if (/disk|storage/.test(text)) return { name: "health.filesystem", params: { volume: "/" } };
      if (/network/.test(text)) return { name: "health.networkDiagnose", params: {} };
      if (/cert|certificate|tls|ssl|expiry|expires/.test(text)) {
        const hostMatch = text.match(/(?:for|host|domain)\s+([a-z0-9.-]+\.[a-z]{2,})/i);
        return { name: "health.certExpiry", params: { host: hostMatch?.[1] || "google.com", port: 443 } };
      }
      if (/log|anomal|spike|error pattern/.test(text)) return { name: "health.logAnomalies", params: {} };
      if (/port exhaustion|socket|connection pool/.test(text)) return { name: "health.socketStats", params: {} };
      if (/security/.test(text)) return { name: "health.securityScan", params: {} };
      return { name: "health.thermal", params: {} };
    }

    // ── Thermal management ──────────────────────────────────────────────
    case "thermal-management": { return { name: "health.thermal", params: {} }; }

    // ── Disk management ─────────────────────────────────────────────────
    case "disk-management": {
      if (/usage|space|free/.test(text)) return { name: "shell.exec", params: { command: "df -h" } };
      if (/larg|big/.test(text)) return { name: "shell.exec", params: { command: "find / -xdev -type f -size +100M 2>/dev/null | head -20" } };
      return { name: "shell.exec", params: { command: "df -h" } };
    }

    // ── Disk cleanup ────────────────────────────────────────────────────
    case "disk-cleanup": {
      if (/defrag|trimforce|trim\s*ssd|ssd\s*trim|optimi[sz]e\s*disk/.test(text)) {
        if (/schedule|weekly|daily|cron|lên\s*lịch/.test(text)) {
          return { name: "shell.exec", params: { command: "(crontab -l 2>/dev/null; echo '0 3 * * 0 /usr/sbin/diskutil verifyVolume / >/tmp/omnistate-disk-verify.log 2>&1') | crontab - && echo 'Scheduled weekly disk verify at 03:00 Sunday.'" } };
        }
        if (/enable|bật/.test(text) && /trim/.test(text)) return { name: "shell.exec", params: { command: "sudo trimforce enable" } };
        return { name: "shell.exec", params: { command: "echo 'Checking TRIM status...' && system_profiler SPNVMeDataType SPSerialATADataType 2>/dev/null | grep -i TRIM -A1 && diskutil verifyVolume /" } };
      }
      return { name: "health.diskRescue", params: {} };
    }

    // ── Memory management ──────────────────────────────────────────────
    case "memory-management": { return { name: "shell.exec", params: { command: "vm_stat && echo '---' && top -l 1 -s 0 | head -12" } }; }

    // ── Audio management ────────────────────────────────────────────────
    case "audio-management": {
      if (/unmute/.test(text)) return { name: "shell.exec", params: { command: "osascript -e 'set volume without output muted'" } };
      if (/\bmute\b/.test(text)) return { name: "shell.exec", params: { command: "osascript -e 'set volume with output muted'" } };
      if (/volume/.test(text)) {
        const levelMatch = text.match(/(\d+)/);
        if (levelMatch) return { name: "audio.volume", params: { level: parseInt(levelMatch[1]) } };
        return { name: "audio.volume", params: {} };
      }
      if (/device/.test(text)) return { name: "audio.devices", params: {} };
      return { name: "audio.volume", params: {} };
    }

    // ── Display management ──────────────────────────────────────────────
    case "display-management": {
      if (/switch|external|monitor|display\s*mode|mirror|extend/.test(text)) {
        if (/mirror/.test(text)) {
          return { name: "shell.exec", params: { command: "if command -v displayplacer >/dev/null 2>&1; then displayplacer list; else open 'x-apple.systempreferences:com.apple.Displays-Settings.extension' && echo 'Opening Displays settings.'; fi" } };
        }
        if (/extend/.test(text)) {
          return { name: "shell.exec", params: { command: "if command -v displayplacer >/dev/null 2>&1; then displayplacer list; else open 'x-apple.systempreferences:com.apple.Displays-Settings.extension' && echo 'Opening Displays settings.'; fi" } };
        }
        return { name: "shell.exec", params: { command: "open 'x-apple.systempreferences:com.apple.Displays-Settings.extension' && echo 'Open Displays settings or use displayplacer.'" } };
      }
      if (/brightness/.test(text)) {
        const levelMatch = text.match(/(\d+)/);
        if (levelMatch) return { name: "display.brightness", params: { level: parseInt(levelMatch[1]) } };
        return { name: "display.brightness", params: {} };
      }
      if (/resolution/.test(text)) return { name: "display.list", params: {} };
      return { name: "display.list", params: {} };
    }

    // ── Container management ────────────────────────────────────────────
    case "container-management": {
      if (/(docker\s*compose|compose\s*up|start\s*compose)/.test(text)) return { name: "shell.exec", params: { command: "docker compose up -d" } };
      if (/(compose\s*down|stop\s*compose)/.test(text)) return { name: "shell.exec", params: { command: "docker compose down" } };
      if (/(compose\s*restart|restart\s*compose)/.test(text)) return { name: "shell.exec", params: { command: "docker compose restart" } };
      if (/\blogs?\b/i.test(text)) {
        const containerMatch = intent.rawText.match(/\blogs?\s+(?:of\s+)?([a-zA-Z0-9_.-]+)\b/i);
        const container = sanitizeToken(containerMatch?.[1], SAFE_DOCKER_TARGET_PATTERN);
        if (container) return { name: "shell.exec", params: { command: `docker logs --tail=100 ${container} 2>&1` } };
        return { name: "shell.exec", params: { command: "docker ps && docker logs --tail=50 $(docker ps -q | head -1) 2>/dev/null || echo 'No containers'" } };
      }
      if (/(create|setup|init).*(venv|virtual\s*env|python\s*env)/.test(text)) {
        const dirMatch = intent.rawText.match(/(?:in|at|path)\s+([~/\w./-]+)/i);
        const targetDir = (dirMatch?.[1] ?? ".").replace(/"/g, '\\"');
        return { name: "shell.exec", params: { command: `cd "${targetDir}" && python3 -m venv .venv && echo "Virtual env created at ${targetDir}/.venv"` } };
      }
      if (/(activate|use).*(venv|virtual\s*env|python\s*env)/.test(text)) {
        return { name: "shell.exec", params: { command: "if [ -f .venv/bin/activate ]; then source .venv/bin/activate && python --version; else echo '.venv not found'; fi" } };
      }
      if (/list|running|ps/.test(text)) return { name: "shell.exec", params: { command: "docker ps" } };
      if (/image/.test(text)) return { name: "shell.exec", params: { command: "docker images" } };
      if (/stop\b/.test(text)) {
        const c = text.match(/stop\s+(\S+)/);
        const container = sanitizeToken(c?.[1], SAFE_DOCKER_TARGET_PATTERN);
        return { name: "shell.exec", params: { command: container ? `docker stop ${container}` : "docker ps" } };
      }
      return { name: "shell.exec", params: { command: "docker ps -a" } };
    }

    // ── Security management ─────────────────────────────────────────────
    case "security-management": {
      if (/firewall/.test(text)) return { name: "network.firewall", params: {} };
      if (/(camera|webcam|microphone|mic)/.test(text)) {
        if (/(lock|block|disable|revoke|deny|off|kh[oó]a|ch[ặa]n|t[ắa]t)/.test(text)) {
          return { name: "shell.exec", params: { command: "tccutil reset Camera && tccutil reset Microphone && echo 'Camera/Microphone permissions reset. Apps must request permission again.'" } };
        }
        if (/(unlock|allow|enable|on|m[ởo])/.test(text)) {
          return { name: "shell.exec", params: { command: "open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera' && open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'" } };
        }
        return { name: "shell.exec", params: { command: "sqlite3 \"$HOME/Library/Application Support/com.apple.TCC/TCC.db\" \"select service,client from access where service in ('kTCCServiceCamera','kTCCServiceMicrophone') limit 60;\"" } };
      }
      if (/(password|vault|bitwarden|1password|autofill\s*password|điền\s*mật\s*khẩu)/.test(text)) {
        const itemMatch = text.match(/(?:for|item|entry|cho)\s+['\"]?([^'\"]+)['\"]?/i);
        const item = (itemMatch?.[1] ?? "").trim();
        const safeItem = item.replace(/[^a-zA-Z0-9 _.:@+-]/g, "").trim();
        if (/(bitwarden|\bbw\b)/.test(text)) {
          if (safeItem) return { name: "shell.exec", params: { command: `bw get password "${safeItem}" | pbcopy && echo 'Password copied from Bitwarden: ${safeItem}'` } };
          return { name: "shell.exec", params: { command: "bw list items | head -20" } };
        }
        if (/(1password|\bop\b)/.test(text)) {
          if (safeItem) return { name: "shell.exec", params: { command: `op item get "${safeItem}" --fields password | pbcopy && echo 'Password copied from 1Password: ${safeItem}'` } };
          return { name: "shell.exec", params: { command: "op item list | head -20" } };
        }
        return { name: "shell.exec", params: { command: "echo 'Specify vault provider and item name, e.g. bitwarden for github or 1password for aws'" } };
      }
      if (/(encrypt|decrypt|lock\s*folder|unlock\s*folder|mã\s*hóa|giải\s*mã|khóa\s*thư\s*mục)/.test(text)) {
        const pathMatch = intent.rawText.match(/(?:folder|dir|directory|thư\s*mục|path)\s*[:=]?\s*["']?([^"'\n]+)["']?/i);
        const folder = (pathMatch?.[1] ?? "").trim().replace(/"/g, '\\"');
        if (/decrypt|unlock|giải\s*mã|mở\s*khóa/.test(text)) {
          if (folder) return { name: "shell.exec", params: { command: `hdiutil attach "${folder}" && echo "Mounted encrypted volume: ${folder}"` } };
          return { name: "shell.exec", params: { command: "echo 'Provide encrypted dmg path, e.g. unlock folder path: ~/Secure/Docs.dmg'" } };
        }
        if (folder) {
          const base = folder.split("/").filter(Boolean).pop() || "secure-data";
          return { name: "shell.exec", params: { command: `echo 'You will be prompted for encryption password'; hdiutil create -encryption -stdinpass -srcfolder "${folder}" "${base}.encrypted.dmg"` } };
        }
        return { name: "shell.exec", params: { command: "echo 'Provide folder path to encrypt, e.g. encrypt folder path: ~/Documents/Secret'" } };
      }
      if (/(secure\s*delete|secure\s*shred|shred\s*file|xóa\s*an\s*toàn)/.test(text)) {
        const targetMatch = intent.rawText.match(/(?:file|folder|path|tệp|thư\s*mục)\s*[:=]?\s*["']?([^"'\n]+)["']?/i);
        const target = (targetMatch?.[1] ?? "").trim().replace(/"/g, '\\"');
        if (target) return { name: "shell.exec", params: { command: `if command -v srm >/dev/null 2>&1; then srm -vz "${target}"; else rm -P "${target}" 2>/dev/null || rm -rf "${target}"; fi && echo 'Secure delete attempted for ${target}'` } };
        return { name: "shell.exec", params: { command: "echo 'Provide file/folder path for secure delete, e.g. secure shred file path: ~/Desktop/secret.txt'" } };
      }
      if (/cert/.test(text)) return { name: "shell.exec", params: { command: "security find-certificate -a /Library/Keychains/System.keychain | grep 'labl' | head -20" } };
      return { name: "shell.exec", params: { command: "sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate" } };
    }

    // ── Clipboard management ────────────────────────────────────────────
    case "clipboard-management": { return { name: "shell.exec", params: { command: "pbpaste | head -20" } }; }

    // ── Peripheral management ───────────────────────────────────────────
    case "peripheral-management": {
      if (/(safe\s*eject|eject\s*(usb|drive|disk)|unmount\s*(usb|drive|disk)|th[aá]o\s*(usb|ổ\s*cứng))/i.test(text)) {
        const diskMatch = intent.rawText.match(/(?:disk|drive|usb)\s*[:=]?\s*(disk\d+)/i);
        const diskId = (diskMatch?.[1] ?? "").toLowerCase();
        if (diskId) return { name: "shell.exec", params: { command: `diskutil unmountDisk /dev/${diskId} && echo "Safely ejected /dev/${diskId}"` } };
        return { name: "shell.exec", params: { command: "diskutil list external && echo 'Specify target disk like: safe eject disk: disk2'" } };
      }
      if (/(turn\s*on|enable|bật).*(bluetooth|bt)/.test(text)) {
        return { name: "shell.exec", params: { command: "if command -v blueutil >/dev/null 2>&1; then blueutil --power 1 && echo 'Bluetooth enabled'; else open 'x-apple.systempreferences:com.apple.BluetoothSettings'; fi" } };
      }
      if (/(turn\s*off|disable|tắt).*(bluetooth|bt)/.test(text)) {
        return { name: "shell.exec", params: { command: "if command -v blueutil >/dev/null 2>&1; then blueutil --power 0 && echo 'Bluetooth disabled'; else open 'x-apple.systempreferences:com.apple.BluetoothSettings'; fi" } };
      }
      if (/(bluetooth|bt).*(toggle|switch)/.test(text)) {
        return { name: "shell.exec", params: { command: "if command -v blueutil >/dev/null 2>&1; then blueutil --power toggle && echo 'Bluetooth toggled'; else open 'x-apple.systempreferences:com.apple.BluetoothSettings'; fi" } };
      }
      if (/bluetooth|bt/.test(text)) return { name: "shell.exec", params: { command: "system_profiler SPBluetoothDataType 2>/dev/null | head -30" } };
      if (/usb/.test(text)) return { name: "shell.exec", params: { command: "system_profiler SPUSBDataType | head -40" } };
      return { name: "shell.exec", params: { command: "system_profiler SPBluetoothDataType SPUSBDataType 2>/dev/null | head -40" } };
    }

    // ── Font / locale management ───────────────────────────────────────
    case "font-locale-management": {
      if (/locale|language|lang/.test(text)) return { name: "shell.exec", params: { command: "defaults read -g AppleLocale 2>/dev/null || echo unknown" } };
      return { name: "shell.exec", params: { command: "system_profiler SPFontsDataType 2>/dev/null | head -40" } };
    }

    // ── Printer management ─────────────────────────────────────────────
    case "printer-management": {
      if (/(scanner|scan|máy\s*quét)/.test(text)) {
        return { name: "shell.exec", params: { command: "system_profiler SPPrintersDataType | sed -n '1,120p' && echo 'Use Image Capture for scan operations.'" } };
      }
      if (/(cancel|clear).*(print|job|queue)/.test(text)) return { name: "shell.exec", params: { command: "cancel -a && lpstat -o" } };
      if (/(print\s*queue|jobs?)/.test(text)) return { name: "shell.exec", params: { command: "lpstat -o" } };
      if (/(set|switch).*(default\s*printer|printer\s*default)/.test(text)) {
        const pMatch = intent.rawText.match(/(?:printer|to)\s*[:=]?\s*['\"]?([a-zA-Z0-9._ -]+)['\"]?/i);
        const printer = (pMatch?.[1] ?? "").trim().replace(/"/g, '\\"');
        if (printer) return { name: "shell.exec", params: { command: `lpoptions -d "${printer}" && lpstat -d` } };
      }
      if (/default/.test(text)) return { name: "shell.exec", params: { command: "lpstat -d" } };
      return { name: "shell.exec", params: { command: "lpstat -p -d" } };
    }

    // ── User ACL management ────────────────────────────────────────────
    case "user-acl-management": {
      if (/list|show|users?/.test(text)) return { name: "shell.exec", params: { command: "dscl . list /Users | head -30" } };
      return { name: "shell.exec", params: { command: "id && groups" } };
    }

    // ── OS config ───────────────────────────────────────────────────────
    case "os-config": {
      if (/dark\s*mode/.test(text)) return { name: "os.darkMode", params: {} };
      if (/(do\s*not\s*disturb|\bdnd\b|focus\s*mode|chế\s*độ\s*tập\s*trung)/.test(text)) {
        if (/(turn\s*on|enable|bật)/.test(text)) {
          return { name: "shell.exec", params: { command: "shortcuts run 'Turn On Do Not Disturb' 2>/dev/null || open 'x-apple.systempreferences:com.apple.Focus-Settings.extension' && echo 'Focus/DND requested.'" } };
        }
        if (/(turn\s*off|disable|tắt)/.test(text)) {
          return { name: "shell.exec", params: { command: "shortcuts run 'Turn Off Do Not Disturb' 2>/dev/null || open 'x-apple.systempreferences:com.apple.Focus-Settings.extension' && echo 'Focus/DND requested.'" } };
        }
        return { name: "shell.exec", params: { command: "defaults -currentHost read com.apple.controlcenter FocusModes 2>/dev/null || echo 'Open Focus settings.'" } };
      }
      if (/dns/.test(text)) return { name: "os.dns", params: {} };
      if (/proxy/.test(text)) return { name: "os.proxy", params: {} };
      return { name: "system.info", params: {} };
    }

    // ── Hardware control ────────────────────────────────────────────────
    case "hardware-control": {
      if (/brightness/.test(text)) return { name: "display.brightness", params: {} };
      if (/volume/.test(text)) return { name: "audio.volume", params: {} };
      if (/bluetooth/.test(text)) return { name: "shell.exec", params: { command: "system_profiler SPBluetoothDataType" } };
      return { name: "system.info", params: {} };
    }

    // ── Network diagnose ────────────────────────────────────────────────
    case "network-diagnose": {
      return { name: "shell.exec", params: { command: "ping -c 3 8.8.8.8 && echo '---' && networksetup -getairportnetwork en0 && echo '---' && curl -s -o /dev/null -w '%{http_code}' https://www.google.com" } };
    }

    // ── Security scan ───────────────────────────────────────────────────
    case "security-scan": {
      return { name: "shell.exec", params: { command: "sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate && echo '---' && security list-keychains" } };
    }

    // ── Self-healing ────────────────────────────────────────────────────
    case "self-healing": {
      if (/repair\s*(?:my\s*)?(?:network|internet)|fix\s*(?:network|internet)|flush\s*dns|renew\s*dhcp/.test(text)) {
        return { name: "shell.exec", params: { command: "echo 'Running automatic network repair...' && networksetup -setairportpower en0 off && sleep 1 && networksetup -setairportpower en0 on && dscacheutil -flushcache && sudo killall -HUP mDNSResponder 2>/dev/null || true && ping -c 2 8.8.8.8" } };
      }
      if (/optimi[sz]e\s*(?:system\s*)?performance|memory\s*leak|high\s*cpu|high\s*memory/.test(text)) {
        return { name: "shell.exec", params: { command: "echo 'Collecting performance diagnostics...' && top -l 1 -o cpu | head -20 && echo '---' && vm_stat && echo '---' && memory_pressure" } };
      }
      if (/network|dns|internet|connect/.test(text)) return { name: "health.networkDiagnose", params: {} };
      if (/fsck|filesystem|file\s*system|integrity|chkdsk/.test(text)) return { name: "health.filesystem", params: { volume: "/", autoRepair: false } };
      if (/cert|certificate|tls|ssl|expiry|expires/.test(text)) {
        const hostMatch = text.match(/(?:for|host|domain)\s+([a-z0-9.-]+\.[a-z]{2,})/i);
        return { name: "health.certExpiry", params: { host: hostMatch?.[1] || "google.com", port: 443 } };
      }
      if (/log|anomal|error pattern/.test(text)) return { name: "health.logAnomalies", params: {} };
      if (/port exhaustion|socket|connection pool/.test(text)) return { name: "health.socketStats", params: {} };
      if (/security|attack|suspicious|malware/.test(text)) return { name: "health.securityScan", params: {} };
      if (/disk|storage|full|cleanup/.test(text)) return { name: "health.diskRescue", params: {} };
      if (/battery/.test(text)) return { name: "health.battery", params: {} };
      return { name: "health.thermal", params: {} };
    }

    // ── Backup/restore ──────────────────────────────────────────────────
    case "backup-restore": {
      if (/status|check/.test(text)) return { name: "shell.exec", params: { command: "tmutil status" } };
      if (/list/.test(text)) return { name: "shell.exec", params: { command: "tmutil listbackups 2>/dev/null | tail -5" } };
      return { name: "shell.exec", params: { command: "tmutil status" } };
    }

    // ── Update management ───────────────────────────────────────────────
    case "update-management": {
      if (/install|cask|brew\s*install/.test(text)) {
        const pkgMatch = intent.rawText.match(/(?:install|cài\s*đặt)\s+([a-zA-Z0-9@._+-]+)/i)
          ?? intent.rawText.match(/\b(?:app|package|gói)\s*[:=]\s*([a-zA-Z0-9@._+-]+)/i);
        const pkg = (pkgMatch?.[1] ?? "").trim();
        if (pkg) {
          const asCask = /(chrome|firefox|slack|notion|visual\s*studio\s*code|vscode|docker)/i.test(pkg);
          const normalizedPkg = pkg.toLowerCase() === "vscode" ? "visual-studio-code" : pkg;
          return { name: "shell.exec", params: { command: asCask ? `brew install --cask ${normalizedPkg}` : `brew install ${normalizedPkg}` } };
        }
        return { name: "shell.exec", params: { command: "brew search | head -30" } };
      }
      if (/uninstall|remove\s*app|gỡ\s*cài\s*đặt|brew\s*uninstall/.test(text)) {
        const pkgMatch = intent.rawText.match(/(?:uninstall|remove|gỡ\s*cài\s*đặt)\s+([a-zA-Z0-9@._+-]+)/i)
          ?? intent.rawText.match(/\b(?:app|package|gói)\s*[:=]\s*([a-zA-Z0-9@._+-]+)/i);
        const pkg = (pkgMatch?.[1] ?? "").trim();
        if (pkg) {
          const normalizedPkg = pkg.toLowerCase() === "vscode" ? "visual-studio-code" : pkg;
          return { name: "shell.exec", params: { command: `brew uninstall --zap --cask ${normalizedPkg} 2>/dev/null || brew uninstall ${normalizedPkg} 2>/dev/null || true; echo "Uninstall attempted for ${normalizedPkg}"` } };
        }
        return { name: "shell.exec", params: { command: "brew list --cask && echo '---' && brew list --formula" } };
      }
      if (/startup\s*apps?|login\s*items?|launch\s*at\s*startup/.test(text)) {
        if (/list|show/.test(text)) return { name: "shell.exec", params: { command: "osascript -e 'tell application \"System Events\" to get name of every login item' && echo '---' && ls ~/Library/LaunchAgents 2>/dev/null | head -30" } };
        return { name: "shell.exec", params: { command: "open 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension' && echo 'Open Login Items settings.'" } };
      }
      if (/update|upgrade|patch|software\s*update/.test(text)) {
        if (/all|everything|toàn\s*bộ/.test(text)) return { name: "shell.exec", params: { command: "softwareupdate -l && echo '---' && brew update && brew upgrade" } };
      }
      if (/brew/.test(text)) return { name: "shell.exec", params: { command: "brew outdated" } };
      return { name: "shell.exec", params: { command: "softwareupdate -l 2>&1 | head -20" } };
    }

    // ── Display/audio combined ──────────────────────────────────────────
    case "display-audio": {
      if (/switch|external|monitor|display\s*mode|mirror|extend/.test(text)) {
        return { name: "shell.exec", params: { command: "open 'x-apple.systempreferences:com.apple.Displays-Settings.extension' && echo 'Open Displays settings or use displayplacer.'" } };
      }
      if (/audio|volume|sound/.test(text)) return { name: "audio.volume", params: {} };
      return { name: "display.list", params: {} };
    }

    // ── Domain D: Hybrid intent types ───────────────────────────────────
    case "script-generation": {
      const language = /python|py script/.test(text) ? "python" : /applescript|apple script/.test(text) ? "applescript" : "bash";
      return { name: "hybrid.generateScript", params: { description: intent.rawText, language } };
    }
    case "voice-control": { return { name: "hybrid.speak", params: { text: intent.rawText } }; }
    case "automation-macro": {
      if (/list|show/.test(text)) return { name: "hybrid.macro.list", params: {} };
      if (/stop/.test(text)) return { name: "hybrid.macro.stop", params: {} };
      if (/\bstart\b|\brecord\b/.test(text)) return { name: "hybrid.macro.start", params: {} };
      return { name: "hybrid.macro.list", params: {} };
    }
    case "workflow-template": { return { name: "hybrid.templates", params: {} }; }
    case "file-organization": {
      if (/desktop/.test(text)) return { name: "hybrid.organizeFiles", params: { dirPath: `${process.env.HOME ?? "~"}/Desktop`, strategy: "group-by-extension" } };
      if (/downloads?/.test(text)) return { name: "hybrid.organizeFiles", params: { dirPath: `${process.env.HOME ?? "~"}/Downloads`, strategy: "group-by-date" } };
      return { name: "hybrid.organizeFiles", params: { dirPath: process.cwd(), strategy: "smart-workspace" } };
    }
    case "debug-assist": {
      if (/(log|error|crash|stack\s*trace|traceback|summari[sz]e\s*logs?|analy[sz]e\s*logs?)/.test(text)) {
        return { name: "shell.exec", params: { command: "echo '=== Recent Errors (24h) ===' && log show --last 24h --predicate 'eventMessage CONTAINS[c] \"error\" OR eventMessage CONTAINS[c] \"exception\" OR eventMessage CONTAINS[c] \"crash\"' --style compact 2>/dev/null | head -80 && echo '---' && echo '=== Error Summary ===' && log show --last 24h --style compact 2>/dev/null | grep -Ei 'error|exception|crash' | awk '{print tolower($0)}' | sed -E 's/.*(error|exception|crash).*/\\1/' | sort | uniq -c | sort -nr | head -10" } };
      }
      return { name: "hybrid.analyzeError", params: { error: { message: intent.rawText } } };
    }
    case "compliance-check": { return { name: "hybrid.compliance", params: {} }; }
    case "resource-forecast": {
      const metric = /disk|storage/.test(text) ? "disk" : /memory|ram/.test(text) ? "memory" : "cpu";
      return { name: "hybrid.forecast", params: { metric, days: 7 } };
    }
    case "multi-app-orchestration": { return { name: "hybrid.suggestAction", params: {} }; }

    default:
      return null;
  }
}

// ============================================================================
// Decompose system prompt
// ============================================================================

export const DECOMPOSE_SYSTEM_PROMPT = `You are a task planner for a macOS computer-automation assistant.
Break the user's complex task into an ordered list of concrete sub-steps.
Each step must be classifiable as one of: shell-command, app-launch, app-control, file-operation, ui-interaction, system-query.

IMPORTANT: The user may write in Vietnamese. Parse Vietnamese commands correctly:
- "mở" = open/launch  |  "truy cập" / "vào" = navigate to  |  "tìm" = search/find
- "nhấp" / "click" = click  |  "cuộn" = scroll  |  "gõ" / "nhập" = type
- "đóng" / "tắt" = close/quit  |  "sau đó" / "rồi" / "tiếp theo" = then (sequence)
- "video đầu tiên" = first video  |  "kết quả đầu tiên" = first result
- "trên" = on (platform)  |  "bằng" = using/with  |  "qua" = via

Semantic parsing rules:
- Extract: action verb, target object, platform/app, modifier (first/latest/etc.)
- "mở X trên Y" = navigate to X using browser Y
- "mở video đầu tiên của youtube trên Safari" = open Safari → go to YouTube → click first video

Tool mapping:
- app.launch   → launch an application
- app.activate → bring app to foreground
- app.script   → run AppleScript (browser navigation, YouTube click, UI automation)
- shell.exec   → run shell command
- ui.click     → click UI element
- ui.type      → type text
- ui.key       → keyboard shortcut

Example: "Mở safari, truy cập youtube sau đó mở video đầu tiên":
{
  "steps": [
    { "description": "Open Safari browser", "type": "app-launch", "tool": "app.launch" },
    { "description": "Navigate to https://www.youtube.com in Safari", "type": "app-control", "tool": "app.script" },
    { "description": "Click the first video on YouTube homepage", "type": "app-control", "tool": "app.script" }
  ]
}

Respond with ONLY valid JSON (no markdown, no commentary):
{
  "steps": [
    { "description": "<step text in English>", "type": "<intent-type>", "tool": "<tool.verb>" }
  ]
}`;

// ============================================================================
// Multi-step decomposition
// ============================================================================

async function decomposeMultiStep(
  text: string,
  episodicContext?: string,
  kgContext?: string,
): Promise<DecomposedStep[] | null> {
  if (!isLlmRequired()) {
    return null;
  }

  const budget = resolveEffectiveBudget();

  try {
    let systemPrompt = DECOMPOSE_SYSTEM_PROMPT;
    if (episodicContext) systemPrompt += episodicContext;
    if (kgContext) systemPrompt += `\n\nKnown context:\n${kgContext}`;
    const response = await requestLlmTextWithFallback({
      system: systemPrompt,
      user: text.slice(0, budget.maxInputChars),
      maxTokens: budget.decomposeMax,
    });

    const raw = response.text;

    const parsed = parseLlmJson<{ steps?: unknown[] }>(raw);
    if (!Array.isArray(parsed.steps)) return null;

    return parsed.steps
      .filter(
        (s): s is Record<string, unknown> =>
          typeof s === "object" && s !== null,
      )
      .map((s) => ({
        description: String(s["description"] ?? ""),
        type: INTENT_TYPES.includes(s["type"] as IntentType)
          ? (s["type"] as IntentType)
          : "shell-command",
        tool: String(s["tool"] ?? "generic.execute"),
      }));
  } catch {
    return null;
  }
}

// ============================================================================
// Episodic & KG context accessors
// ============================================================================

let _episodicStore: EpisodicStore | null = null;
export function getEpisodicStore(): EpisodicStore {
  if (!_episodicStore) {
    _episodicStore = new EpisodicStore(getDb(), getEmbeddingProvider());
  }
  return _episodicStore;
}

let _knowledgeGraph: KnowledgeGraph | null = null;
export function getKnowledgeGraph(): KnowledgeGraph {
  if (!_knowledgeGraph) {
    _knowledgeGraph = new KnowledgeGraph(getDb());
  }
  return _knowledgeGraph;
}

// ============================================================================
// planFromIntent — main public entry point
// ============================================================================

/**
 * Build a StatePlan (DAG of StateNodes) from a classified intent.
 */
export async function planFromIntent(intent: Intent): Promise<StatePlan> {
  const taskId = `task-${Date.now()}`;
  const nodes: StateNode[] = [];

  // Inject episodic recall context into intent for downstream planning
  let episodicContext = "";
  try {
    const store = getEpisodicStore();
    const episodes = await store.recall(intent.rawText, { limit: 3 });
    if (episodes.length > 0) {
      episodicContext =
        "\n\nPast relevant experiences:\n" +
        episodes
          .map(
            (e) =>
              `- Goal: "${e.goal}" → ${e.success ? "succeeded" : "failed"} (tools: ${e.toolsUsed.join(", ")}). Summary: ${e.summary}`,
          )
          .join("\n");
      logger.debug({ count: episodes.length }, "[planFromIntent] injected episodic context");
    }
  } catch (err) {
    logger.warn({ err }, "[planFromIntent] episodic recall failed, continuing without context");
  }

  // Inject KG entity context for downstream planning
  let kgContext = "";
  try {
    const kg = getKnowledgeGraph();
    const entity = kg.resolveReference(intent.rawText);
    if (entity) {
      const related = kg.getRelated(entity.id);
      kgContext = kg.toContextSnippet([entity, ...related.map((r) => r.entity)]);
      logger.debug({ entityId: entity.id, name: entity.name }, "[planFromIntent] resolved KG entity");
    }
  } catch (err) {
    logger.warn({ err }, "[planFromIntent] KG entity resolution failed, continuing without context");
  }

  switch (intent.type as IntentType) {
    // ── shell-command ────────────────────────────────────────────────────────
    case "shell-command": {
      const cmd = extractShellCommand(intent);
      nodes.push(
        actionNode(
          "exec",
          intent.rawText,
          "shell.exec",
          "deep",
          { command: cmd, entities: intent.entities },
        ),
      );
      break;
    }

    // ── app-launch ────────────────────────────────────────────────────────────
    case "app-launch": {
      const appEntity = Object.values(intent.entities).find(
        (e) => e.type === "app",
      );
      const appName = appEntity?.value ?? intent.rawText;

      nodes.push(
        actionNode(
          "launch",
          `Launch ${appName}`,
          "app.launch",
          "deep",
          { name: appName, entities: intent.entities },
          [],
          "verify-launch",
        ),
      );
      nodes.push(
        verifyNode(
          "verify-launch",
          `Verify ${appName} is open and focused`,
          `${appName} window visible and active`,
          ["launch"],
        ),
      );
      break;
    }

    // ── file-operation ───────────────────────────────────────────────────────
    case "file-operation": {
      const cmd = extractShellCommand(intent);
      nodes.push(
        actionNode(
          "file-op",
          intent.rawText,
          "shell.exec",
          "deep",
          { command: cmd, entities: intent.entities },
        ),
      );
      break;
    }

    // ── app-control ─────────────────────────────────────────────────────────
    case "app-control": {
      const branchStartLen = nodes.length;

      // ── Pre-built plan: Vietnamese browser chain ──
      const viOnBrowserMatch = /^(?:mở|open)\s+(.+?)\s+(?:trên|bằng|qua|trong)\s+(safari|chrome|firefox|brave|arc|edge)/i.exec(intent.rawText);
      if (viOnBrowserMatch) {
        const queryPart3 = viOnBrowserMatch[1]?.trim() ?? "";
        const browserPart = viOnBrowserMatch[2]?.trim() ?? "safari";
        const browserNorm = normalizeAppName(browserPart);
        const isYouTube3 = /youtube/i.test(queryPart3);
        const isFirstVideo3 = /\b(?:video\s*đầu\s*tiên|đầu\s*tiên|first\s*video)\b/i.test(queryPart3);
        const ytScript = (() => {
          const ytUrl = "https://www.youtube.com";
          const safeYtUrl3 = escapeAppleScriptString(ytUrl);
          if (isYouTube3 && isFirstVideo3 && browserNorm === "Safari") {
            const js3 = escapeAppleScriptString(
              'setTimeout(function(){' +
              'var sel="ytd-video-renderer a#video-title,ytd-rich-item-renderer a#video-title-link";' +
              'var l=document.querySelector(sel);' +
              'if(l){l.click();}else{var lks=document.querySelectorAll("a[href*=\\"/watch\\"]");if(lks.length)lks[0].click();}' +
              '},2500);'
            );
            return `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${safeYtUrl3}"\ndelay 2.5\ndo JavaScript "${js3}" in current tab of front window\nend tell`;
          }
          if (isYouTube3 && browserNorm === "Safari") {
            return `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${safeYtUrl3}"\nend tell`;
          }
          return null;
        })();
        if (ytScript) {
          nodes.push(actionNode("launch-browser", `Launch ${browserNorm}`, "app.launch", "deep", { name: browserNorm }));
          nodes.push(actionNode("navigate-action", intent.rawText, "app.script", "deep", { script: ytScript, entities: intent.entities }, ["launch-browser"]));
          break;
        }
      }

      let appRaw = extractAppName(intent);
      if (!appRaw && /\b(?:on|in)\s+safari\b/i.test(intent.rawText)) appRaw = "safari";
      if (!appRaw && /\bopen\s+.+\s+on\s+youtube\b/i.test(intent.rawText)) appRaw = "safari";
      const app = appRaw ? normalizeAppName(appRaw) : null;
      const text = intent.rawText.toLowerCase();
      const isQuit = /\b(quit|exit)\b/i.test(text);

      if (isQuit && app) {
        nodes.push(actionNode("app-quit", `Quit ${app}`, "app.quit", "deep", { name: app }));
        break;
      }

      if (app) {
        nodes.push(actionNode("activate", `Activate ${app}`, "app.activate", "deep", { name: app }, [], "action"));
      }

      const script = isMessagingIntentText(intent.rawText)
        ? await buildMessagingScriptWithLLM(intent)
        : buildAppControlScript(intent);
      const keyAction = buildKeyboardAction(intent);

      if (script) {
        nodes.push(actionNode("action", intent.rawText, "app.script", "deep", { script, entities: intent.entities }, app ? ["activate"] : []));
      } else if (keyAction) {
        nodes.push(actionNode("action", intent.rawText, "ui.key", "surface", keyAction, app ? ["activate"] : []));
      } else if (/\b(thông\s*báo|notify\s*me|remind\s*me)\b/i.test(intent.rawText) && /(\d+)\s*(giây|giay|s|phút|phut|p|giờ|gio|h)\b/i.test(intent.rawText)) {
        // Time-based notification: "thông báo sau X giây/phút" → alarm.set
        const text = intent.rawText;
        const timeMatch = text.match(/(\d+)\s*(giây|giay|s|phút|phut|p|giờ|gio|h)\b/i);
        const number = Number(timeMatch?.[1] ?? 0);
        const unit = (timeMatch?.[2] ?? "").toLowerCase();
        let seconds: number | undefined;
        let minutes: number | undefined;
        if (["giây", "giay", "s"].includes(unit)) seconds = number;
        else if (["phút", "phut", "p"].includes(unit)) minutes = number;
        else if (["giờ", "gio", "h"].includes(unit)) seconds = number * 3600;

        const message = text
          .replace(/\b(thông\s*báo|notify\s*me|remind\s*me)\b/gi, "")
          .replace(/\b(sau|in)\s*\d+\s*(giây|giay|s|phút|phut|p|giờ|gio|h)\b/gi, "")
          .replace(/\d+\s*(giây|giay|s|phút|phut|p|giờ|gio|h)\b/gi, "")
          .replace(/\s+/g, " ")
          .trim() || "Timer finished!";
        nodes.push(actionNode("alarm", intent.rawText, "alarm.set", "deep", {
          ...(seconds !== undefined ? { seconds } : {}),
          ...(minutes !== undefined ? { minutes } : {}),
          message,
          entities: intent.entities,
        }));
      } else if (/\b(reminder|timer|alarm|báo\s*thức|nhắc\s*nhở|thông\s*báo)\b/i.test(intent.rawText)) {
        // Reminder intent with no recognized app → build reminder AppleScript directly
        const escaped = escapeAppleScriptString(intent.rawText.replace(/\b(?:set\s*)?(?:reminder|timer|alarm|báo\s*thức|nhắc\s*nhở)\s*(?:to\s*)?/i, "").trim() || intent.rawText);
        const reminderScript = `tell application "Reminders"\ntell list "Reminders"\nmake new reminder with properties {name:"${escaped}"}\nend tell\nend tell`;
        nodes.push(actionNode("reminder", intent.rawText, "app.script", "deep", { script: reminderScript, entities: intent.entities }));
      } else if (app) {
        nodes.push(actionNode("action", intent.rawText, "app.quit", "deep", { name: app }, ["activate"]));
      }

      if (nodes.length === branchStartLen) {
        nodes.push(actionNode("action", intent.rawText, "generic.execute", "deep", { intent: intent.rawText, entities: intent.entities }));
      }
      break;
    }

    // ── voice-control ─────────────────────────────────────────────────────────
    case "voice-control": {
      // Reminders → app.script
      if (/\b(reminder|timer|alarm|báo\s*thức|nhắc\s*nhở|thông\s*báo)\b/i.test(intent.rawText)) {
        const reminderText = intent.rawText
          .replace(/.*(?:reminder|timer|alarm|báo\s*thức|nhắc\s*nhở)\s*(?:to\s*)?/i, "")
          .trim();
        const escaped = escapeAppleScriptString(reminderText || intent.rawText);
        const script = `tell application "Reminders"\ntell list "Reminders"\nmake new reminder with properties {name:"${escaped}"}\nend tell\nend tell`;
        nodes.push(actionNode("reminder", intent.rawText, "app.script", "deep", { script, entities: intent.entities }));
      // YouTube / music playback → multi-step YouTube chain if video search, else speak
      } else if (/\b(youtube|bài\s*hát|bài\s*nhạc|nhạc|music|hát|song|spotify|podcast)\b/i.test(intent.rawText)) {
        // Route YouTube video searches to the multi-step chain (real browser automation)
        const isYouTubeVideoSearch =
          /youtube/i.test(intent.rawText) &&
          /(?:video|bài\s*hát|bài|clip|nhạc|search|tìm|mở|xem)/i.test(intent.rawText) &&
          !/(?:mở|open|launch)\s+(?:safar|chrome|firefox)\b/i.test(intent.rawText);

        if (isYouTubeVideoSearch) {
          const rawText = intent.rawText;
          const cleanQuery = rawText
            .replace(/(?:giúp\s*tôi|mở|xem|tìm|phát|play)\s*/gi, "")
            .replace(/\s*trên\s*youtube/gi, "")
            .replace(/\s*trên\s*(?:safari|chrome|firefox|brave)/gi, "")
            .replace(/\s*trên\s*(?:trình\s*duyệt|browser)/gi, "")
            .trim();
          const ytSearchUrl = escapeAppleScriptString(`https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`);
          const firstVideoJs = escapeAppleScriptString('setTimeout(function(){var sel="ytd-video-renderer a#video-title,ytd-rich-item-renderer a#video-title-link";var l=document.querySelector(sel);if(l){l.click();}else{var lks=document.querySelectorAll("a[href*=\\"/watch\\"]");if(lks.length)lks[0].click();}},3000);');
          const navigateScript = `tell application "Safari"\\nactivate\\nif (count of windows) = 0 then make new document\\nset URL of current tab of front window to "${ytSearchUrl}"\\nend tell`;
          const clickFirstVideoScript = `tell application "Safari"\\nactivate\\ndelay 3\\ndo JavaScript "${firstVideoJs}" in current tab of front window\\nend tell`;
          nodes.push(actionNode("step-0", "Open Safari", "app.launch", "deep", { name: "Safari" }));
          nodes.push(actionNode("step-1", `Search YouTube for: ${cleanQuery}`, "app.script", "deep", { script: navigateScript }, ["step-0"]));
          nodes.push(actionNode("step-2", "Click first YouTube video", "app.script", "deep", { script: clickFirstVideoScript }, ["step-1"]));
        } else {
          nodes.push(actionNode("voice-action", intent.rawText, "hybrid.speak", "surface", { goal: intent.rawText, entities: intent.entities }));
        }
      // Generic voice command → generic.execute
      } else {
        nodes.push(actionNode("voice-action", intent.rawText, "generic.execute", "deep", { goal: intent.rawText }));
      }
      break;
    }

    // ── ui-interaction ───────────────────────────────────────────────────────
    case "ui-interaction": {
      const raw = intent.rawText;
      const coords = extractCoordinatePairs(intent.rawText);

      if (/\b(?:screenshot|screen\s*capture|capture\s*screen|chụp\s*màn\s*hình|chup\s*man\s*hinh)\b/i.test(raw)) {
        nodes.push(actionNode("interact", raw, "screen.capture", "surface", { entities: intent.entities }));
        break;
      }

      if (/\b(translate\s*(?:screen|this|selection|text)|dịch\s*(?:màn\s*hình|đoạn\s*này|văn\s*bản|nội\s*dung))\b/i.test(raw)) {
        nodes.push(actionNode("interact", raw, "shell.exec", "deep", { command: "TMP_IMG=/tmp/omnistate-screen-translate.png; screencapture -x \"$TMP_IMG\" && if command -v tesseract >/dev/null 2>&1; then OCR_TEXT=$(tesseract \"$TMP_IMG\" stdout 2>/dev/null | tr '\\n' ' ' | sed 's/  */ /g' | cut -c1-400); URL=\"https://translate.google.com/?sl=auto&tl=vi&text=$(python3 - <<'PY'\nimport os, urllib.parse\nprint(urllib.parse.quote(os.environ.get('OCR_TEXT','')))\nPY\n)&op=translate\"; open \"$URL\"; echo \"Opened translation overlay in browser\"; else echo 'Install tesseract first: brew install tesseract'; fi", entities: intent.entities }));
        break;
      }

      if (/\b(fill|autofill|form|đi[ềe]n\s*form|bi[ểe]u\s*m[ẫa]u)\b/i.test(raw)) {
        const script = buildWebFormFillScript(intent);
        if (script) { nodes.push(actionNode("interact", raw, "app.script", "deep", { script, entities: intent.entities })); break; }
      }

      if (isDataEntryWorkflowText(raw)) { nodes.push(...buildDataEntryWorkflowNodes(intent)); break; }

      if (/\b(modal|popup|dialog)\b/i.test(raw)) {
        if (/\b(dismiss|close|cancel|escape)\b/i.test(raw)) { nodes.push(actionNode("interact", raw, "vision.modal.dismiss", "surface", { action: "dismiss" })); break; }
        if (/\b(accept|ok|confirm)\b/i.test(raw)) { nodes.push(actionNode("interact", raw, "vision.modal.dismiss", "surface", { action: "accept" })); break; }
        nodes.push(actionNode("interact", raw, "vision.modal.detect", "surface", {}));
        break;
      }

      if (/\b(captcha|recaptcha|hcaptcha|verification challenge)\b/i.test(raw)) { nodes.push(actionNode("interact", raw, "vision.captcha.detect", "surface", {})); break; }
      if (/\b(table|grid|spreadsheet|extract\s*table)\b/i.test(raw)) {
        nodes.push(actionNode("interact", raw, "vision.table.extract", "surface", coords.length >= 1 ? { x: coords[0].x, y: coords[0].y, width: coords[1]?.x ?? 600, height: coords[1]?.y ?? 400 } : {}));
        break;
      }
      if (/\b(accessibility|a11y|wcag|contrast)\b/i.test(raw)) { nodes.push(actionNode("interact", raw, "vision.a11y.audit", "surface", {})); break; }
      if (/\b(ui\s*language|screen\s*language|detect\s*language|ng[oô]n\s*ng[uữ])\b/i.test(raw)) { nodes.push(actionNode("interact", raw, "vision.language.detect", "surface", {})); break; }

      if (/\b(?:drag|drop|k[eé]o\s*th[aả])\b/i.test(raw) && coords.length >= 2) {
        nodes.push(actionNode("interact", intent.rawText, "ui.drag", "surface", { fromX: coords[0].x, fromY: coords[0].y, toX: coords[1].x, toY: coords[1].y }));
        break;
      }

      const chainSteps = parseUiActionChain(raw);
      if (chainSteps.length) { nodes.push(...buildUiActionChainNodes(intent.rawText, chainSteps, intent.entities)); break; }

      if (isNegatedUiInstruction(raw)) {
        nodes.push(actionNode("no-op", "Negative UI instruction detected; skipping conflicting action", "ui.wait", "surface", { ms: 50, reason: raw }));
        break;
      }

      nodes.push(
        actionNode("capture", "Capture current screen state", "screen.capture", "surface", {}, [], "find-element"),
        actionNode("find-element", `Locate target element for: ${intent.rawText}`, "ui.find", "surface", { query: intent.rawText, entities: intent.entities }, ["capture"], "interact"),
        actionNode("interact", intent.rawText, "ui.click", "surface", { query: intent.rawText, entities: intent.entities, button: "left" }, ["find-element"], "verify-ui"),
        verifyNode("verify-ui", "Verify UI interaction had expected effect", "UI state updated as expected", ["interact"]),
      );
      break;
    }

    // ── system-query ─────────────────────────────────────────────────────────
    case "system-query": {
      if (/\b(thời\s*tiết|weather)\b/i.test(intent.rawText)) {
        const cityMatch = intent.rawText.match(/\b(?:tại|at|in|ở)\s+([A-Za-zÀ-ỹ\s]{2,30}?)(?=\s+(?:hôm\s*nay|today|ngày\s*mai|tomorrow)|$)/i);
        const city = cityMatch?.[1]?.trim().replace(/\s+/g, "+") ?? "Ho+Chi+Minh+City";
        nodes.push(actionNode("query", intent.rawText, "shell.exec", "deep", { command: `curl -s "wttr.in/${city}?format=3" 2>/dev/null || echo "Weather unavailable"`, entities: intent.entities }));
        break;
      }
      if (/\b(tỷ\s*giá|exchange\s*rate|tỉ\s*giá)\b/i.test(intent.rawText)) {
        nodes.push(actionNode("query", intent.rawText, "shell.exec", "deep", { command: `curl -s 'https://api.exchangerate-api.com/v4/latest/USD' | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('rates',{}); [print(f'{k}: {v}') for k,v in r.items() if k in ['VND','EUR','JPY','GBP','CNY','KRW','SGD']]" 2>/dev/null || open 'https://vietcombank.com.vn/KHCN/Cong-cu-tien-ich/Ty-gia'`, entities: intent.entities }));
        break;
      }
      if (/\b(summari[sz]e\s*(?:my\s*)?(?:context|workspace|work)|context\s*summary|t[oó]m\s*tắt\s*(?:ng[ữu]\s*cảnh|màn\s*hình|công\s*việc))\b/i.test(intent.rawText.toLowerCase())) {
        nodes.push(actionNode("query", intent.rawText, "shell.exec", "deep", { command: "echo '=== System Context ===' && ps aux --sort=-%cpu | head -6 && echo '=== Memory ===' && vm_stat | head -6 && echo '=== Recent Downloads ===' && ls -lt ~/Downloads | head -6", entities: intent.entities }));
        break;
      }
      const cmd = extractShellCommand(intent);
      const tool = cmd !== intent.rawText ? "shell.exec" : "system.info";
      nodes.push(actionNode("query", intent.rawText, tool, "deep", { command: cmd, entities: intent.entities }));
      break;
    }

    // ── multi-step ───────────────────────────────────────────────────────────
    case "multi-step": {
      if (isDataEntryWorkflowText(intent.rawText)) { nodes.push(...buildDataEntryWorkflowNodes(intent)); break; }

      // ── Pre-built: Any YouTube video search + click first result (no browser specified) ──
      const isYoutubeVideoSearchNoBrowser =
        /youtube/i.test(intent.rawText) &&
        /(?:video|bài\s*hát|bài|clip|nhạc|10\s*ngàn\s*năm)/i.test(intent.rawText) &&
        !/(?:mở|open|launch)\s+safari/i.test(intent.rawText) &&
        !/(?:mở|open|launch)\s+chrome/i.test(intent.rawText);

      if (isYoutubeVideoSearchNoBrowser) {
        // Extract search query from the prompt
        const rawText = intent.rawText;
        // Remove common prefixes to get the search term
        const cleanQuery = rawText
          .replace(/(?:giúp\s*tôi|mở|xem|tìm|phát|play)\s*/gi, "")
          .replace(/\s*trên\s*youtube/gi, "")
          .replace(/\s*trên\s*(?:safari|chrome|firefox|brave)/gi, "")
          .replace(/\s*trên\s*(?:trình\s*duyệt|browser)/gi, "")
          .trim();
        const ytSearchUrl = escapeAppleScriptString(`https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`);
        const firstVideoJs = escapeAppleScriptString('setTimeout(function(){var sel="ytd-video-renderer a#video-title,ytd-rich-item-renderer a#video-title-link";var l=document.querySelector(sel);if(l){l.click();}else{var lks=document.querySelectorAll("a[href*=\\"/watch\\"]");if(lks.length)lks[0].click();}},3000);');
        const navigateScript = `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${ytSearchUrl}"\nend tell`;
        const clickFirstVideoScript = `tell application "Safari"\nactivate\ndelay 3\ndo JavaScript "${firstVideoJs}" in current tab of front window\nend tell`;
        nodes.push(actionNode("step-0", "Open Safari", "app.launch", "deep", { name: "Safari" }));
        nodes.push(actionNode("step-1", `Search YouTube for: ${cleanQuery}`, "app.script", "deep", { script: navigateScript }, ["step-0"]));
        nodes.push(actionNode("step-2", "Click first YouTube video", "app.script", "deep", { script: clickFirstVideoScript }, ["step-1"]));
        break;
      }

      // ── Pre-built: Vietnamese browser + YouTube + first video chain ──
      const isSafariYoutubeVideoChain =
        /(?:mở|open)\s+safari/i.test(intent.rawText) &&
        /youtube/i.test(intent.rawText) &&
        /(?:video\s*đầu\s*tiên|first\s*video|mở\s*video|xem\s*video\s*đầu)/i.test(intent.rawText);

      if (isSafariYoutubeVideoChain) {
        const ytHomeUrl = escapeAppleScriptString("https://www.youtube.com");
        const firstVideoJs = escapeAppleScriptString('setTimeout(function(){var sel="ytd-video-renderer a#video-title,ytd-rich-item-renderer a#video-title-link";var l=document.querySelector(sel);if(l){l.click();}else{var lks=document.querySelectorAll("a[href*=\\"/watch\\"]");if(lks.length)lks[0].click();}},2500);');
        const navigateScript = `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${ytHomeUrl}"\nend tell`;
        const clickFirstVideoScript = `tell application "Safari"\nactivate\ndelay 2.5\ndo JavaScript "${firstVideoJs}" in current tab of front window\nend tell`;
        nodes.push(actionNode("step-0", "Open Safari", "app.launch", "deep", { name: "Safari" }));
        nodes.push(actionNode("step-1", "Navigate to YouTube", "app.script", "deep", { script: navigateScript }, ["step-0"]));
        nodes.push(actionNode("step-2", "Click first YouTube video", "app.script", "deep", { script: clickFirstVideoScript }, ["step-1"]));
        break;
      }

      // ── Pre-built: Vietnamese browser navigation chain ──
      const isBrowserNavChain =
        /(?:mở|open)\s+(?:safari|chrome|firefox|brave|trình\s*duyệt)/i.test(intent.rawText) &&
        /(?:rồi|sau\s*đó|tiếp\s*theo|,)\s*(?:truy\s*cập|vào|navigate|go\s*to)/i.test(intent.rawText);

      if (isBrowserNavChain) {
        const browserNameMatch = intent.rawText.match(/(?:mở|open)\s+(safari|chrome|firefox|brave)/i);
        const browserName = normalizeAppName(browserNameMatch?.[1] ?? "safari");
        const urlMatch = intent.rawText.match(/(?:truy\s*cập|vào|navigate\s+to|go\s+to)\s+(https?:\/\/[^\s]+|[\w-]+\.(?:com|vn|org|net|io)|youtube|google|facebook)/i);
        let navUrl = urlMatch?.[1]?.trim() ?? "";
        if (navUrl && !navUrl.startsWith("http")) {
          const siteMap: Record<string, string> = { "youtube": "https://www.youtube.com", "google": "https://www.google.com", "facebook": "https://www.facebook.com" };
          navUrl = siteMap[navUrl.toLowerCase()] ?? `https://${navUrl}`;
        }
        if (navUrl) {
          const safeUrl = escapeAppleScriptString(navUrl);
          const navScript = browserName === "Safari"
            ? `tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "${safeUrl}"\nend tell`
            : `tell application "${escapeAppleScriptString(browserName)}"\nactivate\nif (count of windows) = 0 then make new window\nset URL of active tab of front window to "${safeUrl}"\nend tell`;
          nodes.push(actionNode("step-0", `Launch ${browserName}`, "app.launch", "deep", { name: browserName }));
          nodes.push(actionNode("step-1", `Navigate to ${navUrl}`, "app.script", "deep", { script: navScript }, ["step-0"]));
          break;
        }
      }

      const steps = await decomposeMultiStep(intent.rawText, episodicContext || undefined, kgContext || undefined);

      if (steps && steps.length > 0) {
        const layerFor: Record<IntentType, StateNode["layer"]> = {
          "ask-clarification": "surface",
          "shell-command": "deep",
          "app-launch": "deep",
          "app-control": "deep",
          "file-operation": "deep",
          "ui-interaction": "surface",
          "system-query": "deep",
          "multi-step": "auto",
          // Domain B
          "process-management": "deep",
          "service-management": "deep",
          "package-management": "deep",
          "network-control": "deep",
          "os-config": "deep",
          "power-management": "deep",
          "hardware-control": "deep",
          "security-management": "deep",
          "peripheral-management": "deep",
          "container-management": "deep",
          "display-audio": "deep",
          "backup-restore": "deep",
          "update-management": "deep",
          // Domain B Extended
          "audio-management": "deep",
          "display-management": "deep",
          "media.play": "surface",
          "media.pause": "surface",
          "alarm.set": "surface",
          "file.search": "deep",
          "thermal-management": "deep",
          "disk-management": "deep",
          "memory-management": "deep",
          "clipboard-management": "deep",
          "font-locale-management": "deep",
          "printer-management": "deep",
          "user-acl-management": "deep",
          // Domain C
          "health-check": "deep",
          "disk-cleanup": "deep",
          "maint.clearBrowserCache": "deep",
          "maintenance.diskCleanup": "deep",
          "network-diagnose": "deep",
          "security-scan": "deep",
          "self-healing": "deep",
          // Domain D
          "voice-control": "surface",
          "script-generation": "deep",
          "automation-macro": "surface",
          "workflow-template": "deep",
          "file-organization": "deep",
          "debug-assist": "deep",
          "compliance-check": "deep",
          "resource-forecast": "deep",
          "multi-app-orchestration": "auto",
          // Domain E: Deep Hardware & Kernel
          "iokit-hardware": "deep",
          "kernel-control": "deep",
          "wifi-security": "deep",
        };

        let prevId: string | null = null;
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const nodeId = `step-${i}`;
          const nextId = i < steps.length - 1 ? `step-${i + 1}` : null;
          const normalizedTool = normalizeStepTool(step.tool, step.type);
          nodes.push(
            actionNode(
              nodeId,
              step.description,
              normalizedTool,
              layerFor[step.type],
              inferStepParamsForTool(normalizedTool, step.description, step.type),
              prevId ? [prevId] : [],
              nextId,
            ),
          );
          prevId = nodeId;
        }
      } else {
        // Fallback: try to extract a shell command; use generic.execute as last resort
        const cmd = extractShellCommand(intent);
        const isRealCommand = cmd !== intent.rawText;
        nodes.push(
          actionNode(
            "execute",
            intent.rawText,
            isRealCommand ? "shell.exec" : "generic.execute",
            "deep",
            isRealCommand ? { command: cmd } : { goal: intent.rawText },
          ),
        );
      }
      break;
    }

    // ── unknown fallback ─────────────────────────────────────────────────────
    default: {
      const tool = mapIntentToTool(intent);
      if (tool) {
        nodes.push(actionNode("execute", intent.rawText, tool.name, "deep", { ...tool.params, goal: intent.rawText, entities: intent.entities }));
      } else {
        const cmd = extractShellCommand(intent);
        const isRealCommand = cmd !== intent.rawText;
        nodes.push(actionNode("execute", intent.rawText, isRealCommand ? "shell.exec" : "generic.execute", isRealCommand ? "deep" : "auto", isRealCommand ? { command: cmd } : { goal: intent.rawText }));
      }
    }
  }

  const totalMs = nodes.reduce((sum, n) => sum + n.estimatedDurationMs, 0);

  return {
    taskId,
    goal: intent.rawText,
    estimatedDuration: `${Math.round(totalMs / 1000)}s`,
    nodes,
  };
}
