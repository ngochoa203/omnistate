import { storageGetItem } from "./native-storage";

let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;

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

function fallbackSpeak(text: string, language: "vi" | "en") {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === "vi" ? "vi-VN" : "en-US";
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

export function cancelSpeech() {
  window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
}

export async function speakText(text: string, language: "vi" | "en") {
  const trimmed = text.trim();
  if (!trimmed) return;
  const profileId = getCurrentProfileId();

  try {
    const response = await fetch("/api/voice/clone/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed, language, profileId }),
    });

    if (!response.ok) {
      fallbackSpeak(trimmed, language);
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
      currentAudio = audio;
      currentAudioUrl = url;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (currentAudioUrl === url) currentAudioUrl = null;
        if (currentAudio === audio) currentAudio = null;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (currentAudioUrl === url) currentAudioUrl = null;
        if (currentAudio === audio) currentAudio = null;
      };
      void audio.play();
      return;
    }

    const payload = (await response.json().catch(() => null)) as { audioBase64?: string; format?: string } | null;
    if (payload?.audioBase64) {
      const format = payload.format || "wav";
      const audio = new Audio(`data:audio/${format};base64,${payload.audioBase64}`);
      currentAudio = audio;
      audio.onended = () => {
        if (currentAudio === audio) currentAudio = null;
      };
      audio.onerror = () => {
        if (currentAudio === audio) currentAudio = null;
      };
      void audio.play();
      return;
    }

    fallbackSpeak(trimmed, language);
  } catch {
    fallbackSpeak(trimmed, language);
  }
}
