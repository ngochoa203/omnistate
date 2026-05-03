/**
 * Hybrid Browser Automation — UC-D03, UC-D05, UC-D06, UC-D09, UC-D11.
 *
 * Browser/app-facing automation: voice, app orchestration, remote control,
 * context handoff, and script execution.
 *
 * @module hybrid/automation-browser
 */

import { execAsync, execFileAsync } from "./automation-types.js";
import { getClient } from "./automation-types.js";
import {
  _remoteBridges,
  RemoteBridgeConfig,
  RemoteBridge,
  RemoteCommand,
  RemoteResult,
} from "./automation-types.js";
import {
  AppContext,
  DataPayload,
  AppWorkflow,
  WorkflowResult,
} from "./automation-types.js";
import {
  TranscriptionResult,
  VoiceCommandResult,
  GeneratedScript,
  ScriptResult,
  QUICK_ACTIONS,
  ContextPackage,
} from "./automation-types.js";
import {
  unlinkSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { whisperLocalClient } from "../voice/whisper-local-client.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Storage helpers (shared)
// ---------------------------------------------------------------------------

import { homedir as _homedir } from "node:os";
import { existsSync as _existsSync, mkdirSync as _mkdirSync } from "node:fs";
import { join as _join } from "node:path";
import { writeFileSync as _writeFileSync } from "node:fs";
import { readFileSync as _readFileSync } from "node:fs";
import { readdirSync as _readdirSync } from "node:fs";
import { OMNISTATE_DIR } from "./automation-desktop.js";

export { OMNISTATE_DIR };

export function ensureDir(subdir?: string): string {
  const dir = subdir ? _join(OMNISTATE_DIR, subdir) : OMNISTATE_DIR;
  if (!_existsSync(dir)) _mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(_readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(filePath: string, data: unknown): void {
  _writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ===========================================================================
// UC-D03: Voice Control Pipeline
// ===========================================================================

/**
 * Swift client now sends 16kHz mono PCM16 WAV directly — gateway can write without conversion.
 * For legacy raw float32 @ 44.1kHz buffers (non-WAV), still converts via wrapPcmAsWav.
 */
export function prepareWav(buf: Buffer, srcSampleRate: number, channels: number): Buffer {
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
export function wrapPcmAsWav(
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
      const transcript = text.replace(/\s+/g, " ").trim();
      logger.info(
        { wavPath: tmpPath, textLen: transcript.length, durationMs: Date.now() - t0wl },
        `[whisper-local] transcribe done: "${transcript}"`
      );
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
      output: JSON.stringify(result.stepResults?.map((r: unknown) => (r as { data: unknown }).data)),
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
// UC-D05: Multi-App Orchestration
// ===========================================================================

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
    await new Promise<void>((r) => setTimeout(r, 500));

    // Activate target app, paste
    await execAsync(
      `osascript -e 'tell application "${target.appName}" to activate'`
    );
    await new Promise<void>((r) => setTimeout(r, 300));
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
      await new Promise<void>((r) => setTimeout(r, 200));
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

export function authorizeRemoteCommand(command: RemoteCommand): {
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
// UC-D09: Cross-Device Context Handoff
// ===========================================================================

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
// UC-D11: NL → Script Generation
// ===========================================================================

/**
 * Execute JXA (JavaScript for Automation) code via osascript.
 */
export async function executeJxa(code: string, timeoutMs: number = 10_000): Promise<string> {
  const tmpPath = join(tmpdir(), `jxa-${randomBytes(6).toString("hex")}.js`);
  writeFileSync(tmpPath, code, "utf-8");
  try {
    const { stdout, stderr } = await execAsync(`osascript -l JavaScript "${tmpPath}"`, { timeout: timeoutMs });
    return (stdout + stderr).trim();
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

/**
 * Execute plain AppleScript code via osascript.
 */
export async function executeAppleScript(code: string, timeoutMs: number = 10_000): Promise<string> {
  const tmpPath = join(tmpdir(), `applescript-${randomBytes(6).toString("hex")}.applescript`);
  writeFileSync(tmpPath, code, "utf-8");
  try {
    const { stdout, stderr } = await execAsync(`osascript "${tmpPath}"`, { timeout: timeoutMs });
    return (stdout + stderr).trim();
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

/**
 * Execute a common system action without requiring LLM generation.
 * Returns an error string (not a thrown error) for unknown actions.
 */
export async function quickSystemAction(action: string): Promise<string> {
  const entry = QUICK_ACTIONS[action];
  if (!entry) {
    return `Unknown quick action: ${action}`;
  }
  if (entry.type === "jxa") {
    return executeJxa(entry.code);
  }
  return executeAppleScript(entry.code);
}

/**
 * UC-D11: Generate a script in the specified language from a natural language description.
 */
export async function generateScript(
  description: string,
  language: "bash" | "python" | "applescript" | "jxa" = "bash"
): Promise<GeneratedScript> {
  const id = generateId("script");
  const client = getClient();

  let code = "";

  if (client) {
    try {
      const systemPrompt =
        language === "jxa"
          ? `You are a JXA (JavaScript for Automation) script generator for macOS. Generate a complete, working JXA script that accomplishes the task. Use the JXA API (Application(), SystemEvents, etc.). Output ONLY the script code, no markdown fences, no explanation.`
          : `You are a ${language} script generator for macOS. Generate a complete, working ${language} script that accomplishes the task. Output ONLY the script code, no markdown fences, no explanation.`;
      const msg = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 2048,
        system: systemPrompt,
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
    // Try to map description to a known quick action before falling back to TODO stubs.
    const actionKey = description.trim().toLowerCase().replace(/\s+/g, "-");
    if (actionKey in QUICK_ACTIONS) {
      const entry = QUICK_ACTIONS[actionKey];
      code = entry.code;
    } else if (language === "bash") {
      const safeDesc = description.replace(/["'`$\n\r]/g, ' ').slice(0, 200);
      code = `#!/bin/bash\n# ${safeDesc}\necho "TODO: implement stub"`;
    } else {
      const safeDesc = description.replace(/["'`$\n\r]/g, ' ').slice(0, 200);
      code = `# ${safeDesc}\nprint("TODO: implement")`;
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
  const ext =
    script.language === "python"
      ? ".py"
      : script.language === "applescript"
      ? ".applescript"
      : script.language === "jxa"
      ? ".js"
      : ".sh";
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
      case "jxa":
        cmd = `osascript -l JavaScript "${tmpPath}"`;
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
