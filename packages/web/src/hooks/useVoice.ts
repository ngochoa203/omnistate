import { useState, useRef, useCallback, useEffect } from "react";
import { encodeWav, blobToBase64 } from "../lib/audio-utils";
import { onTtsStateChange, forceTtsStateReset } from "../lib/tts";

export type VoiceState = "idle" | "recording" | "transcribing";

interface UseVoiceOptions {
  onTranscript?: (text: string) => void;
  onError?: (error: string) => void;
  onNoSpeech?: () => void;
  onAudioSent?: (info: { wavBytes: number; peakRms: number }) => void;
  sendAudio?: (base64: string) => void;
  maxDurationMs?: number;
  vadThreshold?: number;
  /** Intra-utterance silence before auto-stop (ms). Default 3500. */
  silenceMs?: number;
  /** Wall-clock timeout if no speech detected at all (ms). Default 5000. */
  noSpeechMs?: number;
  /** Hard cap on recording duration (ms). Default 25000. */
  maxMs?: number;
  /** Warn and invoke onNoSpeech when peak RMS is below 0.005 (mic may be muted). Default true. */
  warnIfSilent?: boolean;
}

// Inline worklet processor source
const WORKLET_SOURCE = `
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) this.port.postMessage(new Float32Array(ch));
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
`;

const MIN_SPEECH_FRAMES = 5;
const PEAK_RMS_FLOOR = 0.02;
const DEFAULT_SILENCE_MS = 3500;   // intra-utterance pause tolerance
const DEFAULT_NO_SPEECH_MS = 5000; // bail if user never speaks
const DEFAULT_MAX_MS = 25000;      // hard cap
const MIN_RECORDING_MS = 1500;

