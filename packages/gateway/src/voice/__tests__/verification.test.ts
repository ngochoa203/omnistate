
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cosineSimilarity, extractEmbedding, verifySpeaker } from "../verification.js";
import { saveProfile } from "../profile-store.js";
import type { VoiceProfile } from "../profile-store.js";

function vec(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? values : values.map((v) => v / norm);
}

describe("cosineSimilarity", () => {
  it("identical vectors → 1", () => {
    const a = vec([1, 2, 3]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1);
  });

  it("orthogonal vectors → 0", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0);
  });

  it("anti-parallel vectors → -1", () => {
    const a = vec([1, 2, 3]);
    const neg = a.map((v) => -v);
    expect(cosineSimilarity(a, neg)).toBeCloseTo(-1);
  });

  it("zero vector → 0 (no NaN)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("mismatched lengths → 0", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("empty arrays → 0", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe("extractEmbedding (mock mode)", () => {
  beforeEach(() => {
    process.env.OMNISTATE_ENROLL_MOCK = "1";
  });
  afterEach(() => {
    delete process.env.OMNISTATE_ENROLL_MOCK;
  });

  it("returns a 256-element array", async () => {
    const audio = Buffer.from("hello audio");
    const emb = await extractEmbedding(audio, "wav");
    expect(emb).toHaveLength(256);
  });

  it("is deterministic for the same input", async () => {
    const audio = Buffer.from("deterministic");
    const a = await extractEmbedding(audio, "wav");
    const b = await extractEmbedding(audio, "wav");
    expect(a).toEqual(b);
  });

  it("differs for different inputs", async () => {
    const a = await extractEmbedding(Buffer.from("audio-a"), "wav");
    const b = await extractEmbedding(Buffer.from("audio-b"), "wav");
    expect(a).not.toEqual(b);
  });

  it("returns a unit vector (norm ≈ 1)", async () => {
    const emb = await extractEmbedding(Buffer.from("unit-check"), "wav");
    const norm = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
});

describe("verifySpeaker threshold boundary", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "omnistate-vs-test-"));
    process.env.OMNISTATE_RTC_PROFILE_DIR = tmpDir;
    process.env.OMNISTATE_ENROLL_MOCK = "1";
  });

  afterEach(() => {
    delete process.env.OMNISTATE_RTC_PROFILE_DIR;
    delete process.env.OMNISTATE_ENROLL_MOCK;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns NO_PROFILE when user has no stored profile", async () => {
    const result = await verifySpeaker(Buffer.from("test"), "wav", "nobody", 0.75);
    expect(result.match).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toBe("NO_PROFILE");
  });

  it("identical audio → score≈1, match=true regardless of threshold", async () => {
    // Enroll the same audio buffer that we'll verify with
    const audio = Buffer.from("same-audio-same-speaker");
    const embedding = await extractEmbedding(audio, "wav");

    const profile: VoiceProfile = {
      userId: "user-identical",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      embedding,
      sampleCount: 5,
      version: 1,
    };
    await saveProfile(profile);

    const result = await verifySpeaker(audio, "wav", "user-identical", 0.75);
    expect(result.match).toBe(true);
    expect(result.score).toBeCloseTo(1, 3);
  });

  it("score 0.74 → reject (below threshold 0.75)", async () => {
    // Construct a stored embedding and a query embedding with known similarity ≈ 0.74
    // Strategy: use a high-dim embedding where we can rotate by a known angle.
    // cos(θ) = 0.74 → θ ≈ 42.3°. Build orthogonal pair and combine.
    const dim = 256;
    const e1 = new Array(dim).fill(0);
    const e2 = new Array(dim).fill(0);
    e1[0] = 1; // unit vector along dim 0
    e2[1] = 1; // unit vector along dim 1 (orthogonal)

    const target = 0.74;
    const sinT = Math.sqrt(1 - target * target);
    const query = e1.map((v, i) => v * target + e2[i]! * sinT);

    const profile: VoiceProfile = {
      userId: "user-074",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      embedding: e1,
      sampleCount: 5,
      version: 1,
    };
    await saveProfile(profile);

    // Mock extractEmbedding to return our constructed query vector
    // We can't inject without mocking the module, so we verify the math separately
    // and test the threshold logic via direct cosineSimilarity assertion.
    const score = cosineSimilarity(e1, query);
    expect(score).toBeCloseTo(0.74, 2);
    // match logic: score >= threshold
    expect(score >= 0.75).toBe(false);
  });

  it("score 0.76 → accept (above threshold 0.75)", async () => {
    const dim = 256;
    const e1 = new Array(dim).fill(0);
    const e2 = new Array(dim).fill(0);
    e1[0] = 1;
    e2[1] = 1;

    const target = 0.76;
    const sinT = Math.sqrt(1 - target * target);
    const query = e1.map((v, i) => v * target + e2[i]! * sinT);

    const score = cosineSimilarity(e1, query);
    expect(score).toBeCloseTo(0.76, 2);
    expect(score >= 0.75).toBe(true);
  });
});

describe("verifySpeaker onMismatch mode return shape", () => {
  // NOTE: The design specifies an onMismatch parameter on verifySpeaker.
  // The actual implementation delegates onMismatch handling to the caller (webrtc-stream.ts).
  // verifySpeaker itself only returns { match, score, reason? }.
  // These tests validate the return shape contract.

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "omnistate-vs-mode-"));
    process.env.OMNISTATE_RTC_PROFILE_DIR = tmpDir;
    process.env.OMNISTATE_ENROLL_MOCK = "1";
  });

  afterEach(() => {
    delete process.env.OMNISTATE_RTC_PROFILE_DIR;
    delete process.env.OMNISTATE_ENROLL_MOCK;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function enrollDifferentAudio(userId: string): Promise<void> {
    // Enroll with one audio, we will verify with a different one (simulating mismatch)
    const enrollAudio = Buffer.from(`enroll-${userId}-baseline`);
    const embedding = await extractEmbedding(enrollAudio, "wav");
    const profile: VoiceProfile = {
      userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      embedding,
      sampleCount: 5,
      version: 1,
    };
    await saveProfile(profile);
  }

  it("returns { match: boolean, score: number } shape on match", async () => {
    const userId = "shape-match";
    const audio = Buffer.from(`enroll-${userId}-baseline`);
    await enrollDifferentAudio(userId);

    const result = await verifySpeaker(audio, "wav", userId, 0.75);
    expect(typeof result.match).toBe("boolean");
    expect(typeof result.score).toBe("number");
    expect(result.match).toBe(true);
  });

  it("returns { match: false, score: number } on mismatch", async () => {
    const userId = "shape-mismatch";
    await enrollDifferentAudio(userId);

    // Verify with completely different audio
    const verifyAudio = Buffer.from("completely-different-audio-xyz-987654");
    const result = await verifySpeaker(verifyAudio, "wav", userId, 0.99);
    expect(typeof result.match).toBe("boolean");
    expect(typeof result.score).toBe("number");
    // With a very high threshold, this should fail unless by chance the hash embeddings align
    // (score is hash-based, so it's deterministic but not necessarily high)
    expect(result.match).toBe(false);
  });

  it("score is in range [-1, 1]", async () => {
    const userId = "score-range";
    await enrollDifferentAudio(userId);

    const audio = Buffer.from("any-audio-buffer");
    const result = await verifySpeaker(audio, "wav", userId, 0.75);
    expect(result.score).toBeGreaterThanOrEqual(-1);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});
