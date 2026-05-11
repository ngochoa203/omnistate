/**
 * liveness-detection.ts
 *
 * Anti-spoofing measures for voice verification.
 *
 * Provides:
 * - Replay attack detection via audio fingerprinting and timestamp validation
 * - Voice pattern analysis via frequency spectrum and synthetic audio detection
 * - Natural speech variability detection
 * - Multi-factor confidence scoring
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { childLogger } from "../utils/logger.js";

const log = childLogger("liveness-detection");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum audio duration in seconds for reliable analysis */
const MIN_AUDIO_DURATION_S = 0.5;

/** Maximum audio duration in seconds to prevent resource exhaustion */
const MAX_AUDIO_DURATION_S = 60;

/** Expected sample rate for audio analysis */
const SAMPLE_RATE = 16_000;

/** Number of frequency bins for spectrum analysis */
const FFT_SIZE = 2048;

/** Threshold for synthetic audio detection (0-1, higher = more suspicious) */
const SYNTHETIC_THRESHOLD = 0.65;

/** Threshold for replay detection confidence (0-1) */
const REPLAY_CONFIDENCE_THRESHOLD = 0.7;

/** Maximum age of audio fingerprint in ms before considered potential replay */
const MAX_FINGERPRINT_AGE_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Check {
  name: string;
  passed: boolean;
  score: number;
  reason: string;
}

export interface LivenessResult {
  isLive: boolean;
  confidence: number;
  checks: Check[];
}

