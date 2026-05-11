import { z } from "zod";

/** Wake engine types */
export type WakeEngine = "oww" | "porcupine" | "personal" | "legacy";

/** Wake configuration */
export interface WakeConfig {
  engine: WakeEngine;
  threshold: number;
  cooldownMs: number;
  aliases: string[];
  modelPath?: string;
  phrase: string;
}

/** Enrollment configuration */
export interface EnrollmentConfig {
  requiredSamples: number;
  minQualityScore: number;
  timeoutMs: number;
}

/** Verification configuration */
export interface VerificationConfig {
  defaultThreshold: number;
  adaptiveThreshold: boolean;
  antiSpoofing: boolean;
}

/** VAD (Voice Activity Detection) configuration */
export interface VadConfig {
  enabled: boolean;
  speechThreshold: number;
  silenceThreshold: number;
}

/** STT (Speech-to-Text) configuration */
export interface SttConfig {
  model: string;
  language: string;
  fallbackChain: string[];
}

/** TTS (Text-to-Speech) configuration */
export interface TtsConfig {
  voice: string;
  speed: number;
  fallbackVoices: string[];
}

/** Platform-specific settings */
export interface PlatformSettings {
  macos: {
    useHardwareAcceleration: boolean;
  };
  linux: {
    fallbackOrder: string[];
  };
}

/** Unified voice configuration */
export interface VoiceConfig {
  wake: WakeConfig;
  enrollment: EnrollmentConfig;
  verification: VerificationConfig;
  vad: VadConfig;
  stt: SttConfig;
  tts: TtsConfig;
  platform: PlatformSettings;
}

const WakeEngineSchema = z.enum(["oww", "porcupine", "personal", "legacy"]);
const wakeConfigSchema = z.object({
  engine: WakeEngineSchema.default("oww"),
  threshold: z.number().min(0).max(1).default(0.5),
  cooldownMs: z.number().int().min(0).default(1000),
  aliases: z.array(z.string()).default(["mimi", "hey mimi", "ok mimi", "mimi ơi", "mimi oi", "mi mi"]),
  modelPath: z.string().optional(),
  phrase: z.string().default("mimi"),
});

const enrollmentConfigSchema = z.object({
  requiredSamples: z.number().int().min(1).default(5),
  minQualityScore: z.number().min(0).max(1).default(0.7),
  timeoutMs: z.number().int().min(0).default(300000),
});

const verificationConfigSchema = z.object({
  defaultThreshold: z.number().min(0).max(1).default(0.75),
  adaptiveThreshold: z.boolean().default(false),
  antiSpoofing: z.boolean().default(true),
});

const vadConfigSchema = z.object({
  enabled: z.boolean().default(true),
  speechThreshold: z.number().min(0).max(1).default(0.6),
  silenceThreshold: z.number().min(0).max(1).default(0.2),
});

const sttConfigSchema = z.object({
  model: z.string().default("whisper-base"),
  language: z.string().default("vi"),
  fallbackChain: z.array(z.string()).default([]),
});

const ttsConfigSchema = z.object({
  voice: z.string().default("default"),
  speed: z.number().min(0.5).max(2).default(1.0),
  fallbackVoices: z.array(z.string()).default([]),
});

const platformSettingsSchema = z.object({
  macos: z.object({
    useHardwareAcceleration: z.boolean().default(true),
  }).default({}),
  linux: z.object({
    fallbackOrder: z.array(z.string()).default(["pulseaudio", "alsa", "dummy"]),
  }).default({}),
});

const voiceConfigSchema = z.object({
  wake: wakeConfigSchema.default({}),
  enrollment: enrollmentConfigSchema.default({}),
  verification: verificationConfigSchema.default({}),
  vad: vadConfigSchema.default({}),
  stt: sttConfigSchema.default({}),
  tts: ttsConfigSchema.default({}),
  platform: platformSettingsSchema.default({}),
});

const DEFAULT_VOICE_CONFIG: VoiceConfig = voiceConfigSchema.parse({});

let currentConfig: VoiceConfig = { ...DEFAULT_VOICE_CONFIG };

function deepMerge(base: VoiceConfig, patch: Partial<VoiceConfig>): VoiceConfig {
  const result: VoiceConfig = JSON.parse(JSON.stringify(base));
  if (patch.wake) Object.assign(result.wake, patch.wake);
  if (patch.enrollment) Object.assign(result.enrollment, patch.enrollment);
  if (patch.verification) Object.assign(result.verification, patch.verification);
  if (patch.vad) Object.assign(result.vad, patch.vad);
  if (patch.stt) Object.assign(result.stt, patch.stt);
  if (patch.tts) Object.assign(result.tts, patch.tts);
  if (patch.platform) {
    if (patch.platform.macos) Object.assign(result.platform.macos, patch.platform.macos);
    if (patch.platform.linux) Object.assign(result.platform.linux, patch.platform.linux);
  }
  return result;
}

export function getVoiceConfig(): VoiceConfig {
  return currentConfig;
}

export function updateVoiceConfig(patch: Partial<VoiceConfig>): void {
  const validated = voiceConfigSchema.parse(deepMerge(DEFAULT_VOICE_CONFIG, patch));
  currentConfig = validated;
}

