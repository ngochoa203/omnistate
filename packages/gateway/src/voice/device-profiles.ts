import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";

const log = childLogger("device-profiles");

export type DeviceType =
  | "macos"
  | "iphone"
  | "ipad"
  | "apple_watch"
  | "airpods"
  | "airpods_pro"
  | "airpods_max"
  | "homepod"
  | "unknown";

export interface DeviceCapabilities {
  maxSampleRate: number;
  supportsStereo: boolean;
  hasGoodMicrophone: boolean;
  hasGoodSpeaker: boolean;
  supportsLowLatency: boolean;
  supportsHardwareAcceleration: boolean;
  maxConcurrentStreams: number;
  supportsWakeWordDsp: boolean;
}

export interface AudioProfile {
  inputLatencyMs: number;
  outputLatencyMs: number;
  recommendedChunkMs: number;
  bufferSize: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  automaticGainControl: boolean;
}

export interface RecommendedSettings {
  sttProvider: "whisper-local" | "native" | "whisper-cloud";
  whisperModel: "tiny" | "base" | "small";
  vadEnabled: boolean;
  vadSpeechThreshold: number;
  vadSilenceThreshold: number;
  wakeEngine: "porcupine" | "oww" | "personal" | "legacy";
  wakeThreshold: number;
  ttsProvider: "edge" | "rtvc" | "none";
  ttsVoiceSpeed: number;
  enableContinuousListening: boolean;
  enableOnDeviceProcessing: boolean;
}

export interface DeviceProfile {
  deviceType: DeviceType;
  deviceName?: string;
  capabilities: DeviceCapabilities;
  audioProfile: AudioProfile;
  powerMode: "normal" | "low_power" | "battery_saver";
  recommendedSettings: RecommendedSettings;
  confidence: number;
}

export interface DeviceOptimizer {
  setDevice(deviceType: DeviceType, deviceName?: string): DeviceProfile;
  autoDetect(): DeviceProfile;
  getProfile(): DeviceProfile;
  getRecommendedSettings(): RecommendedSettings;
  supportsFeature(feature: keyof DeviceCapabilities): boolean;
  setPowerMode(mode: "normal" | "low_power" | "battery_saver"): void;
  getAudioProfile(): AudioProfile;
}

