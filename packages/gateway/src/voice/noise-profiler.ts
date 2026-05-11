import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";

const log = childLogger("noise-profiler");

export interface NoiseProfile {
  noiseFloorDb: number;
  ambientLevel: "quiet" | "moderate" | "loud" | "very_loud";
  recommendedWakeThreshold: number;
  recommendedVadThreshold: number;
  recommendedSilenceThreshold: number;
  confidence: number;
  sampleCount: number;
  lastCalibrated: number;
}

export interface NoiseProfilerOptions {
  calibrationWindowMs?: number;
  minSamples?: number;
  maxSamples?: number;
}

export interface NoiseProfiler {
  feedSample(energy: number, timestamp?: number): void;
  getProfile(): NoiseProfile;
  isCalibrated(): boolean;
  recalibrate(): void;
  getRecommendedThreshold(purpose: "wake" | "vad_speech" | "vad_silence"): number;
  isEnvironmentSuitable(): boolean;
  reset(): void;
  getCalibrationStatus(): { sampleCount: number; isCalibrated: boolean; confidence: number };
}

interface SampleEntry {
  energy: number;
  timestamp: number;
}

const DEFAULT_OPTIONS: Required<NoiseProfilerOptions> = {
  calibrationWindowMs: 5000,
  minSamples: 10,
  maxSamples: 100,
};


function dbToEnergy(db: number): number {
  return Math.pow(10, db / 20);
}

function energyToDb(energy: number): number {
  return energy > 0 ? 20 * Math.log10(energy) : -100;
}

function classifyAmbientLevel(noiseFloorDb: number): NoiseProfile["ambientLevel"] {
  if (noiseFloorDb < -40) return "quiet";
  if (noiseFloorDb < -25) return "moderate";
  if (noiseFloorDb < -10) return "loud";
  return "very_loud";
}

const MAX_CONFIDENCE = 0.95;

class NoiseProfilerImpl extends EventEmitter implements NoiseProfiler {
  private samples: SampleEntry[] = [];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public lastMajorShiftDb = 0;
  private currentProfile: NoiseProfile;
  private options: Required<NoiseProfilerOptions>;
  private isCalibratedFlag = false;
  
  constructor(options?: NoiseProfilerOptions) {
    super();
    this.options = {
      calibrationWindowMs: options?.calibrationWindowMs ?? DEFAULT_OPTIONS.calibrationWindowMs,
      minSamples: options?.minSamples ?? DEFAULT_OPTIONS.minSamples,
      maxSamples: options?.maxSamples ?? DEFAULT_OPTIONS.maxSamples,
    };

    this.currentProfile = this.createEmptyProfile();
  }

  private createEmptyProfile(): NoiseProfile {
    return {
      noiseFloorDb: -30,
      ambientLevel: "moderate",
      recommendedWakeThreshold: 0.5,
      recommendedVadThreshold: 0.6,
      recommendedSilenceThreshold: 0.2,
      confidence: 0,
      sampleCount: 0,
      lastCalibrated: 0,
    };
  }

  private computeProfile(): NoiseProfile {
    if (this.samples.length === 0) {
      return this.createEmptyProfile();
    }

    const now = Date.now();
    const windowStart = now - this.options.calibrationWindowMs;
    const windowSamples = this.samples.filter((s) => s.timestamp >= windowStart);

    if (windowSamples.length === 0) {
      return this.createEmptyProfile();
    }

    // Sort energies for percentile calculation
    const energies = windowSamples.map((s) => s.energy).sort((a, b) => a - b);

    // Noise floor = 10th percentile (ignores outliers)
    const percentileIndex = Math.floor(energies.length * 0.1);
    const noiseFloorEnergy = energies[percentileIndex] ?? energies[0]!;
    const noiseFloorDb = energyToDb(noiseFloorEnergy);

    // Average energy for ambient classification
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const avgEnergy = energies.reduce((a, b) => a + b, 0) / energies.length;
    void avgEnergy; // placeholder for future use
    
    const ambientLevel = classifyAmbientLevel(noiseFloorDb);

    // Calculate confidence
    let confidence: number;
    if (windowSamples.length < this.options.minSamples) {
      confidence = windowSamples.length / this.options.minSamples;
    } else {
      // Increase confidence slowly after minSamples
      const extraSamples = windowSamples.length - this.options.minSamples;
      const maxExtra = this.options.maxSamples - this.options.minSamples;
      confidence = Math.min(MAX_CONFIDENCE, 0.5 + (extraSamples / maxExtra) * 0.45);
    }

    // Calculate recommended thresholds based on noise floor
    const wakeThreshold = Math.max(0.3, Math.min(0.8, dbToEnergy(noiseFloorDb + 12)));
    const vadSpeechThreshold = Math.max(0.4, Math.min(0.8, dbToEnergy(noiseFloorDb + 15)));
    const vadSilenceThreshold = Math.max(0.15, Math.min(0.5, dbToEnergy(noiseFloorDb * 0.7)));

    return {
      noiseFloorDb,
      ambientLevel,
      recommendedWakeThreshold: wakeThreshold,
      recommendedVadThreshold: vadSpeechThreshold,
      recommendedSilenceThreshold: vadSilenceThreshold,
      confidence,
      sampleCount: windowSamples.length,
      lastCalibrated: confidence >= 0.5 ? now : 0,
    };
  }

