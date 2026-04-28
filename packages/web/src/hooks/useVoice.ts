import { useState, useRef, useCallback } from "react";
import { encodeWav, blobToBase64 } from "../lib/audio-utils";
import { setLocalVoiceSession } from "./useVoiceSession";

export type VoiceState = "idle" | "recording" | "transcribing";

interface UseVoiceOptions {
  onTranscript?: (text: string) => void;
  onError?: (error: string) => void;
  sendAudio?: (base64: string) => void;
  maxDurationMs?: number;
}

export function useVoice(options: UseVoiceOptions = {}) {
  const { maxDurationMs = 30000 } = options;
  const [state, setState] = useState<VoiceState>("idle");
  const [duration, setDuration] = useState(0);
  const recordingStateRef = useRef<VoiceState>("idle");

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setVoiceState = useCallback((next: VoiceState) => {
    recordingStateRef.current = next;
    setState(next);
    setLocalVoiceSession({ state: next, error: undefined });
  }, []);

  const stopAudioCapture = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
    processorRef.current?.disconnect();
    contextRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    processorRef.current = null;
    contextRef.current = null;
    streamRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    if (state !== "idle") return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);

      chunksRef.current = [];

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(input));
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      streamRef.current = stream;
      contextRef.current = audioCtx;
      processorRef.current = processor;
      startTimeRef.current = Date.now();

      setVoiceState("recording");
      setDuration(0);

      // Update duration every 100ms
      timerRef.current = setInterval(() => {
        setDuration(Date.now() - startTimeRef.current);
      }, 100);

      // Auto-stop after max duration
      maxTimerRef.current = setTimeout(() => {
        void stopRecording();
      }, maxDurationMs);

    } catch (err: any) {
      const message = `Microphone access denied: ${err.message}`;
      setLocalVoiceSession({ state: "error", error: message });
      options.onError?.(message);
    }
  }, [state, maxDurationMs, setVoiceState]);

  const stopRecording = useCallback(async () => {
    if (recordingStateRef.current !== "recording") return;

    stopAudioCapture();

    const chunks = chunksRef.current;
    if (chunks.length === 0) {
      setVoiceState("idle");
      setDuration(0);
      options.onError?.("No audio recorded");
      return;
    }

    setVoiceState("transcribing");

    // Merge chunks into single Float32Array
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    // Encode to WAV and convert to base64
    try {
      const wavBlob = encodeWav(merged, 16000);
      const base64 = await blobToBase64(wavBlob);

      // Send to gateway
      if (options.sendAudio) {
        options.sendAudio(base64);
      }
    } catch (err: any) {
      options.onError?.(`Audio encoding failed: ${err.message}`);
      setVoiceState("idle");
      setDuration(0);
    }
  }, [options, setVoiceState, stopAudioCapture]);

  const cancel = useCallback(() => {
    stopAudioCapture();
    chunksRef.current = [];
    setVoiceState("idle");
    setDuration(0);
  }, [setVoiceState, stopAudioCapture]);

  // Called when transcript comes back from gateway
  const onTranscriptReceived = useCallback((text: string) => {
    setVoiceState("idle");
    setLocalVoiceSession({ transcript: text, partialTranscript: "" });
    setDuration(0);
    options.onTranscript?.(text);
  }, [options, setVoiceState]);

  const onTranscriptError = useCallback((error: string) => {
    setVoiceState("idle");
    setLocalVoiceSession({ state: "error", error });
    setDuration(0);
    options.onError?.(error);
  }, [options, setVoiceState]);

  return {
    state,
    duration,
    startRecording,
    stopRecording,
    cancel,
    onTranscriptReceived,
    onTranscriptError,
  };
}
