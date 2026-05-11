import type WebSocket from "ws";
import { extractEmbedding } from "./verification.js";
import { saveProfile } from "./profile-store.js";
import type { VoiceProfile } from "./profile-store.js";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

export const ENROLLMENT_PHRASES = [
  "Trợ lý, hãy bắt đầu phiên làm việc hôm nay",
  "Tôi cần bạn tìm kiếm thông tin cho tôi",
  "Hãy đọc lại nội dung vừa nhận được",
  "Hey assistant, open my task list",
  "Read the last message out loud",
] as const;

const REQUIRED_SAMPLES = ENROLLMENT_PHRASES.length;

// Audio quality thresholds
const MIN_AUDIO_DURATION_MS = 500;
const MAX_CLIPPING_RATIO = 0.05; // 5% of samples can clip
const MIN_SNR_DB = 10; // minimum signal-to-noise ratio in dB
const MAX_SILENCE_RATIO = 0.9; // reject if >90% is silence/near-silence

interface EnrollmentSession {
  embeddings: number[][];
  currentPhraseIndex: number;
  startedAt: number;
  lastActivityAt: number;
}

interface EnrollmentProgress {
  userId: string;
  embeddings: number[][];
  currentPhraseIndex: number;
  startedAt: string;
  lastActivityAt: string;
}

const sessions = new Map<string, EnrollmentSession>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Persistence directory for enrollment progress
function getEnrollmentDir(): string {
  const customRoot = process.env.OMNISTATE_RTC_PROFILE_DIR?.trim();
  const root = customRoot ? resolve(customRoot) : resolve(join(tmpdir(), "omnistate-voice-profiles"));
  return join(root, "enrollment-progress");
}

function progressPath(userId: string): string {
  return join(getEnrollmentDir(), `${userId}-progress.json`);
}

function send(ws: WebSocket, type: string, payload: Record<string, unknown>): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

// ─── Audio Quality Analysis ──────────────────────────────────────────────────

interface AudioQualityResult {
  snrDb: number;
  clippingRatio: number;
  silenceRatio: number;
  durationMs: number;
  isAcceptable: boolean;
  reasons: string[];
}

function analyzeAudioQuality(audioBuffer: Buffer, format: string): AudioQualityResult {
  const reasons: string[] = [];
  let snrDb = 40; // default good SNR
  let clippingRatio = 0;
  let silenceRatio = 0;
  let durationMs = 1000;

  // Assuming 16kHz mono PCM for simplicity - adjust based on actual format
  const bytesPerSample = format.includes("32") ? 4 : format.includes("16") ? 2 : 2;
  const channels = format.includes("mono") ? 1 : 2;

  const totalBytes = audioBuffer.length;
  const totalSamples = Math.floor(totalBytes / bytesPerSample / channels);
  const sampleRate = 16000;
  durationMs = (totalSamples / sampleRate) * 1000;

  // Simple amplitude analysis on raw bytes
  const samples = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, Math.min(totalSamples, audioBuffer.length / 2));
  let maxAmp = 0;
  let sumSignal = 0;

  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]!);
    if (abs > maxAmp) maxAmp = abs;
    sumSignal += abs;

    // Check for clipping (value at or near max Int16)
    if (abs >= 32700) clippingRatio++;
  }

  const avgSignal = sumSignal / samples.length;
  const noiseEstimate = avgSignal * 0.1; // assume ~10% of signal is noise baseline
  snrDb = avgSignal > noiseEstimate ? 20 * Math.log10(avgSignal / Math.max(noiseEstimate, 1)) : 0;

  clippingRatio /= samples.length;

  // Silence detection using threshold
  let silenceCount = 0;
  const silenceThreshold = 500;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) < silenceThreshold) silenceCount++;
  }
  silenceRatio = silenceCount / samples.length;

  // Validate
  if (durationMs < MIN_AUDIO_DURATION_MS) {
    reasons.push(`Audio too short (${Math.round(durationMs)}ms, minimum ${MIN_AUDIO_DURATION_MS}ms)`);
  }
  if (clippingRatio > MAX_CLIPPING_RATIO) {
    reasons.push(`Audio clipping detected (${(clippingRatio * 100).toFixed(1)}% of samples)`);
  }
  if (silenceRatio > MAX_SILENCE_RATIO) {
    reasons.push(`Audio is mostly silence (${(silenceRatio * 100).toFixed(1)}% silent)`);
  }
  if (snrDb < MIN_SNR_DB) {
    reasons.push(`Audio too noisy (SNR ${snrDb.toFixed(1)}dB, minimum ${MIN_SNR_DB}dB)`);
  }

  const isAcceptable = reasons.length === 0;

  return { snrDb, clippingRatio, silenceRatio, durationMs, isAcceptable, reasons };
}

