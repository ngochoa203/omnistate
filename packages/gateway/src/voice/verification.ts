import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadProfile } from "./profile-store.js";

export interface VerificationResult {
  match: boolean;
  score: number;
  reason?: string;
  confidence: number;
  confidenceInterval: { lower: number; upper: number };
  qualityScore: number;
  adjustedThreshold: number;
  antiSpoofing: {
    isReplayAttack: boolean;
    isSyntheticAudio: boolean;
    audioAnomalyDetected: boolean;
    replayConfidence: number;
    syntheticConfidence: number;
    anomalyScore: number;
  };
}

const execFileAsync = promisify(execFile);

const voiceEmbedScriptPath = resolve(process.cwd(), "scripts/voice/voice_embed.py");
const bundledRtvcRepoDir = fileURLToPath(
  new URL("../../vendor/Real-Time-Voice-Cloning", import.meta.url),
);

function getRepoDir(): string {
  const configured = process.env.OMNISTATE_RTC_REPO_DIR?.trim();
  return resolve(configured || bundledRtvcRepoDir);
}

function getPythonExec(): string {
  return process.env.OMNISTATE_RTC_PYTHON?.trim() || "python3";
}

function mockEmbedding(audio: Buffer): number[] {
  const hash = createHash("sha256").update(audio).digest();
  const floats: number[] = [];
  for (let i = 0; i < 256; i++) {
    floats.push((hash[i % hash.length]! / 255) * 2 - 1);
  }
  const norm = Math.sqrt(floats.reduce((s, v) => s + v * v, 0));
  return floats.map((v) => v / norm);
}

