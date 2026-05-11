import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";

const log = childLogger("ambient-classifier");

export type AmbientSound =
  | "doorbell"
  | "dog_bark"
  | "car_horn"
  | "music"
  | "baby_cry"
  | "rain"
  | "wind"
  | "traffic"
  | "applause"
  | "typing"
  | "silence"
  | "speech"
  | "laughter"
  | "phone_ring"
  | "alarm"
  | "unknown";

export interface AmbientEvent {
  type: AmbientSound;
  confidence: number;
  startTime: number;
  durationMs: number;
  intensity: number;
  location?: string;
}

export interface AmbientSummary {
  totalEvents: number;
  dominant: AmbientSound;
  dominantPercent: number;
  recentTypes: AmbientSound[];
  speechDetected: boolean;
  musicDetected: boolean;
  avgIntensity: number;
}

export interface AmbientClassifier {
  classify(audio: Buffer, sampleRate?: number): AmbientEvent[];
  startMonitoring(sampleRate?: number): void;
  stopMonitoring(): void;
  setThreshold(threshold: number): void;
  getEvents(): AmbientEvent[];
  getRecentSummary(windowMs?: number): AmbientSummary;
  getStatistics(): AmbientStatistics;
}

interface AmbientStatistics {
  totalClassified: number;
  totalEvents: number;
  lastClassification: number;
  monitoring: boolean;
}

// Sound classification heuristics based on audio characteristics

class AmbientClassifierImpl extends EventEmitter implements AmbientClassifier {
  private events: AmbientEvent[] = [];
  private monitoring = false;
  private threshold = 0.3;
  private lastEventType: AmbientSound = "silence";
  private lastEventTime = 0;
  private eventCooldownMs = 3000;
  private stats = {
    totalClassified: 0,
    totalEvents: 0,
    lastClassification: 0,
  };

  constructor() {
    super();
  }

  /**
   * Classify ambient sounds from audio buffer.
   */
  classify(audio: Buffer, _sampleRate = 16000): AmbientEvent[] {
    const audioSamples = Math.floor(audio.length / 2);
    if (audioSamples < 1024) return [];

    // Extract features
    const features = this.extractFeatures(audio, audioSamples);
    this.stats.totalClassified++;

    // Check for silence first
    if (features.rmsEnergy < this.threshold) {
      this.emit("sound", { type: "silence", confidence: 0.95, energy: features.rmsEnergy });
      return [];
    }

    // Classify sound type based on features
    const classification = this.matchSoundPattern(features);

    // Deduplicate events
    const now = Date.now();
    if (classification.type !== this.lastEventType ||
        now - this.lastEventTime > this.eventCooldownMs) {

      const event: AmbientEvent = {
        type: classification.type,
        confidence: classification.confidence,
        startTime: now,
        durationMs: features.durationMs,
        intensity: features.rmsEnergy,
      };

      this.events.push(event);
      this.lastEventType = classification.type;
      this.lastEventTime = now;
      this.stats.totalEvents++;

      // Keep rolling window
      this.pruneEvents();

      log.debug(
        { type: event.type, confidence: event.confidence, intensity: event.intensity },
        "Ambient sound classified"
      );

      this.emit("sound", {
        type: event.type,
        confidence: event.confidence,
        energy: features.rmsEnergy,
      });

      return [event];
    }

    return [];
  }

  startMonitoring(sampleRate = 16000): void {
    this.monitoring = true;
    log.info({ sampleRate }, "Ambient monitoring started");
    this.emit("monitoringStarted");
  }

  stopMonitoring(): void {
    this.monitoring = false;
    log.info("Ambient monitoring stopped");
    this.emit("monitoringStopped");
  }

  setThreshold(threshold: number): void {
    this.threshold = Math.max(0.01, Math.min(1.0, threshold));
    log.info({ threshold: this.threshold }, "Ambient threshold updated");
  }

  getEvents(): AmbientEvent[] {
    return [...this.events];
  }

  getRecentSummary(windowMs = 30000): AmbientSummary {
    const now = Date.now();
    const recentEvents = this.events.filter(e => now - e.startTime < windowMs);

    if (recentEvents.length === 0) {
      return {
        totalEvents: 0,
        dominant: "silence",
        dominantPercent: 100,
        recentTypes: [],
        speechDetected: false,
        musicDetected: false,
        avgIntensity: 0,
      };
    }

    // Count by type
    const typeCounts = new Map<AmbientSound, number>();
    for (const event of recentEvents) {
      typeCounts.set(event.type, (typeCounts.get(event.type) ?? 0) + 1);
    }

    // Find dominant
    let dominant: AmbientSound = "unknown";
    let dominantCount = 0;
    for (const [type, count] of typeCounts) {
      if (count > dominantCount) {
        dominantCount = count;
        dominant = type;
      }
    }

    const totalEvents = recentEvents.length;
    return {
      totalEvents,
      dominant,
      dominantPercent: Math.round((dominantCount / totalEvents) * 100),
      recentTypes: recentEvents.slice(-10).map(e => e.type),
      speechDetected: typeCounts.has("speech"),
      musicDetected: typeCounts.has("music"),
      avgIntensity: recentEvents.reduce((sum, e) => sum + e.intensity, 0) / totalEvents,
    };
  }