// ─── Pronunciation Feedback ──────────────────────────────────────────────────

interface PronunciationFeedback {
  score: number; // 0-100
  issues: string[];
  tips: string[];
}

function analyzePronunciation(expected: string, audioBuffer: Buffer): PronunciationFeedback {
  const issues: string[] = [];
  const tips: string[] = [];

  // Simple heuristic: estimate speech rate and clarity from amplitude patterns
  const totalBytes = audioBuffer.length;
  const samples = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, Math.floor(totalBytes / 2));

  let zeroCrossings = 0;
  let energySum = 0;

  for (let i = 1; i < samples.length; i++) {
    const abs = Math.abs(samples[i]!);
    energySum += abs;

    // Zero crossing rate (indicates speech-like patterns)
    if ((samples[i]! >= 0 && samples[i - 1]! < 0) || (samples[i]! < 0 && samples[i - 1]! >= 0)) {
      zeroCrossings++;
    }
  }

  const avgEnergy = energySum / samples.length;
  const zcr = zeroCrossings / samples.length; // normalized zero crossing rate

  // Estimate score based on energy distribution and zero crossing rate
  // Higher energy + moderate ZCR = better clarity
  let score = 70 + Math.min(30, avgEnergy / 100);

  // Check for common issues
  if (avgEnergy < 1000) {
    issues.push("Speech too quiet - speak louder");
    tips.push("Position microphone closer or speak more clearly");
    score -= 20;
  }

  if (zcr < 0.01) {
    issues.push("Unusual speech pattern detected");
    tips.push("Speak at a natural pace, not too slowly");
    score -= 10;
  }

  if (zcr > 0.15) {
    issues.push("Speech too fast or unclear");
    tips.push("Speak more slowly and distinctly");
    score -= 10;
  }

  // Progressive learning tips based on expected phrase language
  if (expected.includes("Trợ lý") || expected.includes("tìm kiếm")) {
    tips.push("For Vietnamese phrases: emphasize the vowel sounds clearly");
  } else if (expected.includes("assistant") || expected.includes("task")) {
    tips.push("For English phrases: consonant clarity is important, especially 't' and 's' sounds");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, issues, tips };
}

// ─── Progress Persistence ────────────────────────────────────────────────────

