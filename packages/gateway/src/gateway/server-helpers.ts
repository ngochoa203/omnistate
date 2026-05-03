// server-helpers.ts — standalone helper functions extracted from server.ts
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { KnownAudioFormat } from "./server-types.js";

export const execAsync = promisify(execFile);
export const execFileAsync = promisify(execFile);
export const bridgeProbeScriptPath = fileURLToPath(new URL("../../scripts/bridge-probe.mjs", import.meta.url));
export const speechbrainScriptPath = fileURLToPath(new URL("../../scripts/speechbrain_voiceprint.py", import.meta.url));
// Bug fix #16: also allow ~/.omnistate/ so screenshots and voice output files
// generated there can be served to authenticated UI clients.
export const allowedFileRoots = [
  tmpdir(),
  join(process.env.HOME ?? "", ".omnistate"),
].filter(Boolean);

export const resolvedAllowedRoots = allowedFileRoots.map((r) => resolve(r));

export function isAllowedFilePath(filePath: string): boolean {
  const resolvedPath = resolve(filePath);
  return resolvedAllowedRoots.some(
    (root) => resolvedPath.startsWith(root + "/") || resolvedPath === root
  );
}

export function mimeForPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".txt" || ext === ".log" || ext === ".md") return "text/plain; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

export function sniffAudioFormat(buffer: Buffer): KnownAudioFormat {
  if (buffer.length < 4) return "unknown";
  const four = buffer.toString("ascii", 0, 4);
  const isWebm =
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3;
  const isWav =
    buffer.length >= 12 &&
    four === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE";
  const isOgg = four === "OggS";
  const isMp3 =
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) ||
    buffer.toString("ascii", 0, 3) === "ID3";

  if (isWav) return "wav";
  if (isWebm) return "webm";
  if (isOgg) return "ogg";
  if (isMp3) return "mp3";
  return "unknown";
}

export function normalizeDeclaredAudioFormat(raw: string): KnownAudioFormat {
  let format = (raw || "").trim().toLowerCase();
  if (format.startsWith("audio/")) format = format.slice("audio/".length);
  if (format.includes(";")) format = format.split(";", 1)[0] ?? format;

  if (format.includes("wav") || format.includes("wave")) return "wav";
  if (format.includes("webm")) return "webm";
  if (format.includes("ogg")) return "ogg";
  if (format.includes("mp3") || format.includes("mpeg") || format.includes("m4a") || format.includes("mp4")) return "mp3";
  return "unknown";
}

export async function ensureSpeechbrainCompatibleAudio(
  inputPath: string,
  declaredFormat: string,
): Promise<{ finalPath: string; cleanupPaths: string[] }> {
  const raw = await readFile(inputPath);
  const sniffed = sniffAudioFormat(raw);
  const declared = normalizeDeclaredAudioFormat(declaredFormat);
  const effective = sniffed !== "unknown" ? sniffed : declared;

  if (effective === "wav") {
    return { finalPath: inputPath, cleanupPaths: [] };
  }

  const convertedPath = join(tmpdir(), `omnistate-voice-converted-${crypto.randomUUID()}.wav`);
  try {
    await execFileAsync(
      "ffmpeg",
      ["-nostdin", "-y", "-i", inputPath, "-ac", "1", "-ar", "16000", "-f", "wav", convertedPath],
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    );
    return { finalPath: convertedPath, cleanupPaths: [convertedPath] };
  } catch (err) {
    throw new Error(
      "Cannot decode uploaded audio for SpeechBrain. Install ffmpeg or upload PCM WAV. Root error: " +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}