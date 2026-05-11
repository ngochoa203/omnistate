import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";

const log = childLogger("emotion-detector");

export type EmotionState = "calm" | "urgent" | "frustrated" | "happy" | "neutral" | "unknown";

export interface EmotionFeatures {
  speakingRate: number;
  pitchVariance: number;
  averageEnergy: number;
  intensity: number;
  silenceRatio: number;
}

export interface EmotionResult {
  emotion: EmotionState;
  confidence: number;
  features: EmotionFeatures;
  reasoning: string;
  suggestedTtsAdjustments: {
    speedMultiplier: number;
    pitchShift: number;
    volumeBoost: number;
    pauseDurationMs: number;
  };
}

export interface EmotionDetector {
  detectEmotion(audioBuffer: Buffer, sampleRate?: number): EmotionResult;
  feedFrame(audioFrame: Buffer, sampleRate?: number): EmotionResult;
  getResult(): EmotionResult;
  reset(): void;
}

const MIN_AUDIO_FOR_EMOTION_S = 0.5;

const TTS_ADJUSTMENTS: Record<EmotionState, EmotionResult["suggestedTtsAdjustments"]> = {
  "urgent": { speedMultiplier: 1.15, pitchShift: 2, volumeBoost: 1.1, pauseDurationMs: 0 },
  "frustrated": { speedMultiplier: 0.9, pitchShift: -1, volumeBoost: 1.0, pauseDurationMs: 200 },
  "happy": { speedMultiplier: 1.05, pitchShift: 1, volumeBoost: 1.05, pauseDurationMs: 50 },
  "calm": { speedMultiplier: 0.95, pitchShift: 0, volumeBoost: 1.0, pauseDurationMs: 100 },
  "neutral": { speedMultiplier: 1.0, pitchShift: 0, volumeBoost: 1.0, pauseDurationMs: 50 },
  "unknown": { speedMultiplier: 1.0, pitchShift: 0, volumeBoost: 1.0, pauseDurationMs: 50 },
};

const EMOTION_THRESHOLDS = {
  urgent: { speakingRate: 1.3, intensity: 0.7 },
  frustrated: { speakingRate: 1.2, silenceRatio: 0.2 },
  happy: { speakingRateRange: [1.0, 1.2] as [number, number], energyRange: [0.3, 0.7] as [number, number] },
  calm: { speakingRate: 0.9, pitchVariance: 0.2 },
};

function extractEmotionFeatures(audio: Buffer, sampleRate: number = 16000): EmotionFeatures {
  // Convert to samples
  const bytesPerSample = 2; // 16-bit
  const totalSamples = Math.floor(audio.length / bytesPerSample);
  const samples = new Int16Array(audio.buffer, audio.byteOffset, totalSamples);

  let zeroCrossings = 0;
  let energySum = 0;
  let peak = 0;
  let silenceCount = 0;
  const zcrIntervals: number[] = [];

  let prevZeroCrossing = 0;

  const SILENCE_THRESHOLD = 500; // Int16 amplitude threshold for silence

  for (let i = 0; i < samples.length; i++) {
    const amp = Math.abs(samples[i]!);
    const normAmp = amp / 32768;

    // Energy accumulation
    energySum += normAmp * normAmp;
    if (amp > peak) peak = normAmp;

    // Silence detection
    if (amp < SILENCE_THRESHOLD) {
      silenceCount++;
    }

    // Zero crossing detection
    const currentSign = samples[i]! >= 0 ? 1 : -1;
    if (i > 0) {
      const prevSign = samples[i - 1]! >= 0 ? 1 : -1;
      if (currentSign !== prevSign) {
        zeroCrossings++;
        if (prevZeroCrossing > 0) {
          // Track interval between zero crossings (proxy for pitch)
          zcrIntervals.push(i - prevZeroCrossing);
        }
        prevZeroCrossing = i;
      }
    }
  }

  const durationSec = totalSamples / sampleRate;
  const rms = Math.sqrt(energySum / totalSamples);

  // Speaking rate: ZCR/sec normalized (130 ZCR/sec ≈ 130 wpm for clean speech)
  const zcrPerSec = zeroCrossings / Math.max(durationSec, 0.001);
  const speakingRate = zcrPerSec / 130; // Normalized: 1.0 = 130 wpm

  // Pitch variance from ZCR intervals
  let pitchVariance = 0;
  if (zcrIntervals.length > 1) {
    const meanInterval = zcrIntervals.reduce((a, b) => a + b, 0) / zcrIntervals.length;
    const varianceSum = zcrIntervals.reduce((sum, interval) => sum + Math.pow(interval - meanInterval, 2), 0);
    pitchVariance = Math.sqrt(varianceSum / zcrIntervals.length) / meanInterval;
  }

  // Intensity: peak / RMS ratio
  const intensity = rms > 0 ? peak / rms : 1;

  // Silence ratio
  const silenceRatio = silenceCount / totalSamples;

  return {
    speakingRate: Math.max(0, Math.min(2, speakingRate)),
    pitchVariance: Math.max(0, Math.min(1, pitchVariance)),
    averageEnergy: rms,
    intensity: Math.min(1, intensity),
    silenceRatio,
  };
}

