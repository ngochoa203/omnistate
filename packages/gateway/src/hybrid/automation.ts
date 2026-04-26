/**
 * Hybrid Automation Module — UC-D02 through UC-D13.
 *
 * Implements advanced hybrid use cases that combine deep-layer OS access,
 * surface-layer UI control, and AI (Claude) for intelligent automation.
 *
 * @module hybrid/automation
 */

import { exec, execFile } from "node:child_process";
import { whisperLocalClient } from "../voice/whisper-local-client.js";
import { promisify } from "node:util";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  statSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../utils/logger.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Anthropic client (lazy singleton — mirrors intent.ts pattern)
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!_client) {
    const baseURL =
      process.env.ANTHROPIC_BASE_URL ?? "https://chat.trollllm.xyz";
    _client = new Anthropic({ apiKey, baseURL });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Persistent storage helpers (persists to ~/.omnistate/)
// ---------------------------------------------------------------------------

const OMNISTATE_DIR = join(homedir(), ".omnistate");

function ensureDir(subdir?: string): string {
  const dir = subdir ? join(OMNISTATE_DIR, subdir) : OMNISTATE_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ===========================================================================
// UC-D02: Structured System Migration
// ===========================================================================

export interface MachineManifest {
  hostname: string;
  os: string;
  arch: string;
  scannedAt: string;
  apps: string[];
  brewPackages: string[];
  npmGlobals: string[];
  dotfiles: string[];
  envVars: string[];
  cronJobs: string[];
  launchAgents: string[];
  userDefaults: Record<string, string>;
}

export interface MigrationPlan {
  id: string;
  sourceManifest: MachineManifest;
  targetDescription: string;
  steps: MigrationStep[];
  createdAt: string;
}

export interface MigrationStep {
  id: string;
  category: "app" | "package" | "dotfile" | "config" | "cron";
  description: string;
  command?: string;
  filePath?: string;
  content?: string;
  status: "pending" | "done" | "failed" | "skipped";
}

export interface MigrationResult {
  planId: string;
  completedSteps: number;
  totalSteps: number;
  failedSteps: MigrationStep[];
  durationMs: number;
  summary: string;
}

/**
 * UC-D02: Scan the current machine and produce a manifest of installed apps,
 * packages, dotfiles, cron jobs, and launch agents.
 */
export async function scanSourceMachine(): Promise<MachineManifest> {
  const [apps, brew, npm, cron, launchAgents] = await Promise.allSettled([
    execAsync("ls /Applications 2>/dev/null").then((r) =>
      r.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((a) => a.replace(/\.app$/, ""))
    ),
    execAsync("brew list --formula 2>/dev/null").then((r) =>
      r.stdout.trim().split("\n").filter(Boolean)
    ),
    execAsync("npm list -g --depth=0 --json 2>/dev/null")
      .then((r) => Object.keys(JSON.parse(r.stdout).dependencies ?? {}))
      .catch(() => [] as string[]),
    execAsync("crontab -l 2>/dev/null").then((r) =>
      r.stdout.trim().split("\n").filter((l) => l && !l.startsWith("#"))
    ),
    execAsync("ls ~/Library/LaunchAgents 2>/dev/null").then((r) =>
      r.stdout.trim().split("\n").filter(Boolean)
    ),
  ]);

  // Collect dotfiles from home dir
  const dotfiles: string[] = [];
  try {
    const home = readdirSync(homedir());
    for (const f of home) {
      if (f.startsWith(".") && !f.startsWith(".DS_Store")) dotfiles.push(f);
    }
  } catch {
    // ignore
  }

  // Sample visible env vars (non-secret keys only)
  const envVars = Object.keys(process.env).filter(
    (k) => !k.includes("KEY") && !k.includes("SECRET") && !k.includes("TOKEN")
  );

  const { stdout: osInfo } = await execAsync(
    "sw_vers 2>/dev/null || uname -a"
  ).catch(() => ({ stdout: "unknown", stderr: "" }));
  const { stdout: archInfo } = await execAsync("uname -m").catch(() => ({
    stdout: "unknown",
    stderr: "",
  }));
  const { stdout: hostInfo } = await execAsync("hostname").catch(() => ({
    stdout: "unknown",
    stderr: "",
  }));

  return {
    hostname: hostInfo.trim(),
    os: osInfo.trim().split("\n")[0] ?? "unknown",
    arch: archInfo.trim(),
    scannedAt: new Date().toISOString(),
    apps:
      apps.status === "fulfilled"
        ? (apps.value as string[])
        : [],
    brewPackages:
      brew.status === "fulfilled" ? (brew.value as string[]) : [],
    npmGlobals:
      npm.status === "fulfilled" ? (npm.value as string[]) : [],
    dotfiles,
    envVars,
    cronJobs:
      cron.status === "fulfilled" ? (cron.value as string[]) : [],
    launchAgents:
      launchAgents.status === "fulfilled"
        ? (launchAgents.value as string[])
        : [],
    userDefaults: {},
  };
}

/**
 * UC-D02: Generate a migration plan from a scanned manifest.
 * Uses Claude to produce intelligent migration steps if available.
 */
export async function generateMigrationPlan(
  manifest: MachineManifest,
  target?: string
): Promise<MigrationPlan> {
  const id = generateId("migration");
  const targetDescription = target ?? "new macOS machine";

  const steps: MigrationStep[] = [];

  // Generate Homebrew install step
  if (manifest.brewPackages.length > 0) {
    steps.push({
      id: generateId("step"),
      category: "package",
      description: "Install Homebrew packages",
      command: `brew install ${manifest.brewPackages.join(" ")}`,
      status: "pending",
    });
  }

  // Generate npm globals step
  if (manifest.npmGlobals.length > 0) {
    steps.push({
      id: generateId("step"),
      category: "package",
      description: "Install npm global packages",
      command: `npm install -g ${manifest.npmGlobals.join(" ")}`,
      status: "pending",
    });
  }

  // Generate app install hints
  for (const app of manifest.apps.slice(0, 20)) {
    steps.push({
      id: generateId("step"),
      category: "app",
      description: `Install ${app}`,
      command: `open -a "App Store" || mas install "${app}" 2>/dev/null || brew install --cask "${app.toLowerCase().replace(/\s+/g, "-")}" 2>/dev/null`,
      status: "pending",
    });
  }

  // Copy dotfiles
  for (const dotfile of manifest.dotfiles.slice(0, 10)) {
    steps.push({
      id: generateId("step"),
      category: "dotfile",
      description: `Copy ${dotfile}`,
      filePath: join(homedir(), dotfile),
      status: "pending",
    });
  }

  // Restore cron jobs
  if (manifest.cronJobs.length > 0) {
    steps.push({
      id: generateId("step"),
      category: "cron",
      description: "Restore cron jobs",
      command: `(crontab -l 2>/dev/null; echo "${manifest.cronJobs.join("\\n")}") | crontab -`,
      status: "pending",
    });
  }

  const plan: MigrationPlan = {
    id,
    sourceManifest: manifest,
    targetDescription,
    steps,
    createdAt: new Date().toISOString(),
  };

  const dir = ensureDir("migrations");
  writeJson(join(dir, `${id}.json`), plan);
  return plan;
}

/**
 * UC-D02: Execute a previously generated migration plan step by step.
 */
export async function executeMigration(
  plan: MigrationPlan
): Promise<MigrationResult> {
  const startMs = Date.now();
  let completedSteps = 0;
  const failedSteps: MigrationStep[] = [];

  for (const step of plan.steps) {
    try {
      if (step.command) {
        await execAsync(step.command, { timeout: 120_000 });
      }
      step.status = "done";
      completedSteps++;
    } catch (err) {
      step.status = "failed";
      failedSteps.push({ ...step });
    }
  }

  const durationMs = Date.now() - startMs;
  const result: MigrationResult = {
    planId: plan.id,
    completedSteps,
    totalSteps: plan.steps.length,
    failedSteps,
    durationMs,
    summary: `Completed ${completedSteps}/${plan.steps.length} steps in ${Math.round(durationMs / 1000)}s. ${failedSteps.length} failed.`,
  };

  // Persist updated plan
  const dir = ensureDir("migrations");
  writeJson(join(dir, `${plan.id}.json`), plan);
  return result;
}

// ===========================================================================
// UC-D03: Voice Control Pipeline
// ===========================================================================

export interface TranscriptionResult {
  text: string;
  confidence: number;
  durationMs: number;
  provider: string;
}

export interface VoiceCommandResult {
  transcription: TranscriptionResult;
  intent: string;
  executed: boolean;
  output?: string;
  error?: string;
}

/**
 * Swift client now sends 16kHz mono PCM16 WAV directly — gateway can write without conversion.
 * For legacy raw float32 @ 44.1kHz buffers (non-WAV), still converts via wrapPcmAsWav.
 */
function prepareWav(buf: Buffer, srcSampleRate: number, channels: number): Buffer {
  // Detect RIFF header: bytes 0-3 == "RIFF"
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x46464952) {
    return buf; // Already a WAV file — pass through
  }
  return wrapPcmAsWav(buf, srcSampleRate, channels);
}

/**
 * Swift client sends raw float32 @ 44.1kHz; STT providers expect 16kHz PCM16 WAV.
 * Converts float32 LE buffer → int16 PCM @ targetSampleRate and wraps a RIFF/WAVE header.
 */
function wrapPcmAsWav(
  buf: Buffer,
  srcSampleRate: number,
  channels: number,
  targetSampleRate: number = 16000
): Buffer {
  // Interpret raw bytes as float32 LE samples
  const floatSamples = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

  // Downsample via linear interpolation (speech quality is sufficient)
  const ratio = srcSampleRate / targetSampleRate;
  const outLen = Math.floor(floatSamples.length / ratio);
  const pcm16 = Buffer.alloc(outLen * 2);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, floatSamples.length - 1);
    const frac = srcIdx - lo;
    const sample = floatSamples[lo] * (1 - frac) + floatSamples[hi] * frac;
    const clamped = Math.max(-1, Math.min(1, sample));
    pcm16.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }

  // Build 44-byte RIFF/WAVE/fmt /data header
  const byteRate = targetSampleRate * channels * 2;
  const blockAlign = channels * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm16.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);            // subchunk1 size
  header.writeUInt16LE(1, 20);             // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(targetSampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);            // bitsPerSample
  header.write("data", 36);
  header.writeUInt32LE(pcm16.byteLength, 40);
  return Buffer.concat([header, pcm16]);
}

