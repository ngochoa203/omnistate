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
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  };

  if (state === "transcribing") {
    return (
      <button
        disabled
        title="Transcribing..."
        style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)",
          color: "#f59e0b", cursor: "wait",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 15" strokeLinecap="round" />
        </svg>
      </button>
    );
  }

  if (state === "recording") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: "0.7rem", fontFamily: "monospace", color: "#ef4444", fontWeight: 700, minWidth: "2.5rem" }}>
          {formatDuration(duration)}
        </span>
        <button
          onClick={onCancel}
          title="Cancel"
          style={{
            width: 30, height: 30, borderRadius: 8,
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            color: "var(--color-text-muted)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
        <button
          onClick={onStop}
          title="Stop and transcribe"
          style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: "linear-gradient(135deg, #ef4444, #f43f5e)",
            border: "none", color: "white", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 16px rgba(239,68,68,0.4)",
            animation: "glow-pulse 1.5s ease-in-out infinite",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onStart}
      disabled={disabled}
      title="Record voice command"
      style={{
        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
        background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
        color: "var(--color-text-muted)", cursor: disabled ? "not-allowed" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.2s", opacity: disabled ? 0.3 : 1,
      }}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.background = "rgba(99,102,241,0.15)";
          e.currentTarget.style.borderColor = "rgba(99,102,241,0.4)";
          e.currentTarget.style.color = "#6366f1";
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "rgba(255,255,255,0.05)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)";
        e.currentTarget.style.color = "var(--color-text-muted)";
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <line x1="12" y1="17" x2="12" y2="22" />
        <line x1="8" y1="22" x2="16" y2="22" />
      </svg>
    </button>
  );
}
