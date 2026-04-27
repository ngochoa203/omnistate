import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadProfile } from "./profile-store.js";

const execFileAsync = promisify(execFile);

const voiceEmbedScriptPath = fileURLToPath(
  new URL("../../scripts/voice_embed.py", import.meta.url),
);
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
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function verifySpeaker(
  audio: Buffer,
  format: string,
  userId: string,
  threshold: number,
): Promise<{ match: boolean; score: number; reason?: string }> {
  // ~10 MB raw ≈ 14 MB base64
  if (audio.length > 10 * 1024 * 1024) {
    return { match: false, score: 0, reason: "AUDIO_TOO_LARGE" };
  }
  const profile = await loadProfile(userId);
  if (!profile) return { match: false, score: 0, reason: "NO_PROFILE" };

  const embedding = await extractEmbedding(audio, format);
  const score = cosineSimilarity(embedding, profile.embedding);
  return { match: score >= threshold, score };
}