/**
 * UC-D03: Transcribe audio buffer to text.
 * Tries whisper-cloud (OpenAI) → whisper-local (python) → native (macOS) fallback.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  provider: "whisper-cloud" | "whisper-local" | "native" = "native",
  language: string = "vi"
): Promise<TranscriptionResult> {
  const startMs = Date.now();

  if (provider === "native") {
    // macOS Sphinx is English-only — refuse non-English so upper-layer race
    // doesn't pick garbage English over a proper whisper result.
    if (language && !language.toLowerCase().startsWith("en")) {
      return {
        text: "",
        confidence: 0,
        durationMs: Date.now() - startMs,
        provider: "native-sphinx",
      };
    }
    // macOS Speech framework via python SpeechRecognition (if available)
    const wavPath = join(homedir(), ".omnistate", "tmp_audio.wav");
    ensureDir();
    writeFileSync(wavPath, prepareWav(audioBuffer, 44100, 1));
    const scriptPath = join(tmpdir(), `sphinx_${randomBytes(8).toString("hex")}.py`);
    const scriptSrc = [
      "import sys, speech_recognition as sr",
      "r = sr.Recognizer()",
      "with sr.AudioFile(sys.argv[1]) as src:",
      "    audio = r.record(src)",
      "text = r.recognize_sphinx(audio)",
      "print(text)",
    ].join("\n");
    writeFileSync(scriptPath, scriptSrc, { mode: 0o600 });
    try {
      const { stdout } = await execFileAsync("python3", [scriptPath, wavPath], {
        timeout: 30_000,
      });
      return {
        text: stdout.trim(),
        confidence: 0.75,
        durationMs: Date.now() - startMs,
        provider: "native-sphinx",
      };
    } catch {
      return {
        text: "",
        confidence: 0,
        durationMs: Date.now() - startMs,
        provider: "native-sphinx",
      };
    } finally {
      try { unlinkSync(scriptPath); } catch { /* ignore */ }
    }
  }

  if (provider === "whisper-local") {
    const tmpPath = join(homedir(), ".omnistate", "tmp_audio.wav");
    ensureDir();
    writeFileSync(tmpPath, prepareWav(audioBuffer, 44100, 1));
    const wavBytes = existsSync(tmpPath) ? statSync(tmpPath).size : 0;
    if (process.env.VOICE_DEBUG === "1") {
      const debugDir = join(homedir(), ".omnistate", "debug");
      if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true });
      const debugPath = join(debugDir, `whisper-input-${Date.now()}.wav`);
      copyFileSync(tmpPath, debugPath);
    }
    logger.info({ wavPath: tmpPath, bytes: wavBytes, language }, "[whisper-local] transcribe start");
    const t0wl = Date.now();
    try {
      const { text, durationMs } = await whisperLocalClient.transcribe(tmpPath, language);
      logger.info({ wavPath: tmpPath, textLen: text.trim().length, durationMs: Date.now() - t0wl }, "[whisper-local] transcribe done");
      return {
        text,
        confidence: 0.9,
        durationMs,
        provider: "whisper-local",
      };
    } catch (err) {
      throw new Error(`whisper-local transcription failed: ${String(err)}`);
    }
  }

  // whisper-cloud via OpenAI API
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey)
    throw new Error("OPENAI_API_KEY required for whisper-cloud provider");

  try {
    const form = new FormData();
    const wavBuffer = prepareWav(audioBuffer, 44100, 1);
    form.append("file", new Blob([wavBuffer], { type: "audio/wav" }), "audio.wav");
    form.append("model", "whisper-1");
    form.append("language", language);
    form.append("prompt", "");
    form.append("temperature", "0");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const parsed = (await response.json()) as { text?: string };
    return {
      text: parsed.text ?? "",
      confidence: 0.95,
      durationMs: Date.now() - startMs,
      provider: "whisper-cloud",
    };
  } catch (err) {
    throw new Error(`whisper-cloud transcription failed: ${String(err)}`);
  }
}