const DEVICE_PROFILES: Record<DeviceType, Omit<DeviceProfile, "deviceName" | "confidence">> = {
  macos: {
    deviceType: "macos",
    capabilities: {
      maxSampleRate: 48000,
      supportsStereo: true,
      hasGoodMicrophone: true,
      hasGoodSpeaker: true,
      supportsLowLatency: true,
      supportsHardwareAcceleration: true,
      maxConcurrentStreams: 4,
      supportsWakeWordDsp: true,
    },
    audioProfile: {
      inputLatencyMs: 5,
      outputLatencyMs: 10,
      recommendedChunkMs: 220,
      bufferSize: 1024,
      noiseSuppression: true,
      echoCancellation: true,
      automaticGainControl: true,
    },
    powerMode: "normal",
    recommendedSettings: {
      sttProvider: "whisper-local",
      whisperModel: "small",
      vadEnabled: true,
      vadSpeechThreshold: 0.5,
      vadSilenceThreshold: 0.35,
      wakeEngine: "personal",
      wakeThreshold: 0.5,
      ttsProvider: "edge",
      ttsVoiceSpeed: 1.0,
      enableContinuousListening: true,
      enableOnDeviceProcessing: true,
    },
  },
  airpods_pro: {
    deviceType: "airpods_pro",
    capabilities: {
      maxSampleRate: 48000,
      supportsStereo: true,
      hasGoodMicrophone: true,
      hasGoodSpeaker: true,
      supportsLowLatency: true,
      supportsHardwareAcceleration: false,
      maxConcurrentStreams: 1,
      supportsWakeWordDsp: false,
    },
    audioProfile: {
      inputLatencyMs: 10,
      outputLatencyMs: 20,
      recommendedChunkMs: 120,
      bufferSize: 512,
      noiseSuppression: true,
      echoCancellation: true,
      automaticGainControl: true,
    },
    powerMode: "low_power",
    recommendedSettings: {
      sttProvider: "whisper-local",
      whisperModel: "tiny",
      vadEnabled: true,
      vadSpeechThreshold: 0.45,
      vadSilenceThreshold: 0.3,
      wakeEngine: "porcupine",
      wakeThreshold: 0.55,
      ttsProvider: "edge",
      ttsVoiceSpeed: 1.0,
      enableContinuousListening: true,
      enableOnDeviceProcessing: true,
    },
  },
  airpods: {
    deviceType: "airpods",
    capabilities: {
      maxSampleRate: 48000,
      supportsStereo: true,
      hasGoodMicrophone: true,
      hasGoodSpeaker: true,
      supportsLowLatency: true,
      supportsHardwareAcceleration: false,
      maxConcurrentStreams: 1,
      supportsWakeWordDsp: false,
    },
    audioProfile: {
      inputLatencyMs: 15,
      outputLatencyMs: 25,
      recommendedChunkMs: 160,
      bufferSize: 512,
      noiseSuppression: true,
      echoCancellation: true,
      automaticGainControl: true,
    },
    powerMode: "low_power",
    recommendedSettings: {
      sttProvider: "whisper-local",
      whisperModel: "tiny",
      vadEnabled: true,
      vadSpeechThreshold: 0.5,
      vadSilenceThreshold: 0.35,
      wakeEngine: "porcupine",
      wakeThreshold: 0.5,
      ttsProvider: "edge",
      ttsVoiceSpeed: 1.0,
      enableContinuousListening: true,
      enableOnDeviceProcessing: true,
    },
  },
  airpods_max: {
    deviceType: "airpods_max",
    capabilities: {
      maxSampleRate: 48000,
      supportsStereo: true,
      hasGoodMicrophone: true,
      hasGoodSpeaker: true,
      supportsLowLatency: true,
      supportsHardwareAcceleration: false,
      maxConcurrentStreams: 1,
      supportsWakeWordDsp: false,
    },
    audioProfile: {
      inputLatencyMs: 10,
      outputLatencyMs: 15,
      recommendedChunkMs: 140,
      bufferSize: 512,
      noiseSuppression: true,
      echoCancellation: true,
      automaticGainControl: true,
    },
    powerMode: "low_power",
    recommendedSettings: {
      sttProvider: "whisper-local",
      whisperModel: "base",
      vadEnabled: true,
      vadSpeechThreshold: 0.45,
      vadSilenceThreshold: 0.3,
      wakeEngine: "porcupine",
      wakeThreshold: 0.55,
      ttsProvider: "edge",
      ttsVoiceSpeed: 1.0,
      enableContinuousListening: true,
      enableOnDeviceProcessing: true,
    },
  },
  homepod: {
    deviceType: "homepod",
    capabilities: {
      maxSampleRate: 48000,
      supportsStereo: true,
      hasGoodMicrophone: true,
      hasGoodSpeaker: true,
      supportsLowLatency: true,
      supportsHardwareAcceleration: true,
      maxConcurrentStreams: 2,
      supportsWakeWordDsp: true,
    },
    audioProfile: {
      inputLatencyMs: 20,
      outputLatencyMs: 30,
      recommendedChunkMs: 200,
      bufferSize: 1024,
      noiseSuppression: true,
      echoCancellation: true,
      automaticGainControl: true,
    },
    powerMode: "normal",
    recommendedSettings: {
      sttProvider: "whisper-cloud",
      whisperModel: "tiny",
      vadEnabled: false,
      vadSpeechThreshold: 0.5,
      vadSilenceThreshold: 0.35,
      wakeEngine: "porcupine",
      wakeThreshold: 0.5,
      ttsProvider: "edge",
      ttsVoiceSpeed: 1.0,
      enableContinuousListening: false,
      enableOnDeviceProcessing: false,
    },
  },
  iphone: {
    deviceType: "iphone",
    capabilities: {
      maxSampleRate: 48000,
      supportsStereo: true,
      hasGoodMicrophone: true,
      hasGoodSpeaker: true,
      supportsLowLatency: true,
      supportsHardwareAcceleration: false,
      maxConcurrentStreams: 1,
      supportsWakeWordDsp: false,
    },
    audioProfile: {
      inputLatencyMs: 10,
      outputLatencyMs: 15,
      recommendedChunkMs: 160,
      bufferSize: 512,
      noiseSuppression: true,
      echoCancellation: true,
      automaticGainControl: true,
    },
    powerMode: "low_power",
    recommendedSettings: {
      sttProvider: "whisper-local",
      whisperModel: "base",
      vadEnabled: true,
      vadSpeechThreshold: 0.5,
      vadSilenceThreshold: 0.35,
      wakeEngine: "porcupine",
      wakeThreshold: 0.55,
      ttsProvider: "edge",
      ttsVoiceSpeed: 1.0,
      enableContinuousListening: true,
      enableOnDeviceProcessing: true,
    },
  },
  ipad: {
    deviceType: "ipad",
    capabilities: {
      maxSampleRate: 48000,
      supportsStereo: true,
      hasGoodMicrophone: true,
      hasGoodSpeaker: true,
      supportsLowLatency: true,
      supportsHardwareAcceleration: false,
      maxConcurrentStreams: 2,
      supportsWakeWordDsp: false,
    },
    audioProfile: {
      inputLatencyMs: 10,
      outputLatencyMs: 15,
      recommendedChunkMs: 180,
      bufferSize: 512,
      noiseSuppression: true,
      echoCancellation: true,
      automaticGainControl: true,
    },
    powerMode: "normal",
    recommendedSettings: {
      sttProvider: "whisper-local",
      whisperModel: "small",
      vadEnabled: true,
      vadSpeechThreshold: 0.5,
      vadSilenceThreshold: 0.35,
      wakeEngine: "oww",
      wakeThreshold: 0.5,
      ttsProvider: "edge",
      ttsVoiceSpeed: 1.0,
      enableContinuousListening: true,
      enableOnDeviceProcessing: true,
    },
  },
  apple_watch: {
    deviceType: "apple_watch",
    capabilities: {
      maxSampleRate: 48000,
      supportsStereo: false,
      hasGoodMicrophone: true,
      hasGoodSpeaker: true,
      supportsLowLatency: false,
      supportsHardwareAcceleration: false,
      maxConcurrentStreams: 1,
      supportsWakeWordDsp: false,
    },
    audioProfile: {
      inputLatencyMs: 30,
      outputLatencyMs: 50,
      recommendedChunkMs: 200,
      bufferSize: 256,
      noiseSuppression: true,
      echoCancellation: false,
      automaticGainControl: true,
    },
    powerMode: "battery_saver",
    recommendedSettings: {
      sttProvider: "whisper-cloud",
      whisperModel: "tiny",
      vadEnabled: false,
      vadSpeechThreshold: 0.6,
      vadSilenceThreshold: 0.4,
      wakeEngine: "porcupine",
      wakeThreshold: 0.6,
      ttsProvider: "edge",
      ttsVoiceSpeed: 1.1,
      enableContinuousListening: false,
      enableOnDeviceProcessing: false,
    },
  },
  unknown: {
    deviceType: "unknown",
    capabilities: {
      maxSampleRate: 44100,
      supportsStereo: false,
      hasGoodMicrophone: true,
      hasGoodSpeaker: true,
      supportsLowLatency: false,
      supportsHardwareAcceleration: false,
      maxConcurrentStreams: 1,
      supportsWakeWordDsp: false,
    },
    audioProfile: {
      inputLatencyMs: 20,
      outputLatencyMs: 30,
      recommendedChunkMs: 220,
      bufferSize: 512,
      noiseSuppression: true,
      echoCancellation: true,
      automaticGainControl: true,
    },
    powerMode: "normal",
    recommendedSettings: {
      sttProvider: "whisper-local",
      whisperModel: "base",
      vadEnabled: true,
      vadSpeechThreshold: 0.5,
      vadSilenceThreshold: 0.35,
      wakeEngine: "oww",
      wakeThreshold: 0.5,
      ttsProvider: "edge",
      ttsVoiceSpeed: 1.0,
      enableContinuousListening: true,
      enableOnDeviceProcessing: false,
    },
  },
};

