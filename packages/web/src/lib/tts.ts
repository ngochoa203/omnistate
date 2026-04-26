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
let _isSpeaking = false;
let _watchdogTimer: ReturnType<typeof setTimeout> | null = null;
const TTS_WATCHDOG_MS = 30_000;

/** Subscribe to TTS start/end events. Returns an unsubscribe function. */
export function onTtsStateChange(fn: TtsStateListener): () => void {
  _ttsStateListeners.add(fn);
  return () => { _ttsStateListeners.delete(fn); };
}
function _notifyTtsState(speaking: boolean) {
  // Idempotent: avoid duplicate transitions that would confuse listeners.
  if (_isSpeaking === speaking) return;
  _isSpeaking = speaking;
  if (_watchdogTimer) { clearTimeout(_watchdogTimer); _watchdogTimer = null; }
  if (speaking) {
    // Safety watchdog — if onended/onerror never fires (browser bug, stalled stream),
    // force-clear after TTS_WATCHDOG_MS so the mic gate doesn't lock the user out.
    _watchdogTimer = setTimeout(() => {
      console.warn("[tts] watchdog: forcing speaking=false after timeout");
      _watchdogTimer = null;
      if (_isSpeaking) {
        _isSpeaking = false;
        _ttsStateListeners.forEach((fn) => fn(false));
        _ttsEndCallback?.();
      }
    }, TTS_WATCHDOG_MS);
  }
  _ttsStateListeners.forEach((fn) => fn(speaking));
}

/** Force-reset speaking state. Useful when starting recording explicitly to break out
 * of any stuck-true situation caused by browser quirks (paused audio not firing onended,
 * speechSynthesis.cancel() not invoking onend, etc.). */
export function forceTtsStateReset() {
  if (_watchdogTimer) { clearTimeout(_watchdogTimer); _watchdogTimer = null; }
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  if (currentAudio) {
    try { currentAudio.pause(); } catch { /* ignore */ }
    currentAudio = null;
  }
  if (currentAudioUrl) {
    try { URL.revokeObjectURL(currentAudioUrl); } catch { /* ignore */ }
    currentAudioUrl = null;
  }
  if (_isSpeaking) {
    _isSpeaking = false;
    _ttsStateListeners.forEach((fn) => fn(false));
  }
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

function attachAudioHandlers(audio: HTMLAudioElement, url: string | null) {
  const finish = () => {
    if (url) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      if (currentAudioUrl === url) currentAudioUrl = null;
    }
    if (currentAudio === audio) currentAudio = null;
    _notifyTtsState(false);
    _ttsEndCallback?.();
  };
  audio.onplay = () => { _notifyTtsState(true); };
  audio.onended = finish;
  audio.onerror = finish;
  audio.onpause = () => {
    // pause() does not normally fire onended; emit false ourselves so the mic gate releases.
    if (currentAudio === audio) finish();
  };
  audio.onabort = finish;
  audio.onstalled = () => {
    console.warn("[tts] audio stalled — releasing speaking state");
    finish();
  };
  audio.onsuspend = () => {
    // Only treat as end if we never resumed (readyState stuck).
    if (audio.readyState < 2 && _isSpeaking) finish();
  };
}

function fallbackSpeak(text: string, language: "vi" | "en", speed = 1.2) {
  // Pre-emit false in case a previous utterance gets cancelled without firing onend.
  if (_isSpeaking) _notifyTtsState(false);
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
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

      // Tear down previous audio cleanly: emit false BEFORE pause so listeners release.
      if (currentAudio) {
        const old = currentAudio;
        currentAudio = null;
        if (_isSpeaking) _notifyTtsState(false);
        try { old.pause(); } catch { /* ignore */ }
      }
      if (currentAudioUrl) {
        try { URL.revokeObjectURL(currentAudioUrl); } catch { /* ignore */ }
        currentAudioUrl = null;
      }

      const audio = new Audio(url);
      audio.playbackRate = Math.min(1.5, Math.max(0.7, speed));
      currentAudio = audio;
      currentAudioUrl = url;
      attachAudioHandlers(audio, url);
      audio.play().catch((err) => {
        console.warn("[tts] audio.play() rejected:", err?.message);
        if (currentAudio === audio) currentAudio = null;
        if (currentAudioUrl === url) {
          try { URL.revokeObjectURL(url); } catch { /* ignore */ }
          currentAudioUrl = null;
        }
        _notifyTtsState(false);
        fallbackSpeak(trimmed, language, speed);
      });
      return;
    }

    const payload = (await response.json().catch(() => null)) as { audioBase64?: string; format?: string } | null;
    if (payload?.audioBase64) {
      const format = payload.format || "wav";
      // Tear down previous audio cleanly here too.
      if (currentAudio) {
        const old = currentAudio;
        currentAudio = null;
        if (_isSpeaking) _notifyTtsState(false);
        try { old.pause(); } catch { /* ignore */ }
      }
      const audio = new Audio(`data:audio/${format};base64,${payload.audioBase64}`);
      audio.playbackRate = Math.min(1.5, Math.max(0.7, speed));
      currentAudio = audio;
      attachAudioHandlers(audio, null);
      audio.play().catch((err) => {
        console.warn("[tts] audio.play() rejected (base64):", err?.message);
        if (currentAudio === audio) currentAudio = null;
        _notifyTtsState(false);
        fallbackSpeak(trimmed, language, speed);
      });
      return;
    }

    fallbackSpeak(trimmed, language, speed);
  } catch {
    fallbackSpeak(trimmed, language, speed);
  }
}
