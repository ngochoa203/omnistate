import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { detectLanguage, sanitizeForTts } from "./edge-tts.js";

const execFileAsync = promisify(execFile);

const omniStateVoiceScriptPath = resolve(process.cwd(), "scripts/voice/omnistate_voice_tts.py");

export type OmniStateVoiceRuntimeInstallState =
  | "not_installed"
  | "installing"
  | "ready"
  | "failed";

export interface OmniStateVoiceRuntimeStatus {
  provider: "omnistate-voice";
  state: OmniStateVoiceRuntimeInstallState;
  message: string;
  managed: boolean;
  progress: number;
  runtimeRoot: string;
  pythonPath?: string;
  activeStep?: string;
  lastError?: string;
}

let runtimeStatus: OmniStateVoiceRuntimeStatus = {
  provider: "omnistate-voice",
  state: "not_installed",
  message: "OmniState Voice runtime is not installed yet.",
  managed: true,
  progress: 0,
  runtimeRoot: "",
};
let activeInstallPromise: Promise<OmniStateVoiceRuntimeStatus> | null = null;

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

function currentConfiguredPython(): string | null {
  const configured = process.env.OMNISTATE_VOICE_PYTHON?.trim()
    ?? process.env.OMNISTATE_OMNIVOICE_PYTHON?.trim()
    ?? process.env.OMNISTATE_RTC_PYTHON?.trim();
  return configured || null;
}

function buildRuntimeStatus(
  overrides: Partial<OmniStateVoiceRuntimeStatus> = {},
): OmniStateVoiceRuntimeStatus {
  return {
    provider: "omnistate-voice",
    state: "not_installed",
    message: "OmniState Voice runtime is not installed yet.",
    managed: !currentConfiguredPython(),
    progress: 0,
    runtimeRoot: getManagedRuntimeRoot(),
    ...overrides,
  };
}

function updateRuntimeStatus(
  overrides: Partial<OmniStateVoiceRuntimeStatus>,
  onStatus?: (status: OmniStateVoiceRuntimeStatus) => void,
): OmniStateVoiceRuntimeStatus {
  runtimeStatus = buildRuntimeStatus({
    ...runtimeStatus,
    ...overrides,
  });
  onStatus?.(runtimeStatus);
  return runtimeStatus;
}

export async function getOmniStateVoiceRuntimeStatus(): Promise<OmniStateVoiceRuntimeStatus> {
  const configured = process.env.OMNISTATE_VOICE_PYTHON?.trim()
    ?? process.env.OMNISTATE_OMNIVOICE_PYTHON?.trim()
    ?? process.env.OMNISTATE_RTC_PYTHON?.trim();
  if (configured) {
    if (existsSync(configured)) {
      return updateRuntimeStatus({
        state: "ready",
        message: "Using configured OmniState Voice Python runtime.",
        managed: false,
        progress: 100,
        pythonPath: configured,
        activeStep: "configured_python",
        lastError: undefined,
      });
    }
    return updateRuntimeStatus({
      state: "failed",
      message: "Configured OmniState Voice Python runtime was not found.",
      managed: false,
      progress: 0,
      pythonPath: configured,
      activeStep: "configured_python_missing",
      lastError: `Missing configured Python runtime: ${configured}`,
    });
  }

  const managedPython = getManagedPythonExecPath();
  if (existsSync(managedPython)) {
    return updateRuntimeStatus({
      state: "ready",
      message: "OmniState Voice runtime is ready.",
      managed: true,
      progress: 100,
      pythonPath: managedPython,
      activeStep: "ready",
      lastError: undefined,
    });
  }

  if (activeInstallPromise) {
    return runtimeStatus;
  }

  return updateRuntimeStatus({
    state: "not_installed",
    message: "OmniState Voice runtime is not installed yet.",
    managed: true,
    progress: 0,
    pythonPath: managedPython,
    activeStep: "idle",
    lastError: undefined,
  });
}