const POWER_MODE_MULTIPLIERS = {
  normal: { whisperModel: 1, chunkMs: 1, vadSensitivity: 1 },
  low_power: { whisperModel: 0.5, chunkMs: 1.5, vadSensitivity: 0.8 },
  battery_saver: { whisperModel: 0.25, chunkMs: 2, vadSensitivity: 0.6 },
};

const POWER_MODE_THRESHOLD_ADJUSTMENTS = {
  normal: { speech: 0, silence: 0 },
  low_power: { speech: 0.05, silence: -0.05 },
  battery_saver: { speech: 0.1, silence: -0.1 },
};

class DeviceOptimizerImpl extends EventEmitter implements DeviceOptimizer {
  private currentDeviceType: DeviceType = "unknown";
  private currentDeviceName?: string;
  private currentPowerMode: "normal" | "low_power" | "battery_saver" = "normal";
  private confidence = 0.5;

  setDevice(deviceType: DeviceType, deviceName?: string): DeviceProfile {
    this.currentDeviceType = deviceType;
    this.currentDeviceName = deviceName;
    this.confidence = 1.0;

    const profile = this.getCurrentProfile();
    log.info({ deviceType, deviceName }, "Device profile set");
    this.emit("deviceChanged", profile);

    return profile;
  }

  autoDetect(): DeviceProfile {
    // Detect based on platform
    const platform = process.platform;

    let detectedType: DeviceType = "unknown";

    if (platform === "darwin") {
      detectedType = "macos";
    }

    this.currentDeviceType = detectedType;
    this.confidence = detectedType === "macos" ? 0.9 : 0.3;

    const profile = this.getCurrentProfile();
    log.info({ detectedType, confidence: this.confidence }, "Device auto-detected");
    this.emit("deviceAutoDetected", profile);

    return profile;
  }