function classifyEmotion(features: EmotionFeatures, audioDurationSec: number): { emotion: EmotionState; confidence: number; reasoning: string } {
  // Insufficient audio
  if (audioDurationSec < MIN_AUDIO_FOR_EMOTION_S) {
    return { emotion: "unknown", confidence: 0, reasoning: "Audio too short for emotion analysis" };
  }

  let baseConfidence = 0.5;

  // Urgent detection: fast speaking, high intensity
  if (features.speakingRate > EMOTION_THRESHOLDS.urgent.speakingRate &&
      features.intensity > EMOTION_THRESHOLDS.urgent.intensity) {
    baseConfidence += 0.3;
    return {
      emotion: "urgent",
      confidence: Math.min(1, baseConfidence),
      reasoning: `Fast speech rate (${features.speakingRate.toFixed(2)}) and high intensity (${features.intensity.toFixed(2)})`
    };
  }

  // Frustrated detection: fast speaking, low silence, high energy
  if (features.speakingRate > EMOTION_THRESHOLDS.frustrated.speakingRate &&
      features.silenceRatio < EMOTION_THRESHOLDS.frustrated.silenceRatio &&
      features.intensity > 0.5) {
    baseConfidence += 0.25;
    return {
      emotion: "frustrated",
      confidence: Math.min(1, baseConfidence),
      reasoning: `Fast speech with low pauses (${(features.silenceRatio * 100).toFixed(0)}% silence)`
    };
  }

  // Happy detection: moderate speaking rate, good energy, some variation
  const [rateMin, rateMax] = EMOTION_THRESHOLDS.happy.speakingRateRange;
  const [energyMin, energyMax] = EMOTION_THRESHOLDS.happy.energyRange;
  if (features.speakingRate >= rateMin && features.speakingRate <= rateMax &&
      features.averageEnergy >= energyMin && features.averageEnergy <= energyMax) {
    baseConfidence += 0.2;
    return {
      emotion: "happy",
      confidence: Math.min(1, baseConfidence),
      reasoning: `Moderate speech rate with balanced energy (RMS: ${features.averageEnergy.toFixed(3)})`
    };
  }

  // Calm detection: slow speaking, low pitch variance
  if (features.speakingRate < EMOTION_THRESHOLDS.calm.speakingRate &&
      features.pitchVariance < EMOTION_THRESHOLDS.calm.pitchVariance) {
    baseConfidence += 0.25;
    return {
      emotion: "calm",
      confidence: Math.min(1, baseConfidence),
      reasoning: `Slow, steady speech with low variation (pitch variance: ${features.pitchVariance.toFixed(3)})`
    };
  }

  // Neutral (default)
  return {
    emotion: "neutral",
    confidence: baseConfidence,
    reasoning: "No strong emotional indicators detected"
  };
}

