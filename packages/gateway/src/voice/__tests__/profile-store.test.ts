import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveProfile, loadProfile, deleteProfile } from "../profile-store.js";
import type { VoiceProfile } from "../profile-store.js";

function makeProfile(userId: string, overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    userId,
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
    embedding: Array.from({ length: 256 }, (_, i) => i / 256),
    sampleCount: 5,
    version: 1,
    ...overrides,
  };
}

describe("profile-store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "omnistate-ps-test-"));
    process.env.OMNISTATE_RTC_PROFILE_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.OMNISTATE_RTC_PROFILE_DIR;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("save/load roundtrip preserves all fields", async () => {
    const profile = makeProfile("user-abc");
    await saveProfile(profile);
    const loaded = await loadProfile("user-abc");

    expect(loaded).not.toBeNull();
    expect(loaded!.userId).toBe("user-abc");
    expect(loaded!.sampleCount).toBe(5);
    expect(loaded!.version).toBe(1);
    expect(loaded!.embedding).toHaveLength(256);
    expect(loaded!.embedding[0]).toBeCloseTo(0);
    expect(loaded!.createdAt).toBe("2026-04-23T00:00:00.000Z");
  });

  it("loadProfile returns null for missing file", async () => {
    const result = await loadProfile("nonexistent-user");
    expect(result).toBeNull();
  });

  it("saveProfile overwrites an existing profile", async () => {
    const first = makeProfile("user-overwrite", { sampleCount: 3 });
    await saveProfile(first);

    const second = makeProfile("user-overwrite", { sampleCount: 5, updatedAt: "2026-04-24T00:00:00.000Z" });
    await saveProfile(second);

    const loaded = await loadProfile("user-overwrite");
    expect(loaded!.sampleCount).toBe(5);
    expect(loaded!.updatedAt).toBe("2026-04-24T00:00:00.000Z");
  });

  it("deleteProfile removes file; subsequent load returns null", async () => {
    const profile = makeProfile("user-delete");
    await saveProfile(profile);
    expect(await loadProfile("user-delete")).not.toBeNull();

    await deleteProfile("user-delete");
    expect(await loadProfile("user-delete")).toBeNull();
  });

  it("deleteProfile on non-existent user does not throw", async () => {
    await expect(deleteProfile("ghost-user")).resolves.not.toThrow();
  });

  it("loadProfile returns null when file contains invalid JSON", async () => {
    // Pre-seed a corrupt file so loadProfile hits the catch branch
    const enrollDir = join(tmpDir, "enrollment");
    mkdirSync(enrollDir, { recursive: true });
    writeFileSync(join(enrollDir, "bad-user.json"), "{{not json}}");

    const result = await loadProfile("bad-user");
    expect(result).toBeNull();
  });

  it("saveProfile rejects (throws) when dir cannot be created — FS error path", async () => {
    // Point profile dir to a file (not a dir) so mkdir fails
    const blockingFile = join(tmpDir, "blocker");
    writeFileSync(blockingFile, "not a dir");
    process.env.OMNISTATE_RTC_PROFILE_DIR = blockingFile;

    const profile = makeProfile("user-fserr");
    await expect(saveProfile(profile)).rejects.toThrow();
  });
});
