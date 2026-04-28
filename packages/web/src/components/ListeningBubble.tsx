import { useMemo } from "react";
import { useVoiceSession, type GatewayVoiceState } from "../hooks/useVoiceSession";

const LABELS: Record<GatewayVoiceState, string> = {
  idle: "Voice idle",
  "wake-listening": "Listening for wake word",
  "wake-detected": "Wake word detected",
  recording: "Recording",
  transcribing: "Transcribing",
  thinking: "Thinking",
  executing: "Executing",
  speaking: "Speaking",
  interrupted: "Interrupted",
  error: "Voice error",
};

const CANCEL_STATES = new Set<GatewayVoiceState>(["recording", "transcribing", "thinking", "executing", "speaking"]);

function Waveform({ active }: { active: boolean }) {
  return (
    <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 3, height: 22 }}>
      {Array.from({ length: 7 }).map((_, index) => (
        <span
          key={index}
          className={active ? "voice-bar" : undefined}
          style={{
            width: 3,
            height: active ? undefined : 5,
            minHeight: 5,
            borderRadius: 3,
            background: active ? "linear-gradient(to top, #6366f1, #22d3ee)" : "rgba(255,255,255,0.18)",
            animation: active ? `voice-wave-${(index % 5) + 1} ${0.55 + index * 0.04}s ${index * 0.06}s ease-in-out infinite` : "none",
          }}
        />
      ))}
    </div>
  );
}

export function ListeningBubble({ onCancelRecording }: { onCancelRecording?: () => void }) {
  const session = useVoiceSession();
  const isVisible = session.state !== "idle" || Boolean(session.partialTranscript || session.transcript || session.error);
  const label = LABELS[session.state];
  const detail = session.error || session.partialTranscript || session.transcript;
  const canCancel = CANCEL_STATES.has(session.state);

  const borderColor = useMemo(() => {
    if (session.state === "error") return "rgba(239,68,68,0.45)";
    if (session.state === "interrupted") return "rgba(245,158,11,0.4)";
    return "rgba(99,102,241,0.35)";
  }, [session.state]);

  if (!isVisible) {
    return (
      <div
        aria-label="Voice idle"
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          zIndex: 30,
          width: 12,
          height: 12,
          borderRadius: 999,
          background: "rgba(99,102,241,0.45)",
          boxShadow: "0 0 18px rgba(99,102,241,0.35)",
        }}
      />
    );
  }

  return (
    <section
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 30,
        width: 320,
        maxWidth: "calc(100vw - 40px)",
        borderRadius: 18,
        border: `1px solid ${borderColor}`,
        background: "rgba(8,8,14,0.92)",
        backdropFilter: "blur(18px)",
        boxShadow: "0 16px 42px rgba(0,0,0,0.35)",
        padding: 14,
        color: "var(--color-text-primary)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(99,102,241,0.14)", flexShrink: 0 }}>
          <Waveform active={["wake-detected", "recording", "speaking"].includes(session.state)} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "white" }}>{label}</div>
          <div style={{ fontSize: "0.72rem", color: session.state === "error" ? "#f87171" : "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
            {detail || (session.state === "executing" ? "Task is running" : "Voice workflow active")}
          </div>
        </div>
        {canCancel && (
          <button
            type="button"
            onClick={session.state === "recording" ? onCancelRecording : session.cancel}
            aria-label="Cancel voice session"
            title="Cancel voice session"
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.06)",
              color: "white",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        )}
      </div>
    </section>
  );
}