export interface LivenessMetadata {
  timestamp?: number;
  sessionId?: string;
  deviceId?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// In-memory fingerprint store for replay detection
// ---------------------------------------------------------------------------

interface FingerprintEntry {
  fingerprint: string;
  timestamp: number;
  sessionId?: string;
}

const recentFingerprints = new Map<string, FingerprintEntry>();

function addFingerprint(key: string, fingerprint: string, sessionId?: string): void {
  recentFingerprints.set(key, { fingerprint, timestamp: Date.now(), sessionId });
  // Cleanup old entries periodically
  if (recentFingerprints.size > 1000) {
    const cutoff = Date.now() - MAX_FINGERPRINT_AGE_MS * 2;
    for (const [k, v] of recentFingerprints) {
      if (v.timestamp < cutoff) {
        recentFingerprints.delete(k);
      }
    }
  }
}

function findSimilarFingerprint(fingerprint: string, sessionId?: string): FingerprintEntry | null {
  const now = Date.now();
  for (const entry of recentFingerprints.values()) {
    // Skip entries that are too old
    if (now - entry.timestamp > MAX_FINGERPRINT_AGE_MS) continue;
    // Skip same session
    if (sessionId && entry.sessionId === sessionId) continue;
    // Exact match indicates potential replay
    if (timingSafeEqual(Buffer.from(fingerprint), Buffer.from(entry.fingerprint))) {
      return entry;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Audio Analysis Utilities
// ---------------------------------------------------------------------------

/**
 * Compute a simple audio fingerprint from PCM data.
 * Uses spectral characteristics to create a unique-ish hash.
 */
function computeAudioFingerprint(audio: Buffer, sampleRate: number): string {
  // Convert to Float32 for analysis
  const samples = new Float32Array(audio.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const low = audio[i * 2];
    const high = audio[i * 2 + 1];
    const int16 = (high << 8) | (low & 0xff);
    samples[i] = int16 >= 32768 ? int16 - 65536 : int16;
    samples[i] /= 32768;
  }

  // Compute simple spectral fingerprint using zero-crossing rate and energy
  let zeroCrossings = 0;
  let energy = 0;
  const hopSize = Math.floor(samples.length / 32);

  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) {
      zeroCrossings++;
    }
    energy += samples[i] * samples[i];
  }
  energy = Math.sqrt(energy / samples.length);

  // Compute spectral centroid approximation
  let spectralSum = 0;
  let centroid = 0;
  for (let i = 0; i < 32; i++) {
    const start = i * hopSize;
    const end = Math.min(start + hopSize, samples.length);
    let frameEnergy = 0;
    for (let j = start; j < end; j++) {
      frameEnergy += samples[j] * samples[j];
    }
    spectralSum += frameEnergy;
    centroid += i * frameEnergy;
  }
  centroid = spectralSum > 0 ? centroid / spectralSum : 0;

  // Create hash from characteristics
  const hash = createHash("sha256");
  hash.update(Buffer.from([
    Math.floor(zeroCrossings & 0xff),
    Math.floor((energy * 1000) & 0xff),
    Math.floor(centroid & 0xff),
    Math.floor((samples.length / sampleRate) & 0xff),
  ]));
  hash.update(audio.slice(0, Math.min(audio.length, 4096)));

  return hash.digest("hex");
}

/**
 * Perform basic FFT on audio samples using naive DFT.
 * Returns magnitude spectrum in dB.
 */
function computeSpectrum(samples: Float32Array, fftSize: number): Float32Array {
  const spectrum = new Float32Array(fftSize / 2);
  const halfSize = Math.min(samples.length, fftSize);

  for (let k = 0; k < fftSize / 2; k++) {
    let real = 0;
    let imag = 0;
    const freq = (2 * Math.PI * k) / halfSize;

    for (let n = 0; n < halfSize; n++) {
      const angle = freq * n;
      real += samples[n] * Math.cos(angle);
      imag -= samples[n] * Math.sin(angle);
    }

    const magnitude = Math.sqrt(real * real + imag * imag);
    // Convert to dB, clamped to reasonable range
    spectrum[k] = magnitude > 0 ? 20 * Math.log10(magnitude) : -100;
  }

  return spectrum;
}

/**
 * Detect synthetic audio by analyzing spectral characteristics.
 * Natural speech has specific patterns that synthetic TTS often lacks.
 */
function analyzeSyntheticIndicators(spectrum: Float32Array): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;

  // Check 1: Spectral flatness - synthetic audio tends to be more flat
  let geometricMean = 0;
  let arithmeticMean = 0;
  let nonzeroCount = 0;
  for (let i = 0; i < spectrum.length; i++) {
    if (spectrum[i] > -80) {
      geometricMean += Math.exp(spectrum[i] / 20);
      arithmeticMean += Math.exp(spectrum[i] / 20);
      nonzeroCount++;
    }
  }
  if (nonzeroCount > 0) {
    geometricMean = Math.pow(geometricMean / nonzeroCount, 1);
    arithmeticMean /= nonzeroCount;
    // Spectral flatness: ratio of geometric to arithmetic mean
    // Synthetic audio typically has higher flatness (closer to 1)
    const flatness = geometricMean / (arithmeticMean + 1e-10);
    if (flatness > 0.5) {
      score += 0.3;
      reasons.push(`High spectral flatness: ${flatness.toFixed(2)}`);
    }
  }

  // Check 2: High-frequency content - natural speech has natural HF rolloff
  const hfStart = Math.floor(spectrum.length * 0.3);
  const hfEnd = Math.floor(spectrum.length * 0.6);
  let hfEnergy = 0;
  let totalEnergy = 0;
  for (let i = 0; i < spectrum.length; i++) {
    totalEnergy += Math.exp(spectrum[i] / 10);
  }
  for (let i = hfStart; i < hfEnd; i++) {
    hfEnergy += Math.exp(spectrum[i] / 10);
  }
  const hfRatio = totalEnergy > 0 ? hfEnergy / totalEnergy : 0;

  // Synthetic TTS often has unnaturally high or low HF
  if (hfRatio > 0.35) {
    score += 0.25;
    reasons.push(`Unusually high HF content: ${hfRatio.toFixed(2)}`);
  } else if (hfRatio < 0.05) {
    score += 0.15;
    reasons.push(`Very low HF content: ${hfRatio.toFixed(2)}`);
  }

  // Check 3: Periodic patterns in spectrum - synthetic often has harmonics
  let peakCount = 0;
  for (let i = 1; i < spectrum.length - 1; i++) {
    if (spectrum[i] > spectrum[i - 1] && spectrum[i] > spectrum[i + 1]) {
      if (spectrum[i] > -40) {
        peakCount++;
      }
    }
  }
  // Too many sharp peaks can indicate synthetic
  if (peakCount > spectrum.length * 0.15) {
    score += 0.2;
    reasons.push(`Excessive spectral peaks: ${peakCount}`);
  }

  return { score: Math.min(score, 1), reasons };
}

/**
 * Analyze natural speech variability by examining frame-to-frame energy changes.
 */
function analyzeSpeechVariability(samples: Float32Array, sampleRate: number): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;

