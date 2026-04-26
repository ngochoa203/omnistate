import { useState, useRef, useCallback } from "react";
import {
  useVoiceEnrollment,
  startMediaRecording,
  type RecordingHandle,
} from "../hooks/useVoiceEnrollment";

// ─── Phrases (fixed per design doc §2) ───────────────────────────────────────

const PHRASES = [
  "Trợ lý, hãy bắt đầu phiên làm việc hôm nay",
  "Tôi cần bạn tìm kiếm thông tin cho tôi",
  "Hãy đọc lại nội dung vừa nhận được",
  "Hey assistant, open my task list",
  "Read the last message out loud",
] as const;

const TOTAL_STEPS = PHRASES.length;

// ─── Props ────────────────────────────────────────────────────────────────────

interface VoiceEnrollmentProps {
  userId: string;
  onComplete?: (sampleCount: number) => void;
  onCancel?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VoiceEnrollment({ userId, onComplete, onCancel }: VoiceEnrollmentProps) {
  const {
    step,
    status,
    error,
    sampleCount,
    startEnrollment,
    submitSample,
    cancelEnrollment,
    finalize,
  } = useVoiceEnrollment();

  const [isRecording, setIsRecording] = useState(false);
  const recordingHandleRef = useRef<RecordingHandle | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);

  // Use phrase from local const (design doc §2) — server prompt is advisory
  const phraseIndex = Math.min(step, TOTAL_STEPS - 1);
  const currentPhrase = PHRASES[phraseIndex];

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    startEnrollment(userId);
  }, [startEnrollment, userId]);

  const handleRecordStart = useCallback(async () => {
    setRecordError(null);
    setIsRecording(true);
    const handle = await startMediaRecording(
      async (blob) => {
        setIsRecording(false);
        recordingHandleRef.current = null;
        await submitSample(blob);
      },
      (err) => {
        setIsRecording(false);
        recordingHandleRef.current = null;
        setRecordError(err);
      }
    );
    recordingHandleRef.current = handle;
  }, [submitSample]);

  const handleRecordStop = useCallback(() => {
    recordingHandleRef.current?.stop();
  }, []);

  const handleCancel = useCallback(() => {
    recordingHandleRef.current?.stop();
    cancelEnrollment();
    onCancel?.();
  }, [cancelEnrollment, onCancel]);

  const handleFinalize = useCallback(() => {
    finalize();
  }, [finalize]);

  const handleRetry = useCallback(() => {
    setRecordError(null);
  }, []);

  // ── After last sample accepted → auto-finalize ─────────────────────────────
  // step advances to TOTAL_STEPS after last accepted sample
  const shouldFinalize = status === "idle" && step >= TOTAL_STEPS;

  // ── Render: Done ──────────────────────────────────────────────────────────
  if (status === "done") {
    onComplete?.(sampleCount);
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <div className="text-4xl">✅</div>
        <h2 className="text-xl font-semibold text-green-600">Enrollment Complete</h2>
        <p className="text-sm text-gray-500">{sampleCount} voice samples recorded.</p>
      </div>
    );
  }

  // ── Render: Not started ───────────────────────────────────────────────────
  if (status === "idle" && step === 0 && !shouldFinalize) {
    return (
      <div className="flex flex-col items-center gap-6 p-8">
        <h2 className="text-lg font-semibold">Voice Enrollment</h2>
        <p className="text-sm text-gray-500 text-center max-w-sm">
          You will read {TOTAL_STEPS} short phrases aloud. This creates a voice profile
          so the assistant can recognise your voice.
        </p>
        <button
          onClick={handleStart}
          className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
        >
          Begin Enrollment
        </button>
        <button
          onClick={handleCancel}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── Render: Finalize prompt ───────────────────────────────────────────────
  if (shouldFinalize) {
    return (
      <div className="flex flex-col items-center gap-6 p-8 text-center">
        <div className="text-4xl">🎙️</div>
        <h2 className="text-lg font-semibold">All phrases recorded!</h2>
        <p className="text-sm text-gray-500">Save your voice profile?</p>
        <button
          onClick={handleFinalize}
          className="px-6 py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors"
        >
          Save Profile
        </button>
        <button
          onClick={handleCancel}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── Render: Error ─────────────────────────────────────────────────────────
  const displayError = error ?? recordError;
  if (status === "error" || displayError) {
    return (
      <div className="flex flex-col items-center gap-6 p-8 text-center">
        <div className="text-4xl">⚠️</div>
        <p className="text-sm text-red-600 max-w-sm">{displayError}</p>
        <button
          onClick={handleRetry}
          className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
        <button
          onClick={handleCancel}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── Render: Recording step ────────────────────────────────────────────────
  const isWaiting = status === "waiting" || status === "sending";

  return (
    <div className="flex flex-col items-center gap-6 p-8 select-none">
      {/* Progress dots */}
      <div className="flex gap-2">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            className={[
              "w-3 h-3 rounded-full transition-colors",
              i < phraseIndex
                ? "bg-green-500"
                : i === phraseIndex
                ? "bg-blue-500"
                : "bg-gray-200",
            ].join(" ")}
          />
        ))}
      </div>

      {/* Step counter */}
      <p className="text-xs text-gray-400 uppercase tracking-wide">
        Phrase {phraseIndex + 1} of {TOTAL_STEPS}
      </p>

      {/* Current phrase */}
      <div className="bg-gray-50 rounded-xl px-6 py-4 max-w-sm text-center">
        <p className="text-base font-medium text-gray-800">{currentPhrase}</p>
      </div>

      {/* Record button */}
      <button
        onMouseDown={handleRecordStart}
        onMouseUp={handleRecordStop}
        onTouchStart={handleRecordStart}
        onTouchEnd={handleRecordStop}
        disabled={isWaiting}
        className={[
          "w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl shadow-md transition-all",
          isRecording
            ? "bg-red-500 scale-110 animate-pulse"
            : isWaiting
            ? "bg-gray-300 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700 active:scale-95",
        ].join(" ")}
        aria-label={isRecording ? "Stop recording" : "Hold to record"}
      >
        {isWaiting ? "⏳" : isRecording ? "⏹" : "🎙️"}
      </button>

      <p className="text-xs text-gray-400">
        {isWaiting
          ? "Processing…"
          : isRecording
          ? "Recording — release to submit"
          : "Hold to record"}
      </p>

      {/* Cancel */}
      <button
        onClick={handleCancel}
        className="text-sm text-gray-400 hover:text-gray-600 transition-colors mt-2"
      >
        Cancel enrollment
      </button>
    </div>
  );
}
