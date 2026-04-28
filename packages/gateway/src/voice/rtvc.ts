import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const rtvcTtsScriptPath = resolve(process.cwd(), "scripts/voice/rtvc_tts.py");
const rtvcTrainScriptPath = resolve(process.cwd(), "scripts/voice/rtvc_train.py");
const bundledRtvcRepoDir = fileURLToPath(new URL("../../vendor/Real-Time-Voice-Cloning", import.meta.url));

function getRepoDir(): string {
  const configured = process.env.OMNISTATE_RTC_REPO_DIR?.trim();
  const repoDir = configured || bundledRtvcRepoDir;
  const resolved = resolve(repoDir);

  if (!existsSync(resolved)) {
    throw new Error(
      configured
        ? `OMNISTATE_RTC_REPO_DIR does not exist: ${resolved}`
        : `Bundled RTVC repo not found at ${resolved}. Vendor Real-Time-Voice-Cloning into packages/gateway/vendor or set OMNISTATE_RTC_REPO_DIR.`,
    );
  }

  return resolved;
}

function getPythonExec(): string {
  return process.env.OMNISTATE_RTC_PYTHON?.trim() || "python3";
}

function getProfileRootDir(): string {
  const customRoot = process.env.OMNISTATE_RTC_PROFILE_DIR?.trim();
  if (customRoot) return resolve(customRoot);
  return resolve(join(tmpdir(), "omnistate-rtvc-profiles"));
}

function decodeBase64Audio(raw: string): Buffer {
  const cleaned = raw.replace(/^data:audio\/[a-zA-Z0-9+.-]+;base64,/, "");
  return Buffer.from(cleaned, "base64");
}

function normalizeFormat(raw?: string): "wav" | "webm" | "ogg" | "mp3" {
  const lower = String(raw || "wav").toLowerCase();
  if (lower.includes("webm")) return "webm";
  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("mp3") || lower.includes("mpeg") || lower.includes("m4a") || lower.includes("mp4")) return "mp3";
  return "wav";
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function resolveLatestSpeakerWav(profileId?: string): Promise<string | null> {
  if (!profileId) {
    const fallback = process.env.OMNISTATE_VOICE_CLONE_SPEAKER_WAV?.trim();
    return fallback ? resolve(fallback) : null;
  }

  const profileDir = join(getProfileRootDir(), profileId);
  try {
    const files = await readdir(profileDir);
    const wavs = files.filter((name) => name.toLowerCase().endsWith(".wav"));
    if (wavs.length === 0) return null;

    const details = await Promise.all(
      wavs.map(async (name) => {
        const path = join(profileDir, name);
        const fileStat = await stat(path);
        return { path, mtimeMs: fileStat.mtimeMs };
      }),
    );

    details.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return details[0]?.path ?? null;
  } catch {
    return null;
  }
}

export async function trainRtvcProfile(input: {
  profileId: string;
  audioBase64: string;
  format?: string;
  sampleIndex?: number;
}): Promise<{
  ok: boolean;
  profileId: string;
  samplePath: string;
  embeddingPath?: string;
  warning?: string;
}> {
  const repoDir = getRepoDir();
  const profileRoot = getProfileRootDir();
  const profileDir = join(profileRoot, input.profileId);
  await ensureDir(profileDir);

  const sampleFormat = normalizeFormat(input.format);
  const sampleName = `sample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${sampleFormat}`;
  const samplePath = join(profileDir, sampleName);
  const sampleBuffer = decodeBase64Audio(input.audioBase64);
  await writeFile(samplePath, sampleBuffer);

  const embeddingPath = join(profileDir, "speaker-embedding.npy");
  try {
    await execFileAsync(
      getPythonExec(),
      [
        rtvcTrainScriptPath,
        "--repo",
        repoDir,
        "--sample",
        samplePath,
        "--output",
        embeddingPath,
      ],
      { timeout: 120_000, maxBuffer: 1024 * 1024 * 4 },
    );
    return { ok: true, profileId: input.profileId, samplePath, embeddingPath };
  } catch (err) {
    const warning = err instanceof Error ? err.message : String(err);
    return { ok: false, profileId: input.profileId, samplePath, warning };
  }
}

export async function synthesizeRtvcSpeech(input: {
  text: string;
  profileId?: string;
  language?: string;
}): Promise<{
  audio: Buffer;
  contentType: string;
  speakerPath: string;
}> {
  const repoDir = getRepoDir();
  const speakerPath = await resolveLatestSpeakerWav(input.profileId);
  if (!speakerPath) {
    throw new Error("No speaker sample available. Train a profile first via /api/voice/clone/train or set OMNISTATE_VOICE_CLONE_SPEAKER_WAV");
  }

  // Use pre-saved embedding (.npy) when available — faster and consistent voice identity.
  const embeddingPath = input.profileId
    ? join(getProfileRootDir(), input.profileId, "speaker-embedding.npy")
    : null;

  const outPath = join(tmpdir(), `omnistate-rtvc-${crypto.randomUUID()}.wav`);
  const ttsArgs = [
    rtvcTtsScriptPath,
    "--repo", repoDir,
    "--speaker", speakerPath,
    "--text", input.text,
    "--output", outPath,
    "--language", input.language || "vi",
  ];
  if (embeddingPath && existsSync(embeddingPath)) {
    ttsArgs.push("--embedding", embeddingPath);
  }
  await execFileAsync(getPythonExec(), ttsArgs, { timeout: 180_000, maxBuffer: 1024 * 1024 * 8 });

  const audio = await import("node:fs/promises").then((m) => m.readFile(outPath));
  return {
    audio,
    contentType: "audio/wav",
    speakerPath,
  };
}
