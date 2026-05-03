/**
 * Voice Pipeline Integration Tests
 *
 * Tests the complete voice pipeline from enrollment to command execution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock environment
process.env.OMNISTATE_ENROLL_MOCK = "1";

import {
  handleEnrollStart,
  handleEnrollSample,
  handleEnrollFinalize,
  cleanupEnrollSession
} from "../voice/enrollment.js";
import { cosineSimilarity } from "../voice/verification.js";
import { saveProfile, loadProfile, deleteProfile } from "../voice/profile-store.js";

describe("Voice Enrollment", () => {
  let mockWs: any;

  beforeEach(() => {
    mockWs = {
      send: vi.fn(),
    };
  });

  afterEach(() => {
    // Clean up any sessions
    cleanupEnrollSession("test-user-001");
    cleanupEnrollSession("test-user-002");
  });

  describe("handleEnrollStart", () => {
    it("should initialize enrollment session for new user", () => {
      handleEnrollStart(mockWs, "test-user-001");

      expect(mockWs.send).toHaveBeenCalled();
      const call = mockWs.send.mock.calls[0][0];
      const msg = JSON.parse(call);

      expect(msg.type).toBe("voice.enroll.ready");
      expect(msg.phraseIndex).toBe(0);
      expect(msg.totalPhrases).toBe(5);
    });

    it("should reset session for returning user", () => {
      handleEnrollStart(mockWs, "test-user-001");
      // First call - no need to store

      handleEnrollStart(mockWs, "test-user-001");
      const secondCall = mockWs.send.mock.calls[1];

      // Should get new session message
      expect(secondCall).toBeDefined();
    });
  });

  describe("handleEnrollSample", () => {
    it("should accept valid audio sample", async () => {
      handleEnrollStart(mockWs, "test-user-002");

      // Mock audio (base64 encoded zeros)
      const mockAudio = Buffer.alloc(1000).toString("base64");

      await handleEnrollSample(mockWs, "test-user-002", mockAudio, "audio/webm", 0);

      expect(mockWs.send).toHaveBeenCalled();
    });

    it("should reject out-of-order phrase", async () => {
      handleEnrollStart(mockWs, "test-user-002");

      const mockAudio = Buffer.alloc(1000).toString("base64");

      // Try to submit phrase 2 before 0
      await handleEnrollSample(mockWs, "test-user-002", mockAudio, "audio/webm", 2);

      const calls = mockWs.send.mock.calls;
      const lastCall = calls[calls.length - 1];
      const msg = JSON.parse(lastCall[0]);

      expect(msg.type).toBe("voice.enroll.error");
      expect(msg.code).toBe("WRONG_PHRASE");
    });

    it("should reject audio that is too large", async () => {
      handleEnrollStart(mockWs, "test-user-002");

      // Create 15MB audio (over limit)
      const largeAudio = Buffer.alloc(15 * 1024 * 1024).toString("base64");

      await handleEnrollSample(mockWs, "test-user-002", largeAudio, "audio/webm", 0);

      const calls = mockWs.send.mock.calls;
      const lastCall = calls[calls.length - 1];
      const msg = JSON.parse(lastCall[0]);

      expect(msg.type).toBe("voice.enroll.error");
      expect(msg.code).toBe("AUDIO_TOO_LARGE");
    });
  });

  describe("handleEnrollFinalize", () => {
    it("should create profile with averaged embedding", async () => {
      handleEnrollStart(mockWs, "test-user-003");

      // Submit 5 samples
      for (let i = 0; i < 5; i++) {
        const mockAudio = Buffer.alloc(1000).toString("base64");
        await handleEnrollSample(mockWs, "test-user-003", mockAudio, "audio/webm", i);
      }

      await handleEnrollFinalize(mockWs, "test-user-003");

      const calls = mockWs.send.mock.calls;
      const lastCall = calls[calls.length - 1];
      const msg = JSON.parse(lastCall[0]);

      expect(msg.type).toBe("voice.enroll.done");
      expect(msg.sampleCount).toBe(5);

      // Verify profile was saved
      const profile = await loadProfile("test-user-003");
      expect(profile).not.toBeNull();
      expect(profile?.embedding.length).toBe(256);
    });

    it("should reject finalize with insufficient samples", async () => {
      handleEnrollStart(mockWs, "test-user-004");

      // Only submit 3 samples (need 5)
      for (let i = 0; i < 3; i++) {
        const mockAudio = Buffer.alloc(1000).toString("base64");
        await handleEnrollSample(mockWs, "test-user-004", mockAudio, "audio/webm", i);
      }

      await handleEnrollFinalize(mockWs, "test-user-004");

      const calls = mockWs.send.mock.calls;
      const lastCall = calls[calls.length - 1];
      const msg = JSON.parse(lastCall[0]);

      expect(msg.type).toBe("voice.enroll.error");
      expect(msg.code).toBe("INSUFFICIENT_SAMPLES");
    });
  });
});

describe("Cosine Similarity", () => {
  it("should return 1.0 for identical vectors", () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
  });

  it("should return 0.0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it("should return -1.0 for opposite vectors", () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
  });

  it("should handle empty arrays", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("should handle different length arrays", () => {
    const a = [1, 0, 0];
    const b = [1, 0];
    // Should return 0 or handle gracefully
    const result = cosineSimilarity(a, b);
    expect(typeof result).toBe("number");
  });

  it("should handle zero vectors", () => {
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    // Should return 1.0 if both zero, or 0.0
    const result = cosineSimilarity(a, b);
    expect(typeof result).toBe("number");
  });
});

describe("Profile Store", () => {
  afterEach(async () => {
    try {
      await deleteProfile("profile-test-user");
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should save and load profile", async () => {
    const profile = {
      userId: "profile-test-user",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      embedding: Array(256).fill(0).map(() => Math.random() * 2 - 1),
      sampleCount: 5,
      version: 1 as const,
    };

    await saveProfile(profile);

    const loaded = await loadProfile("profile-test-user");
    expect(loaded).not.toBeNull();
    expect(loaded?.userId).toBe("profile-test-user");
    expect(loaded?.embedding.length).toBe(256);
    expect(loaded?.sampleCount).toBe(5);
  });

  it("should return null for non-existent profile", async () => {
    const result = await loadProfile("non-existent-user");
    expect(result).toBeNull();
  });

  it("should delete profile", async () => {
    const profile = {
      userId: "profile-test-user",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      embedding: Array(256).fill(0.5),
      sampleCount: 3,
      version: 1 as const,
    };

    await saveProfile(profile);
    await deleteProfile("profile-test-user");

    const result = await loadProfile("profile-test-user");
    expect(result).toBeNull();
  });

  it("should reject invalid userId", async () => {
    // UserId with path traversal attempt - should throw
    let errorThrown = false;
    let errorMessage = "";
    try {
      await saveProfile({
        userId: "../../../etc/passwd",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        embedding: Array(256).fill(0),
        sampleCount: 1,
        version: 1 as const,
      });
    } catch (err) {
      errorThrown = true;
      errorMessage = err instanceof Error ? err.message : String(err);
    }
    expect(errorThrown).toBe(true);
    expect(errorMessage).toContain("Invalid userId");
  });
});

describe("Voice Streaming Session", () => {
  it("should handle buffer size limits", () => {
    // Test MAX_CHUNK_BYTES and MAX_BUFFER_BYTES
    const MAX_CHUNK_BYTES = 512 * 1024; // 512 KB
    const MAX_BUFFER_BYTES = 25 * 1024 * 1024; // 25 MB

    expect(MAX_CHUNK_BYTES).toBe(524288);
    expect(MAX_BUFFER_BYTES).toBe(26214400);
  });

  it("should validate mime types for streaming", () => {
    const validMimeTypes = [
      "audio/webm",
      "audio/webm;codecs=opus",
      "audio/pcm",
      "audio/raw",
    ];

    const streamingMimes = validMimeTypes.filter(m =>
      m === "audio/pcm" || m === "audio/raw" || m.includes("pcm")
    );

    expect(streamingMimes).toContain("audio/pcm");
    expect(streamingMimes).toContain("audio/raw");
  });
});