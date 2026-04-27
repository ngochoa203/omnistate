import { useState, useRef, useCallback, useEffect, type DragEvent } from "react";
import { useVoice } from "../hooks/useVoice";
import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";
import { onTtsEnd } from "../lib/tts";

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------
const LS_AUTO_SEND = "omnistate.voice.autoSend";
const LS_AUTO_EXECUTE = "omnistate.voice.autoExecute";
const LS_WAKE_LOCAL = "omnistate.voice.wakeListenerLocal";

function lsGet(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "true";
  } catch { return fallback; }
}
function lsSet(key: string, val: boolean) {
  try { localStorage.setItem(key, String(val)); } catch { /* ignore */ }
}

type VoiceTab = "input" | "train" | "settings";

function WaveVisualizer({ active }: { active: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 4,
      height: 40, padding: "0 8px",
    }}>
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 3,
            height: active ? undefined : 6,
            minHeight: 4,
            borderRadius: 2,
            background: active
              ? `linear-gradient(to top, #6366f1, #22d3ee)`
              : "rgba(255,255,255,0.1)",
            animation: active ? `voice-wave-${(i % 5) + 1} ${0.5 + i * 0.05}s ${i * 0.08}s ease-in-out infinite` : "none",
          }}
          className={active ? "voice-bar" : ""}
        />
      ))}
    </div>
  );
}

function VoiceMicButton({
  state, onStart, onStop, onCancel, disabled, isVi
}: {
  state: "idle" | "recording" | "transcribing";
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  disabled?: boolean;
  isVi: boolean;
}) {
  const isRecording = state === "recording";
  const isTranscribing = state === "transcribing";

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {isRecording && (
        <>
          <div className="voice-ring-outer" />
          <div className="voice-ring-outer-2" />
        </>
      )}
      <button
        onClick={isRecording ? onStop : isTranscribing ? undefined : onStart}
        disabled={disabled || isTranscribing}
        style={{
          width: 80, height: 80, borderRadius: "50%",
          border: "none", cursor: isTranscribing ? "wait" : disabled ? "not-allowed" : "pointer",
          background: isRecording
            ? "linear-gradient(135deg, #ef4444, #f43f5e)"
            : isTranscribing
            ? "linear-gradient(135deg, #f59e0b, #f97316)"
            : "linear-gradient(135deg, #6366f1, #7c3aed)",
          boxShadow: isRecording
            ? "0 0 32px rgba(239,68,68,0.5)"
            : isTranscribing
            ? "0 0 32px rgba(245,158,11,0.4)"
            : "0 0 32px rgba(99,102,241,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.2s",
          position: "relative", zIndex: 2,
          opacity: disabled && !isRecording ? 0.4 : 1,
          transform: isRecording ? "scale(1.05)" : "scale(1)",
        }}
      >
        {isTranscribing ? (
          <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
          </svg>
        ) : isRecording ? (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <line x1="12" y1="17" x2="12" y2="22" />
            <line x1="8" y1="22" x2="16" y2="22" />
          </svg>
        )}
      </button>
      {isRecording && (
        <button
          onClick={onCancel}
          style={{
            position: "absolute", top: -8, right: -8, zIndex: 3,
            width: 24, height: 24, borderRadius: "50%",
            background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
            color: "white", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12,
          }}
          title={isVi ? "Huỷ" : "Cancel"}
        >✕</button>
      )}
    </div>
  );
}

