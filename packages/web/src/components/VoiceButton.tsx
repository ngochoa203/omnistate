import type { VoiceState } from "../hooks/useVoice";

interface VoiceButtonProps {
  state: VoiceState;
  duration: number;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function VoiceButton({ state, duration, onStart, onStop, onCancel, disabled }: VoiceButtonProps) {
  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  if (state === "transcribing") {
    return (
      <button
        disabled
        className="relative flex items-center justify-center w-12 h-12 rounded-xl bg-amber-500/20 text-amber-400 cursor-wait"
        title="Transcribing..."
      >
        <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
        </svg>
      </button>
    );
  }

  if (state === "recording") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-red-400 font-mono tabular-nums min-w-[3ch]">
          {formatDuration(duration)}
        </span>
        <button
          onClick={onCancel}
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-bg-tertiary hover:bg-bg-hover text-text-muted transition-colors"
          title="Cancel"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <button
          onClick={onStop}
          className="voice-recording relative flex items-center justify-center w-12 h-12 rounded-xl bg-red-500 hover:bg-red-600 text-white transition-colors"
          title="Stop recording"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      </div>
    );
  }

  // Idle state
  return (
    <button
      onClick={onStart}
      disabled={disabled}
      className="flex items-center justify-center w-12 h-12 rounded-xl bg-bg-tertiary hover:bg-bg-hover text-text-secondary hover:text-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      title="Record voice command"
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <line x1="12" y1="17" x2="12" y2="22" />
        <line x1="8" y1="22" x2="16" y2="22" />
      </svg>
    </button>
  );
}
