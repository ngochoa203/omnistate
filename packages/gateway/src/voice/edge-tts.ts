import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VoiceRuntimeConfig } from "../llm/runtime-config.js";

const execFileAsync = promisify(execFile);

const edgeTtsScriptPath = resolve(process.cwd(), "scripts/voice/edge_tts.py");

const VI_VOICE_DEFAULT = "vi-VN-HoaiMyNeural";
const EN_VOICE_DEFAULT = "en-US-AriaNeural";

const VI_DIACRITICS =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

function getPythonExec(): string {
  return process.env.OMNISTATE_RTC_PYTHON?.trim() ?? "python3";
}

export function detectLanguage(text: string): "vi" | "en" {
  return VI_DIACRITICS.test(text) ? "vi" : "en";
}

// Strip emoji, markdown syntax, URLs, mentions, and leading/standalone punctuation
// so the TTS engine doesn't read symbols out loud (e.g. "asterisk", "at", "hash").
export function sanitizeForTts(input: string): string {
  if (!input) return "";
  let text = input;

  // Remove fenced code blocks and inline code
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/`[^`]*`/g, " ");

  // Markdown links/images: ![alt](url) and [text](url) -> keep visible text
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Bare URLs -> "link"
  text = text.replace(/https?:\/\/\S+/gi, " link ");

  // @mentions and #hashtags -> keep the word, drop the symbol
  text = text.replace(/[@#](\w+)/g, "$1");

  // Markdown emphasis / headings / blockquotes / list bullets
  text = text.replace(/[*_~`>#]+/g, " ");
  text = text.replace(/^\s*[-+]\s+/gm, "");

  // Emoji and pictographic symbols (Extended_Pictographic covers most emoji)
  text = text.replace(/\p{Extended_Pictographic}/gu, " ");
  // Variation selectors / zero-width joiners
  text = text.replace(/[‍️]/g, "");

  // Collapse runs of same punctuation (e.g. "!!!" → "!")
  text = text.replace(/([!?.,;:])\1{1,}/g, "$1");

  // Collapse 2+ dots or ellipsis (…) to a single space — e.g. "word...." or "word … …"
  text = text.replace(/(\.|…){2,}/g, " ");

  // Remove isolated punctuation tokens surrounded by whitespace or at string boundaries
  text = text.replace(/(^|\s)[.,;:!?…]+(\s|$)/g, " ");

  // Strip trailing punctuation / whitespace at end of string
  text = text.replace(/[\s\p{P}]+$/u, "");

  // Strip leading lone punctuation
  text = text.replace(/^[\s\p{P}\p{S}]+/u, "");

  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

export function pickVoice(
  lang: "vi" | "en",
  config?: Pick<VoiceRuntimeConfig, "tts">,
): string {
  if (lang === "vi") {
    return (
      config?.tts?.voiceVi ??
      process.env.OMNISTATE_TTS_VOICE_VI ??
      VI_VOICE_DEFAULT
    );
  }
  return (
    config?.tts?.voiceEn ??
    process.env.OMNISTATE_TTS_VOICE_EN ??
    EN_VOICE_DEFAULT
  );
}

export async function synthesize(
  text: string,
  opts?: { voice?: string; lang?: "vi" | "en"; signal?: AbortSignal },
): Promise<Buffer> {
  const cleanText = sanitizeForTts(text);
  if (!cleanText) {
    return Buffer.alloc(0);
  }
  const lang = opts?.lang ?? detectLanguage(cleanText);
  const voice = opts?.voice ?? pickVoice(lang);

  if (!/^[a-zA-Z]+-[A-Z]{2}-[A-Za-z]+Neural$/.test(voice)) {
    throw new Error(`Invalid voice identifier: ${voice}`);
  }

  const id = `omnistate-edge-tts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const outPath = join(tmpdir(), `${id}.mp3`);

  try {
    await execFileAsync(
      getPythonExec(),
      [edgeTtsScriptPath, "--text", cleanText, "--voice", voice, "--output", outPath],
      { timeout: 60_000, maxBuffer: 1024 * 1024 * 16, signal: opts?.signal },
    );
    const buf = await readFile(outPath);
    return buf;
  } finally {
    await unlink(outPath).catch(() => undefined);
  }
}