  // Frame length ~25ms
  const frameSize = Math.floor(sampleRate * 0.025);
  const hopSize = Math.floor(frameSize / 2);
  const frameCount = Math.floor((samples.length - frameSize) / hopSize);

  if (frameCount < 3) {
    return { score: 0.5, reasons: ["Insufficient samples for variability analysis"] };
  }

  const energies: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    const start = i * hopSize;
    let energy = 0;
    for (let j = start; j < start + frameSize && j < samples.length; j++) {
      energy += samples[j] * samples[j];
    }
    energies.push(Math.sqrt(energy / frameSize));
  }

  // Calculate coefficient of variation in energy
  const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
  const variance = energies.reduce((a, e) => a + (e - mean) ** 2, 0) / energies.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  // Natural speech has moderate variability
  // Too low = might be synthetic or recorded/replayed
  if (cv < 0.1) {
    score += 0.25;
    reasons.push(`Very low energy variability (CV=${cv.toFixed(3)})`);
  }

  // Check for unnatural regularity (bot-like)
  let regularityScore = 0;
  for (let i = 1; i < energies.length - 1; i++) {
    const diff = Math.abs(energies[i] - (energies[i - 1] + energies[i + 1]) / 2);
    if (diff < mean * 0.05) {
      regularityScore++;
    }
  }
  const regularityRatio = regularityScore / (energies.length - 2);
  if (regularityRatio > 0.7) {
    score += 0.3;
    reasons.push(`Highly regular energy pattern (${(regularityRatio * 100).toFixed(0)}%)`);
  }

  return { score: Math.min(score, 1), reasons };
}

/**
 * Validate audio timestamp against expected timing.
 */
function validateTimestamp(metadata: LivenessMetadata | undefined): {
  score: number;
  reason: string;
} {
  if (!metadata?.timestamp) {
    return { score: 0.5, reason: "No timestamp provided" };
  }

  const now = Date.now();
  const age = now - metadata.timestamp;

  if (age < 0) {
    return { score: 0, reason: `Future timestamp detected: ${age}ms` };
  }

  if (age > MAX_FINGERPRINT_AGE_MS) {
    return { score: 0.1, reason: `Timestamp too old: ${age}ms` };
  }

  if (age < 100) {
    return { score: 0.7, reason: `Timestamp is very recent: ${age}ms` };
  }

  return { score: 0.9, reason: `Timestamp valid: ${age}ms ago` };
}

// ---------------------------------------------------------------------------
// Main Liveness Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze audio for liveness indicators.
 *
 * @param audio - Raw PCM16 LE mono audio buffer
 * @param metadata - Optional metadata including timestamp, sessionId, deviceId
 * @returns LivenessResult with overall assessment and individual checks
 */