class EmotionDetectorImpl extends EventEmitter implements EmotionDetector {
  private accumulatedFeatures: EmotionFeatures[] = [];
  private accumulatedSamples = 0;
  private lastResult: EmotionResult | null = null;

  detectEmotion(audioBuffer: Buffer, sampleRate: number = 16000): EmotionResult {
    const features = extractEmotionFeatures(audioBuffer, sampleRate);
    const audioDurationSec = audioBuffer.length / (2 * sampleRate);

    const { emotion, confidence, reasoning } = classifyEmotion(features, audioDurationSec);

    const result: EmotionResult = {
      emotion,
      confidence,
      features,
      reasoning,
      suggestedTtsAdjustments: TTS_ADJUSTMENTS[emotion],
    };

    this.lastResult = result;
    log.debug(
      { emotion, confidence, features: { speakingRate: features.speakingRate.toFixed(2) } },
      "Emotion detected"
    );

    return result;
  }

  feedFrame(audioFrame: Buffer, sampleRate: number = 16000): EmotionResult {
    const frameFeatures = extractEmotionFeatures(audioFrame, sampleRate);
    this.accumulatedFeatures.push(frameFeatures);
    this.accumulatedSamples += audioFrame.length;

    // Re-classify based on accumulated features
    const avgSpeakingRate = this.accumulatedFeatures.reduce((sum, f) => sum + f.speakingRate, 0) / this.accumulatedFeatures.length;
    const avgPitchVariance = this.accumulatedFeatures.reduce((sum, f) => sum + f.pitchVariance, 0) / this.accumulatedFeatures.length;
    const avgEnergy = this.accumulatedFeatures.reduce((sum, f) => sum + f.averageEnergy, 0) / this.accumulatedFeatures.length;
    const avgIntensity = this.accumulatedFeatures.reduce((sum, f) => sum + f.intensity, 0) / this.accumulatedFeatures.length;
    const avgSilence = this.accumulatedFeatures.reduce((sum, f) => sum + f.silenceRatio, 0) / this.accumulatedFeatures.length;

    const aggregatedFeatures: EmotionFeatures = {
      speakingRate: avgSpeakingRate,
      pitchVariance: avgPitchVariance,
      averageEnergy: avgEnergy,
      intensity: avgIntensity,
      silenceRatio: avgSilence,
    };

    const audioDurationSec = this.accumulatedSamples / (2 * sampleRate);
    const { emotion, confidence, reasoning } = classifyEmotion(aggregatedFeatures, audioDurationSec);

    const result: EmotionResult = {
      emotion,
      confidence,
      features: aggregatedFeatures,
      reasoning,
      suggestedTtsAdjustments: TTS_ADJUSTMENTS[emotion],
    };

    this.lastResult = result;
    return result;
  }

  getResult(): EmotionResult {
    return this.lastResult ?? {
      emotion: "unknown",
      confidence: 0,
      features: { speakingRate: 1, pitchVariance: 0, averageEnergy: 0, intensity: 1, silenceRatio: 0.5 },
      reasoning: "No audio analyzed yet",
      suggestedTtsAdjustments: TTS_ADJUSTMENTS.unknown,
    };
  }

  reset(): void {
    this.accumulatedFeatures = [];
    this.accumulatedSamples = 0;
    this.lastResult = null;
    log.debug("Emotion detector reset");
    this.emit("reset");
  }
}

export interface EmotionDetector extends EventEmitter {
  on(event: "reset", listener: () => void): this;
  emit(event: "reset"): boolean;
}

// Singleton export
export const emotionDetector: EmotionDetector = new EmotionDetectorImpl();
