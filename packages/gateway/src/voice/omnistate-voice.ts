import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { detectLanguage, sanitizeForTts } from "./edge-tts.js";

const execFileAsync = promisify(execFile);

const omniStateVoiceScriptPath = resolve(process.cwd(), "scripts/voice/omnistate_voice_tts.py");

function getManagedRuntimeRoot(): string {
  return resolve(homedir(), ".omnistate/runtime/omnistate-voice");
}

function getManagedVenvDir(): string {
  return join(getManagedRuntimeRoot(), ".venv");
}

function getManagedPythonExecPath(): string {
  return platform() === "win32"
    ? join(getManagedVenvDir(), "Scripts", "python.exe")
    : join(getManagedVenvDir(), "bin", "python3");
}

function resolveBootstrapPython(): string {
  return process.env.OMNISTATE_VOICE_BOOTSTRAP_PYTHON?.trim()
    ?? process.env.OMNISTATE_VOICE_PYTHON?.trim()
    ?? process.env.OMNISTATE_OMNIVOICE_PYTHON?.trim()
    ?? process.env.OMNISTATE_RTC_PYTHON?.trim()
    ?? "python3";
}

async function ensureManagedPythonExec(): Promise<string> {
  const configured = process.env.OMNISTATE_VOICE_PYTHON?.trim()
    ?? process.env.OMNISTATE_OMNIVOICE_PYTHON?.trim()
    ?? process.env.OMNISTATE_RTC_PYTHON?.trim();
  if (configured) {
    return configured;
  }

  const managedPython = getManagedPythonExecPath();
  if (existsSync(managedPython)) {
    return managedPython;
  }

  const runtimeRoot = getManagedRuntimeRoot();
  const venvDir = getManagedVenvDir();
  const bootstrapPython = resolveBootstrapPython();
  await mkdir(runtimeRoot, { recursive: true });

  await execFileAsync(bootstrapPython, ["-m", "venv", venvDir], {
    timeout: 180_000,
    maxBuffer: 1024 * 1024 * 8,
  });
  await execFileAsync(managedPython, ["-m", "pip", "install", "--upgrade", "pip"], {
    timeout: 180_000,
    maxBuffer: 1024 * 1024 * 8,
  });
  await execFileAsync(
    managedPython,
    ["-m", "pip", "install", "torch", "torchaudio", "soundfile", "omnivoice"],
    {
      timeout: 900_000,
      maxBuffer: 1024 * 1024 * 8,
    },
  );

  return managedPython;
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

export function normalizeOmniStateVoiceRate(rate?: number): number {
  const normalized = Number.isFinite(rate) ? Number(rate) : 1;
  return Math.max(0.7, Math.min(1.3, Number(normalized.toFixed(2))));
}

export async function synthesizeOmniStateVoiceSpeech(input: {
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

  const pythonExec = await ensureManagedPythonExec();
  const outPath = join(tmpdir(), `omnistate-voice-${crypto.randomUUID()}.wav`);
  const speakerPath = await resolveLatestSpeakerWav(input.profileId);
  const args = [
    omniStateVoiceScriptPath,
    "--text",
    cleanText,
    "--output",
    outPath,
    "--model",
    process.env.OMNISTATE_VOICE_MODEL?.trim()
      ?? process.env.OMNISTATE_OMNIVOICE_MODEL?.trim()
      ?? "k2-fsa/OmniVoice",
    "--language",
    input.language || detectLanguage(cleanText),
    "--speed",
    String(normalizeOmniStateVoiceRate(input.rate)),
  ];

  if (speakerPath) {
    args.push("--ref-audio", speakerPath);
  }

  const instruct = process.env.OMNISTATE_VOICE_INSTRUCT?.trim()
    ?? process.env.OMNISTATE_OMNIVOICE_INSTRUCT?.trim();
  if (instruct) {
    args.push("--instruct", instruct);
  }

  const device = process.env.OMNISTATE_VOICE_DEVICE?.trim()
    ?? process.env.OMNISTATE_OMNIVOICE_DEVICE?.trim();
  if (device) {
    args.push("--device", device);
  }

  try {
    await execFileAsync(pythonExec, args, {
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