export async function analyzeLiveness(
  audio: Buffer,
  metadata?: LivenessMetadata,
): Promise<LivenessResult> {
  const checks: Check[] = [];

  // Basic validation
  if (!audio || audio.length === 0) {
    return {
      isLive: false,
      confidence: 0,
      checks: [{
        name: "audio_present",
        passed: false,
        score: 0,
        reason: "No audio provided",
      }],
    };
  }

  // Estimate duration
  const byteCount = audio.length;
  const sampleCount = byteCount / 2; // 16-bit samples
  const durationS = sampleCount / SAMPLE_RATE;

  if (durationS < MIN_AUDIO_DURATION_S) {
    return {
      isLive: false,
      confidence: 0.1,
      checks: [{
        name: "duration",
        passed: false,
        score: 0,
        reason: `Audio too short: ${durationS.toFixed(2)}s (min: ${MIN_AUDIO_DURATION_S}s)`,
      }],
    };
  }

  if (durationS > MAX_AUDIO_DURATION_S) {
    return {
      isLive: false,
      confidence: 0,
      checks: [{
        name: "duration",
        passed: false,
        score: 0,
        reason: `Audio too long: ${durationS.toFixed(2)}s (max: ${MAX_AUDIO_DURATION_S}s)`,
      }],
    };
  }

  // Convert to Float32 for analysis
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const low = audio[i * 2];
    const high = audio[i * 2 + 1];
    const int16 = (high << 8) | (low & 0xff);
    samples[i] = int16 >= 32768 ? int16 - 65536 : int16;
    samples[i] /= 32768;
  }

  // Check 1: Replay Attack Detection - Audio Fingerprint
  const fingerprint = computeAudioFingerprint(audio, SAMPLE_RATE);
  const sessionId = metadata?.sessionId;
  const similarFingerprint = findSimilarFingerprint(fingerprint, sessionId);

  if (similarFingerprint) {
    checks.push({
      name: "replay_fingerprint",
      passed: false,
      score: 0,
      reason: `Audio fingerprint matches recent sample from ${similarFingerprint.sessionId ?? "unknown session"}`,
    });
  } else {
    addFingerprint(sessionId ?? fingerprint, fingerprint, sessionId);
    checks.push({
      name: "replay_fingerprint",
      passed: true,
      score: 1,
      reason: "Audio fingerprint unique",
    });
  }

  // Check 2: Replay Attack Detection - Timestamp Validation
  const timestampResult = validateTimestamp(metadata);
  checks.push({
    name: "timestamp_validation",
    passed: timestampResult.score > REPLAY_CONFIDENCE_THRESHOLD,
    score: timestampResult.score,
    reason: timestampResult.reason,
  });

  // Check 3: Synthetic Audio Detection - Spectrum Analysis
  const spectrum = computeSpectrum(samples, FFT_SIZE);
  const syntheticResult = analyzeSyntheticIndicators(spectrum);

  checks.push({
    name: "synthetic_detection",
    passed: syntheticResult.score < SYNTHETIC_THRESHOLD,
    score: 1 - syntheticResult.score,
    reason: syntheticResult.reasons.length > 0
      ? syntheticResult.reasons.join("; ")
      : "No synthetic indicators found",
  });

  // Check 4: Natural Speech Variability
  const variabilityResult = analyzeSpeechVariability(samples, SAMPLE_RATE);

  checks.push({
    name: "speech_variability",
    passed: variabilityResult.score < 0.4,
    score: 1 - variabilityResult.score,
    reason: variabilityResult.reasons.length > 0
      ? variabilityResult.reasons.join("; ")
      : "Natural speech patterns detected",
  });

  // Check 5: Audio Quality/Anomaly Detection
  let energy = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    energy += samples[i] * samples[i];
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  energy = Math.sqrt(energy / samples.length);

  if (peak < 0.01) {
    checks.push({
      name: "audio_quality",
      passed: false,
      score: 0,
      reason: "Audio level too low / silent",
    });
  } else if (energy < 0.02) {
    checks.push({
      name: "audio_quality",
      passed: false,
      score: 0.1,
      reason: "Audio level very low",
    });
  } else if (peak > 0.99) {
    checks.push({
      name: "audio_quality",
      passed: false,
      score: 0.2,
      reason: "Audio clipped / distorted",
    });
  } else {
    checks.push({
      name: "audio_quality",
      passed: true,
      score: 1,
      reason: "Audio levels normal",
    });
  }

  // Calculate overall confidence using weighted factors
  const weights: Record<string, number> = {
    replay_fingerprint: 0.25,
    timestamp_validation: 0.15,
    synthetic_detection: 0.30,
    speech_variability: 0.20,
    audio_quality: 0.10,
  };

  let totalWeight = 0;
  let weightedScore = 0;

  for (const check of checks) {
    const weight = weights[check.name] ?? 0.1;
    weightedScore += check.score * weight;
    totalWeight += weight;
  }

  const confidence = totalWeight > 0 ? weightedScore / totalWeight : 0;

  // Determine if audio is live based on confidence and key checks
  const failedCriticalChecks = checks.filter(
    (c) => !c.passed && ["replay_fingerprint", "synthetic_detection"].includes(c.name)
  );

  const isLive = confidence >= 0.5 && failedCriticalChecks.length === 0;

  log.debug(
    { confidence, isLive, checks: checks.map((c) => ({ name: c.name, passed: c.passed, score: c.score })) },
    "Liveness analysis complete"
  );

  return {
    isLive,
    confidence: Math.round(confidence * 100) / 100,
    checks,
  };
}

// ---------------------------------------------------------------------------
// Utility exports
// ---------------------------------------------------------------------------

export { computeAudioFingerprint, computeSpectrum };