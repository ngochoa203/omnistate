import { childLogger } from "../utils/logger.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const log = childLogger("voice-privacy");

export type PrivacyLevel = "full" | "local_only" | "minimal" | "anonymous";

export interface PrivacySetting {
  key: string;
  value: boolean;
  description: string;
  lastModified: number;
}

export interface AuditEntry {
  timestamp: number;
  action: string;
  detail: string;
  privacyFlag?: string;
  dataType: string;
}

export interface VoicePrivacy {
  setLevel(level: PrivacyLevel): void;
  getLevel(): PrivacyLevel;
  setSetting(key: string, value: boolean): void;
  getSetting(key: string): boolean;
  getAllSettings(): PrivacySetting[];
  resetToDefaults(): void;
  grantTemporary(level: PrivacyLevel, durationMs: number): void;
  revokeTemporary(): void;
  canLog(): boolean;
  canStoreAudio(): boolean;
  canUseCloud(): boolean;
  shouldAnonymize(): boolean;
  getAuditLog(): AuditEntry[];
  clearAuditLog(): void;
}

interface PrivacyData {
  level: PrivacyLevel;
  settings: Record<string, PrivacySetting>;
  temporaryGrant: { level: PrivacyLevel; expiresAt: number } | null;
}

const PRIVACY_FILE = join(homedir(), ".omnistate", "voice-privacy.json");

// Default settings per privacy level
const DEFAULT_SETTINGS: Record<PrivacyLevel, Record<string, boolean>> = {
  full: {
    log_transcripts: true,
    store_audio: true,
    share_analytics: true,
    cloud_stt: true,
    cloud_tts: true,
    speaker_verification_store: true,
    emotion_detection: true,
    language_detection: true,
    cross_device_sync: true,
  },
  local_only: {
    log_transcripts: true,
    store_audio: true,
    share_analytics: false,
    cloud_stt: false,
    cloud_tts: false,
    speaker_verification_store: true,
    emotion_detection: true,
    language_detection: true,
    cross_device_sync: false,
  },
  minimal: {
    log_transcripts: false,
    store_audio: false,
    share_analytics: false,
    cloud_stt: false,
    cloud_tts: false,
    speaker_verification_store: false,
    emotion_detection: false,
    language_detection: false,
    cross_device_sync: false,
  },
  anonymous: {
    log_transcripts: true,
    store_audio: false,
    share_analytics: false,
    cloud_stt: true,
    cloud_tts: true,
    speaker_verification_store: false,
    emotion_detection: false,
    language_detection: true,
    cross_device_sync: false,
  },
};

const SETTING_DESCRIPTIONS: Record<string, string> = {
  log_transcripts: "Log transcript text for debugging and improvement",
  store_audio: "Store audio recordings for quality improvement",
  share_analytics: "Share anonymized analytics to improve the service",
  cloud_stt: "Use cloud-based speech-to-text (requires network)",
  cloud_tts: "Use cloud-based text-to-speech (requires network)",
  speaker_verification_store: "Store speaker voice profiles for verification",
  emotion_detection: "Analyze emotional state from voice",
  language_detection: "Detect language for multilingual support",
  cross_device_sync: "Sync session data across devices",
};

class VoicePrivacyImpl implements VoicePrivacy {
  private level: PrivacyLevel = "full";
  private settings = new Map<string, PrivacySetting>();
  private temporaryGrant: { level: PrivacyLevel; expiresAt: number } | null = null;
  private auditLog: AuditEntry[] = [];
  private auditMaxSize = 1000;

  constructor() {
    this.loadFromFile();
    this.initializeDefaults();
  }

  private loadFromFile(): void {
    try {
      if (!existsSync(PRIVACY_FILE)) return;

      const raw = readFileSync(PRIVACY_FILE, "utf-8");
      const data = JSON.parse(raw) as PrivacyData;

      this.level = data.level ?? "full";

      if (data.settings) {
        for (const [key, setting] of Object.entries(data.settings)) {
          this.settings.set(key, setting as PrivacySetting);
        }
      }

      if (data.temporaryGrant) {
        this.temporaryGrant = data.temporaryGrant as { level: PrivacyLevel; expiresAt: number };
      }

      log.info({ level: this.level }, "Privacy settings loaded");
    } catch (err) {
      log.warn({ err }, "Failed to load privacy settings");
    }
  }

  private saveToFile(): void {
    try {
      const dir = join(homedir(), ".omnistate");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const settingsObj: Record<string, PrivacySetting> = {};
      for (const [key, setting] of this.settings) {
        settingsObj[key] = setting;
      }

      const data: PrivacyData = {
        level: this.level,
        settings: settingsObj,
        temporaryGrant: this.temporaryGrant,
      };

      writeFileSync(PRIVACY_FILE, JSON.stringify(data, null, 2), "utf-8");
      log.debug("Privacy settings saved");
    } catch (err) {
      log.warn({ err }, "Failed to save privacy settings");
    }
  }

