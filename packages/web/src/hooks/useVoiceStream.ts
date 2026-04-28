import { useCallback, useRef, useState } from "react";
import { getClient } from "./useGateway";
import { setLocalVoiceSession } from "./useVoiceSession";

interface VoiceStreamOptions {
  timesliceMs?: number;
  mimeTypes?: string[];
  onFallback?: () => void;
  onError?: (error: string) => void;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const DEFAULT_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

export function useVoiceStream(options: VoiceStreamOptions = {}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef<string | undefined>();
  const seqRef = useRef(0);

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    streamRef.current = null;
    setIsStreaming(false);
  }, []);

  const start = useCallback(async () => {
    if (isStreaming) return true;
    if (typeof MediaRecorder === "undefined") {
      options.onFallback?.();
      return false;
    }

    const mimeType = (options.mimeTypes ?? DEFAULT_MIME_TYPES).find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      options.onFallback?.();
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const client = getClient();
      const sessionId = client.startVoiceStream({ mimeType });
      const recorder = new MediaRecorder(stream, { mimeType });
      streamRef.current = stream;
      recorderRef.current = recorder;
      sessionIdRef.current = sessionId;
      seqRef.current = 0;
      setError(undefined);
      setLocalVoiceSession({ sessionId, state: "recording", transcript: "", partialTranscript: "", error: undefined });

      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        void blobToBase64(event.data)
          .then((base64) => client.sendVoiceChunk(sessionId, base64, seqRef.current++))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            options.onError?.(message);
          });
      };
      recorder.onerror = () => {
        const message = "Voice stream recorder failed";
        setError(message);
        options.onError?.(message);
        cleanup();
      };
      recorder.onstop = cleanup;
      recorder.start(options.timesliceMs ?? 500);
      setIsStreaming(true);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      options.onError?.(message);
      options.onFallback?.();
      cleanup();
      return false;
    }
  }, [cleanup, isStreaming, options]);

  const stop = useCallback((reason = "user_stopped") => {
    const sessionId = sessionIdRef.current;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    if (sessionId) getClient().stopVoiceStream(sessionId, reason);
    setLocalVoiceSession({ state: "transcribing" });
    cleanup();
  }, [cleanup]);

  const cancel = useCallback((reason = "user_cancelled") => {
    const sessionId = sessionIdRef.current;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    if (sessionId) getClient().cancelVoiceSession(sessionId, reason);
    setLocalVoiceSession({ state: "interrupted" });
    cleanup();
  }, [cleanup]);

  return { isStreaming, error, sessionId: sessionIdRef.current, start, stop, cancel };
}