function VoiceInputTab({ isVi }: { isVi: boolean }) {
  // ---------------------------------------------------------------------------
  // Persisted toggles
  // ---------------------------------------------------------------------------
  const [autoSend, setAutoSendState] = useState(() => lsGet(LS_AUTO_SEND, true));
  const [autoExecute, setAutoExecuteState] = useState(() => lsGet(LS_AUTO_EXECUTE, true));
  const [wakeListenerLocal, setWakeListenerLocalState] = useState(() => lsGet(LS_WAKE_LOCAL, true));

  const setAutoSend = (v: boolean) => { setAutoSendState(v); lsSet(LS_AUTO_SEND, v); };
  const setAutoExecute = (v: boolean) => { setAutoExecuteState(v); lsSet(LS_AUTO_EXECUTE, v); };
  const setWakeListenerLocal = (v: boolean) => {
    setWakeListenerLocalState(v);
    lsSet(LS_WAKE_LOCAL, v);
    // Inform gateway
    getClient().enableWakeListener(v);
  };

  // ---------------------------------------------------------------------------
  // Transcript accumulation (concat per-session, clear on mic-open)
  // ---------------------------------------------------------------------------
  const [transcript, setTranscript] = useState("");
  const sessionTranscriptRef = useRef("");

  // ---------------------------------------------------------------------------
  // Mic visibility (big visualizer vs. idle indicator)
  // ---------------------------------------------------------------------------
  const [micVisible, setMicVisible] = useState(false);

  // Track whether last mic-open was from wake event vs. manual
  const fromWakeRef = useRef(false);

  const connectionState = useChatStore((s) => s.connectionState);
  const rearmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskDispatchedRef = useRef(false);

  const voice = useVoice({
    silenceMs: 5000,
    noSpeechMs: 5000,
    maxMs: 25000,
    sendAudio: (base64) => {
      useChatStore.getState().setVoiceState("transcribing");
      getClient().sendVoice(base64);
    },
    onTranscript: (text, meta?: { confidence?: number }) => {
      // Accumulate within the session
      const sep = sessionTranscriptRef.current ? " " : "";
      sessionTranscriptRef.current += sep + text;
      setTranscript(sessionTranscriptRef.current);

      useChatStore.getState().setVoiceState("idle");

      const full = sessionTranscriptRef.current.trim();
      if (autoSend && full) {
        const LOW_CONFIDENCE = ["[unintelligible]", "[inaudible]", "..."];
        const isGibberish =
          full.split(/\s+/).filter(Boolean).length < 2 ||
          LOW_CONFIDENCE.includes(full.toLowerCase()) ||
          /^[\s\p{P}]+$/u.test(full) ||
          (meta?.confidence !== undefined && meta.confidence < 0.5);
        if (isGibberish) {
          useChatStore.getState().addSystemMessage("Mình nghe chưa rõ, bạn nói lại giúp nhé");
          return;
        }
        useChatStore.getState().addUserMessage(full);
        const shouldAutoExecute = autoExecute || fromWakeRef.current;
        if (shouldAutoExecute) {
          // Auto-execute: fire the task immediately
          getClient().sendTask(full);
          taskDispatchedRef.current = true;
        } else {
          taskDispatchedRef.current = false;
        }
        fromWakeRef.current = false;
        // If !autoExecute, transcript is in the box for user to confirm via Send button
        sessionTranscriptRef.current = "";
      }
    },
    onNoSpeech: () => {
      // No speech detected for 5 s — hide the big mic UI
      setMicVisible(false);
      fromWakeRef.current = false;
    },
    onError: (error) => {
      useChatStore.getState().setVoiceState("idle");
      useChatStore.getState().addSystemMessage(`${isVi ? "Lỗi voice" : "Voice error"}: ${error}`);
    },
  });

  // ---------------------------------------------------------------------------
  // Enable wake listener on mount (if toggle is on)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (wakeListenerLocal) {
      getClient().enableWakeListener(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Listen for voice.wake WS events → show UI + start recording
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const unsub = getClient().on("voice.wake", () => {
      if (!wakeListenerLocal) return;
      fromWakeRef.current = true;
      setMicVisible(true);
      sessionTranscriptRef.current = "";
      setTranscript("");
      void voice.startRecording();
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeListenerLocal]);

  // ---------------------------------------------------------------------------
  // Bridge WS transcript/error events into useVoice callbacks
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const offTranscript = getClient().on("voice.transcript", (msg: any) => {
      if (msg?.type !== "voice.transcript") return;
      const text = typeof msg.text === "string" ? msg.text : "";
      voice.onTranscriptReceived(text);
    });

    const offError = getClient().on("voice.error", (msg: any) => {
      if (msg?.type !== "voice.error") return;
      const error = typeof msg.error === "string" ? msg.error : "Unknown voice error";
      voice.onTranscriptError(error);
    });

    return () => {
      offTranscript();
      offError();
    };
  }, [voice]);

  // ---------------------------------------------------------------------------
  // Re-arm mic 400 ms after TTS ends OR after assistant message arrives (no TTS)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    onTtsEnd(() => {
      if (!taskDispatchedRef.current) return;
      taskDispatchedRef.current = false;
      rearmTimerRef.current = setTimeout(() => {
        setMicVisible(true);
        sessionTranscriptRef.current = "";
        setTranscript("");
        void voice.startRecording();
      }, 400);
    });
    return () => {
      onTtsEnd(null);
      if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Re-arm when assistant message arrives (TTS disabled path)
  // ---------------------------------------------------------------------------
  const ttsEnabled = useChatStore((s) => s.ttsEnabled);
  useEffect(() => {
    if (ttsEnabled) return; // handled by onTtsEnd branch above
    const unsub = useChatStore.subscribe((state, prev) => {
      const msgs = state.messages;
      const prevMsgs = prev.messages;
      if (msgs.length > prevMsgs.length && taskDispatchedRef.current) {
        const last = msgs[msgs.length - 1];
        if (last?.role === "system") {
          taskDispatchedRef.current = false;
          rearmTimerRef.current = setTimeout(() => {
            setMicVisible(true);
            sessionTranscriptRef.current = "";
            setTranscript("");
            void voice.startRecording();
          }, 400);
        }
      }
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsEnabled]);

  // ---------------------------------------------------------------------------
  // Local duration display
  // ---------------------------------------------------------------------------
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (voice.state === "recording") {
      startRef.current = Date.now();
      timerRef.current = setInterval(() => setDuration(Date.now() - startRef.current), 100);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setDuration(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [voice.state]);

  const formatDur = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  };

  // ---------------------------------------------------------------------------
  // Manual mic button open — always shows visualizer
  // ---------------------------------------------------------------------------
  const handleManualStart = useCallback(() => {
    fromWakeRef.current = false;
    setMicVisible(true);
    sessionTranscriptRef.current = "";
    setTranscript("");
    void voice.startRecording();
  }, [voice]);

  const sendTranscript = () => {
    if (!transcript.trim()) return;
    useChatStore.getState().addUserMessage(transcript);
    if (autoExecute) {
      getClient().sendTask(transcript);
      taskDispatchedRef.current = true;
    } else {
      taskDispatchedRef.current = false;
    }
    setTranscript("");
    sessionTranscriptRef.current = "";
  };

  const isConnected = connectionState === "connected";

  // Big visualizer is shown when micVisible OR actively recording/transcribing
  const showBigUI = micVisible || voice.state === "recording" || voice.state === "transcribing";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32, padding: "32px 24px" }}>
      {/* Status label */}
      <div style={{ textAlign: "center" }}>
        <div style={{
          fontSize: "1rem", fontWeight: 600, marginBottom: 6,
          color: voice.state === "recording" ? "#f43f5e"
            : voice.state === "transcribing" ? "#f59e0b"
            : "var(--color-text-secondary)"
        }}>
          {voice.state === "recording"
            ? (isVi ? "🔴 Đang ghi âm..." : "🔴 Recording...")
            : voice.state === "transcribing"
              ? (isVi ? "⏳ Đang chuyển giọng nói thành chữ..." : "⏳ Transcribing...")
              : showBigUI
                ? (isVi ? "🎙️ Sẵn sàng — hãy nói..." : "🎙️ Ready — speak now...")
                : (isVi ? "Sẵn sàng lắng nghe" : "Ready to listen")}
        </div>
        {voice.state === "recording" && (
          <div style={{ fontFamily: "monospace", fontSize: "1.5rem", color: "#f43f5e", fontWeight: 700 }}>
            {formatDur(duration)}
          </div>
        )}
        {voice.state === "idle" && !showBigUI && (
          <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
            {isConnected
              ? (isVi ? "Bấm mic hoặc dùng wake word để nói" : "Click the mic or use wake word to speak")
              : (isVi ? "⚠️ Hãy kết nối gateway trước" : "⚠️ Connect to gateway first")}
          </div>
        )}
      </div>

      {/* Waveform + mic button — shown only when micVisible */}
      {showBigUI ? (
        <>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 0, height: 60, padding: "0 16px",
            background: "rgba(255,255,255,0.03)", borderRadius: 30,
            border: "1px solid rgba(255,255,255,0.06)", minWidth: 240,
          }}>
            <WaveVisualizer active={voice.state === "recording"} />
          </div>

          <VoiceMicButton
            state={voice.state}
            onStart={handleManualStart}
            onStop={voice.stopRecording}
            onCancel={() => { voice.cancel(); setMicVisible(false); }}
            disabled={!isConnected}
            isVi={isVi}
          />

          <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", textAlign: "center" }}>
            {voice.state === "recording"
              ? (isVi ? "Bấm để dừng và chuyển thành chữ" : "Click to stop and transcribe")
              : (isVi ? "Bấm để bắt đầu ghi âm" : "Click to start recording")}
          </div>
        </>
      ) : (
        /* Small idle indicator */
        <button
          onClick={handleManualStart}
          disabled={!isConnected}
          title={isVi ? "Bấm để nói" : "Click to speak"}
          style={{
            width: 48, height: 48, borderRadius: "50%",
            border: "1px solid rgba(99,102,241,0.3)",
            background: "rgba(99,102,241,0.08)",
            cursor: isConnected ? "pointer" : "not-allowed",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "rgba(99,102,241,0.8)", fontSize: 20,
            opacity: isConnected ? 1 : 0.4,
          }}
        >
          🎙️
        </button>
      )}

      {/* Transcript area */}
      {(transcript || voice.state !== "idle") && (
        <div className="animate-fade-in" style={{ width: "100%", maxWidth: 480 }}>
          <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
            {isVi ? "Bản ghi" : "Transcript"}
          </div>
          <div style={{
            background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)",
            borderRadius: 12, padding: "14px 16px", minHeight: 60,
            fontSize: "0.9rem", color: "var(--color-text-primary)", lineHeight: 1.6,
          }}>
            {transcript || <span style={{ color: "var(--color-text-muted)" }}>{isVi ? "Đang chờ bản ghi..." : "Waiting for transcription..."}</span>}
          </div>
          {transcript && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {autoExecute ? (
                <button className="btn-primary" style={{ flex: 1 }} onClick={sendTranscript}>
                  {isVi ? "Thực thi tác vụ" : "Execute Task"}
                </button>
              ) : (
                <button className="btn-primary" style={{ flex: 1 }} onClick={sendTranscript}>
                  {isVi ? "Gửi để xác nhận" : "Send for Confirmation"}
                </button>
              )}
              <button className="btn-ghost" onClick={() => { setTranscript(""); sessionTranscriptRef.current = ""; }} style={{ padding: "10px 16px" }}>
                {isVi ? "Xoá" : "Clear"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Toggles */}
      <div style={{ width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Auto-Send toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div>
            <div style={{ fontSize: "0.875rem", color: "var(--color-text-primary)", fontWeight: 500 }}>
              {isVi ? "Tự động gửi bản ghi" : "Auto-Send Transcript"}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
              {isVi ? "Gửi bản ghi ngay sau khi nhận được" : "Send transcript as soon as it arrives"}
            </div>
          </div>
          <button onClick={() => setAutoSend(!autoSend)} className={`toggle ${autoSend ? "on" : ""}`}>
            <div className="toggle-knob" />
          </button>
        </div>

        {/* Auto-Execute toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div>
            <div style={{ fontSize: "0.875rem", color: "var(--color-text-primary)", fontWeight: 500 }}>
              {isVi ? "Tự động thực thi tác vụ" : "Auto-Execute Task"}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
              {isVi ? "Bật: gọi sendTask ngay. Tắt: chỉ đưa vào ô nhập để xác nhận" : "ON: call sendTask immediately. OFF: append to input for confirmation"}
            </div>
          </div>
          <button onClick={() => setAutoExecute(!autoExecute)} className={`toggle ${autoExecute ? "on" : ""}`}>
            <div className="toggle-knob" />
          </button>
        </div>

        {/* Wake Listener Local toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div>
            <div style={{ fontSize: "0.875rem", color: "var(--color-text-primary)", fontWeight: 500 }}>
              {isVi ? "Wake listener cục bộ" : "Wake Listener Local"}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
              {isVi ? "Nghe wake word nền, mở mic khi phát hiện. Giao diện chỉ hiện khi có wake." : "Background wake-word detection. UI appears only on wake event, not 24/7."}
            </div>
          </div>
          <button onClick={() => setWakeListenerLocal(!wakeListenerLocal)} className={`toggle ${wakeListenerLocal ? "on" : ""}`}>
            <div className="toggle-knob" />
          </button>
        </div>
      </div>
    </div>
  );
}

function VoiceTrainTab({ isVi }: { isVi: boolean }) {
  const [voiceUserId, setVoiceUserId] = useState("owner");
  const [voiceDisplayName, setVoiceDisplayName] = useState("Owner");
  const [voiceThreshold, setVoiceThreshold] = useState("0.85");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceResult, setVoiceResult] = useState<null | { ok: boolean; data: unknown }>(null);
  const [currentPrompt, setCurrentPrompt] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<Array<{ prompt: string; file: File; durationMs: number; phrases: string[] }>>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);

  const prompts = isVi
    ? [
        "Xin chào OmniState, hôm nay tôi muốn kiểm tra trạng thái hệ thống.",
        "Mở trình duyệt và tìm kiếm từ khóa học máy trên Safari.",
        "Ghi nhớ vị trí tôi đã click và tóm tắt lại sau khi hoàn tất.",
        "Di chuyển chuột đến góc phải màn hình rồi nhấp đúp.",
      ]
    : [
        "Hello OmniState, today I want to check system status.",
        "Open the browser and search for machine learning on Safari.",
        "Remember where I clicked and summarize it after finishing.",
        "Move the mouse to the right corner and double-click.",
      ];

  const parsePhrases = useCallback((text: string): string[] => {
    return text
      .split(/[,.!?;:\n]/g)
      .map((x) => x.trim())
      .filter((x) => x.length >= 3)
      .slice(0, 6);
  }, []);

  const startRecordingPrompt = async () => {
    try {
      setVoiceResult(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      startTimeRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `voice-sample-${Date.now()}.webm`, { type: "audio/webm" });
        const prompt = prompts[currentPrompt];
        const durationMs = Date.now() - startTimeRef.current;
        const phrases = parsePhrases(prompt);

        setRecorded((prev) => {
          const next = prev.filter((x) => x.prompt !== prompt);
          return [...next, { prompt, file, durationMs, phrases }];
        });

        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };

      recorder.start();
      setRecording(true);
    } catch (err) {
      setVoiceResult({ ok: false, data: { error: err instanceof Error ? err.message : String(err) } });
    }
  };

  const stopRecordingPrompt = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const fileToBase64 = async (file: File): Promise<string> => {
    const buf = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
    }
    return btoa(binary);
  };

  const enrollFromLatestSample = async () => {
    if (recorded.length === 0) {
      setVoiceResult({ ok: false, data: { error: isVi ? "Bạn chưa có mẫu ghi âm nào." : "No recorded sample yet." } });
      return;
    }
    const latest = recorded[recorded.length - 1];
    const MIN_DURATION_MS = 1500;
    const MIN_BLOB_BYTES = 8 * 1024;
    if (latest.durationMs < MIN_DURATION_MS) {
      setVoiceResult({ ok: false, data: { error: isVi ? "Ghi âm quá ngắn (tối thiểu 1.5 giây)." : "Recording too short (minimum 1.5 s)." } });
      return;
    }
    if (latest.file.size < MIN_BLOB_BYTES) {
      setVoiceResult({ ok: false, data: { error: isVi ? "File âm thanh quá nhỏ (tối thiểu 8 KB)." : "Audio file too small (minimum 8 KB)." } });
      return;
    }
    try {
      setVoiceBusy(true);
      setVoiceResult(null);
      const audioBase64 = await fileToBase64(latest.file);
      const resp = await fetch("/api/voice/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: voiceUserId.trim() || "owner",
          displayName: voiceDisplayName.trim() || voiceUserId.trim() || "owner",
          threshold: Number(voiceThreshold) || 0.85,
          audioBase64,
          audioFormat: "webm",
          trainingPrompt: latest.prompt,
          trainingPhrases: latest.phrases,
        }),
      });
      const data = await resp.json();
      setVoiceResult({ ok: resp.ok, data });
    } catch (err) {
      setVoiceResult({ ok: false, data: { error: err instanceof Error ? err.message : String(err) } });
    } finally {
      setVoiceBusy(false);
    }
  };

  const recordedMap = new Map(recorded.map((x) => [x.prompt, x]));
  const doneCount = recorded.length;

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h3 style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 700, color: "white" }}>
          {isVi ? "Huấn luyện đọc theo câu mẫu" : "Guided Prompt Reading Training"}
        </h3>
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
          {isVi
            ? "Đọc lần lượt từng câu mẫu, hệ thống tách phrase để tạo dữ liệu huấn luyện giọng nói."
            : "Read prompts in sequence. The system extracts phrases for voice training metadata."}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{isVi ? "ID NGƯỜI NÓI" : "SPEAKER ID"}</span>
          <input className="omni-input" value={voiceUserId} onChange={(e) => setVoiceUserId(e.target.value)} placeholder={isVi ? "chu-so-huu" : "owner"} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{isVi ? "TÊN HIỂN THỊ" : "DISPLAY NAME"}</span>
          <input className="omni-input" value={voiceDisplayName} onChange={(e) => setVoiceDisplayName(e.target.value)} placeholder={isVi ? "Chủ sở hữu" : "Owner"} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{isVi ? "NGƯỠNG" : "THRESHOLD"}</span>
          <input className="omni-input" type="number" min="0" max="1" step="0.01" value={voiceThreshold} onChange={(e) => setVoiceThreshold(e.target.value)} />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>
        <span>{isVi ? `Tiến độ: ${doneCount}/${prompts.length} câu` : `Progress: ${doneCount}/${prompts.length} prompts`}</span>
        <div style={{ width: 220, height: 8, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{ width: `${(doneCount / prompts.length) * 100}%`, height: "100%", background: "linear-gradient(90deg,#22d3ee,#6366f1)" }} />
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {prompts.map((prompt, idx) => {
          const sample = recordedMap.get(prompt);
          const active = idx === currentPrompt;
          return (
            <button
              key={prompt}
              onClick={() => setCurrentPrompt(idx)}
              style={{
                textAlign: "left",
                padding: "12px 14px",
                borderRadius: 10,
                border: active ? "1px solid rgba(99,102,241,0.35)" : "1px solid rgba(255,255,255,0.07)",
                background: sample ? "rgba(34,197,94,0.08)" : active ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.03)",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", marginBottom: 4 }}>
                {isVi ? "Câu" : "Prompt"} {idx + 1} {sample ? (isVi ? "• Đã ghi" : "• Recorded") : ""}
              </div>
              <div style={{ fontSize: "0.82rem", color: "white" }}>{prompt}</div>
              {sample && (
                <div style={{ marginTop: 4, fontSize: "0.7rem", color: "var(--color-text-muted)" }}>
                  {isVi ? "Phrase:" : "Phrases:"} {sample.phrases.join(" | ")}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        {!recording ? (
          <button className="btn-primary" onClick={startRecordingPrompt} style={{ flex: 1 }}>
            {isVi ? "Bắt đầu ghi câu đang chọn" : "Record selected prompt"}
          </button>
        ) : (
          <button className="btn-primary" onClick={stopRecordingPrompt} style={{ flex: 1, background: "linear-gradient(135deg,#ef4444,#f43f5e)" }}>
            {isVi ? "Dừng ghi" : "Stop recording"}
          </button>
        )}
        <button className="btn-ghost" onClick={enrollFromLatestSample} disabled={voiceBusy || recorded.length === 0}>
          {voiceBusy ? (isVi ? "Đang đăng ký..." : "Enrolling...") : (isVi ? "Đăng ký mẫu mới nhất" : "Enroll latest sample")}
        </button>
      </div>

      {voiceResult && (
        <div className={`animate-fade-in ${voiceResult.ok ? "alert-info" : "alert-critical"}`} style={{ borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: 8, color: voiceResult.ok ? "#22d3ee" : "#f43f5e" }}>
            {voiceResult.ok ? (isVi ? "✅ Thành công" : "✅ Success") : (isVi ? "❌ Lỗi" : "❌ Error")}
          </div>
          <pre style={{ margin: 0, fontSize: "0.72rem", color: "var(--color-text-secondary)", fontFamily: "monospace", overflowX: "auto", lineHeight: 1.6 }}>
            {JSON.stringify(voiceResult.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function VoiceSettingsTab({ isVi }: { isVi: boolean }) {
  const ttsEnabled = useChatStore((s) => s.ttsEnabled);
  const setTtsEnabled = useChatStore((s) => s.setTtsEnabled);
  const runtimeConfig = useChatStore((s) => s.runtimeConfig) as {
    voice?: { sttProvider?: string; whisperLocalModel?: string };
  } | null;

  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [wakePhrase, setWakePhrase] = useState("hey omnistate");
  const [sttProvider, setSttProvider] = useState("whisper-local");
  const [cooldownMs, setCooldownMs] = useState("3000");

  // Sync sttProvider from runtimeConfig when it arrives
  useEffect(() => {
    const p = runtimeConfig?.voice?.sttProvider;
    if (p === "whisper-local" || p === "whisper-cloud" || p === "native") {
      setSttProvider(p);
    }
  }, [runtimeConfig]);

  const handleSttProviderChange = (val: string) => {
    setSttProvider(val);
    getClient().setRuntimeConfig("voice.sttProvider", val);
  };

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h3 style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 700, color: "white" }}>
          {isVi ? "Cài đặt voice" : "Voice Settings"}
        </h3>
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
          {isVi ? "Cấu hình wake word, engine STT và đầu ra TTS" : "Configure wake word, STT engine, and TTS output"}
        </p>
      </div>

      {/* TTS */}
      <div className="glow-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {isVi ? "Đầu ra" : "Output"}
          </div>
        </div>
        <div style={{ padding: "4px 0" }}>
          {[
            {
              label: isVi ? "Văn bản thành giọng nói" : "Text-to-Speech",
              sub: isVi ? "Đọc phản hồi AI bằng Web Speech API" : "Read AI responses aloud via Web Speech API",
              control: (
                <button onClick={() => setTtsEnabled(!ttsEnabled)} className={`toggle ${ttsEnabled ? "on" : ""}`}>
                  <div className="toggle-knob" />
                </button>
              )
            },
          ].map((row) => (
            <div key={row.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px" }}>
              <div>
                <div style={{ fontSize: "0.875rem", color: "var(--color-text-primary)", fontWeight: 500 }}>{row.label}</div>
                <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>{row.sub}</div>
              </div>
              {row.control}
            </div>
          ))}
        </div>
      </div>

      {/* STT Provider */}
      <div className="glow-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {isVi ? "Engine chuyển giọng nói thành chữ" : "Speech-to-Text Engine"}
          </div>
        </div>
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { val: "whisper-local", label: isVi ? "Whisper (Cục bộ)" : "Whisper (Local)", sub: isVi ? "Nhanh, riêng tư, chạy trên máy — mặc định" : "Fast, private, runs on-device — default", recommended: true },
            { val: "whisper-cloud", label: isVi ? "Whisper (Đám mây)" : "Whisper (Cloud)", sub: isVi ? "OpenAI API, cần API key" : "OpenAI API, requires key", recommended: false },
            { val: "native", label: isVi ? "Native (Safari/Chrome)" : "Native (Safari/Chrome)", sub: isVi ? "Web Speech API của trình duyệt" : "Browser Web Speech API", recommended: false },
          ].map((opt) => (
            <button
              key={opt.val}
              onClick={() => handleSttProviderChange(opt.val)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                background: sttProvider === opt.val ? "rgba(99,102,241,0.12)" : "rgba(255,255,255,0.02)",
                border: sttProvider === opt.val ? "1px solid rgba(99,102,241,0.3)" : "1px solid rgba(255,255,255,0.05)",
                textAlign: "left", transition: "all 0.2s",
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                border: `2px solid ${sttProvider === opt.val ? "#6366f1" : "rgba(255,255,255,0.2)"}`,
                background: sttProvider === opt.val ? "#6366f1" : "transparent",
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.875rem", color: "white", fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
                  {opt.label}
                  {opt.recommended && (
                    <span style={{ fontSize: "0.65rem", padding: "1px 6px", borderRadius: 4, background: "rgba(34,197,94,0.15)", color: "#22c55e", fontWeight: 600, letterSpacing: "0.04em" }}>
                      {isVi ? "MẶC ĐỊNH" : "DEFAULT"}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>{opt.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Wake Word */}
      <div className="glow-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {isVi ? "Từ kích hoạt" : "Wake Word"}
          </div>
          <button onClick={() => setWakeEnabled(!wakeEnabled)} className={`toggle ${wakeEnabled ? "on" : ""}`}>
            <div className="toggle-knob" />
          </button>
        </div>
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10, opacity: wakeEnabled ? 1 : 0.5 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{isVi ? "Cụm từ kích hoạt" : "Trigger Phrase"}</span>
            <input className="omni-input" disabled={!wakeEnabled} value={wakePhrase} onChange={e => setWakePhrase(e.target.value)} placeholder="hey omnistate" />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{isVi ? "Thời gian chờ (ms)" : "Cooldown (ms)"}</span>
            <input className="omni-input" type="number" disabled={!wakeEnabled} value={cooldownMs} onChange={e => setCooldownMs(e.target.value)} />
          </label>
          <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
            {isVi ? "Nhận diện wake word cần Python +" : "Wake word detection requires Python +"} <code style={{ background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 4 }}>OMNISTATE_SIRI_TOKEN</code> {isVi ? "trong file" : "in your"} <code style={{ background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 4 }}>.env</code>
          </div>
        </div>
      </div>
    </div>
  );
}

export function VoicePage() {
  const [tab, setTab] = useState<VoiceTab>("input");
  const appLanguage = useChatStore((s) => s.appLanguage);
  const isVi = appLanguage === "vi";

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "transparent" }}>
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px" }}>
        {/* Header */}
        <div className="hero-gradient animate-fade-in" style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: "linear-gradient(135deg, #22d3ee, #6366f1)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, boxShadow: "0 4px 20px rgba(34,211,238,0.3)",
            }}>
              🎙️
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: "white" }}>
                {isVi ? "Điều khiển bằng giọng nói" : "Voice Control"}
              </h2>
              <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                {isVi ? "Nói chuyện, đăng ký và cấu hình giao diện voice" : "Speak, enroll, and configure your voice interface"}
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="tab-strip" style={{ marginBottom: 24 }}>
          <button className={`tab-item ${tab === "input" ? "active" : ""}`} onClick={() => setTab("input")}>
            {isVi ? "🎤 Nhập giọng nói" : "🎤 Voice Input"}
          </button>
          <button className={`tab-item ${tab === "train" ? "active" : ""}`} onClick={() => setTab("train")}>
            {isVi ? "🧬 Huấn luyện định danh" : "🧬 Train Identity"}
          </button>
          <button className={`tab-item ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
            {isVi ? "⚙️ Cài đặt" : "⚙️ Settings"}
          </button>
        </div>

        {/* Tab panel */}
        <div className="glow-card animate-fade-in" style={{ padding: 0, overflow: "hidden" }}>
          {tab === "input"    && <VoiceInputTab isVi={isVi} />}
          {tab === "train"    && <VoiceTrainTab isVi={isVi} />}
          {tab === "settings" && <VoiceSettingsTab isVi={isVi} />}
        </div>
      </div>
    </div>
  );
}