export function resetVoiceConfig(): void {
  currentConfig = { ...DEFAULT_VOICE_CONFIG };
}

export function loadFromEnv(): VoiceConfig {
  const envConfig: Partial<VoiceConfig> = {};

  // Wake config from env
  const wakeEngine = process.env.OMNISTATE_WAKE_ENGINE?.trim();
  if (wakeEngine) {
    const parsed = WakeEngineSchema.safeParse(wakeEngine);
    if (parsed.success) {
      envConfig.wake = {
        engine: parsed.data,
        threshold: parseFloat(process.env.OMNISTATE_WAKE_THRESHOLD ?? "0.5"),
        cooldownMs: parseInt(process.env.OMNISTATE_WAKE_COOLDOWN_MS ?? "1000", 10),
        aliases: (process.env.OMNISTATE_WAKE_ALIASES ?? "").split(",").filter(Boolean),
        modelPath: process.env.OMNISTATE_WAKE_MODEL_PATH?.trim() || undefined,
        phrase: process.env.OMNISTATE_WAKE_PHRASE?.trim() || "mimi",
      };
    }
  }

  // Enrollment config from env
  const envRequiredSamples = parseInt(process.env.OMNISTATE_ENROLL_REQUIRED_SAMPLES ?? "", 10);
  const envMinQuality = parseFloat(process.env.OMNISTATE_ENROLL_MIN_QUALITY ?? "");
  const envTimeout = parseInt(process.env.OMNISTATE_ENROLL_TIMEOUT_MS ?? "", 10);
  if (!isNaN(envRequiredSamples) || !isNaN(envMinQuality) || !isNaN(envTimeout)) {
    envConfig.enrollment = {
      requiredSamples: isNaN(envRequiredSamples) ? 5 : envRequiredSamples,
      minQualityScore: isNaN(envMinQuality) ? 0.7 : envMinQuality,
      timeoutMs: isNaN(envTimeout) ? 300000 : envTimeout,
    };
  }

  // Verification config from env
  const envThreshold = parseFloat(process.env.OMNISTATE_VERIFY_THRESHOLD ?? "");
  const envAdaptive = process.env.OMNISTATE_VERIFY_ADAPTIVE?.trim();
  const envAntiSpoof = process.env.OMNISTATE_VERIFY_ANTISPOOFING?.trim();
  if (!isNaN(envThreshold) || envAdaptive || envAntiSpoof) {
    envConfig.verification = {
      defaultThreshold: isNaN(envThreshold) ? 0.75 : envThreshold,
      adaptiveThreshold: envAdaptive === "true",
      antiSpoofing: envAntiSpoof !== "false",
    };
  }

  // VAD config from env
  const vadEnabled = process.env.OMNISTATE_VAD_ENABLED?.trim();
  const vadSpeech = parseFloat(process.env.OMNISTATE_VAD_SPEECH_THRESHOLD ?? "");
  const vadSilence = parseFloat(process.env.OMNISTATE_VAD_SILENCE_THRESHOLD ?? "");
  if (vadEnabled || !isNaN(vadSpeech) || !isNaN(vadSilence)) {
    envConfig.vad = {
      enabled: vadEnabled !== "false",
      speechThreshold: isNaN(vadSpeech) ? 0.6 : vadSpeech,
      silenceThreshold: isNaN(vadSilence) ? 0.2 : vadSilence,
    };
  }

  // STT config from env
  const sttModel = process.env.OMNISTATE_STT_MODEL?.trim();
  const sttLang = process.env.OMNISTATE_STT_LANGUAGE?.trim();
  const sttFallback = process.env.OMNISTATE_STT_FALLBACK?.trim();
  if (sttModel || sttLang || sttFallback) {
    envConfig.stt = {
      model: sttModel || "whisper-base",
      language: sttLang || "vi",
      fallbackChain: sttFallback ? sttFallback.split(",").filter(Boolean) : [],
    };
  }

  // TTS config from env
  const ttsVoice = process.env.OMNISTATE_TTS_VOICE?.trim();
  const ttsSpeed = parseFloat(process.env.OMNISTATE_TTS_SPEED ?? "");
  const ttsFallback = process.env.OMNISTATE_TTS_FALLBACK_VOICES?.trim();
  if (ttsVoice || !isNaN(ttsSpeed) || ttsFallback) {
    envConfig.tts = {
      voice: ttsVoice || "default",
      speed: isNaN(ttsSpeed) ? 1.0 : ttsSpeed,
      fallbackVoices: ttsFallback ? ttsFallback.split(",").filter(Boolean) : [],
    };
  }

  // Platform config from env
  const hwAccel = process.env.OMNISTATE_PLATFORM_MACOS_HW_ACCEL?.trim();
  const linuxFallback = process.env.OMNISTATE_PLATFORM_LINUX_FALLBACK?.trim();
  if (hwAccel || linuxFallback) {
    envConfig.platform = {
      macos: {
        useHardwareAcceleration: hwAccel !== "false",
      },
      linux: {
        fallbackOrder: linuxFallback ? linuxFallback.split(",").filter(Boolean) : ["pulseaudio", "alsa", "dummy"],
      },
    };
  }

  const validated = voiceConfigSchema.parse(deepMerge(DEFAULT_VOICE_CONFIG, envConfig));
  currentConfig = validated;
  return currentConfig;
}