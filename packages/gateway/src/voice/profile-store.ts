import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

export interface VoiceProfile {
  userId: string;
  createdAt: string;
  updatedAt: string;
  embedding: number[];
  sampleCount: number;
  version: 1;
}

function getEnrollmentDir(): string {
  const customRoot = process.env.OMNISTATE_RTC_PROFILE_DIR?.trim();
  const root = customRoot ? resolve(customRoot) : resolve(join(tmpdir(), "omnistate-voice-profiles"));
  return join(root, "enrollment");
}

const VALID_USER_ID = /^[a-zA-Z0-9_-]{1,64}$/;

function assertValidUserId(userId: string): void {
  if (!VALID_USER_ID.test(userId)) throw new Error("Invalid userId");
  if (userId.includes('\0')) throw new Error("Invalid userId: null byte");
}

function profilePath(userId: string): string {
  assertValidUserId(userId);
  return join(getEnrollmentDir(), `${userId}.json`);
}

function validateProfileShape(data: unknown): VoiceProfile {
  const d = data as Record<string, unknown>;
  if (
    typeof d.userId !== "string" ||
    !Array.isArray(d.embedding) ||
    (d.embedding as unknown[]).length < 256 ||
    (d.embedding as unknown[]).length > 260 ||
    !(d.embedding as unknown[]).every((v) => typeof v === "number" && isFinite(v)) ||
    typeof d.sampleCount !== "number"
  ) {
    throw new Error("Invalid profile shape");
  }
  // Bug fix: Add version migration support
  if (d.version === 1) {
    return data as VoiceProfile;
  }
  if (typeof d.version === 'number' && d.version < 1) {
    throw new Error(`Profile version ${d.version} not supported - re-enroll required`);
  }
  throw new Error("Invalid profile version");
}

export async function saveProfile(profile: VoiceProfile): Promise<void> {
  assertValidUserId(profile.userId);
  const dir = getEnrollmentDir();
  await mkdir(dir, { recursive: true });
  await writeFile(profilePath(profile.userId), JSON.stringify(profile, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export async function loadProfile(userId: string): Promise<VoiceProfile | null> {
  assertValidUserId(userId);
  const p = profilePath(userId);
  if (!existsSync(p)) return null;
  try {
    const raw = await readFile(p, "utf-8");
    return validateProfileShape(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function deleteProfile(userId: string): Promise<void> {
  assertValidUserId(userId);
  const p = profilePath(userId);
  if (existsSync(p)) await unlink(p);
}