  getCurrentProfile(): DeviceProfile {
    const baseProfile = DEVICE_PROFILES[this.currentDeviceType];

    // Apply power mode adjustments
    const powerMultipliers = POWER_MODE_MULTIPLIERS[this.currentPowerMode];
    const thresholdAdjustments = POWER_MODE_THRESHOLD_ADJUSTMENTS[this.currentPowerMode];

    const adjustedSettings = { ...baseProfile.recommendedSettings };

    // Adjust whisper model
    if (this.currentPowerMode !== "normal") {
      const modelSizes: Record<string, number> = { tiny: 1, base: 2, small: 3 };
      const currentSize = modelSizes[adjustedSettings.whisperModel] ?? 2;
      const adjustedSize = Math.max(1, Math.round(currentSize * powerMultipliers.whisperModel));
      const models = ["tiny", "base", "small"] as const;
      adjustedSettings.whisperModel = models[Math.min(adjustedSize - 1, 2)];
    }

    // Adjust VAD thresholds
    adjustedSettings.vadSpeechThreshold = Math.max(
      0.3,
      Math.min(0.9, adjustedSettings.vadSpeechThreshold + thresholdAdjustments.speech)
    );
    adjustedSettings.vadSilenceThreshold = Math.max(
      0.1,
      Math.min(0.5, adjustedSettings.vadSilenceThreshold + thresholdAdjustments.silence)
    );

    // Disable features in battery saver
    if (this.currentPowerMode === "battery_saver") {
      adjustedSettings.enableContinuousListening = false;
      adjustedSettings.enableOnDeviceProcessing = false;
    }

    return {
      ...baseProfile,
      deviceName: this.currentDeviceName,
      powerMode: this.currentPowerMode,
      confidence: this.confidence,
      recommendedSettings: adjustedSettings,
    };
  }

  getProfile(): DeviceProfile {
    return this.getCurrentProfile();
  }

  getRecommendedSettings(): RecommendedSettings {
    return this.getCurrentProfile().recommendedSettings;
  }

  supportsFeature(feature: keyof DeviceCapabilities): boolean {
    const profile = this.getCurrentProfile();
    return (profile.capabilities[feature] ?? false) as boolean;
  }

  setPowerMode(mode: "normal" | "low_power" | "battery_saver"): void {
    this.currentPowerMode = mode;
    const profile = this.getCurrentProfile();
    log.info({ powerMode: mode }, "Power mode changed");
    this.emit("powerModeChanged", profile);
  }

  getAudioProfile(): AudioProfile {
    return this.getCurrentProfile().audioProfile;
  }
}

export interface DeviceOptimizer extends EventEmitter {
  on(event: "deviceChanged", listener: (profile: DeviceProfile) => void): this;
  on(event: "deviceAutoDetected", listener: (profile: DeviceProfile) => void): this;
  on(event: "powerModeChanged", listener: (profile: DeviceProfile) => void): this;
  emit(event: "deviceChanged", profile: DeviceProfile): boolean;
  emit(event: "deviceAutoDetected", profile: DeviceProfile): boolean;
  emit(event: "powerModeChanged", profile: DeviceProfile): boolean;
}

// Singleton export
export const deviceOptimizer: DeviceOptimizer = new DeviceOptimizerImpl();
