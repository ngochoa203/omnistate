import { storageGetItem } from "./native-storage";

let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
let _ttsEndCallback: (() => void) | null = null;

/** Strip emoji, markdown, URLs, and lone punctuation so TTS doesn't read symbols out loud. */
export function sanitizeForTts(input: string): string {
  if (!input) return "";
  let text = input;
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/`[^`]*`/g, " ");
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/https?:\/\/\S+/gi, " link ");
  text = text.replace(/[@#](\w+)/g, "$1");
  text = text.replace(/[*_~`>#]+/g, " ");
  text = text.replace(/^\s*[-+]\s+/gm, "");
  text = text.replace(/\p{Extended_Pictographic}/gu, " ");
  text = text.replace(/[‍️]/g, "");
  text = text.replace(/([!?.,;:])\1{1,}/g, "$1");
  text = text.replace(/^[\s\p{P}\p{S}]+/u, "");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/** Register a callback fired when TTS audio finishes (or errors). Pass null to unregister. */
export function onTtsEnd(cb: (() => void) | null) {
  _ttsEndCallback = cb;
}

// Half-duplex gate: broadcast TTS speaking state (true = started, false = ended).
type TtsStateListener = (speaking: boolean) => void;
const _ttsStateListeners: Set<TtsStateListener> = new Set();
/** Subscribe to TTS start/end events. Returns an unsubscribe function. */
export function onTtsStateChange(fn: TtsStateListener): () => void {
  _ttsStateListeners.add(fn);
  return () => { _ttsStateListeners.delete(fn); };
}
function _notifyTtsState(speaking: boolean) {
  _ttsStateListeners.forEach((fn) => fn(speaking));
}

function getCurrentProfileId(): string | undefined {
  try {
    const raw = storageGetItem("omnistate.currentProfile");
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { id?: string };
    return typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : undefined;
  } catch {
    return undefined;
  }
}

function fallbackSpeak(text: string, language: "vi" | "en", speed = 1.2) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === "vi" ? "vi-VN" : "en-US";
  utterance.rate = Math.min(1.5, Math.max(0.7, speed));
  utterance.pitch = 1;
  utterance.onstart = () => { _notifyTtsState(true); };
  utterance.onend = () => { _notifyTtsState(false); _ttsEndCallback?.(); };
  utterance.onerror = () => { _notifyTtsState(false); _ttsEndCallback?.(); };
  window.speechSynthesis.speak(utterance);
}

export async function speakText(text: string, language: "vi" | "en", speed = 1.2) {
  const trimmed = sanitizeForTts(text);
  if (!trimmed) return;
  const profileId = getCurrentProfileId();

  try {
    const response = await fetch("/api/voice/clone/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed, language, profileId }),
    });

    if (!response.ok) {
      fallbackSpeak(trimmed, language, speed);
      return;
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();

    if (contentType.startsWith("audio/")) {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
        currentAudioUrl = null;
      }

      const audio = new Audio(url);
      audio.playbackRate = Math.min(1.5, Math.max(0.7, speed));
      currentAudio = audio;
      currentAudioUrl = url;
      audio.onplay = () => { _notifyTtsState(true); };
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (currentAudioUrl === url) currentAudioUrl = null;
        if (currentAudio === audio) currentAudio = null;
        _notifyTtsState(false);
        _ttsEndCallback?.();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (currentAudioUrl === url) currentAudioUrl = null;
        if (currentAudio === audio) currentAudio = null;
        _notifyTtsState(false);
        _ttsEndCallback?.();
      };
      void audio.play();
      return;
    }

    const payload = (await response.json().catch(() => null)) as { audioBase64?: string; format?: string } | null;
    if (payload?.audioBase64) {
      const format = payload.format || "wav";
      const audio = new Audio(`data:audio/${format};base64,${payload.audioBase64}`);
      audio.playbackRate = Math.min(1.5, Math.max(0.7, speed));
      currentAudio = audio;
      audio.onplay = () => { _notifyTtsState(true); };
      audio.onended = () => {
        if (currentAudio === audio) currentAudio = null;
        _notifyTtsState(false);
        _ttsEndCallback?.();
      };
      audio.onerror = () => {
        if (currentAudio === audio) currentAudio = null;
        _notifyTtsState(false);
        _ttsEndCallback?.();
      };
      void audio.play();
      return;
    }

    fallbackSpeak(trimmed, language, speed);
  } catch {
    fallbackSpeak(trimmed, language, speed);
  }
}