export async function extractEmbedding(audio: Buffer, _format: string): Promise<number[]> {
  if (process.env.OMNISTATE_ENROLL_MOCK === "1") {
    return mockEmbedding(audio);
  }

  const tmpDir = tmpdir();
  await mkdir(tmpDir, { recursive: true });
  const wavPath = join(tmpDir, `voice_embed_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);

  try {
    await writeFile(wavPath, audio, { mode: 0o600 });
    const { stdout } = await execFileAsync(getPythonExec(), [
      voiceEmbedScriptPath,
      "--wav", wavPath,
      "--repo", getRepoDir(),
    ], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
    const result = JSON.parse(stdout.trim()) as { embedding?: number[]; error?: string };
    if (result.error) {
      console.error("[voice embed] script error:", result.error);
      throw new Error("voice embed failed");
    }
    if (!Array.isArray(result.embedding)) throw new Error("No embedding in output");
    return result.embedding;
  } finally {
    unlink(wavPath).catch(() => {});
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    console.error(`[cosineSimilarity] length mismatch: ${a.length} vs ${b.length}`);
    return 0;
  }
  if (a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  // Bug fix: handle zero vectors properly
  if (denom === 0) {
    return normA === 0 && normB === 0 ? 1.0 : 0.0;
  }
  return dot / denom;
}

// --- Module-level helpers (not exported) ---

const HISTORICAL_MEAN = 0.65;
const HISTORICAL_STDDEV = 0.15;

function estimateSNR(audio: Buffer, sampleRate: number): number {
  const audioSamples = Math.floor(audio.length / 2);
  if (audioSamples < 1) return 20;
  const samples = audioSamples;
  const chunkSize = Math.min(samples, Math.floor(sampleRate * 0.1));
  let signalPower = 0;
  let noiseFloor = Infinity;

  for (let i = 0; i < samples; i += chunkSize) {
    let chunkSum = 0;
    const end = Math.min(i + chunkSize, samples);
    const actualEnd = Math.min(end, samples);
    for (let j = i; j < actualEnd; j++) {
      const val = audio.readInt16LE(j * 2) / 32768;
      chunkSum += val * val;
    }
    const chunkLen = actualEnd - i;
    if (chunkLen === 0) continue;
    const chunkPower = chunkSum / chunkLen;
    signalPower = Math.max(signalPower, chunkPower);
    noiseFloor = Math.min(noiseFloor, chunkPower);
  }

  if (noiseFloor === 0 || noiseFloor === Infinity) return 20;
  const snr = 10 * Math.log10(signalPower / noiseFloor);
  return Math.max(0, Math.min(40, snr));
}

function computeQualityScore(audio: Buffer, sampleRate: number): number {
  const audioSamples = Math.floor(audio.length / 2);
  if (audioSamples < 1) return 0.1;
  const samples = audioSamples;
  if (samples < sampleRate * 0.1) return 0.1;

  let sum = 0;
  let maxAmp = 0;
  let clippingCount = 0;
  let prevVal = 0;
  let amplitudeJumps = 0;

  for (let i = 0; i < samples; i++) {
    const val = audio.readInt16LE(i * 2) / 32768;
    sum += val * val;
    const absVal = Math.abs(val);
    maxAmp = Math.max(maxAmp, absVal);

    if (absVal > 0.99) clippingCount++;
    if (i > 0 && Math.abs(val - prevVal) > 0.5) amplitudeJumps++;
    prevVal = val;
  }

  const rms = Math.sqrt(sum / samples);
  const clippingRatio = clippingCount / samples;

  const rmsScore = rms < 0.001 ? 0.1 : rms > 0.5 ? 0.5 : 1.0 - Math.abs(Math.log10(rms + 0.001)) / 2;
  const clippingScore = Math.max(0, 1 - clippingRatio * 100);
  const jumpScore = Math.max(0, 1 - amplitudeJumps / samples);

  return Math.max(0.1, Math.min(1, rmsScore * 0.4 + clippingScore * 0.3 + jumpScore * 0.3));
}

function computeAdjustedThreshold(baseThreshold: number, snr: number, qualityScore: number): number {
  const snrFactor = snr < 10 ? 1.3 : snr < 20 ? 1.1 : 1.0;
  const qualityFactor = qualityScore < 0.5 ? 1.2 : qualityScore < 0.8 ? 1.1 : 1.0;
  return Math.min(1, baseThreshold * snrFactor * qualityFactor);
}

function computeConfidenceInterval(score: number, qualityScore: number, audioDuration: number): { lower: number; upper: number } {
  const baseStddev = (1 - qualityScore) * 0.2;
  const shortAudioPenalty = audioDuration < 0.5 ? 0.15 : 0;
  const effectiveStddev = Math.min(0.4, baseStddev + shortAudioPenalty);

  const zScore = (score - HISTORICAL_MEAN) / HISTORICAL_STDDEV;
  const shrinkage = Math.exp(-Math.abs(zScore) * 0.5) * 0.3;
  const adjustedScore = score * (1 - shrinkage) + HISTORICAL_MEAN * shrinkage;

  const margin = 1.96 * effectiveStddev;
  return {
    lower: Math.max(0, adjustedScore - margin),
    upper: Math.min(1, adjustedScore + margin),
  };
}

function computeBayesianConfidence(score: number, threshold: number, qualityScore: number): number {
  const priorMatch = 0.95;
  const priorNoMatch = 1 - priorMatch;

  const scoreDiff = score - threshold;
  const normalizedDiff = scoreDiff / HISTORICAL_STDDEV;

  const likelihoodMatch = Math.exp(-normalizedDiff * normalizedDiff / 2);
  const likelihoodNoMatch = Math.exp(-(1 + normalizedDiff) * (1 + normalizedDiff) / 2);

  const evidence = priorMatch * likelihoodMatch + priorNoMatch * likelihoodNoMatch;
  const posteriorMatch = (priorMatch * likelihoodMatch) / evidence;

  return posteriorMatch * qualityScore * 0.9 + 0.05;
}

function detectReplayAttack(audio: Buffer, sampleRate: number): { isReplay: boolean; confidence: number } {
  const durationSec = audio.length / (2 * sampleRate);

  if (durationSec < 0.3) return { isReplay: true, confidence: 0.8 };
  if (durationSec > 30) return { isReplay: false, confidence: 0 };

  const chunkSize = sampleRate * 0.05;
  let lowEntropyChunks = 0;
  let totalChunks = 0;

  for (let i = 0; i < audio.length - chunkSize * 2; i += chunkSize) {
    let sum = 0;
    let sumSq = 0;
    const n = chunkSize;

    for (let j = 0; j < n; j++) {
      const val = audio.readInt16LE((i + j) * 2) / 32768;
      sum += val;
      sumSq += val * val;
    }

    const mean = sum / n;
    const variance = sumSq / n - mean * mean;

    if (variance < 0.001) lowEntropyChunks++;
    totalChunks++;
  }

  const lowEntropyRatio = lowEntropyChunks / Math.max(1, totalChunks);

  if (lowEntropyRatio > 0.5) return { isReplay: true, confidence: 0.7 };
  if (lowEntropyRatio > 0.3) return { isReplay: false, confidence: 0.5 };

  return { isReplay: false, confidence: 0.1 };
}

function detectSyntheticAudio(audio: Buffer, _sampleRate: number): { isSynthetic: boolean; confidence: number } {
  const audioSamples = Math.floor(audio.length / 2);
  if (audioSamples < 16) return { isSynthetic: false, confidence: 0.2 };
  const chunkSize = Math.min(audioSamples, 4096);
  let totalFlatness = 0;
  let chunkCount = 0;

  for (let start = 0; start + chunkSize <= audioSamples && chunkCount < 5; start += chunkSize) {
    const magnitudes: number[] = [];

    for (let k = 0; k < 16; k++) {
      let real = 0;
      let imag = 0;
      const actualChunkSize = Math.min(chunkSize, audioSamples - start);
      for (let n = 0; n < actualChunkSize; n++) {
        const val = audio.readInt16LE((start + n) * 2) / 32768;
        const angle = -2 * Math.PI * k * n / actualChunkSize;
        real += val * Math.cos(angle);
        imag += val * Math.sin(angle);
      }
      magnitudes.push(Math.sqrt(real * real + imag * imag) / actualChunkSize);
    }

    const geometricMean = Math.exp(
      magnitudes.reduce((s, m) => s + Math.log(Math.max(1e-10, m)), 0) / magnitudes.length,
    );
    const arithmeticMean = magnitudes.reduce((s, m) => s + m, 0) / magnitudes.length;
    const flatness = geometricMean / Math.max(1e-10, arithmeticMean);

    totalFlatness += flatness;
    chunkCount++;
  }

  const avgFlatness = totalFlatness / Math.max(1, chunkCount);

  if (avgFlatness > 0.8) return { isSynthetic: true, confidence: 0.8 };
  if (avgFlatness > 0.6) return { isSynthetic: false, confidence: 0.6 };

  return { isSynthetic: false, confidence: 0.2 };
}

function detectAudioAnomalies(audio: Buffer): { detected: boolean; score: number } {
  const audioSamples = Math.floor(audio.length / 2);
  if (audioSamples < 1) return { detected: false, score: 0 };
  const samples = audioSamples;
  let anomalyScore = 0;

  let clippingCount = 0;
  for (let i = 0; i < samples; i++) {
    const val = audio.readInt16LE(i * 2) / 32768;
    if (Math.abs(val) > 0.99) clippingCount++;
  }
  const clippingRatio = clippingCount / samples;
  if (clippingRatio > 0.01) anomalyScore += clippingRatio * 10;

  const blockSize = 256;
  let varianceBetweenBlocks = 0;
  let blockMeans: number[] = [];

  for (let i = 0; i + blockSize <= samples; i += blockSize) {
    let sum = 0;
    for (let j = i; j < i + blockSize; j++) {
      sum += audio.readInt16LE(j * 2) / 32768;
    }
    blockMeans.push(sum / blockSize);
  }

  for (let i = 1; i < blockMeans.length; i++) {
    varianceBetweenBlocks += Math.abs(blockMeans[i]! - blockMeans[i - 1]!);
  }

  const avgVariance = varianceBetweenBlocks / Math.max(1, blockMeans.length - 1);
  if (avgVariance > 0.1) anomalyScore += avgVariance * 5;

  let silentChunks = 0;
  const SAMPLE_RATE = 16000;
  for (let i = 0; i < samples; i += SAMPLE_RATE) {
    let energy = 0;
    const end = Math.min(i + SAMPLE_RATE, samples);
    for (let j = i; j < end; j++) {
      const val = audio.readInt16LE(j * 2) / 32768;
      energy += val * val;
    }
    const samplesInChunk = end - i;
    if (samplesInChunk > 0 && energy / samplesInChunk < 0.0001) silentChunks++;
  }

  const silenceRatio = silentChunks / Math.max(1, Math.ceil(samples / SAMPLE_RATE));
  if (silenceRatio > 0.3) anomalyScore += silenceRatio * 3;

  return {
    detected: anomalyScore > 0.5,
    score: Math.min(1, anomalyScore),
  };
}

export async function verifySpeaker(
  audio: Buffer,
  format: string,
  userId: string,
  threshold: number,
): Promise<VerificationResult> {
  if (audio.length > 10 * 1024 * 1024) {
    return {
      match: false,
      score: 0,
      reason: "AUDIO_TOO_LARGE",
      confidence: 0,
      confidenceInterval: { lower: 0, upper: 0 },
      qualityScore: 0,
      adjustedThreshold: threshold,
      antiSpoofing: {
        isReplayAttack: false,
        isSyntheticAudio: false,
        audioAnomalyDetected: false,
        replayConfidence: 0,
        syntheticConfidence: 0,
        anomalyScore: 0,
      },
    };
  }

  const profile = await loadProfile(userId);
  if (!profile) {
    return {
      match: false,
      score: 0,
      reason: "NO_PROFILE",
      confidence: 0,
      confidenceInterval: { lower: 0, upper: 0 },
      qualityScore: 0,
      adjustedThreshold: threshold,
      antiSpoofing: {
        isReplayAttack: false,
        isSyntheticAudio: false,
        audioAnomalyDetected: false,
        replayConfidence: 0,
        syntheticConfidence: 0,
        anomalyScore: 0,
      },
    };
  }

  const sampleRate = 16000;
  const audioDurationSec = audio.length / (2 * sampleRate);

  const embedding = await extractEmbedding(audio, format);
  const zeroEmbedding = embedding.every((v) => Math.abs(v) < 1e-9);

  const qualityScore = zeroEmbedding ? 0 : computeQualityScore(audio, sampleRate);
  const snr = zeroEmbedding ? 0 : estimateSNR(audio, sampleRate);
  const adjustedThreshold = computeAdjustedThreshold(threshold, snr, qualityScore);

  let score = zeroEmbedding ? 0 : cosineSimilarity(embedding, profile.embedding);

  const replayCheck = zeroEmbedding
    ? { isReplay: false, confidence: 0 }
    : detectReplayAttack(audio, sampleRate);
  const syntheticCheck = zeroEmbedding
    ? { isSynthetic: false, confidence: 0 }
    : detectSyntheticAudio(audio, sampleRate);
  const anomalyCheck = zeroEmbedding
    ? { detected: false, score: 0 }
    : detectAudioAnomalies(audio);

  const spoofingPenalty =
    replayCheck.confidence * 0.3 +
    syntheticCheck.confidence * 0.4 +
    anomalyCheck.score * 0.3;
  score = score * (1 - spoofingPenalty * 0.5);

  const effectiveQuality = audioDurationSec < 0.5 ? qualityScore * 0.5 : qualityScore;

  const confidenceInterval = computeConfidenceInterval(score, effectiveQuality, audioDurationSec);

  const confidence = zeroEmbedding
    ? 0
    : computeBayesianConfidence(score, adjustedThreshold, effectiveQuality);

  return {
    match: score >= adjustedThreshold,
    score,
    confidence,
    confidenceInterval,
    qualityScore: effectiveQuality,
    adjustedThreshold,
    antiSpoofing: {
      isReplayAttack: replayCheck.isReplay,
      isSyntheticAudio: syntheticCheck.isSynthetic,
      audioAnomalyDetected: anomalyCheck.detected,
      replayConfidence: replayCheck.confidence,
      syntheticConfidence: syntheticCheck.confidence,
      anomalyScore: anomalyCheck.score,
    },
  };
}