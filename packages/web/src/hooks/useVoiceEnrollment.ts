import { useState, useRef, useCallback } from "react";
import { getClient } from "./useGateway";
import { encodeWav, blobToBase64 } from "../lib/audio-utils";
import type {
  ServerMessage,
  VoiceEnrollReadyMessage,
  VoiceEnrollProgressMessage,
  VoiceEnrollDoneMessage,
  VoiceEnrollErrorMessage,
} from "@omnistate/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EnrollStatus =
  | "idle"
  | "recording"
  | "sending"
  | "waiting"
  | "done"
  | "error";

export interface UseVoiceEnrollmentReturn {
  step: number;
  status: EnrollStatus;
  currentPrompt: string;
  error: string | null;
  sampleCount: number;
  startEnrollment: (userId: string) => void;
  submitSample: (blob: Blob) => Promise<void>;
  cancelEnrollment: () => void;
  finalize: () => void;
}


// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useVoiceEnrollment(): UseVoiceEnrollmentReturn {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<EnrollStatus>("idle");
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sampleCount, setSampleCount] = useState(0);

  const userIdRef = useRef<string>("");
  const unsubsRef = useRef<Array<() => void>>([]);

  const cleanup = useCallback(() => {
    for (const unsub of unsubsRef.current) unsub();
    unsubsRef.current = [];
  }, []);

  const startEnrollment = useCallback(
    (userId: string) => {
      cleanup();
      userIdRef.current = userId;
      setStep(0);
      setError(null);
      setSampleCount(0);
      setStatus("waiting");

      const client = getClient();

      // Subscribe to enrollment events
      const unsubs: Array<() => void> = [];

      unsubs.push(
        client.on("voice.enroll.ready", (msg: ServerMessage) => {
          const m = msg as VoiceEnrollReadyMessage;
          setStep(m.phraseIndex);
          setCurrentPrompt(m.prompt);
          setStatus("idle");
        })
      );

      unsubs.push(
        client.on("voice.enroll.progress", (msg: ServerMessage) => {
          const m = msg as VoiceEnrollProgressMessage;
          if (m.accepted) {
            setStep(m.phraseIndex);
            setStatus("idle");
          } else {
            setError(m.reason ?? "Sample rejected, please try again.");
            setStatus("error");
          }
        })
      );

      unsubs.push(
        client.on("voice.enroll.done", (msg: ServerMessage) => {
          const m = msg as VoiceEnrollDoneMessage;
          setSampleCount(m.sampleCount);
          setStatus("done");
          cleanup();
        })
      );

      unsubs.push(
        client.on("voice.enroll.error", (msg: ServerMessage) => {
          const m = msg as VoiceEnrollErrorMessage;
          setError(`[${m.code}] ${m.message}`);
          setStatus("error");
        })
      );

      unsubsRef.current = unsubs;
      client.send({ type: "voice.enroll.start", userId });
    },
    [cleanup]
  );

  const submitSample = useCallback(async (blob: Blob) => {
    setStatus("sending");

    let base64: string;
    let format: string;

    try {
      if (blob.type === "audio/wav" || blob.type === "") {
        // Already WAV or unknown — send as-is
        base64 = await blobToBase64(blob);
        format = "wav";
      } else if (blob.type.includes("webm") || blob.type.includes("ogg")) {
        base64 = await blobToBase64(blob);
        format = "webm";
      } else {
        // Fallback: read as base64 directly
        base64 = await blobToBase64(blob);
        format = blob.type.split("/")[1] ?? "wav";
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Audio encoding failed: ${msg}`);
      setStatus("error");
      return;
    }

    const phraseIndex = step;
    const client = getClient();
    client.send({ type: "voice.enroll.sample", audio: base64, format, phraseIndex });
    setStatus("waiting");
  }, [step]);

  const cancelEnrollment = useCallback(() => {
    cleanup();
    const client = getClient();
    if (userIdRef.current) {
      client.send({ type: "voice.enroll.cancel", userId: userIdRef.current });
    }
    setStatus("idle");
    setStep(0);
    setError(null);
    setSampleCount(0);
    setCurrentPrompt("");
    userIdRef.current = "";
  }, [cleanup]);

  const finalize = useCallback(() => {
    const client = getClient();
    client.send({ type: "voice.enroll.finalize", userId: userIdRef.current });
    setStatus("waiting");
  }, []);

  return {
    step,
    status,
    currentPrompt,
    error,
    sampleCount,
    startEnrollment,
    submitSample,
    cancelEnrollment,
    finalize,
  };
}

// ─── Minimal MediaRecorder helper ─────────────────────────────────────────────

export interface RecordingHandle {
  stop: () => void;
}

/**
 * Start recording from the default microphone.
 * Calls `onBlob` with a WAV Blob when recording stops.
 * Returns a handle to stop recording early.
 */
export async function startMediaRecording(
  onBlob: (blob: Blob) => void,
  onError: (err: string) => void
): Promise<RecordingHandle> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onError(`Microphone access denied: ${msg}`);
    return { stop: () => {} };
  }

  // Prefer WAV-capable AudioWorklet path (same as useVoice), but use MediaRecorder
  // as a simple alternative for enrollment (accuracy > latency here).
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : MediaRecorder.isTypeSupported("audio/webm")
    ? "audio/webm"
    : "";

  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    onBlob(blob);
  };

  recorder.onerror = () => {
    stream.getTracks().forEach((t) => t.stop());
    onError("MediaRecorder error");
  };

  recorder.start();

  return {
    stop: () => {
      if (recorder.state !== "inactive") recorder.stop();
    },
  };
}

// Re-export to satisfy callers that import encodeWav from here
export { encodeWav };