export function useVoice(options: UseVoiceOptions = {}) {
  const {
    maxDurationMs = DEFAULT_MAX_MS,
    vadThreshold = 0.01,
    silenceMs: silenceMsOpt = DEFAULT_SILENCE_MS,
    noSpeechMs: noSpeechMsOpt = DEFAULT_NO_SPEECH_MS,
    maxMs: maxMsOpt = DEFAULT_MAX_MS,
    warnIfSilent = true,
  } = options;
  const SILENCE_AUTO_STOP_MS = silenceMsOpt;
  const NO_SPEECH_TIMEOUT_MS = noSpeechMsOpt;
  const MAX_DURATION_MS = Math.min(maxDurationMs, maxMsOpt);
  const [state, setState] = useState<VoiceState>("idle");
  const [duration, setDuration] = useState(0);
  const recordingStateRef = useRef<VoiceState>("idle");

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletBlobUrlRef = useRef<string | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const speechFramesRef = useRef(0);
  const silenceFramesRef = useRef(0);
  const silenceMsRef = useRef(0);
  const peakRmsRef = useRef(0);
  const rmsAccRef = useRef(0);
  const frameCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Half-duplex echo-loop gate: block mic capture while TTS is playing.
  const TTS_TAIL_GUARD_MS = 300;
  const ttsSpeakingRef = useRef(false);
  const ttsEndedAtRef = useRef<number>(0);

  useEffect(() => {
    return onTtsStateChange((speaking) => {
      ttsSpeakingRef.current = speaking;
      if (!speaking) ttsEndedAtRef.current = Date.now();
    });
  }, []);

  const setVoiceState = useCallback((next: VoiceState) => {
    recordingStateRef.current = next;
    setState(next);
  }, []);

  const autoStopCallbackRef = useRef<(() => void) | null>(null);

  const trackFrame = useCallback((frame: Float32Array) => {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    if (rms > peakRmsRef.current) peakRmsRef.current = rms;
    rmsAccRef.current += rms;
    frameCountRef.current++;
    const frameDurationMs = (frame.length / (contextRef.current?.sampleRate ?? 16000)) * 1000;
    if (rms > vadThreshold) {
      speechFramesRef.current++;
      silenceMsRef.current = 0;
    } else {
      silenceFramesRef.current++;
      silenceMsRef.current += frameDurationMs;
    }
    // Throttled level log (~every 500ms at ~30 fps = every 15 frames)
    if (frameCountRef.current % 15 === 0) {
      console.log('[useVoice] level', {
        rms: rms.toFixed(4),
        peak: peakRmsRef.current.toFixed(4),
        speechFrames: speechFramesRef.current,
        silenceFrames: silenceFramesRef.current,
      });
    }
    // Auto-stop on silence
    const wallMs = Date.now() - startTimeRef.current;
    if (
      silenceMsRef.current >= SILENCE_AUTO_STOP_MS &&
      speechFramesRef.current >= MIN_SPEECH_FRAMES &&
      wallMs >= MIN_RECORDING_MS
    ) {
      console.log('[useVoice] auto-stop on silence', { silenceMs: silenceMsRef.current, speechFrames: speechFramesRef.current });
      autoStopCallbackRef.current?.();
    }
  }, [vadThreshold]);

  const stopAudioCapture = useCallback(() => {
    autoStopCallbackRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
    if (noSpeechTimerRef.current) { clearTimeout(noSpeechTimerRef.current); noSpeechTimerRef.current = null; }
    workletNodeRef.current?.disconnect();
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    contextRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (workletBlobUrlRef.current) {
      URL.revokeObjectURL(workletBlobUrlRef.current);
      workletBlobUrlRef.current = null;
    }
    workletNodeRef.current = null;
    processorRef.current = null;
    sourceRef.current = null;
    contextRef.current = null;
    streamRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    if (state !== "idle") return;
    // Half-duplex gate: block new recording while TTS is genuinely playing.
    // We trust the gate at start time only; once recording, do NOT drop frames
    // mid-stream (the input device's echoCancellation handles loopback). Dropping
    // mid-recording was the root cause of "stuck mic" when TTS state got latched.
    if (ttsSpeakingRef.current) {
      // Defensive: if a stuck-true state is older than the watchdog, force reset
      // and proceed. This is a best-effort recovery on user-initiated record.
      const stuckMs = Date.now() - ttsEndedAtRef.current;
      if (stuckMs > 3000) {
        console.warn("[useVoice] TTS state appears stuck — forcing reset");
        forceTtsStateReset();
        ttsSpeakingRef.current = false;
      } else {
        return;
      }
    }
    if (Date.now() - ttsEndedAtRef.current < TTS_TAIL_GUARD_MS) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      console.log('[useVoice] mic opened', {
        sampleRate: audioCtx.sampleRate,
        track: stream.getAudioTracks()[0]?.label,
        settings: stream.getAudioTracks()[0]?.getSettings(),
      });
      const source = audioCtx.createMediaStreamSource(stream);

      chunksRef.current = [];
      speechFramesRef.current = 0;
      silenceFramesRef.current = 0;
      silenceMsRef.current = 0;
      peakRmsRef.current = 0;
      rmsAccRef.current = 0;
      frameCountRef.current = 0;

      streamRef.current = stream;
      contextRef.current = audioCtx;
      sourceRef.current = source;

      let useWorklet = false;
      try {
        const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);
        workletBlobUrlRef.current = blobUrl;
        await audioCtx.audioWorklet.addModule(blobUrl);
        const workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");
        workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
          // Mid-recording: do NOT drop frames based on TTS state. Hardware echo
          // cancellation handles loopback; dropping here used to silently swallow
          // user audio when TTS state got latched at true.
          chunksRef.current.push(e.data);
          trackFrame(e.data);
        };
        source.connect(workletNode);
        workletNodeRef.current = workletNode;
        useWorklet = true;
      } catch (err: any) {
        console.warn("[useVoice] AudioWorklet unavailable, falling back to ScriptProcessor:", err.message);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
          // Mid-recording: never drop frames — see worklet comment above.
          const frame = new Float32Array(e.inputBuffer.getChannelData(0));
          chunksRef.current.push(frame);
          trackFrame(frame);
        };
        source.connect(processor);
        processor.connect(audioCtx.destination);
        processorRef.current = processor;
      }

      startTimeRef.current = Date.now();
      autoStopCallbackRef.current = () => { void stopRecording(true); };
      setVoiceState("recording");
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration(Date.now() - startTimeRef.current);
      }, 100);

      maxTimerRef.current = setTimeout(() => {
        void stopRecording(true);
      }, MAX_DURATION_MS);

      // No-speech guard: if user never speaks within NO_SPEECH_TIMEOUT_MS, bail silently.
      noSpeechTimerRef.current = setTimeout(() => {
        if (speechFramesRef.current < MIN_SPEECH_FRAMES) {
          console.log('[useVoice] no-speech timeout — closing mic');
          stopAudioCapture();
          chunksRef.current = [];
          setVoiceState("idle");
          setDuration(0);
          options.onNoSpeech?.();
        }
      }, NO_SPEECH_TIMEOUT_MS);

      void useWorklet; // suppress unused warning
    } catch (err: any) {
      options.onError?.(`Microphone access denied: ${err.message}`);
    }
  }, [state, MAX_DURATION_MS, NO_SPEECH_TIMEOUT_MS, setVoiceState, trackFrame, stopAudioCapture, options]);

  const stopRecording = useCallback(async (skipDrain = false) => {
    if (recordingStateRef.current !== "recording") return;
    // Drain 400ms more audio before stopping to avoid tail truncation on manual stop
    if (!skipDrain) {
      await new Promise<void>(resolve => setTimeout(resolve, 400));
      if (recordingStateRef.current !== "recording") return; // may have been cancelled
    }
    const durationMs = Date.now() - startTimeRef.current;
    stopAudioCapture();

    const chunks = chunksRef.current;
    if (chunks.length === 0) {
      setVoiceState("idle");
      setDuration(0);
      options.onError?.("No audio recorded");
      return;
    }

    // Merge chunks
    const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0);
    const SAMPLE_RATE = 16000;
    const paddingSamples = Math.floor(0.8 * SAMPLE_RATE);
    const merged = new Float32Array(totalSamples + paddingSamples);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    // trailing paddingSamples remain zero (silence padding)

    const peakRms = peakRmsRef.current;
    const avgRms = frameCountRef.current > 0 ? rmsAccRef.current / frameCountRef.current : 0;
    const speechFrames = speechFramesRef.current;
    const silenceFrames = silenceFramesRef.current;

    console.info("[useVoice] stats", { durationMs, totalSamples, peakRms, avgRms, speechFrames, silenceFrames });

    // VAD guard
    if (speechFrames < MIN_SPEECH_FRAMES || peakRms < PEAK_RMS_FLOOR) {
      options.onError?.(
        `STT_NO_SPEECH: microphone captured only silence (peakRms=${peakRms.toFixed(4)}, speechFrames=${speechFrames})`
      );
      setVoiceState("idle");
      setDuration(0);
      return;
    }

    setVoiceState("transcribing");

    try {
      const wavBlob = encodeWav(merged, 16000);
      const base64 = await blobToBase64(wavBlob);
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

  const onTranscriptReceived = useCallback((text: string) => {
    setVoiceState("idle");
    setDuration(0);
    options.onTranscript?.(text);
  }, [options, setVoiceState]);

  const onTranscriptError = useCallback((error: string) => {
    setVoiceState("idle");
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
