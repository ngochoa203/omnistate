import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";

const log = childLogger("pitch-detection");

export type PitchUnit = "hz" | "midi" | "cents";

export interface PitchResult {
  pitch: number;           // in requested unit
  confidence: number;      // 0-1
  voiced: boolean;        // whether this frame is voiced
  energy: number;          // frame energy
  timestamp: number;       // ms from start
}

export interface PitchTrack {
  sessionId: string;
  durationMs: number;
  results: PitchResult[];
  avgPitch: number;
  minPitch: number;
  maxPitch: number;
  pitchStdDev: number;
  voicedPercent: number;
  dominantFrequency: number;
}

export interface PitchDetectionConfig {
  sampleRate: number;
  windowSizeMs: number;
  hopSizeMs: number;
  minFrequency: number;
  maxFrequency: number;
  confidenceThreshold: number;
}

export interface PitchDetection {
  configure(config: Partial<PitchDetectionConfig>): void;
  detect(audio: Buffer, sessionId?: string): PitchResult[];
  track(audio: Buffer, sessionId?: string): PitchTrack;
  getStatistics(): PitchStatistics;
}

export interface PitchStatistics {
  totalAnalyzedMs: number;
  totalFrames: number;
  voicedFrames: number;
  avgConfidence: number;
}

const DEFAULT_CONFIG: Required<PitchDetectionConfig> = {
  sampleRate: 16000,
  windowSizeMs: 25,   // 25ms windows (standard for speech)
  hopSizeMs: 10,      // 10ms hop (75% overlap)
  minFrequency: 80,   // ~E2, low male voice
  maxFrequency: 500,  // ~B4, high female voice
  confidenceThreshold: 0.3,
};

class PitchDetectionImpl extends EventEmitter implements PitchDetection {
  private config: Required<PitchDetectionConfig>;
  private stats = {
    totalAnalyzedMs: 0,
    totalFrames: 0,
    voicedFrames: 0,
    confidenceSum: 0,
  };