  getStatistics(): AmbientStatistics {
    return {
      totalClassified: this.stats.totalClassified,
      totalEvents: this.stats.totalEvents,
      lastClassification: this.stats.lastClassification,
      monitoring: this.monitoring,
    };
  }

  // ─── Internal Methods ────────────────────────────────────────────────────────

  private extractFeatures(audio: Buffer, sampleCount: number): {
    rmsEnergy: number;
    peakEnergy: number;
    zcr: number;
    spectralCentroid: number;
    durationMs: number;
  } {
    let sumSquares = 0;
    let peak = 0;
    let zeroCrossings = 0;
    let previousSign = 0;

    for (let i = 0; i < sampleCount; i++) {
      const sample = audio.readInt16LE(i * 2) / 32768;
      const abs = Math.abs(sample);

      sumSquares += sample * sample;
      if (abs > peak) peak = abs;

      const sign = sample >= 0 ? 1 : 0;
      if (i > 0 && sign !== previousSign) {
        zeroCrossings++;
      }
      previousSign = sign;
    }

    const rmsEnergy = Math.sqrt(sumSquares / sampleCount);
    const zcr = zeroCrossings / sampleCount;

    // Simple spectral centroid estimation
    let weightedSum = 0;
    let magnitudeSum = 0;
    const binSize = Math.max(1, Math.floor(sampleCount / 64));

    for (let i = 0; i < 64; i++) {
      let binEnergy = 0;
      for (let j = 0; j < binSize && (i * binSize + j) < sampleCount; j++) {
        const sample = audio.readInt16LE((i * binSize + j) * 2) / 32768;
        binEnergy += sample * sample;
      }
      weightedSum += i * binEnergy;
      magnitudeSum += binEnergy;
    }

    const spectralCentroid = magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
    const durationMs = (sampleCount / 16000) * 1000;

    return { rmsEnergy, peakEnergy: peak, zcr, spectralCentroid, durationMs };
  }

  private matchSoundPattern(features: ReturnType<AmbientClassifierImpl["extractFeatures"]>): {
    type: AmbientSound;
    confidence: number;
  } {
    const { rmsEnergy, peakEnergy, zcr, spectralCentroid, durationMs } = features;

    // Silence check
    if (rmsEnergy < this.threshold) {
      return { type: "silence", confidence: 0.95 };
    }

    // High spectral centroid + rhythmic = doorbell/phone ring
    if (spectralCentroid > 30 && zcr > 0.1 && durationMs < 3000) {
      if (durationMs > 1000 && durationMs < 10000 && zcr > 0.2) {
        return { type: "phone_ring", confidence: 0.7 };
      }
      if (durationMs < 2000 && peakEnergy > 0.5) {
        return { type: "doorbell", confidence: 0.75 };
      }
    }

    // Low spectral centroid, medium energy, high duration = rain/wind
    if (spectralCentroid < 20 && durationMs > 5000) {
      if (rmsEnergy > 0.2) {
        return { type: "rain", confidence: 0.65 };
      }
      return { type: "wind", confidence: 0.6 };
    }

    // Moderate spectral centroid, rhythmic = music
    if (spectralCentroid > 10 && spectralCentroid < 40 && durationMs > 5000 && zcr > 0.05) {
      return { type: "music", confidence: 0.7 };
    }

    // Low-mid centroid, bursty = dog bark / car horn
    if (spectralCentroid > 10 && spectralCentroid < 35 && durationMs < 1000) {
      if (peakEnergy > 0.5) {
        return { type: "car_horn", confidence: 0.7 };
      }
      return { type: "dog_bark", confidence: 0.65 };
    }

    // Very low centroid, very high peak = applause
    if (spectralCentroid < 25 && peakEnergy > 0.4 && durationMs < 5000 && durationMs > 300) {
      return { type: "applause", confidence: 0.6 };
    }

    // Speech-like
    if (spectralCentroid > 15 && spectralCentroid < 45 && zcr > 0.03 && zcr < 0.2) {
      return { type: "speech", confidence: 0.7 };
    }

    // Typing: short bursts, medium-high centroid
    if (durationMs < 300 && spectralCentroid > 25 && rmsEnergy > 0.1) {
      return { type: "typing", confidence: 0.6 };
    }

    return { type: "unknown", confidence: 0.3 };
  }

  private pruneEvents(): void {
    const cutoff = Date.now() - 60000; // Keep last 60 seconds
    this.events = this.events.filter(e => e.startTime > cutoff);

    // Cap at 500 events
    if (this.events.length > 500) {
      this.events = this.events.slice(-500);
    }
  }
}

export interface AmbientClassifier extends EventEmitter {
  on(event: "sound", listener: (info: { type: AmbientSound; confidence: number; energy: number }) => void): this;
  on(event: "monitoringStarted" | "monitoringStopped", listener: () => void): this;
  emit(event: "sound", info: { type: AmbientSound; confidence: number; energy: number }): boolean;
  emit(event: "monitoringStarted" | "monitoringStopped"): boolean;
}

// ─── Singleton Export ──────────────────────────────────────────────────────────

export const ambientClassifier: AmbientClassifier = new AmbientClassifierImpl();