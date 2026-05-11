import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const log = childLogger("voice-command-registry");

export interface VoiceCommand {
  id: string;
  trigger: string;      // regex or keyword pattern
  phrase: string;        // human-readable trigger
  action: string;        // action identifier
  params?: Record<string, string>;
  language: "vi" | "en" | "both";
  enabled: boolean;
  category?: string;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}

export interface VoiceCommandRegistry {
  register(command: VoiceCommand): void;
  unregister(id: string): void;
  update(id: string, updates: Partial<VoiceCommand>): void;
  find(phrase: string, language?: string): VoiceCommand | null;
  findAll(category?: string): VoiceCommand[];
  enable(id: string): void;
  disable(id: string): void;
  incrementUsage(id: string): void;
  importCommands(commands: VoiceCommand[]): void;
  exportCommands(): VoiceCommand[];
  clear(): void;
  reload(): void;
  save(): Promise<void>;
}

const COMMANDS_FILE = join(homedir(), ".omnistate", "voice-commands.json");

// ─── Default Commands Library ───────────────────────────────────────────────────

const DEFAULT_COMMANDS: VoiceCommand[] = [
  {
    id: "stop-command",
    trigger: "dừng|dừng lại|stop|thôi|cancel|hủy",
    phrase: "Stop/Dừng",
    action: "cancel",
    language: "both",
    enabled: true,
    category: "system",
    usageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "repeat-command",
    trigger: "nhắc lại|repeat|lặp lại|what did you say",
    phrase: "Repeat/Nhắc lại",
    action: "repeat_last",
    language: "both",
    enabled: true,
    category: "system",
    usageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "help-command",
    trigger: "giúp|help|trợ giúp|what can you do",
    phrase: "Help/Giúp đỡ",
    action: "show_help",
    language: "both",
    enabled: true,
    category: "system",
    usageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "open-safari",
    trigger: "mở safari|open safari|launch safari",
    phrase: "Open Safari",
    action: "app_open",
    params: { app: "Safari" },
    language: "both",
    enabled: true,
    category: "apps",
    usageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "open-notes",
    trigger: "mở notes|open notes|launch notes",
    phrase: "Open Notes",
    action: "app_open",
    params: { app: "Notes" },
    language: "both",
    enabled: true,
    category: "apps",
    usageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "set-alarm-7am",
    trigger: "báo thức 7|báo thức bảy|alarm 7",
    phrase: "Set alarm for 7 AM",
    action: "alarm_set",
    params: { time: "07:00" },
    language: "both",
    enabled: true,
    category: "alarms",
    usageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "play-music",
    trigger: "bật nhạc|chơi nhạc|play music|play",
    phrase: "Play Music",
    action: "music_play",
    language: "both",
    enabled: true,
    category: "media",
    usageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "pause-music",
    trigger: "dừng nhạc|tạm dừng|pause music|pause",
    phrase: "Pause Music",
    action: "music_pause",
    language: "both",
    enabled: true,
    category: "media",
    usageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "send-message",
    trigger: "gửi tin nhắn|send message|text",
    phrase: "Send Message",
    action: "message_send",
    language: "both",
    enabled: true,
    category: "communication",
    usageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "search-web",
    trigger: "tìm|search|kiếm|google",
    phrase: "Search",
    action: "search",
    language: "both",
    enabled: true,
    category: "search",
    usageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// ─── Fuzzy Matching Utility ─────────────────────────────────────────────────────

function fuzzyMatch(pattern: string, text: string): { matched: boolean; score: number } {
  const normalizedPattern = pattern.toLowerCase().trim();
  const normalizedText = text.toLowerCase().trim();

  // Exact match
  if (normalizedText.includes(normalizedPattern) || normalizedPattern.includes(normalizedText)) {
    return { matched: true, score: 1.0 };
  }

  // Split into words and check coverage
  const patternWords = normalizedPattern.split(/[|\s,]+/).filter(w => w.length > 1);
  const textWords = normalizedText.split(/\s+/);

  let matchedWords = 0;
  for (const pw of patternWords) {
    for (const tw of textWords) {
      if (tw.includes(pw) || pw.includes(tw)) {
        matchedWords++;
        break;
      }
    }
  }

  if (matchedWords > 0) {
    const score = matchedWords / patternWords.length;
    return { matched: score >= 0.6, score };
  }

  // Levenshtein-based fuzzy match for short inputs
  if (normalizedText.length < 10 && normalizedPattern.length < 10) {
    const distance = levenshteinDistance(normalizedText, normalizedPattern);
    const maxLen = Math.max(normalizedText.length, normalizedPattern.length);
    const similarity = 1 - distance / maxLen;
    return { matched: similarity >= 0.7, score: similarity };
  }

  return { matched: false, score: 0 };
}

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j]! + 1,
          matrix[i]![j - 1]! + 1,
          matrix[i - 1]![j - 1]! + 1
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

// ─── VoiceCommandRegistry Implementation ────────────────────────────────────────

class VoiceCommandRegistryImpl extends EventEmitter implements VoiceCommandRegistry {
  private commands = new Map<string, VoiceCommand>();
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.loadDefaults();
    this.loadFromFile();
  }

  private loadDefaults(): void {
    for (const cmd of DEFAULT_COMMANDS) {
      this.commands.set(cmd.id, { ...cmd });
    }
    log.debug({ count: DEFAULT_COMMANDS.length }, "Default commands loaded");
  }

  private loadFromFile(): void {
    try {
      if (!existsSync(COMMANDS_FILE)) {
        log.debug("No custom commands file found");
        return;
      }

      const raw = readFileSync(COMMANDS_FILE, "utf-8");
      const customCommands = JSON.parse(raw) as VoiceCommand[];

      for (const cmd of customCommands) {
        if (cmd.id && cmd.trigger) {
          this.commands.set(cmd.id, {
            ...cmd,
            usageCount: cmd.usageCount ?? 0,
            enabled: cmd.enabled ?? true,
            createdAt: cmd.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }

      log.info({ count: customCommands.length }, "Custom commands loaded");
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "Failed to load custom commands");
    }
  }

  private async saveToFile(): Promise<void> {
    try {
      const dir = join(homedir(), ".omnistate");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const commands = Array.from(this.commands.values());
      writeFileSync(COMMANDS_FILE, JSON.stringify(commands, null, 2), "utf-8");
      log.debug({ count: commands.length }, "Commands saved to file");
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "Failed to save commands");
    }
  }

  private scheduleSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveToFile();
    }, 1000);
  }

  register(command: VoiceCommand): void {
    const now = new Date().toISOString();
    const cmd: VoiceCommand = {
      ...command,
      id: command.id || `cmd-${Date.now()}`,
      createdAt: command.createdAt ?? now,
      updatedAt: now,
      usageCount: command.usageCount ?? 0,
      enabled: command.enabled ?? true,
    };

    this.commands.set(cmd.id, cmd);
    this.scheduleSave();

    log.info({ id: cmd.id, trigger: cmd.trigger }, "Command registered");
    this.emit("commandRegistered", cmd);
  }

  unregister(id: string): void {
    if (this.commands.has(id)) {
      this.commands.delete(id);
      this.scheduleSave();
      log.info({ id }, "Command unregistered");
      this.emit("commandUnregistered", { id });
    }
  }

  update(id: string, updates: Partial<VoiceCommand>): void {
    const existing = this.commands.get(id);
    if (!existing) {
      log.warn({ id }, "Command not found for update");
      return;
    }

    const updated: VoiceCommand = {
      ...existing,
      ...updates,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    };

    this.commands.set(id, updated);
    this.scheduleSave();

    log.info({ id }, "Command updated");
    this.emit("commandUpdated", updated);
  }

  find(phrase: string, language?: string): VoiceCommand | null {
    let bestMatch: VoiceCommand | null = null;
    let bestScore = 0;

    for (const cmd of this.commands.values()) {
      if (!cmd.enabled) continue;
      if (language && cmd.language !== "both" && cmd.language !== language) continue;

      const { matched, score } = fuzzyMatch(cmd.trigger, phrase);
      if (matched && score > bestScore) {
        bestMatch = cmd;
        bestScore = score;
      }
    }

    return bestMatch;
  }

  findAll(category?: string): VoiceCommand[] {
    const results: VoiceCommand[] = [];
    for (const cmd of this.commands.values()) {
      if (!cmd.enabled) continue;
      if (category && cmd.category !== category) continue;
      results.push(cmd);
    }
    return results;
  }

  enable(id: string): void {
    const cmd = this.commands.get(id);
    if (cmd) {
      cmd.enabled = true;
      cmd.updatedAt = new Date().toISOString();
      this.scheduleSave();
      this.emit("commandEnabled", { id });
    }
  }

  disable(id: string): void {
    const cmd = this.commands.get(id);
    if (cmd) {
      cmd.enabled = false;
      cmd.updatedAt = new Date().toISOString();
      this.scheduleSave();
      this.emit("commandDisabled", { id });
    }
  }

  incrementUsage(id: string): void {
    const cmd = this.commands.get(id);
    if (cmd) {
      cmd.usageCount++;
      cmd.updatedAt = new Date().toISOString();
      this.scheduleSave();
    }
  }

  importCommands(commands: VoiceCommand[]): void {
    for (const cmd of commands) {
      this.register(cmd);
    }
    log.info({ count: commands.length }, "Commands imported");
  }

  exportCommands(): VoiceCommand[] {
    return Array.from(this.commands.values());
  }

  clear(): void {
    this.commands.clear();
    this.loadDefaults();
    this.scheduleSave();
    log.info("Commands cleared");
  }

  reload(): void {
    this.commands.clear();
    this.loadDefaults();
    this.loadFromFile();
    log.info("Commands reloaded");
  }

  save(): Promise<void> {
    return this.saveToFile();
  }
}

// ─── Singleton Export ──────────────────────────────────────────────────────────

export const voiceCommandRegistry: VoiceCommandRegistry = new VoiceCommandRegistryImpl();