  private initializeDefaults(): void {
    const defaults = DEFAULT_SETTINGS[this.level];
    for (const [key, value] of Object.entries(defaults)) {
      if (!this.settings.has(key)) {
        this.settings.set(key, {
          key,
          value,
          description: SETTING_DESCRIPTIONS[key] ?? "",
          lastModified: Date.now(),
        });
      }
    }
  }

  private checkTemporaryGrant(): PrivacyLevel | null {
    if (this.temporaryGrant && this.temporaryGrant.expiresAt > Date.now()) {
      return this.temporaryGrant.level;
    }
    // Clear expired grant
    if (this.temporaryGrant) {
      this.temporaryGrant = null;
      this.saveToFile();
    }
    return null;
  }

  private audit(action: string, detail: string, dataType: string, privacyFlag?: string): void {
    this.auditLog.push({
      timestamp: Date.now(),
      action,
      detail,
      dataType,
      privacyFlag,
    });

    // Prune old entries
    if (this.auditLog.length > this.auditMaxSize) {
      this.auditLog = this.auditLog.slice(-this.auditMaxSize / 2);
    }
  }

  setLevel(level: PrivacyLevel): void {
    const previousLevel = this.level;
    this.level = level;

    // Apply default settings for new level
    const defaults = DEFAULT_SETTINGS[level];
    for (const [key, value] of Object.entries(defaults)) {
      this.setSetting(key, value);
    }

    this.saveToFile();

    log.info({ previousLevel, newLevel: level }, "Privacy level changed");
    this.audit("set_level", `Changed from ${previousLevel} to ${level}`, "privacy_config");
  }

  getLevel(): PrivacyLevel {
    const grant = this.checkTemporaryGrant();
    return grant ?? this.level;
  }

  setSetting(key: string, value: boolean): void {
    const existing = this.settings.get(key);
    this.settings.set(key, {
      key,
      value,
      description: SETTING_DESCRIPTIONS[key] ?? "",
      lastModified: Date.now(),
    });

    if (!existing || existing.value !== value) {
      this.saveToFile();
      this.audit("set_setting", `${key} = ${value}`, "privacy_setting");
    }
  }

  getSetting(key: string): boolean {
    const setting = this.settings.get(key);
    return setting?.value ?? false;
  }

  getAllSettings(): PrivacySetting[] {
    return Array.from(this.settings.values());
  }

  resetToDefaults(): void {
    this.level = "full";
    this.settings.clear();
    this.initializeDefaults();
    this.temporaryGrant = null;
    this.saveToFile();

    log.info("Privacy settings reset to defaults");
    this.audit("reset_defaults", "Reset all settings", "privacy_config");
  }

  grantTemporary(level: PrivacyLevel, durationMs: number): void {
    this.temporaryGrant = {
      level,
      expiresAt: Date.now() + durationMs,
    };
    this.saveToFile();

    log.info({ level, durationMs }, "Temporary privacy grant issued");
    this.audit("grant_temporary", `Granted ${level} for ${durationMs}ms`, "privacy_grant");
  }

  revokeTemporary(): void {
    if (this.temporaryGrant) {
      this.temporaryGrant = null;
      this.saveToFile();
      log.info("Temporary privacy grant revoked");
      this.audit("revoke_temporary", "Grant revoked", "privacy_grant");
    }
  }

  canLog(): boolean {
    return this.getSetting("log_transcripts");
  }

  canStoreAudio(): boolean {
    return this.getSetting("store_audio");
  }

  canUseCloud(): boolean {
    const level = this.getLevel();
    if (level === "minimal") return false;
    return this.getSetting("cloud_stt") || this.getSetting("cloud_tts");
  }

  shouldAnonymize(): boolean {
    return this.getLevel() === "anonymous";
  }

  getAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }

  clearAuditLog(): void {
    this.auditLog = [];
    log.info("Audit log cleared");
  }

  /**
   * Check if a specific action is allowed given current privacy settings.
   */
  isActionAllowed(action: string): boolean {
    const actionToSetting: Record<string, string> = {
      log_transcript: "log_transcripts",
      store_audio: "store_audio",
      cloud_stt: "cloud_stt",
      cloud_tts: "cloud_tts",
      store_speaker: "speaker_verification_store",
      detect_emotion: "emotion_detection",
      detect_language: "language_detection",
      sync_device: "cross_device_sync",
    };

    const settingKey = actionToSetting[action];
    if (!settingKey) return true; // Unknown actions allowed by default

    const allowed = this.getSetting(settingKey);
    if (!allowed) {
      this.audit("action_blocked", action, "privacy_check", settingKey);
    }
    return allowed;
  }

  /**
   * Get a data object with sensitive fields anonymized if needed.
   */
  anonymize<T extends Record<string, unknown>>(data: T): T {
    if (!this.shouldAnonymize()) return data;

    return {
      ...data,
      userId: "[ANONYMIZED]",
      sessionId: `anon-${Date.now()}`,
    } as T;
  }
}

// ─── Singleton Export ──────────────────────────────────────────────────────────

export const voicePrivacy: VoicePrivacy = new VoicePrivacyImpl();