async function installManagedPythonExec(
  onStatus?: (status: OmniStateVoiceRuntimeStatus) => void,
): Promise<string> {
  const existing = await getOmniStateVoiceRuntimeStatus();
  if (existing.state === "ready" && existing.pythonPath) {
    return existing.pythonPath;
  }

  const configured = currentConfiguredPython();
  if (configured) {
    throw new Error(`Configured OmniState Voice Python runtime was not found: ${configured}`);
  }

  const runtimeRoot = getManagedRuntimeRoot();
  const venvDir = getManagedVenvDir();
  const managedPython = getManagedPythonExecPath();
  const bootstrapPython = resolveBootstrapPython();
  await mkdir(runtimeRoot, { recursive: true });

  updateRuntimeStatus({
    state: "installing",
    message: "Creating OmniState Voice runtime environment…",
    managed: true,
    progress: 10,
    pythonPath: managedPython,
    activeStep: "create_venv",
    lastError: undefined,
  }, onStatus);
  await execFileAsync(bootstrapPython, ["-m", "venv", venvDir], {
    timeout: 180_000,
    maxBuffer: 1024 * 1024 * 8,
  });
  updateRuntimeStatus({
    state: "installing",
    message: "Upgrading pip for OmniState Voice runtime…",
    managed: true,
    progress: 35,
    pythonPath: managedPython,
    activeStep: "upgrade_pip",
  }, onStatus);
  await execFileAsync(managedPython, ["-m", "pip", "install", "--upgrade", "pip"], {
    timeout: 180_000,
    maxBuffer: 1024 * 1024 * 8,
  });
  updateRuntimeStatus({
    state: "installing",
    message: "Installing OmniState Voice runtime dependencies…",
    managed: true,
    progress: 60,
    pythonPath: managedPython,
    activeStep: "install_dependencies",
  }, onStatus);
  await execFileAsync(
    managedPython,
    ["-m", "pip", "install", "torch", "torchaudio", "soundfile", "omnivoice"],
    {
      timeout: 900_000,
      maxBuffer: 1024 * 1024 * 8,
    },
  );

  updateRuntimeStatus({
    state: "ready",
    message: "OmniState Voice runtime is ready.",
    managed: true,
    progress: 100,
    pythonPath: managedPython,
    activeStep: "ready",
    lastError: undefined,
  }, onStatus);

  return managedPython;
}

export async function installOmniStateVoiceRuntime(options?: {
  force?: boolean;
  onStatus?: (status: OmniStateVoiceRuntimeStatus) => void;
}): Promise<OmniStateVoiceRuntimeStatus> {
  const onStatus = options?.onStatus;
  const current = await getOmniStateVoiceRuntimeStatus();
  if (!options?.force && current.state === "ready") {
    onStatus?.(current);
    return current;
  }

  if (!options?.force && activeInstallPromise) {
    onStatus?.(runtimeStatus);
    return activeInstallPromise;
  }

  activeInstallPromise = (async () => {
    try {
      const pythonPath = await installManagedPythonExec(onStatus);
      return updateRuntimeStatus({
        state: "ready",
        message: "OmniState Voice runtime is ready.",
        managed: !currentConfiguredPython(),
        progress: 100,
        pythonPath,
        activeStep: "ready",
        lastError: undefined,
      }, onStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return updateRuntimeStatus({
        state: "failed",
        message: "OmniState Voice runtime installation failed.",
        managed: !currentConfiguredPython(),
        progress: 0,
        activeStep: "failed",
        lastError: message,
      }, onStatus);
    } finally {
      activeInstallPromise = null;
    }
  })();

  return activeInstallPromise;
}

async function ensureManagedPythonExec(): Promise<string> {
  const configured = currentConfiguredPython();
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`Configured OmniState Voice Python runtime was not found: ${configured}`);
    }
    await getOmniStateVoiceRuntimeStatus();
    return configured;
  }

  const status = await installOmniStateVoiceRuntime();
  if (status.state !== "ready" || !status.pythonPath) {
    throw new Error(status.lastError ?? "OmniState Voice runtime is not ready");
  }
  return status.pythonPath;
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
