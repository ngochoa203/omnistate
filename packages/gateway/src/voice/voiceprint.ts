import { getDb } from "../db/database.js";

const VOICEPRINT_URL = process.env.VOICEPRINT_URL || "http://127.0.0.1:19802";
const REQUIRED_SAMPLES = 3;

export interface EnrollResult {
  embedding: number[];
  sampleCount: number;
  isComplete: boolean;
}

export interface VerifyResult {
  matched: boolean;
  profileId: string | null;
  similarity: number;
  scores: Record<string, number>;
}

export interface VoiceprintStatus {
  serviceAvailable: boolean;
  enrolledProfiles: number;
}

async function callService(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${VOICEPRINT_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Service error" })) as { error?: string };
    throw new Error(err.error || `Voiceprint service error: ${res.status}`);
  }
  return res.json();
}

export async function checkService(): Promise<boolean> {
  try {
    const res = await fetch(`${VOICEPRINT_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function enrollVoiceSample(
  profileId: string,
  audioBase64: string
): Promise<EnrollResult> {
  const db = getDb();

  // Get existing embedding if any
  const existing = db
    .prepare(
      "SELECT embedding_json, sample_count FROM voice_embeddings WHERE user_id = ?"
    )
    .get(profileId) as
    | { embedding_json: string; sample_count: number }
    | undefined;

  const result = await callService("/enroll", {
    audio: audioBase64,
    existingEmbedding: existing ? JSON.parse(existing.embedding_json) : null,
    sampleCount: existing?.sample_count ?? 0,
  });

  const sampleCount: number = result.sampleCount;
  const now = new Date().toISOString();
  const embeddingJson = JSON.stringify(result.embedding);

  if (existing) {
    db.prepare(
      `UPDATE voice_embeddings
          SET embedding_json = ?, sample_count = ?, updated_at = ?
        WHERE user_id = ?`
    ).run(embeddingJson, sampleCount, now, profileId);
  } else {
    const { v4: uuid } = await import("uuid");
    db.prepare(
      `INSERT INTO voice_embeddings (id, user_id, embedding_json, sample_count, enrolled_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(uuid(), profileId, embeddingJson, sampleCount, now, now);
  }

  // Update voice_profiles enrollment status
  const isEnrolled = sampleCount >= REQUIRED_SAMPLES ? 1 : 0;
  db.prepare(
    `UPDATE voice_profiles SET enrolled_samples = ?, is_enrolled = ?, updated_at = ? WHERE id = ?`
  ).run(sampleCount, isEnrolled, now, profileId);

  return {
    embedding: result.embedding,
    sampleCount,
    isComplete: sampleCount >= REQUIRED_SAMPLES,
  };
}

export async function verifySpeaker(audioBase64: string): Promise<VerifyResult> {
  const db = getDb();

  // Load all enrolled embeddings
  const rows = db
    .prepare(
      `SELECT ve.user_id, ve.embedding_json, ve.threshold
         FROM voice_embeddings ve
         JOIN voice_profiles vp ON vp.id = ve.user_id
        WHERE vp.is_enrolled = 1`
    )
    .all() as { user_id: string; embedding_json: string; threshold: number }[];

  if (rows.length === 0) {
    return { matched: false, profileId: null, similarity: 0, scores: {} };
  }

  const embeddings: Record<string, number[]> = {};
  let threshold = 0.75;
  for (const row of rows) {
    embeddings[row.user_id] = JSON.parse(row.embedding_json);
    // Use the stored per-profile threshold (last one wins if multiple; they should match)
    if (row.threshold) threshold = row.threshold;
  }

  const result = await callService("/verify", {
    audio: audioBase64,
    embeddings,
    threshold,
  });

  return {
    matched: result.matched,
    profileId: result.bestMatch ?? null,
    similarity: result.bestSimilarity,
    scores: result.scores,
  };
}

export async function deleteVoiceprint(profileId: string): Promise<void> {
  const db = getDb();
  db.prepare("DELETE FROM voice_embeddings WHERE user_id = ?").run(profileId);
  db.prepare(
    "UPDATE voice_profiles SET is_enrolled = 0, enrolled_samples = 0 WHERE id = ?"
  ).run(profileId);
}

export async function getEnrollmentStatus(profileId: string): Promise<{
  isEnrolled: boolean;
  sampleCount: number;
  required: number;
}> {
  const db = getDb();
  const row = db
    .prepare("SELECT sample_count FROM voice_embeddings WHERE user_id = ?")
    .get(profileId) as { sample_count: number } | undefined;

  return {
    isEnrolled: (row?.sample_count ?? 0) >= REQUIRED_SAMPLES,
    sampleCount: row?.sample_count ?? 0,
    required: REQUIRED_SAMPLES,
  };
}