  constructor(config?: Partial<PitchDetectionConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  configure(config: Partial<PitchDetectionConfig>): void {
    this.config = { ...this.config, ...config };
    log.info({ config: this.config }, "Pitch detection configured");
  }

  /**
   * Main pitch detection entry point.
   * Returns array of PitchResult for each frame.
   */
  detect(audio: Buffer, sessionId?: string): PitchResult[] {
    const windowSamples = Math.floor(this.config.sampleRate * this.config.windowSizeMs / 1000);
    const hopSamples = Math.floor(this.config.sampleRate * this.config.hopSizeMs / 1000);
    const audioSamples = Math.floor(audio.length / 2); // 16-bit samples

    if (audioSamples < windowSamples) {
      log.debug("Audio too short for pitch detection");
      return [];
    }

    const results: PitchResult[] = [];
    let startTime = 0;

    for (let i = 0; i + windowSamples <= audioSamples; i += hopSamples) {
      const window = this.extractWindow(audio, i, windowSamples);
      const result = this.analyzeWindow(window, startTime);
      results.push(result);

      // Update stats
      this.stats.totalFrames++;
      this.stats.confidenceSum += result.confidence;
      if (result.voiced) {
        this.stats.voicedFrames++;
      }

      startTime += this.config.hopSizeMs;
    }

    this.stats.totalAnalyzedMs += startTime;

    if (sessionId) {
      log.debug(
        { sessionId, frames: results.length, voiced: results.filter(r => r.voiced).length },
        "Pitch detection complete"
      );
    }

    this.emit("detectionComplete", { sessionId, frameCount: results.length });

    return results;
  }

  /**
   * Analyze a full audio track and return summary statistics.
   */
  track(audio: Buffer, sessionId = "default"): PitchTrack {
    const results = this.detect(audio, sessionId);
    
    const voiced = results.filter(r => r.voiced);
    const pitches = voiced.map(r => r.pitch);

    const avgPitch = pitches.length > 0
      ? pitches.reduce((a, b) => a + b, 0) / pitches.length
      : 0;

    const minPitch = pitches.length > 0 ? Math.min(...pitches) : 0;
    const maxPitch = pitches.length > 0 ? Math.max(...pitches) : 0;

    // Standard deviation
    const pitchStdDev = pitches.length > 1
      ? Math.sqrt(pitches.reduce((sum, p) => sum + (p - avgPitch) ** 2, 0) / pitches.length)
      : 0;

    // Dominant frequency via peak counting in FFT
    const dominantFrequency = this.estimateDominantFrequency(audio);

    return {
      sessionId,
      durationMs: results.length > 0 ? results[results.length - 1]!.timestamp : 0,
      results,
      avgPitch,
      minPitch,
      maxPitch,
      pitchStdDev,
      voicedPercent: results.length > 0 ? (voiced.length / results.length) * 100 : 0,
      dominantFrequency,
    };
  }

  getStatistics(): PitchStatistics {
    return {
      totalAnalyzedMs: this.stats.totalAnalyzedMs,
      totalFrames: this.stats.totalFrames,
      voicedFrames: this.stats.voicedFrames,
      avgConfidence: this.stats.totalFrames > 0
        ? this.stats.confidenceSum / this.stats.totalFrames
        : 0,
    };
  }

  // ─── Internal Analysis Methods ───────────────────────────────────────────────

  private extractWindow(audio: Buffer, startSample: number, windowSize: number): Float32Array {
    const window = new Float32Array(windowSize);

    for (let i = 0; i < windowSize; i++) {
      const idx = (startSample + i) * 2; // 16-bit samples
      if (idx + 1 < audio.length) {
        window[i] = audio.readInt16LE(idx) / 32768;
      }
    }

    return window;
  }

  private analyzeWindow(window: Float32Array, timestamp: number): PitchResult {
    // Compute energy
    const energy = this.computeEnergy(window);

    // Check if voiced (above energy threshold)
    const voiced = energy > 0.01;

    // Estimate pitch using autocorrelation (YIN-like simplified)
    const { pitch, confidence } = voiced
      ? this.estimatePitchAutocorrelation(window)
      : { pitch: 0, confidence: 0 };

    return {
      pitch,
      confidence,
      voiced,
      energy,
      timestamp,
    };
  }

  private computeEnergy(frame: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i]! * frame[i]!;
    }
    return Math.sqrt(sum / frame.length);
  }

  private estimatePitchAutocorrelation(frame: Float32Array): { pitch: number; confidence: number } {
    const n = frame.length;
    const sampleRate = this.config.sampleRate;

    // Apply simple windowing (Hann)
    const windowed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
      windowed[i] = frame[i] * w;
    }

    // Compute autocorrelation
    const minLag = Math.floor(sampleRate / this.config.maxFrequency);
    const maxLag = Math.floor(sampleRate / this.config.minFrequency);

    let maxCorr = -Infinity;
    let bestLag = minLag;

    for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
      let corr = 0;
      for (let i = 0; i < n - lag; i++) {
        corr += windowed[i] * windowed[i + lag];
      }
      if (corr > maxCorr) {
        maxCorr = corr;
        bestLag = lag;
      }
    }

    // Convert lag to frequency
    const pitch = bestLag > 0 ? sampleRate / bestLag : 0;

    // Normalize confidence
    const energy = this.computeEnergy(windowed);
    const confidence = energy > 0 ? Math.min(1, Math.max(0, maxCorr / (energy * n * 0.9))) : 0;

    return {
      pitch: pitch >= this.config.minFrequency && pitch <= this.config.maxFrequency ? pitch : 0,
      confidence: confidence > this.config.confidenceThreshold ? confidence : 0,
    };
  }

  private estimateDominantFrequency(audio: Buffer): number {
    // Simple FFT-based dominant frequency estimation
    const samples = Math.floor(audio.length / 2);
    const n = Math.min(samples, 2048);

    // Extract samples and apply Hann window
    const frame = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const idx = i * 2;
      if (idx + 1 < audio.length) {
        const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
        frame[i] = (audio.readInt16LE(idx) / 32768) * w;
      }
    }

    // Simple DFT for first few bins (approximate FFT)
    const binSize = this.config.sampleRate / n;
    let maxMag = 0;
    let dominantBin = 0;

    // Only analyze bins within our frequency range
    const minBin = Math.floor(this.config.minFrequency / binSize);
    const maxBin = Math.min(Math.floor(this.config.maxFrequency / binSize), n / 2);

    for (let k = minBin; k <= maxBin; k++) {
      let real = 0;
      let imag = 0;

      for (let t = 0; t < n; t++) {
        const angle = -2 * Math.PI * k * t / n;
        real += frame[t]! * Math.cos(angle);
        imag += frame[t]! * Math.sin(angle);
      }

      const mag = Math.sqrt(real * real + imag * imag);
      if (mag > maxMag) {
        maxMag = mag;
        dominantBin = k;
      }
    }

    return dominantBin * binSize;
  }

  /**
   * Convert pitch between units.
   */
  convertPitch(pitchHz: number, from: PitchUnit, to: PitchUnit): number {
    if (from === to) return pitchHz;

    if (from === "hz" && to === "midi") {
      // MIDI: A4 = 69, A4 = 440Hz
      return pitchHz > 0 ? 69 + 12 * Math.log2(pitchHz / 440) : 0;
    }

    if (from === "hz" && to === "cents") {
      // Cents relative to A4 (440Hz)
      return pitchHz > 0 ? 1200 * Math.log2(pitchHz / 440) : 0;
    }

    if (from === "midi" && to === "hz") {
      return 440 * Math.pow(2, (pitchHz - 69) / 12);
    }

    if (from === "cents" && to === "hz") {
      return 440 * Math.pow(2, pitchHz / 1200);
    }

    return pitchHz;
  }
}

export interface PitchDetection extends EventEmitter {
  on(event: "detectionComplete", listener: (info: { sessionId?: string; frameCount: number }) => void): this;
  emit(event: "detectionComplete", info: { sessionId?: string; frameCount: number }): boolean;
}

// ─── Utility Functions ─────────────────────────────────────────────────────────

/**
 * Convert Hz to semitones from a reference pitch.
 */
export function hzToSemitones(hz: number, referenceHz = 440): number {
  return hz > 0 ? 12 * Math.log2(hz / referenceHz) : 0;
}

/**
 * Get musical note name from Hz.
 */
export function hzToNoteName(hz: number): string {
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  if (hz <= 0) return "N/A";

  const semitones = 12 * Math.log2(hz / 440);
  const midiNote = Math.round(semitones + 69);
  const noteName = noteNames[midiNote % 12]!;
  const octave = Math.floor(midiNote / 12) - 1;

  return `${noteName}${octave}`;
}

/**
 * Estimate speaker gender from average pitch.
 */
export function estimateGender(avgPitchHz: number): "male" | "female" | "unknown" {
  if (avgPitchHz >= 120 && avgPitchHz <= 200) return "male";
  if (avgPitchHz >= 180 && avgPitchHz <= 300) return "female";
  return "unknown";
}

// ─── Singleton Export ──────────────────────────────────────────────────────────

export const pitchDetection: PitchDetection = new PitchDetectionImpl();