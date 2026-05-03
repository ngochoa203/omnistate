import type WebSocket from "ws";
import { extractEmbedding } from "./verification.js";
import { saveProfile } from "./profile-store.js";
import type { VoiceProfile } from "./profile-store.js";

export const ENROLLMENT_PHRASES = [
  "Trợ lý, hãy bắt đầu phiên làm việc hôm nay",
  "Tôi cần bạn tìm kiếm thông tin cho tôi",
  "Hãy đọc lại nội dung vừa nhận được",
  "Hey assistant, open my task list",
  "Read the last message out loud",
] as const;

const REQUIRED_SAMPLES = ENROLLMENT_PHRASES.length;

interface EnrollmentSession {
  embeddings: number[][];
  currentPhraseIndex: number;
}

const sessions = new Map<string, EnrollmentSession>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

function send(ws: WebSocket, type: string, payload: Record<string, unknown>): void {
  ws.send(JSON.stringify({ type, ...payload }));
}

export function handleEnrollStart(ws: WebSocket, userId: string): void {
  // Bug fix: Clear existing session and timer before creating new one
  if (sessions.has(userId)) {
    const oldTimer = cleanupTimers.get(userId);
    if (oldTimer) clearTimeout(oldTimer);
    sessions.delete(userId);
  }
  sessions.set(userId, { embeddings: [], currentPhraseIndex: 0 });
  // Bug fix #6: include totalPhrases so the client knows how many steps remain
  send(ws, "voice.enroll.ready", {
    phraseIndex: 0,
    prompt: ENROLLMENT_PHRASES[0],
    totalPhrases: REQUIRED_SAMPLES,
  });
}

export async function handleEnrollSample(
  ws: WebSocket,
  userId: string,
  audioBase64: string,
  format: string,
  phraseIndex: number,
): Promise<void> {
  const session = sessions.get(userId);
  if (!session) {
    send(ws, "voice.enroll.error", { code: "NO_SESSION", message: "Enrollment not started" });
    return;
  }
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
    const embedding = await extractEmbedding(audio, format);
    session.embeddings.push(embedding);
    session.currentPhraseIndex++;

    const nextIndex = session.currentPhraseIndex;
    send(ws, "voice.enroll.progress", { accepted: true, phraseIndex: nextIndex });

    if (nextIndex < REQUIRED_SAMPLES) {
      send(ws, "voice.enroll.ready", {
        phraseIndex: nextIndex,
        prompt: ENROLLMENT_PHRASES[nextIndex],
        totalPhrases: REQUIRED_SAMPLES,
      });
    } else {
      // Bug fix #7: all phrases collected — client should call finalize, but if
      // they don't, the session would leak indefinitely. Use cleanup timers map
      // so we can clear the timer when finalize is called.
      const timer = setTimeout(() => {
        if (sessions.has(userId)) {
          sessions.delete(userId);
          cleanupTimers.delete(userId);
        }
      }, 10 * 60 * 1000); // 10 minutes
      cleanupTimers.set(userId, timer);
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
  const session = sessions.get(userId);
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
    version: 1,
  };

  try {
    await saveProfile(profile);
    // Bug fix: Clear the cleanup timer since we successfully finalized
    const timer = cleanupTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      cleanupTimers.delete(userId);
    }
    sessions.delete(userId);
    send(ws, "voice.enroll.done", { userId, sampleCount: profile.sampleCount });
  } catch (err) {
    send(ws, "voice.enroll.error", {
      code: "SAVE_FAILED",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export function handleEnrollCancel(_ws: WebSocket, userId: string): void {
  sessions.delete(userId);
}

export function cleanupEnrollSession(userId: string): void {
  sessions.delete(userId);
}