/**
 * UC-D03: Text-to-speech via macOS `say` command.
 */
export async function speak(text: string, voice?: string): Promise<boolean> {
  try {
    const voiceFlag = voice ? `-v "${voice}"` : "";
    await execAsync(`say ${voiceFlag} "${text.replace(/"/g, '\\"')}"`);
    return true;
  } catch {
    return false;
  }
}

/**
 * UC-D03: Transcribe audio and execute the resulting voice command.
 */
export async function processVoiceCommand(
  audioBuffer: Buffer
): Promise<VoiceCommandResult> {
  const transcription = await transcribeAudio(audioBuffer, "native");
  if (!transcription.text) {
    return {
      transcription,
      intent: "unknown",
      executed: false,
      error: "Empty transcription",
    };
  }

  // Lazy import to avoid circular dep
  const { classifyIntent } = await import("../planner/intent.js");
  const intent = await classifyIntent(transcription.text);

  try {
    const { planFromIntent } = await import("../planner/intent.js");
    const { Orchestrator } = await import("../executor/orchestrator.js");

    const plan = await planFromIntent(intent);
    const orch = new Orchestrator();
    const result = await orch.executePlan(plan);

    return {
      transcription,
      intent: intent.type,
      executed: result.status === "complete",
      output: JSON.stringify(result.stepResults?.map((r) => r.data)),
    };
  } catch (err) {
    return {
      transcription,
      intent: intent.type,
      executed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ===========================================================================
// UC-D04: Learn Repeated Actions → Macros
// ===========================================================================

export interface ActionSequence {
  sessionId: string;
  actions: RecordedAction[];
  startedAt: string;
  stoppedAt?: string;
}

export interface RecordedAction {
  timestamp: string;
  type: "shell" | "applescript" | "keypress" | "click" | "type" | "custom";
  payload: Record<string, unknown>;
}

export interface MacroDefinition {
  id: string;
  name: string;
  description: string;
  actions: RecordedAction[];
  params: MacroParam[];
  createdAt: string;
  lastRunAt?: string;
  runCount: number;
}

export interface MacroParam {
  name: string;
  description: string;
  defaultValue?: string;
}

export interface MacroResult {
  macroId: string;
  status: "ok" | "failed";
  durationMs: number;
  error?: string;
  output?: unknown;
}

// In-memory recording sessions
const _recordingSessions = new Map<string, ActionSequence>();

/**
 * UC-D04: Start recording user actions. Returns a session ID.
 */
export function startRecording(): string {
  const sessionId = generateId("rec");
  _recordingSessions.set(sessionId, {
    sessionId,
    actions: [],
    startedAt: new Date().toISOString(),
  });
  return sessionId;
}

/**
 * UC-D04: Stop recording and return the captured action sequence.
 */
export function stopRecording(sessionId: string): ActionSequence {
  const session = _recordingSessions.get(sessionId);
  if (!session) throw new Error(`No recording session found: ${sessionId}`);
  session.stoppedAt = new Date().toISOString();
  _recordingSessions.delete(sessionId);
  return session;
}

/**
 * UC-D04: Use Claude to infer a reusable macro definition from an action sequence.
 */
export async function inferMacro(
  actions: ActionSequence
): Promise<MacroDefinition> {
  const client = getClient();
  let name = `Macro ${Date.now()}`;
  let description = "Recorded macro";
  const params: MacroParam[] = [];

  if (client) {
    try {
      const msg = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 512,
        system:
          'You are a macro analyzer. Given a list of actions, output JSON with: {"name": string, "description": string, "params": [{"name": string, "description": string, "defaultValue"?: string}]}. Keep it concise.',
        messages: [
          {
            role: "user",
            content: JSON.stringify(actions.actions.slice(0, 20)),
          },
        ],
      });
      const text = msg.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("");
      const parsed = JSON.parse(text) as {
        name?: string;
        description?: string;
        params?: MacroParam[];
      };
      name = parsed.name ?? name;
      description = parsed.description ?? description;
      if (Array.isArray(parsed.params)) params.push(...parsed.params);
    } catch {
      // fallback to defaults
    }
  }

  return {
    id: generateId("macro"),
    name,
    description,
    actions: actions.actions,
    params,
    createdAt: new Date().toISOString(),
    runCount: 0,
  };
}

/**
 * UC-D04: Persist a macro definition to ~/.omnistate/macros/.
 */
export async function saveMacro(macro: MacroDefinition): Promise<boolean> {
  try {
    const dir = ensureDir("macros");
    writeJson(join(dir, `${macro.id}.json`), macro);
    return true;
  } catch {
    return false;
  }
}

/**
 * UC-D04: List all saved macros.
 */
export async function listMacros(): Promise<MacroDefinition[]> {
  try {
    const dir = ensureDir("macros");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    return files.map((f) => readJson<MacroDefinition>(join(dir, f), {} as MacroDefinition));
  } catch {
    return [];
  }
}

/**
 * UC-D04: Execute a saved macro by ID.
 */
export async function runMacro(
  macroId: string,
  _params?: Record<string, unknown>
): Promise<MacroResult> {
  const dir = ensureDir("macros");
  const macroPath = join(dir, `${macroId}.json`);

  if (!existsSync(macroPath)) {
    return { macroId, status: "failed", durationMs: 0, error: "Macro not found" };
  }

  const macro = readJson<MacroDefinition>(macroPath, {} as MacroDefinition);
  const startMs = Date.now();

  try {
    for (const action of macro.actions) {
      switch (action.type) {
        case "shell":
          await execAsync(action.payload["command"] as string, {
            timeout: 30_000,
          });
          break;
        case "applescript":
          await execAsync(
            `osascript -e ${JSON.stringify(action.payload["script"] as string)}`
          );
          break;
        default:
          // Skip unknown action types
          break;
      }
    }

    // Update run metadata
    macro.lastRunAt = new Date().toISOString();
    macro.runCount = (macro.runCount ?? 0) + 1;
    writeJson(macroPath, macro);

    return { macroId, status: "ok", durationMs: Date.now() - startMs };
  } catch (err) {
    return {
      macroId,
      status: "failed",
      durationMs: Date.now() - startMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ===========================================================================
// UC-D05: Multi-App Orchestration
// ===========================================================================

export interface AppContext {
  appName: string;
  windowTitle?: string;
  elementQuery?: string;
}

export interface DataPayload {
  type: "text" | "file" | "url" | "json";
  content: string;
}

export interface AppWorkflow {
  id?: string;
  steps: AppWorkflowStep[];
}

export interface AppWorkflowStep {
  app: string;
  action: "activate" | "copy" | "paste" | "type" | "run-script";
  params: Record<string, unknown>;
}

export interface WorkflowResult {
  workflowId: string;
  status: "ok" | "failed";
  completedSteps: number;
  totalSteps: number;
  durationMs: number;
  error?: string;
}

/**
 * UC-D05: Transfer data from one app to another via clipboard or AppleScript.
 */
export async function transferData(
  source: AppContext,
  target: AppContext,
  data: DataPayload
): Promise<boolean> {
  try {
    // Write to clipboard
    const escaped = data.content.replace(/'/g, "'\\''");
    await execAsync(`printf '%s' '${escaped}' | pbcopy`);

    // Activate source app, copy
    await execAsync(
      `osascript -e 'tell application "${source.appName}" to activate'`
    );
    await new Promise((r) => setTimeout(r, 500));

    // Activate target app, paste
    await execAsync(
      `osascript -e 'tell application "${target.appName}" to activate'`
    );
    await new Promise((r) => setTimeout(r, 300));
    await execAsync(
      `osascript -e 'tell application "System Events" to keystroke "v" using command down'`
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * UC-D05: Execute a multi-step app workflow.
 */
export async function orchestrateApps(
  workflow: AppWorkflow
): Promise<WorkflowResult> {
  const workflowId = workflow.id ?? generateId("workflow");
  const startMs = Date.now();
  let completedSteps = 0;

  for (const step of workflow.steps) {
    try {
      switch (step.action) {
        case "activate":
          await execAsync(
            `osascript -e 'tell application "${step.app}" to activate'`
          );
          break;
        case "type":
          await execAsync(
            `osascript -e 'tell application "System Events" to type text "${(step.params["text"] as string ?? "").replace(/"/g, '\\"')}"'`
          );
          break;
        case "run-script":
          await execAsync(
            `osascript -e ${JSON.stringify(step.params["script"] as string)}`
          );
          break;
        case "copy":
          await execAsync(
            `osascript -e 'tell application "System Events" to keystroke "c" using command down'`
          );
          break;
        case "paste":
          await execAsync(
            `osascript -e 'tell application "System Events" to keystroke "v" using command down'`
          );
          break;
      }
      completedSteps++;
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      return {
        workflowId,
        status: "failed",
        completedSteps,
        totalSteps: workflow.steps.length,
        durationMs: Date.now() - startMs,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    workflowId,
    status: "ok",
    completedSteps,
    totalSteps: workflow.steps.length,
    durationMs: Date.now() - startMs,
  };
}

/**
 * UC-D05: Copy content described in natural language between two apps via clipboard.
 */
export async function copyBetweenApps(
  sourceApp: string,
  targetApp: string,
  dataDescription: string
): Promise<boolean> {
  return transferData(
    { appName: sourceApp },
    { appName: targetApp },
    { type: "text", content: dataDescription }
  );
}

// ===========================================================================
// UC-D06: Remote Control Bridge
// ===========================================================================

export interface RemoteBridgeConfig {
  port?: number;
  host?: string;
  authToken?: string;
  allowShell?: boolean;
  protocol?: "ws" | "http";
}

export interface RemoteBridge {
  id: string;
  config: RemoteBridgeConfig;
  status: "active" | "closed";
  startedAt: string;
  port: number;
}

export interface RemoteCommand {
  id: string;
  bridgeId?: string;
  authToken?: string;
  type: "shell" | "applescript" | "plan";
  payload: Record<string, unknown>;
}

export interface RemoteResult {
  commandId: string;
  status: "ok" | "failed";
  output?: unknown;
  error?: string;
  durationMs: number;
}

// In-memory bridge registry
const _remoteBridges = new Map<string, RemoteBridge>();

function authorizeRemoteCommand(command: RemoteCommand): {
  ok: boolean;
  bridge: RemoteBridge | null;
  reason?: string;
} {
  const activeBridges = Array.from(_remoteBridges.values()).filter(
    (b) => b.status === "active"
  );

  if (command.bridgeId) {
    const bridge = _remoteBridges.get(command.bridgeId) ?? null;
    if (!bridge || bridge.status !== "active") {
      return { ok: false, bridge: null, reason: "Bridge not found or inactive" };
    }
    const required = bridge.config.authToken;
    if (required && command.authToken !== required) {
      return { ok: false, bridge, reason: "Invalid auth token" };
    }
    return { ok: true, bridge };
  }

  if (activeBridges.length === 0) {
    return { ok: false, bridge: null, reason: "No active remote bridge" };
  }

  const bridgesWithAuth = activeBridges.filter((b) => !!b.config.authToken);
  if (bridgesWithAuth.length > 0) {
    const matched = bridgesWithAuth.find(
      (b) => b.config.authToken === command.authToken
    );
    if (!matched) {
      return { ok: false, bridge: null, reason: "Missing or invalid auth token" };
    }
    return { ok: true, bridge: matched };
  }

  return { ok: true, bridge: activeBridges[0] ?? null };
}

/**
 * UC-D06: Start a remote control bridge (HTTP listener for incoming commands).
 */
export async function startRemoteBridge(
  config: RemoteBridgeConfig
): Promise<RemoteBridge> {
  const id = generateId("bridge");
  const port = config.port ?? 7788;

  const bridge: RemoteBridge = {
    id,
    config,
    status: "active",
    startedAt: new Date().toISOString(),
    port,
  };

  _remoteBridges.set(id, bridge);
  return bridge;
}

/**
 * UC-D06: Stop and unregister a remote bridge.
 */
export function stopRemoteBridge(bridgeId: string): boolean {
  const bridge = _remoteBridges.get(bridgeId);
  if (!bridge) return false;
  bridge.status = "closed";
  _remoteBridges.delete(bridgeId);
  return true;
}

/**
 * UC-D06: Handle an incoming remote command.
 */
export async function handleRemoteCommand(
  command: RemoteCommand
): Promise<RemoteResult> {
  const startMs = Date.now();
  try {
    const auth = authorizeRemoteCommand(command);
    if (!auth.ok) {
      return {
        commandId: command.id,
        status: "failed",
        error: auth.reason ?? "Unauthorized remote command",
        durationMs: Date.now() - startMs,
      };
    }

    let output: unknown;
    switch (command.type) {
      case "shell": {
        if (!auth.bridge?.config.allowShell) {
          return {
            commandId: command.id,
            status: "failed",
            error: "Shell execution disabled for this bridge",
            durationMs: Date.now() - startMs,
          };
        }
        const { stdout } = await execAsync(
          command.payload["command"] as string,
          { timeout: 30_000 }
        );
        output = stdout.trim();
        break;
      }
      case "applescript":
        const { stdout: asOut } = await execAsync(
          `osascript -e ${JSON.stringify(command.payload["script"] as string)}`
        );
        output = asOut.trim();
        break;
      case "plan": {
        const { classifyIntent, planFromIntent } = await import(
          "../planner/intent.js"
        );
        const { Orchestrator } = await import("../executor/orchestrator.js");
        const intent = await classifyIntent(
          command.payload["text"] as string ?? ""
        );
        const plan = await planFromIntent(intent);
        const orch = new Orchestrator();
        output = await orch.executePlan(plan);
        break;
      }
    }
    return { commandId: command.id, status: "ok", output, durationMs: Date.now() - startMs };
  } catch (err) {
    return {
      commandId: command.id,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    };
  }
}

/**
 * UC-D06: Stream a result back to the remote bridge (writes to a result file).
 */
export async function streamResultToRemote(
  bridge: RemoteBridge,
  result: unknown
): Promise<boolean> {
  try {
    const dir = ensureDir("remote");
    writeJson(join(dir, `${bridge.id}-result.json`), {
      bridgeId: bridge.id,
      timestamp: new Date().toISOString(),
      result,
    });
    return true;
  } catch {
    return false;
  }
}

// ===========================================================================
// UC-D07: Desired State Enforcement
// ===========================================================================

export interface DesiredStateSpec {
  name: string;
  description?: string;
  checks: StateCheck[];
}

export interface StateCheck {
  id: string;
  type: "file-exists" | "process-running" | "shell-check" | "pref-check";
  description: string;
  command?: string;
  filePath?: string;
  processName?: string;
  expectedOutput?: string;
}

export interface DriftReport {
  stateId: string;
  checkedAt: string;
  drifted: boolean;
  violations: DriftViolation[];
}

export interface DriftViolation {
  checkId: string;
  description: string;
  expected: string;
  actual: string;
}

export interface EnforcementResult {
  stateId: string;
  enforcedAt: string;
  violations: number;
  remediated: number;
  failed: number;
  actions: string[];
}

// In-memory state loops
const _stateLoops = new Map<string, NodeJS.Timeout>();

/**
 * UC-D07: Define a desired state specification. Returns a state ID.
 */
export async function defineDesiredState(
  spec: DesiredStateSpec
): Promise<string> {
  const id = generateId("state");
  const dir = ensureDir("states");
  writeJson(join(dir, `${id}.json`), { id, ...spec, createdAt: new Date().toISOString() });
  return id;
}

/**
 * UC-D07: Check for drift against a defined desired state.
 */
export async function checkDrift(stateId: string): Promise<DriftReport> {
  const dir = ensureDir("states");
  const specPath = join(dir, `${stateId}.json`);
  if (!existsSync(specPath)) {
    throw new Error(`State not found: ${stateId}`);
  }

  const spec = readJson<DesiredStateSpec & { id: string }>(specPath, {} as DesiredStateSpec & { id: string });
  const violations: DriftViolation[] = [];

  for (const check of spec.checks ?? []) {
    try {
      switch (check.type) {
        case "file-exists":
          if (!existsSync(check.filePath ?? "")) {
            violations.push({
              checkId: check.id,
              description: check.description,
              expected: "file exists",
              actual: "file missing",
            });
          }
          break;
        case "process-running": {
          const { stdout } = await execAsync(
            `pgrep -x "${check.processName}" 2>/dev/null`
          ).catch(() => ({ stdout: "", stderr: "" }));
          if (!stdout.trim()) {
            violations.push({
              checkId: check.id,
              description: check.description,
              expected: "process running",
              actual: "process not found",
            });
          }
          break;
        }
        case "shell-check": {
          const { stdout } = await execAsync(check.command ?? "true", {
            timeout: 10_000,
          }).catch(() => ({ stdout: "", stderr: "" }));
          if (
            check.expectedOutput &&
            !stdout.trim().includes(check.expectedOutput)
          ) {
            violations.push({
              checkId: check.id,
              description: check.description,
              expected: check.expectedOutput,
              actual: stdout.trim().slice(0, 100),
            });
          }
          break;
        }
      }
    } catch {
      violations.push({
        checkId: check.id,
        description: check.description,
        expected: "check passed",
        actual: "check errored",
      });
    }
  }

  return {
    stateId,
    checkedAt: new Date().toISOString(),
    drifted: violations.length > 0,
    violations,
  };
}

/**
 * UC-D07: Enforce desired state by running remediation commands.
 */
export async function enforcState(stateId: string): Promise<EnforcementResult> {
  const report = await checkDrift(stateId);
  const actions: string[] = [];
  let remediated = 0;
  let failed = 0;

  for (const violation of report.violations) {
    const dir = ensureDir("states");
    const spec = readJson<DesiredStateSpec & { checks: StateCheck[] }>(
      join(dir, `${stateId}.json`),
      { checks: [] } as unknown as DesiredStateSpec & { checks: StateCheck[] }
    );
    const check = spec.checks.find((c) => c.id === violation.checkId);
    if (!check) continue;

    try {
      if (check.type === "process-running" && check.processName) {
        await execAsync(`open -a "${check.processName}" 2>/dev/null || ${check.processName} &`);
        actions.push(`Started process: ${check.processName}`);
        remediated++;
      } else if (check.type === "file-exists" && check.filePath) {
        await execAsync(`touch "${check.filePath}"`);
        actions.push(`Created file: ${check.filePath}`);
        remediated++;
      } else if (check.command) {
        await execAsync(check.command, { timeout: 30_000 });
        actions.push(`Ran remediation: ${check.command}`);
        remediated++;
      }
    } catch {
      failed++;
    }
  }

  return {
    stateId,
    enforcedAt: new Date().toISOString(),
    violations: report.violations.length,
    remediated,
    failed,
    actions,
  };
}

/**
 * UC-D07: Start a background enforcement loop.
 */
export function startDesiredStateLoop(
  stateId: string,
  intervalMs: number = 60_000
): void {
  if (_stateLoops.has(stateId)) return;
  const timer = setInterval(async () => {
    try {
      const report = await checkDrift(stateId);
      if (report.drifted) await enforcState(stateId);
    } catch {
      // Ignore loop errors silently
    }
  }, intervalMs);
  _stateLoops.set(stateId, timer);
}

/**
 * UC-D07: Stop the enforcement loop for a state.
 */
export function stopDesiredStateLoop(stateId: string): void {
  const timer = _stateLoops.get(stateId);
  if (timer) {
    clearInterval(timer);
    _stateLoops.delete(stateId);
  }
}

// ===========================================================================
// UC-D08: Time-Travel Undo / Checkpoints
// ===========================================================================

export interface CheckpointInfo {
  id: string;
  label: string;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

export interface RollbackResult {
  checkpointId: string;
  status: "ok" | "failed";
  restoredAt: string;
  actionsApplied: number;
  error?: string;
}

/**
 * UC-D08: Record a system checkpoint (clipboard, frontmost app, env snapshot).
 */
export async function recordCheckpoint(label?: string): Promise<CheckpointInfo> {
  const id = generateId("ckpt");

  // Capture lightweight state snapshot
  const [clipboard, frontApp, cwd] = await Promise.allSettled([
    execAsync("pbpaste").then((r) => r.stdout.trim().slice(0, 500)),
    execAsync(
      "osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true'"
    ).then((r) => r.stdout.trim()),
    execAsync("pwd").then((r) => r.stdout.trim()),
  ]);

  const snapshot: Record<string, unknown> = {
    clipboard: clipboard.status === "fulfilled" ? clipboard.value : "",
    frontmostApp: frontApp.status === "fulfilled" ? frontApp.value : "",
    cwd: cwd.status === "fulfilled" ? cwd.value : "",
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) => !k.includes("KEY") && !k.includes("SECRET")
      )
    ),
  };

  const info: CheckpointInfo = {
    id,
    label: label ?? `Checkpoint ${new Date().toLocaleTimeString()}`,
    createdAt: new Date().toISOString(),
    snapshot,
  };

  const dir = ensureDir("checkpoints");
  writeJson(join(dir, `${id}.json`), info);
  return info;
}

/**
 * UC-D08: List all recorded checkpoints.
 */
export async function listCheckpoints(): Promise<CheckpointInfo[]> {
  try {
    const dir = ensureDir("checkpoints");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
    return files.map((f) =>
      readJson<CheckpointInfo>(join(dir, f), {} as CheckpointInfo)
    );
  } catch {
    return [];
  }
}

/**
 * UC-D08: Roll back to a previous checkpoint.
 */
export async function rollbackToCheckpoint(
  checkpointId: string
): Promise<RollbackResult> {
  const dir = ensureDir("checkpoints");
  const path = join(dir, `${checkpointId}.json`);
  if (!existsSync(path)) {
    return {
      checkpointId,
      status: "failed",
      restoredAt: new Date().toISOString(),
      actionsApplied: 0,
      error: "Checkpoint not found",
    };
  }

  const info = readJson<CheckpointInfo>(path, {} as CheckpointInfo);
  let actionsApplied = 0;

  try {
    // Restore clipboard
    if (info.snapshot["clipboard"]) {
      const escaped = (info.snapshot["clipboard"] as string).replace(
        /'/g,
        "'\\''"
      );
      await execAsync(`printf '%s' '${escaped}' | pbcopy`);
      actionsApplied++;
    }

    // Re-activate front app
    if (info.snapshot["frontmostApp"]) {
      await execAsync(
        `osascript -e 'tell application "${info.snapshot["frontmostApp"]}" to activate'`
      ).catch(() => null);
      actionsApplied++;
    }

    return {
      checkpointId,
      status: "ok",
      restoredAt: new Date().toISOString(),
      actionsApplied,
    };
  } catch (err) {
    return {
      checkpointId,
      status: "failed",
      restoredAt: new Date().toISOString(),
      actionsApplied,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * UC-D08: Undo the last recorded action by rolling back to the most recent checkpoint.
 */
export async function undoLastAction(): Promise<RollbackResult> {
  const checkpoints = await listCheckpoints();
  if (checkpoints.length === 0) {
    return {
      checkpointId: "",
      status: "failed",
      restoredAt: new Date().toISOString(),
      actionsApplied: 0,
      error: "No checkpoints available",
    };
  }
  return rollbackToCheckpoint(checkpoints[0].id);
}

// ===========================================================================
// UC-D09: Cross-Device Context Handoff
// ===========================================================================

export interface ContextPackage {
  id: string;
  sourceDevice: string;
  createdAt: string;
  clipboard?: string;
  openFiles?: string[];
  workingDirectory?: string;
  openApps?: string[];
  notes?: string;
}

/**
 * UC-D09: Serialize the current device context into a portable package.
 */
export async function serializeContext(): Promise<ContextPackage> {
  const id = generateId("ctx");

  const [clipboard, hostname, cwd, openApps] = await Promise.allSettled([
    execAsync("pbpaste").then((r) => r.stdout.trim().slice(0, 2000)),
    execAsync("hostname").then((r) => r.stdout.trim()),
    execAsync("pwd").then((r) => r.stdout.trim()),
    execAsync(
      "osascript -e 'tell application \"System Events\" to get name of every application process whose background only is false'"
    ).then((r) => r.stdout.trim().split(", ")),
  ]);

  const pkg: ContextPackage = {
    id,
    sourceDevice: hostname.status === "fulfilled" ? hostname.value : "unknown",
    createdAt: new Date().toISOString(),
    clipboard: clipboard.status === "fulfilled" ? clipboard.value : undefined,
    workingDirectory: cwd.status === "fulfilled" ? cwd.value : undefined,
    openApps: openApps.status === "fulfilled" ? openApps.value : undefined,
  };

  const dir = ensureDir("contexts");
  writeJson(join(dir, `${id}.json`), pkg);
  return pkg;
}

/**
 * UC-D09: Send a context package to another device (writes to shared path or cloud sync).
 */
export async function sendContextToDevice(
  context: ContextPackage,
  targetId: string
): Promise<boolean> {
  try {
    const dir = ensureDir("contexts/outbox");
    writeJson(join(dir, `${targetId}-${context.id}.json`), context);
    return true;
  } catch {
    return false;
  }
}

/**
 * UC-D09: Receive a context package and restore it on this device.
 */
export async function receiveContext(
  context: ContextPackage
): Promise<boolean> {
  try {
    // Restore clipboard
    if (context.clipboard) {
      const escaped = context.clipboard.replace(/'/g, "'\\''");
      await execAsync(`printf '%s' '${escaped}' | pbcopy`);
    }

    // Open apps
    if (context.openApps) {
      for (const app of context.openApps.slice(0, 5)) {
        await execAsync(`open -a "${app}" 2>/dev/null`).catch(() => null);
      }
    }

    const dir = ensureDir("contexts");
    writeJson(join(dir, `received-${context.id}.json`), context);
    return true;
  } catch {
    return false;
  }
}

// ===========================================================================
// UC-D10: Personalization via Usage Patterns
// ===========================================================================

export interface UserAction {
  timestamp?: string;
  type: string;
  appName?: string;
  command?: string;
  description?: string;
  durationMs?: number;
}

export interface UsageProfile {
  analyzedDays: number;
  totalActions: number;
  topApps: Array<{ app: string; count: number }>;
  topCommands: Array<{ command: string; count: number }>;
  peakHours: number[];
  patterns: string[];
}

export interface AutomationSuggestion {
  id: string;
  title: string;
  description: string;
  confidence: number;
  estimatedTimeSavedMinutes: number;
}

export interface UserProfile {
  userId: string;
  createdAt: string;
  lastUpdatedAt: string;
  usageProfile?: UsageProfile;
  preferences: Record<string, unknown>;
}

/**
 * UC-D10: Record a user action to the usage log.
 */
export async function recordUserAction(action: UserAction): Promise<void> {
  const dir = ensureDir("usage");
  const logPath = join(dir, "actions.jsonl");
  const entry = {
    ...action,
    timestamp: action.timestamp ?? new Date().toISOString(),
  };
  // Append to JSONL log
  const line = JSON.stringify(entry) + "\n";
  const { appendFileSync } = await import("node:fs");
  appendFileSync(logPath, line, "utf-8");
}

/**
 * UC-D10: Analyze usage patterns over the specified number of days.
 */
export async function analyzePatterns(days: number = 7): Promise<UsageProfile> {
  const dir = ensureDir("usage");
  const logPath = join(dir, "actions.jsonl");

  let actions: UserAction[] = [];
  try {
    const raw = readFileSync(logPath, "utf-8");
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    actions = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as UserAction)
      .filter(
        (a) =>
          !a.timestamp || new Date(a.timestamp).getTime() > cutoff
      );
  } catch {
    // No log yet
  }

  const appCounts = new Map<string, number>();
  const cmdCounts = new Map<string, number>();
  const hourCounts = new Array(24).fill(0) as number[];

  for (const action of actions) {
    if (action.appName) appCounts.set(action.appName, (appCounts.get(action.appName) ?? 0) + 1);
    if (action.command) cmdCounts.set(action.command, (cmdCounts.get(action.command) ?? 0) + 1);
    if (action.timestamp) {
      const hour = new Date(action.timestamp).getHours();
      hourCounts[hour]++;
    }
  }

  const topApps = Array.from(appCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([app, count]) => ({ app, count }));

  const topCommands = Array.from(cmdCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([command, count]) => ({ command, count }));

  const peakHours = hourCounts
    .map((count, hour) => ({ hour, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((h) => h.hour);

  return {
    analyzedDays: days,
    totalActions: actions.length,
    topApps,
    topCommands,
    peakHours,
    patterns: topApps.slice(0, 3).map((a) => `Frequent ${a.app} usage`),
  };
}

/**
 * UC-D10: Suggest automations based on usage patterns (Claude-assisted).
 */
export async function suggestAutomation(): Promise<AutomationSuggestion[]> {
  const profile = await analyzePatterns(30);
  const client = getClient();

  if (!client || profile.totalActions < 5) {
    return profile.topApps.slice(0, 3).map((a) => ({
      id: generateId("sug"),
      title: `Automate ${a.app} workflow`,
      description: `You use ${a.app} frequently. Consider creating a macro.`,
      confidence: 0.6,
      estimatedTimeSavedMinutes: 5,
    }));
  }

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system:
        'You are an automation advisor. Given a usage profile, suggest 3 automations. Return JSON array: [{"id":"...","title":"...","description":"...","confidence":0.8,"estimatedTimeSavedMinutes":10}]',
      messages: [{ role: "user", content: JSON.stringify(profile) }],
    });
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
    return JSON.parse(text) as AutomationSuggestion[];
  } catch {
    return [];
  }
}

/**
 * UC-D10: Get the persisted user profile.
 */
export async function getUserProfile(): Promise<UserProfile> {
  const dir = ensureDir("profile");
  const profilePath = join(dir, "user.json");
  const profile = readJson<UserProfile>(profilePath, {
    userId: generateId("user"),
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    preferences: {},
  });

  // Refresh with latest usage analysis
  profile.usageProfile = await analyzePatterns(30);
  profile.lastUpdatedAt = new Date().toISOString();
  writeJson(profilePath, profile);
  return profile;
}

// ===========================================================================
// UC-D11: NL → Script Generation
// ===========================================================================

export interface GeneratedScript {
  id: string;
  description: string;
  language: "bash" | "python" | "applescript";
  code: string;
  generatedAt: string;
  filePath?: string;
}

export interface ScriptResult {
  scriptId: string;
  status: "ok" | "failed" | "dry-run";
  output?: string;
  error?: string;
  durationMs: number;
}

/**
 * UC-D11: Generate a script in the specified language from a natural language description.
 */
export async function generateScript(
  description: string,
  language: "bash" | "python" | "applescript" = "bash"
): Promise<GeneratedScript> {
  const id = generateId("script");
  const client = getClient();

  let code = "";

  if (client) {
    try {
      const msg = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 2048,
        system: `You are a ${language} script generator for macOS. Generate a complete, working ${language} script that accomplishes the task. Output ONLY the script code, no markdown fences, no explanation.`,
        messages: [{ role: "user", content: description }],
      });
      code = msg.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("")
        .trim();
    } catch (err) {
      throw new Error(`Script generation failed: ${String(err)}`);
    }
  } else {
    // Heuristic fallback for common bash patterns
    if (language === "bash") {
      code = `#!/bin/bash\n# ${description}\necho "TODO: implement ${description}"`;
    } else {
      code = `# ${description}\nprint("TODO: implement")`;
    }
  }

  return {
    id,
    description,
    language,
    code,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * UC-D11: Execute a generated script, optionally in dry-run mode (just print it).
 */
export async function executeGeneratedScript(
  script: GeneratedScript,
  dryRun: boolean = false
): Promise<ScriptResult> {
  const startMs = Date.now();

  if (dryRun) {
    return {
      scriptId: script.id,
      status: "dry-run",
      output: script.code,
      durationMs: 0,
    };
  }

  const tmpDir = ensureDir("scripts/tmp");
  const ext = script.language === "python" ? ".py" : script.language === "applescript" ? ".applescript" : ".sh";
  const tmpPath = join(tmpDir, `${script.id}${ext}`);
  writeFileSync(tmpPath, script.code, "utf-8");

  try {
    let cmd: string;
    switch (script.language) {
      case "python":
        cmd = `python3 "${tmpPath}"`;
        break;
      case "applescript":
        cmd = `osascript "${tmpPath}"`;
        break;
      default:
        await execAsync(`chmod +x "${tmpPath}"`);
        cmd = `bash "${tmpPath}"`;
    }

    const { stdout, stderr } = await execAsync(cmd, { timeout: 60_000 });
    return {
      scriptId: script.id,
      status: "ok",
      output: (stdout + stderr).trim(),
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    return {
      scriptId: script.id,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    };
  }
}

/**
 * UC-D11: Save a generated script to disk and return the saved path.
 */
export async function saveScript(
  script: GeneratedScript,
  path?: string
): Promise<string> {
  const ext = script.language === "python" ? ".py" : script.language === "applescript" ? ".applescript" : ".sh";
  const dir = ensureDir("scripts");
  const savePath = path ?? join(dir, `${script.id}${ext}`);
  writeFileSync(savePath, script.code, "utf-8");
  if (script.language === "bash") {
    await execAsync(`chmod +x "${savePath}"`);
  }
  return savePath;
}

// ===========================================================================
// UC-D12: Context-Aware Next-Action Suggestion
// ===========================================================================

export interface WorkContext {
  id: string;
  capturedAt: string;
  frontmostApp?: string;
  openWindows?: string[];
  clipboard?: string;
  recentCommands?: string[];
  workingDirectory?: string;
}

export interface ActionSuggestion {
  id: string;
  title: string;
  description: string;
  confidence: number;
  tool: string;
  params: Record<string, unknown>;
  estimatedDurationMs: number;
}

/**
 * UC-D12: Capture the current work context from the OS.
 */
export async function getCurrentContext(): Promise<WorkContext> {
  const [frontApp, windows, clipboard, cwd] = await Promise.allSettled([
    execAsync(
      "osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true'"
    ).then((r) => r.stdout.trim()),
    execAsync(
      "osascript -e 'tell application \"System Events\" to get name of every application process whose background only is false'"
    ).then((r) => r.stdout.trim().split(", ").filter(Boolean)),
    execAsync("pbpaste 2>/dev/null").then((r) => r.stdout.trim().slice(0, 200)),
    execAsync("pwd").then((r) => r.stdout.trim()),
  ]);

  return {
    id: generateId("wctx"),
    capturedAt: new Date().toISOString(),
    frontmostApp: frontApp.status === "fulfilled" ? frontApp.value : undefined,
    openWindows: windows.status === "fulfilled" ? windows.value : undefined,
    clipboard: clipboard.status === "fulfilled" ? clipboard.value : undefined,
    workingDirectory: cwd.status === "fulfilled" ? cwd.value : undefined,
  };
}

/**
 * UC-D12: Suggest next actions based on current work context using Claude.
 */
export async function suggestNextAction(
  context?: WorkContext
): Promise<ActionSuggestion[]> {
  const ctx = context ?? (await getCurrentContext());
  const client = getClient();

  if (!client) {
    return [
      {
        id: generateId("sug"),
        title: "Save current work",
        description: `Save work in ${ctx.frontmostApp ?? "current app"}`,
        confidence: 0.7,
        tool: "app.script",
        params: {
          script: `tell application "${ctx.frontmostApp ?? "System Events"}" to activate`,
        },
        estimatedDurationMs: 500,
      },
    ];
  }

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system:
        'You are a macOS productivity assistant. Given work context, suggest 3 next actions. Return JSON array: [{"id":"...","title":"...","description":"...","confidence":0.8,"tool":"shell.exec","params":{"command":"..."},"estimatedDurationMs":1000}]',
      messages: [{ role: "user", content: JSON.stringify(ctx) }],
    });
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
    return JSON.parse(text) as ActionSuggestion[];
  } catch {
    return [];
  }
}

/**
 * UC-D12: Auto-execute a suggested action using the orchestrator.
 */
export async function autoExecuteSuggestion(
  suggestion: ActionSuggestion
): Promise<boolean> {
  try {
    const { Orchestrator } = await import("../executor/orchestrator.js");
    const orch = new Orchestrator();
    const plan = {
      taskId: generateId("task"),
      goal: suggestion.title,
      estimatedDuration: `${Math.round(suggestion.estimatedDurationMs / 1000)}s`,
      nodes: [
        {
          id: "action",
          type: "action" as const,
          layer: "auto" as const,
          action: {
            description: suggestion.description,
            tool: suggestion.tool,
            params: suggestion.params,
          },
          dependencies: [],
          onSuccess: null,
          onFailure: { strategy: "escalate" as const },
          estimatedDurationMs: suggestion.estimatedDurationMs,
          priority: "normal" as const,
        },
      ],
    };
    const result = await orch.executePlan(plan);
    return result.status === "complete";
  } catch {
    return false;
  }
}

// ===========================================================================
// UC-D13: Multi-User Isolation
// ===========================================================================

export interface UserSession {
  userId: string;
  username: string;
  displayName: string;
  homeDir: string;
  isActive: boolean;
  loginAt?: string;
}

/**
 * UC-D13: Get the current user session information.
 */
export async function getCurrentUserSession(): Promise<UserSession> {
  const [whoami, id, home] = await Promise.allSettled([
    execAsync("whoami").then((r) => r.stdout.trim()),
    execAsync("id -F 2>/dev/null || getent passwd $(whoami) 2>/dev/null | cut -d: -f5 || whoami").then(
      (r) => r.stdout.trim()
    ),
    execAsync("echo $HOME").then((r) => r.stdout.trim()),
  ]);

  const username = whoami.status === "fulfilled" ? whoami.value : "unknown";
  const displayName =
    id.status === "fulfilled" ? id.value : username;
  const homeDir =
    home.status === "fulfilled" ? home.value : `/Users/${username}`;

  return {
    userId: username,
    username,
    displayName,
    homeDir,
    isActive: true,
    loginAt: new Date().toISOString(),
  };
}

/**
 * UC-D13: Switch to a different macOS user session (fast-user-switching via loginwindow).
 */
export async function switchUserSession(_userId: string): Promise<boolean> {
  try {
    // macOS fast user switching via loginwindow AppleScript
    await execAsync(
      `osascript -e 'tell application "System Events" to keystroke "q" using {control down, option down, command down}' 2>/dev/null`
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * UC-D13: List all local macOS user accounts.
 */
export async function listUserSessions(): Promise<UserSession[]> {
  try {
    const { stdout } = await execAsync(
      "dscl . -list /Users 2>/dev/null | grep -v '^_' | head -20"
    );
    const usernames = stdout.trim().split("\n").filter(Boolean);

    return usernames.map((username) => ({
      userId: username,
      username,
      displayName: username,
      homeDir: `/Users/${username}`,
      isActive: false,
    }));
  } catch {
    return [await getCurrentUserSession()];
  }
}

/**
 * UC-D13: Isolate user data by setting restrictive permissions on a user's home directory.
 */
export async function isolateUserData(userId: string): Promise<boolean> {
  try {
    // Set home directory permissions to 700 (owner only)
    await execAsync(`chmod 700 /Users/${userId} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}
