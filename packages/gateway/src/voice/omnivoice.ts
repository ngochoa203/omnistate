import { readFile, readdir, stat, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { detectLanguage, sanitizeForTts } from "./edge-tts.js";

const execFileAsync = promisify(execFile);

const omnivoiceTtsScriptPath = resolve(process.cwd(), "scripts/voice/omnivoice_tts.py");

function getPythonExec(): string {
  return process.env.OMNISTATE_OMNIVOICE_PYTHON?.trim()
    ?? process.env.OMNISTATE_RTC_PYTHON?.trim()
    ?? "python3";
}

function getProfileRootDir(): string {
  const customRoot = process.env.OMNISTATE_RTC_PROFILE_DIR?.trim();
  if (customRoot) return resolve(customRoot);
  return resolve(join(tmpdir(), "omnistate-rtvc-profiles"));
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

export function normalizeOmniVoiceRate(rate?: number): number {
  const normalized = Number.isFinite(rate) ? Number(rate) : 1;
  return Math.max(0.7, Math.min(1.3, Number(normalized.toFixed(2))));
}

export async function synthesizeOmniVoiceSpeech(input: {
  text: string;
  profileId?: string;
  language?: string;
  rate?: number;
}): Promise<{
  audio: Buffer;
  contentType: string;
  speakerPath?: string;
}> {
  const cleanText = sanitizeForTts(input.text);
  if (!cleanText) {
    return { audio: Buffer.alloc(0), contentType: "audio/wav" };
  }

  const outPath = join(tmpdir(), `omnistate-omnivoice-${crypto.randomUUID()}.wav`);
  const speakerPath = await resolveLatestSpeakerWav(input.profileId);
  const args = [
    omnivoiceTtsScriptPath,
    "--text",
    cleanText,
    "--output",
    outPath,
    "--model",
    process.env.OMNISTATE_OMNIVOICE_MODEL?.trim() || "k2-fsa/OmniVoice",
    "--language",
    input.language || detectLanguage(cleanText),
    "--speed",
    String(normalizeOmniVoiceRate(input.rate)),
  ];

  if (speakerPath) {
    args.push("--ref-audio", speakerPath);
  }

  const instruct = process.env.OMNISTATE_OMNIVOICE_INSTRUCT?.trim();
  if (instruct) {
    args.push("--instruct", instruct);
  }

  const device = process.env.OMNISTATE_OMNIVOICE_DEVICE?.trim();
  if (device) {
    args.push("--device", device);
  }

  try {
    await execFileAsync(getPythonExec(), args, {
      timeout: 240_000,
      maxBuffer: 1024 * 1024 * 8,
    });
    const audio = await readFile(outPath);
    return {
      audio,
      contentType: "audio/wav",
      ...(speakerPath ? { speakerPath } : {}),
    };
  } finally {
    await unlink(outPath).catch(() => undefined);
  }
}