  feedSample(energy: number, timestamp?: number): void {
    const entry: SampleEntry = {
      energy: Math.max(0, Math.min(1, energy)), // Clamp to 0-1
      timestamp: timestamp ?? Date.now(),
    };

    this.samples.push(entry);

    // Maintain max samples
    if (this.samples.length > this.options.maxSamples) {
      this.samples = this.samples.slice(-this.options.maxSamples);
    }

    // Check for environment shift
    if (this.currentProfile.confidence > 0.8 && this.samples.length > 1) {
      const latestDb = energyToDb(energy);
      const shift = Math.abs(latestDb - this.currentProfile.noiseFloorDb);

      if (shift > 3) {
        this.lastMajorShiftDb = shift;
        log.warn(
          { shift, currentFloor: this.currentProfile.noiseFloorDb, newEnergy: latestDb },
          "Environment noise shift detected - recalibrating"
        );
        this.emit("environmentShift", { shift, previousProfile: this.currentProfile });
        this.recalibrate();
        return;
      }
    }

    // Update profile
    const newProfile = this.computeProfile();

    // Check if we just became calibrated
    if (!this.isCalibratedFlag && newProfile.sampleCount >= this.options.minSamples) {
      this.isCalibratedFlag = true;
      log.info({ confidence: newProfile.confidence, sampleCount: newProfile.sampleCount }, "Noise profiler calibrated");
      this.emit("calibrated", newProfile);
    }

    this.currentProfile = newProfile;
    this.emit("profileUpdate", newProfile);
  }

  getProfile(): NoiseProfile {
    return { ...this.currentProfile };
  }

  isCalibrated(): boolean {
    return this.isCalibratedFlag && this.currentProfile.sampleCount >= this.options.minSamples;
  }

  recalibrate(): void {
    this.samples = [];
    this.isCalibratedFlag = false;
    this.currentProfile = this.createEmptyProfile();
    log.info("Noise profiler recalibrating");
    this.emit("recalibrating");
  }

  getRecommendedThreshold(purpose: "wake" | "vad_speech" | "vad_silence"): number {
    const profile = this.currentProfile;

    switch (purpose) {
      case "wake":
        return profile.recommendedWakeThreshold;
      case "vad_speech":
        return profile.recommendedVadThreshold;
      case "vad_silence":
        return profile.recommendedSilenceThreshold;
      default:
        return 0.5;
    }
  }

  isEnvironmentSuitable(): boolean {
    const profile = this.currentProfile;

    // Very loud environments are not suitable
    if (profile.ambientLevel === "very_loud") return false;

    // Need minimum confidence
    if (profile.confidence < 0.3) return false;

    // Noise floor too high = unsuitable
    if (profile.noiseFloorDb > -5) return false;

    return true;
  }

  reset(): void {
    this.samples = [];
    this.isCalibratedFlag = false;
    this.currentProfile = this.createEmptyProfile();
    this.lastMajorShiftDb = 0;
    log.info("Noise profiler reset");
    this.emit("reset");
  }

  getCalibrationStatus(): { sampleCount: number; isCalibrated: boolean; confidence: number } {
    return {
      sampleCount: this.currentProfile.sampleCount,
      isCalibrated: this.isCalibrated(),
      confidence: this.currentProfile.confidence,
    };
  }
}

export interface NoiseProfiler extends EventEmitter {
  on(event: "calibrated", listener: (profile: NoiseProfile) => void): this;
  on(event: "profileUpdate", listener: (profile: NoiseProfile) => void): this;
  on(event: "environmentShift", listener: (info: { shift: number; previousProfile: NoiseProfile }) => void): this;
  on(event: "recalibrating", listener: () => void): this;
  on(event: "reset", listener: () => void): this;
  emit(event: "calibrated", profile: NoiseProfile): boolean;
  emit(event: "profileUpdate", profile: NoiseProfile): boolean;
  emit(event: "environmentShift", info: { shift: number; previousProfile: NoiseProfile }): boolean;
  emit(event: "recalibrating"): boolean;
  emit(event: "reset"): boolean;
}

// Singleton export
export const noiseProfiler: NoiseProfiler = new NoiseProfilerImpl();