async function saveProgress(userId: string, session: EnrollmentSession): Promise<void> {
  const progress: EnrollmentProgress = {
    userId,
    embeddings: session.embeddings,
    currentPhraseIndex: session.currentPhraseIndex,
    startedAt: new Date(session.startedAt).toISOString(),
    lastActivityAt: new Date(session.lastActivityAt).toISOString(),
  };

  const dir = getEnrollmentDir();
  await mkdir(dir, { recursive: true });
  await writeFile(progressPath(userId), JSON.stringify(progress, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

async function loadProgress(userId: string): Promise<EnrollmentProgress | null> {
  const path = progressPath(userId);
  if (!existsSync(path)) return null;

  try {
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as EnrollmentProgress;

    // Validate structure
    if (
      typeof data.userId !== "string" ||
      !Array.isArray(data.embeddings) ||
      !Array.isArray(data.embeddings[0]) ||
      typeof data.currentPhraseIndex !== "number"
    ) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

async function clearProgress(userId: string): Promise<void> {
  const path = progressPath(userId);
  if (existsSync(path)) {
    await unlink(path).catch(() => {/* ignore */});
  }
}

async function restoreSession(progress: EnrollmentProgress, _ws?: WebSocket): Promise<EnrollmentSession> {
  return {
    embeddings: progress.embeddings,
    currentPhraseIndex: progress.currentPhraseIndex,
    startedAt: new Date(progress.startedAt).getTime(),
    lastActivityAt: Date.now(),
  };
}

// ─── Session Management ──────────────────────────────────────────────────────

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes inactivity timeout

function createSessionTimer(userId: string, ws: WebSocket): void {
  // Clear existing timer
  const existing = cleanupTimers.get(userId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    const session = sessions.get(userId);
    if (session) {
      send(ws, "voice.enroll.timeout", {
        message: "Session timed out due to inactivity",
        phraseIndex: session.currentPhraseIndex,
        canResume: session.embeddings.length > 0,
      });
      sessions.delete(userId);
      cleanupTimers.delete(userId);
      clearProgress(userId).catch(() => {/* ignore */});
    }
  }, SESSION_TIMEOUT_MS);

  cleanupTimers.set(userId, timer);
}

function extendSession(userId: string, ws: WebSocket): void {
  const session = sessions.get(userId);
  if (session) {
    session.lastActivityAt = Date.now();
    createSessionTimer(userId, ws);
  }
}

export function handleEnrollStart(ws: WebSocket, userId: string): void {
  // Clear existing session and timer before creating new one
  if (sessions.has(userId)) {
    const oldTimer = cleanupTimers.get(userId);
    if (oldTimer) clearTimeout(oldTimer);
    sessions.delete(userId);
  }

  // Try to restore from saved progress
  loadProgress(userId).then((progress) => {
    if (progress && progress.embeddings.length > 0) {
      // Resume existing enrollment
      restoreSession(progress).then((session) => {
        sessions.set(userId, session);
        createSessionTimer(userId, ws);

        const phraseIndex = session.currentPhraseIndex;
        if (phraseIndex >= REQUIRED_SAMPLES) {
          // All done but not finalized - ask to finalize
          send(ws, "voice.enroll.resumed", {
            message: "Enrollment can be finalized",
            phraseIndex,
            totalPhrases: REQUIRED_SAMPLES,
            sampleCount: session.embeddings.length,
          });
        } else {
          send(ws, "voice.enroll.resumed", {
            message: `Resuming enrollment from phrase ${phraseIndex + 1}`,
            phraseIndex,
            prompt: ENROLLMENT_PHRASES[phraseIndex],
            totalPhrases: REQUIRED_SAMPLES,
            sampleCount: session.embeddings.length,
          });
        }
      });
    } else {
      // Start fresh
      const session: EnrollmentSession = {
        embeddings: [],
        currentPhraseIndex: 0,
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
      };
      sessions.set(userId, session);
      createSessionTimer(userId, ws);

      send(ws, "voice.enroll.ready", {
        phraseIndex: 0,
        prompt: ENROLLMENT_PHRASES[0],
        totalPhrases: REQUIRED_SAMPLES,
      });
    }
  }).catch(() => {
    // On error, start fresh
    const session: EnrollmentSession = {
      embeddings: [],
      currentPhraseIndex: 0,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    sessions.set(userId, session);
    createSessionTimer(userId, ws);

    send(ws, "voice.enroll.ready", {
      phraseIndex: 0,
      prompt: ENROLLMENT_PHRASES[0],
      totalPhrases: REQUIRED_SAMPLES,
    });
  });
}

export async function handleEnrollSample(
  ws: WebSocket,
  userId: string,
  audioBase64: string,
  format: string,
  phraseIndex: number,
): Promise<void> {
  let session = sessions.get(userId);
  if (!session) {
    // Try to restore from progress
    const progress = await loadProgress(userId);
    if (progress) {
      session = await restoreSession(progress, ws);
      sessions.set(userId, session);
      createSessionTimer(userId, ws);
    }
  }

  if (!session) {
    send(ws, "voice.enroll.error", { code: "NO_SESSION", message: "Enrollment not started" });
    return;
  }

  // Update activity
  extendSession(userId, ws);

  if (phraseIndex !== session.currentPhraseIndex) {
    send(ws, "voice.enroll.error", {
      code: "WRONG_PHRASE",
      message: `Expected phrase ${session.currentPhraseIndex}, got ${phraseIndex}`,
    });
    return;
  }

  try {
    if (audioBase64.length > 14_000_000) {
      send(ws, "voice.enroll.error", { code: "AUDIO_TOO_LARGE", message: "Audio exceeds size limit" });
      return;
    }
    const audio = Buffer.from(audioBase64, "base64");

    // ─── Audio Quality Validation ───────────────────────────────────────────
    const quality = analyzeAudioQuality(audio, format);

    if (!quality.isAcceptable) {
      send(ws, "voice.enroll.quality-feedback", {
        accepted: false,
        phraseIndex,
        quality: {
          snrDb: Math.round(quality.snrDb * 10) / 10,
          clippingRatio: Math.round(quality.clippingRatio * 1000) / 10,
          silenceRatio: Math.round(quality.silenceRatio * 1000) / 10,
          durationMs: Math.round(quality.durationMs),
        },
        reasons: quality.reasons,
        message: "Audio quality too low. Please try again in a quieter environment.",
      });

      // Update activity but don't advance
      session.lastActivityAt = Date.now();
      await saveProgress(userId, session);
      return;
    }

    // ─── Pronunciation Feedback ───────────────────────────────────────────
    const pronunciation = analyzePronunciation(ENROLLMENT_PHRASES[phraseIndex] ?? "", audio);

    // Extract embedding
    const embedding = await extractEmbedding(audio, format);
    session.embeddings.push(embedding);
    session.currentPhraseIndex++;
    session.lastActivityAt = Date.now();

    // Save progress
    await saveProgress(userId, session);

    const nextIndex = session.currentPhraseIndex;

    // Send progress with pronunciation feedback
    send(ws, "voice.enroll.progress", {
      accepted: true,
      phraseIndex: nextIndex,
      pronunciationScore: pronunciation.score,
    });

    // Send detailed feedback for low scores
    if (pronunciation.score < 80) {
      send(ws, "voice.enroll.pronunciation-tips", {
        phraseIndex,
        score: pronunciation.score,
        issues: pronunciation.issues,
        tips: pronunciation.tips,
      });
    }

    if (nextIndex < REQUIRED_SAMPLES) {
      send(ws, "voice.enroll.ready", {
        phraseIndex: nextIndex,
        prompt: ENROLLMENT_PHRASES[nextIndex],
        totalPhrases: REQUIRED_SAMPLES,
      });
    } else {
      // All phrases collected - ask client to finalize
      const timer = setTimeout(() => {
        if (sessions.has(userId)) {
          sessions.delete(userId);
          cleanupTimers.delete(userId);
          clearProgress(userId).catch(() => {/* ignore */});
        }
      }, 10 * 60 * 1000); // 10 minutes
      cleanupTimers.set(userId, timer);

      send(ws, "voice.enroll.ready-finalize", {
        message: "All phrases recorded. Call finalize to complete enrollment.",
        sampleCount: session.embeddings.length,
      });
    }
  } catch (err) {
    console.error(err);
    send(ws, "voice.enroll.error", {
      code: "EMBEDDING_FAILED",
      message: "Embedding extraction failed",
    });
  }
}

export async function handleEnrollFinalize(ws: WebSocket, userId: string): Promise<void> {
  let session = sessions.get(userId);
  if (!session) {
    // Try to restore from progress
    const progress = await loadProgress(userId);
    if (progress && progress.embeddings.length >= REQUIRED_SAMPLES) {
      session = await restoreSession(progress, ws);
      sessions.set(userId, session);
    }
  }

  if (!session) {
    send(ws, "voice.enroll.error", { code: "NO_SESSION", message: "Enrollment not started" });
    return;
  }
  if (session.embeddings.length < REQUIRED_SAMPLES) {
    send(ws, "voice.enroll.error", {
      code: "INSUFFICIENT_SAMPLES",
      message: `Need ${REQUIRED_SAMPLES} samples, have ${session.embeddings.length}`,
    });
    return;
  }

  const dim = session.embeddings[0]!.length;
  const averaged: number[] = Array.from({ length: dim }, () => 0);
  for (const emb of session.embeddings) {
    for (let i = 0; i < dim; i++) averaged[i]! += emb[i]!;
  }
  for (let i = 0; i < dim; i++) averaged[i]! /= session.embeddings.length;

  const now = new Date().toISOString();
  const profile: VoiceProfile = {
    userId,
    createdAt: now,
    updatedAt: now,
    embedding: averaged,
    sampleCount: session.embeddings.length,
    version: 2,
  };

  try {
    await saveProfile(profile);

    // Clear timers, session, and persisted progress
    const timer = cleanupTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      cleanupTimers.delete(userId);
    }
    sessions.delete(userId);
    await clearProgress(userId);

    send(ws, "voice.enroll.done", { userId, sampleCount: profile.sampleCount });
  } catch (err) {
    send(ws, "voice.enroll.error", {
      code: "SAVE_FAILED",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export function handleEnrollCancel(_ws: WebSocket, userId: string): void {
  const timer = cleanupTimers.get(userId);
  if (timer) clearTimeout(timer);
  cleanupTimers.delete(userId);
  sessions.delete(userId);
  clearProgress(userId).catch(() => {/* ignore */});
}

export function cleanupEnrollSession(userId: string): void {
  const timer = cleanupTimers.get(userId);
  if (timer) clearTimeout(timer);
  cleanupTimers.delete(userId);
  sessions.delete(userId);
  clearProgress(userId).catch(() => {/* ignore */});
}

// Export for testing
export { analyzeAudioQuality, analyzePronunciation, MIN_SNR_DB, MAX_CLIPPING_RATIO, MIN_AUDIO_DURATION_MS };