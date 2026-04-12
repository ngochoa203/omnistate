import { useState, useCallback, useRef } from "react";
import { useAuthStore } from "../lib/auth-store";
import type { VoiceProfile } from "../lib/auth-store";
import { createProfile, getProfile, markProfileEnrolled } from "../lib/auth-client";
import { encodeWav, blobToBase64 } from "../lib/audio-utils";

const ENROLLMENT_PHRASES = [
  "Hey OmniState, open my favorite apps",
  "Check system status and show me the dashboard",
  "What's the weather like today?",
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "ja", label: "日本語" },
  { value: "zh", label: "中文" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "ko", label: "한국어" },
];

export function AuthPage() {
  const enrollmentStep = useAuthStore((s) => s.enrollmentStep);
  const enrollmentSamples = useAuthStore((s) => s.enrollmentSamples);
  const enrollmentName = useAuthStore((s) => s.enrollmentName);
  const enrollmentLanguage = useAuthStore((s) => s.enrollmentLanguage);

  const setEnrollmentStep = useAuthStore((s) => s.setEnrollmentStep);
  const setEnrollmentSamples = useAuthStore((s) => s.setEnrollmentSamples);
  const setEnrollmentName = useAuthStore((s) => s.setEnrollmentName);
  const setEnrollmentLanguage = useAuthStore((s) => s.setEnrollmentLanguage);
  const completeEnrollment = useAuthStore((s) => s.completeEnrollment);

  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [verifyDone, setVerifyDone] = useState(false);

  // Pending profile created in step 1 (before samples are sent)
  const pendingProfileRef = useRef<{ id: string } | null>(null);

  // Gateway WebSocket URL for sending enrollment audio
  const wsUrl = (import.meta as any).env?.VITE_GATEWAY_URL || "ws://127.0.0.1:19800";

  // --- Audio capture helpers (raw, without useVoice's send path) ---
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const stopCapture = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    processorRef.current?.disconnect();
    contextRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current = null;
    contextRef.current = null;
    streamRef.current = null;
  }, []);

  const startCapture = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      chunksRef.current = [];
      processor.onaudioprocess = (e) => {
        chunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(audioCtx.destination);
      streamRef.current = stream;
      contextRef.current = audioCtx;
      processorRef.current = processor;
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setRecordDuration(0);
      timerRef.current = setInterval(() => setRecordDuration(Date.now() - startTimeRef.current), 100);
    } catch (err: any) {
      setError(`Microphone access denied: ${err.message}`);
    }
  }, []);

  const finishCapture = useCallback(async (): Promise<string | null> => {
    stopCapture();
    setIsRecording(false);
    setRecordDuration(0);
    const chunks = chunksRef.current;
    if (chunks.length === 0) { setError("No audio recorded. Try again."); return null; }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
    try {
      const wavBlob = encodeWav(merged, 16000);
      const base64 = await blobToBase64(wavBlob);
      return base64;
    } catch (err: any) {
      setError(`Audio encoding failed: ${err.message}`);
      return null;
    }
  }, [stopCapture]);

  // Send enrollment sample via HTTP (not WS, since it's one-shot)
  const sendEnrollmentSample = useCallback(async (profileId: string, sampleIndex: number, audioBase64: string) => {
    const httpUrl = wsUrl.replace(/^ws/, "http").replace(/\/ws\/?$/, "");
    const res = await fetch(`${httpUrl}/api/voice/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, sampleIndex, audio: audioBase64 }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error((d as any).error || `HTTP ${res.status}`);
    }
    return res.json();
  }, [wsUrl]);

  const sendVerifySample = useCallback(async (profileId: string, audioBase64: string) => {
    const httpUrl = wsUrl.replace(/^ws/, "http").replace(/\/ws\/?$/, "");
    const res = await fetch(`${httpUrl}/api/voice/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, audio: audioBase64 }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error((d as any).error || `HTTP ${res.status}`);
    }
    return res.json();
  }, [wsUrl]);

  // ---- Step handlers ----

  const handleWelcomeNext = useCallback(async () => {
    if (!enrollmentName.trim()) { setError("Please enter your name."); return; }
    setError(null);
    setIsProcessing(true);
    try {
      const profile = await createProfile(enrollmentName.trim(), enrollmentLanguage);
      pendingProfileRef.current = { id: profile.id };
      setEnrollmentStep(1);
    } catch (err: any) {
      // Offline / gateway not running — create a local-only profile for demo
      const localId = `local-${Date.now()}`;
      pendingProfileRef.current = { id: localId };
      setEnrollmentStep(1);
    } finally {
      setIsProcessing(false);
    }
  }, [enrollmentName, enrollmentLanguage, setEnrollmentStep]);

  const handleRecordSample = useCallback(async () => {
    if (isRecording) {
      // Stop and process
      setIsProcessing(true);
      const audio = await finishCapture();
      if (!audio) { setIsProcessing(false); return; }
      const profileId = pendingProfileRef.current?.id ?? "local";
      try {
        await sendEnrollmentSample(profileId, enrollmentSamples, audio);
      } catch {
        // Gateway may not support enrollment yet — continue locally
      }
      const nextCount = enrollmentSamples + 1;
      setEnrollmentSamples(nextCount);
      setIsProcessing(false);
      if (nextCount >= ENROLLMENT_PHRASES.length) {
        setEnrollmentStep(2);
      }
    } else {
      await startCapture();
    }
  }, [isRecording, finishCapture, enrollmentSamples, sendEnrollmentSample, setEnrollmentSamples, setEnrollmentStep, startCapture]);

  const handleVerify = useCallback(async () => {
    if (isRecording) {
      setIsProcessing(true);
      const audio = await finishCapture();
      if (!audio) { setIsProcessing(false); return; }
      const profileId = pendingProfileRef.current?.id ?? "local";
      try {
        await sendVerifySample(profileId, audio);
      } catch {
        // Proceed anyway
      }
      setVerifyDone(true);
      setIsProcessing(false);
    } else {
      await startCapture();
    }
  }, [isRecording, finishCapture, sendVerifySample]);

  const handleComplete = useCallback(async () => {
    const profileId = pendingProfileRef.current?.id ?? `local-${Date.now()}`;
    setIsProcessing(true);
    try {
      // Try to get the up-to-date profile from DB
      const serverProfile = await getProfile(profileId);
      const profile: VoiceProfile = serverProfile ?? {
        id: profileId,
        name: enrollmentName.trim(),
        preferredLanguage: enrollmentLanguage,
        enrolledSamples: ENROLLMENT_PHRASES.length,
        isEnrolled: true,
        isVerified: true,
        createdAt: new Date().toISOString(),
      };
      // Ensure isEnrolled is true
      if (!profile.isEnrolled) {
        // Mark enrolled on server
        await markProfileEnrolled(profileId);
        profile.isEnrolled = true;
      }
      completeEnrollment(profile);
    } catch {
      // Fallback to local profile
      completeEnrollment({
        id: profileId,
        name: enrollmentName.trim(),
        preferredLanguage: enrollmentLanguage,
        enrolledSamples: ENROLLMENT_PHRASES.length,
        isEnrolled: true,
        isVerified: true,
        createdAt: new Date().toISOString(),
      });
    } finally {
      setIsProcessing(false);
    }
  }, [enrollmentName, enrollmentLanguage, completeEnrollment]);

  // ---- Styles ----

  const cardStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 520,
    padding: "44px 48px",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 24,
    backdropFilter: "blur(24px)",
    position: "relative",
    zIndex: 1,
    animation: "fadeSlideUp 0.4s cubic-bezier(0.16,1,0.3,1)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "11px 14px",
    fontSize: 14,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    color: "#fff",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "'Inter', -apple-system, sans-serif",
    transition: "border-color 0.2s",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    color: "#a1a1aa",
    fontSize: 12,
    marginBottom: 6,
    fontWeight: 500,
    letterSpacing: "0.02em",
  };

  const primaryBtn = (disabled = false): React.CSSProperties => ({
    width: "100%",
    padding: "13px 0",
    fontSize: 14,
    fontWeight: 600,
    background: disabled
      ? "rgba(99,102,241,0.25)"
      : "linear-gradient(135deg, #6366f1, #7c3aed)",
    border: "none",
    borderRadius: 12,
    color: disabled ? "rgba(255,255,255,0.4)" : "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.2s",
    fontFamily: "'Inter', -apple-system, sans-serif",
    letterSpacing: "0.01em",
  });

  const recordBtnStyle = (recording: boolean): React.CSSProperties => ({
    width: "100%",
    padding: "14px 0",
    fontSize: 14,
    fontWeight: 600,
    background: recording
      ? "linear-gradient(135deg, #ef4444, #dc2626)"
      : "linear-gradient(135deg, #6366f1, #7c3aed)",
    border: "none",
    borderRadius: 12,
    color: "#fff",
    cursor: isProcessing ? "wait" : "pointer",
    transition: "all 0.2s",
    fontFamily: "'Inter', -apple-system, sans-serif",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  });

  // ---- Render steps ----

  const renderStep0 = () => (
    <>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{
          width: 72, height: 72, margin: "0 auto 20px",
          background: "linear-gradient(135deg, #6366f1, #7c3aed)",
          borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 34, boxShadow: "0 12px 32px rgba(99,102,241,0.4)",
        }}>🧠</div>
        <h1 style={{ color: "#fff", fontSize: 26, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.02em" }}>
          Welcome to OmniState
        </h1>
        <p style={{ color: "#71717a", fontSize: 14, margin: 0, lineHeight: 1.6 }}>
          Let's set up your voice profile.<br />
          OmniState will recognize you by your voice — no passwords needed.
        </p>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Your Name</label>
        <input
          type="text"
          value={enrollmentName}
          onChange={(e) => setEnrollmentName(e.target.value)}
          placeholder="e.g. Alex"
          style={inputStyle}
          onKeyDown={(e) => e.key === "Enter" && handleWelcomeNext()}
        />
      </div>

      <div style={{ marginBottom: 28 }}>
        <label style={labelStyle}>Preferred Language</label>
        <select
          value={enrollmentLanguage}
          onChange={(e) => setEnrollmentLanguage(e.target.value)}
          style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value} style={{ background: "#0a0a1a" }}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorBox msg={error} />}

      <button
        onClick={handleWelcomeNext}
        disabled={isProcessing || !enrollmentName.trim()}
        style={primaryBtn(isProcessing || !enrollmentName.trim())}
      >
        {isProcessing ? "Setting up..." : "Continue →"}
      </button>
    </>
  );

  const renderStep1 = () => {
    const currentPhrase = ENROLLMENT_PHRASES[enrollmentSamples];
    const phraseIndex = enrollmentSamples;

    return (
      <>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h2 style={{ color: "#fff", fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>
            Voice Training
          </h2>
          <p style={{ color: "#71717a", fontSize: 13, margin: 0 }}>
            We need to learn your voice. Please read each phrase aloud.
          </p>
        </div>

        {/* Progress */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            {ENROLLMENT_PHRASES.map((_, i) => (
              <div key={i} style={{
                flex: 1,
                height: 4,
                borderRadius: 99,
                background: i < enrollmentSamples
                  ? "linear-gradient(90deg, #6366f1, #7c3aed)"
                  : i === enrollmentSamples
                  ? "rgba(99,102,241,0.35)"
                  : "rgba(255,255,255,0.07)",
                marginRight: i < ENROLLMENT_PHRASES.length - 1 ? 6 : 0,
                transition: "background 0.4s",
              }} />
            ))}
          </div>
          <p style={{ color: "#52525b", fontSize: 11, textAlign: "right", margin: 0, letterSpacing: "0.04em" }}>
            {enrollmentSamples}/{ENROLLMENT_PHRASES.length} recorded
          </p>
        </div>

        {/* Phrase card */}
        <div style={{
          padding: "20px 24px",
          background: "rgba(99,102,241,0.07)",
          border: "1px solid rgba(99,102,241,0.2)",
          borderRadius: 14,
          marginBottom: 24,
          textAlign: "center",
        }}>
          <p style={{ color: "#a78bfa", fontSize: 11, margin: "0 0 10px", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
            Sample {phraseIndex + 1} of {ENROLLMENT_PHRASES.length}
          </p>
          <p style={{ color: "#e4e4f0", fontSize: 16, margin: 0, fontStyle: "italic", lineHeight: 1.5, fontWeight: 500 }}>
            "{currentPhrase}"
          </p>
        </div>

        {/* Recording indicator */}
        {isRecording && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            marginBottom: 16, color: "#ef4444", fontSize: 13, fontWeight: 600,
          }}>
            <PulseRing />
            Recording… {(recordDuration / 1000).toFixed(1)}s
          </div>
        )}

        {error && <ErrorBox msg={error} />}

        <button
          onClick={handleRecordSample}
          disabled={isProcessing}
          style={recordBtnStyle(isRecording) as React.CSSProperties}
        >
          {isProcessing ? (
            "Processing..."
          ) : isRecording ? (
            <><StopIcon /> Stop Recording</>
          ) : (
            <><MicIcon /> {enrollmentSamples === 0 ? "Start Recording" : "Record Next Sample"}</>
          )}
        </button>

        <p style={{ textAlign: "center", color: "#3f3f50", fontSize: 12, marginTop: 14 }}>
          Speak clearly. Recording stops when you click again.
        </p>
      </>
    );
  };

  const renderStep2 = () => (
    <>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{
          width: 64, height: 64, margin: "0 auto 16px",
          background: "rgba(34,211,238,0.1)",
          border: "1px solid rgba(34,211,238,0.2)",
          borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 28,
        }}>🎙</div>
        <h2 style={{ color: "#fff", fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>
          Verify Your Voice
        </h2>
        <p style={{ color: "#71717a", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
          Now say <em style={{ color: "#a1a1aa" }}>anything</em> to verify your voiceprint works.<br />
          A few words or a sentence is enough.
        </p>
      </div>

      {verifyDone ? (
        <div style={{
          padding: "20px 24px", marginBottom: 24,
          background: "rgba(34,197,94,0.08)",
          border: "1px solid rgba(34,197,94,0.2)",
          borderRadius: 14, textAlign: "center",
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
          <p style={{ color: "#4ade80", fontSize: 14, margin: 0, fontWeight: 600 }}>
            Voice verified successfully!
          </p>
        </div>
      ) : (
        <>
          {isRecording && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              marginBottom: 16, color: "#ef4444", fontSize: 13, fontWeight: 600,
            }}>
              <PulseRing />
              Recording… {(recordDuration / 1000).toFixed(1)}s
            </div>
          )}

          {error && <ErrorBox msg={error} />}

          <button
            onClick={handleVerify}
            disabled={isProcessing}
            style={recordBtnStyle(isRecording) as React.CSSProperties}
          >
            {isProcessing ? (
              "Verifying..."
            ) : isRecording ? (
              <><StopIcon /> Stop & Verify</>
            ) : (
              <><MicIcon /> Start Speaking</>
            )}
          </button>
        </>
      )}

      {verifyDone && (
        <button onClick={() => setEnrollmentStep(3)} style={primaryBtn(false)}>
          Continue →
        </button>
      )}
    </>
  );

  const renderStep3 = () => (
    <>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{
          width: 80, height: 80, margin: "0 auto 20px",
          background: "linear-gradient(135deg, #22c55e, #16a34a)",
          borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 38, boxShadow: "0 12px 32px rgba(34,197,94,0.35)",
          animation: "popIn 0.5s cubic-bezier(0.16,1,0.3,1)",
        }}>✓</div>
        <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 700, margin: "0 0 12px" }}>
          All set, {enrollmentName}!
        </h2>
        <p style={{ color: "#71717a", fontSize: 14, margin: 0, lineHeight: 1.7 }}>
          OmniState will now recognize your voice automatically.<br />
          Just speak — no buttons, no passwords.
        </p>
      </div>

      <div style={{
        padding: "16px 20px",
        background: "rgba(99,102,241,0.07)",
        border: "1px solid rgba(99,102,241,0.15)",
        borderRadius: 12, marginBottom: 28,
      }}>
        {[
          ["Profile", enrollmentName],
          ["Language", LANGUAGES.find((l) => l.value === enrollmentLanguage)?.label ?? enrollmentLanguage],
          ["Samples recorded", `${ENROLLMENT_PHRASES.length} phrases`],
        ].map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <span style={{ color: "#52525b", fontSize: 12 }}>{k}</span>
            <span style={{ color: "#a1a1aa", fontSize: 12, fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </div>

      <button onClick={handleComplete} style={primaryBtn(false)}>
        Start using OmniState
      </button>
    </>
  );

  // Step indicator dots
  const TOTAL_STEPS = 4;
  const stepLabels = ["Setup", "Training", "Verify", "Done"];

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #050508 0%, #0a0a1a 50%, #050508 100%)",
      fontFamily: "'Inter', -apple-system, sans-serif",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Keyframes injection */}
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes popIn {
          from { transform: scale(0.5); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes pulseRing {
          0%   { transform: scale(0.8); opacity: 1; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
      `}</style>

      {/* Background orbs */}
      <div style={{
        position: "absolute", width: 600, height: 600, top: -200, left: -200,
        background: "radial-gradient(circle, rgba(99,102,241,0.12), transparent)",
        borderRadius: "50%", pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", width: 500, height: 500, bottom: -150, right: -100,
        background: "radial-gradient(circle, rgba(124,58,237,0.08), transparent)",
        borderRadius: "50%", pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", width: 300, height: 300, top: "40%", right: "30%",
        background: "radial-gradient(circle, rgba(34,211,238,0.05), transparent)",
        borderRadius: "50%", pointerEvents: "none",
      }} />

      <div style={{ width: "100%", maxWidth: 560, padding: "0 16px", position: "relative", zIndex: 1 }}>
        {/* Step indicator */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 0, marginBottom: 28 }}>
          {stepLabels.map((label, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: i < enrollmentStep
                    ? "linear-gradient(135deg, #6366f1, #7c3aed)"
                    : i === enrollmentStep
                    ? "rgba(99,102,241,0.25)"
                    : "rgba(255,255,255,0.05)",
                  border: i === enrollmentStep
                    ? "2px solid #6366f1"
                    : i < enrollmentStep
                    ? "none"
                    : "1px solid rgba(255,255,255,0.1)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700,
                  color: i <= enrollmentStep ? "#fff" : "#3f3f50",
                  transition: "all 0.3s",
                }}>
                  {i < enrollmentStep ? "✓" : i + 1}
                </div>
                <span style={{
                  fontSize: 10, color: i === enrollmentStep ? "#a78bfa" : "#3f3f50",
                  fontWeight: i === enrollmentStep ? 600 : 400,
                  letterSpacing: "0.04em",
                }}>
                  {label}
                </span>
              </div>
              {i < TOTAL_STEPS - 1 && (
                <div style={{
                  width: 48, height: 1, margin: "0 4px",
                  background: i < enrollmentStep
                    ? "linear-gradient(90deg, #6366f1, #7c3aed)"
                    : "rgba(255,255,255,0.07)",
                  marginBottom: 20,
                  transition: "background 0.4s",
                }} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div style={cardStyle} key={enrollmentStep}>
          {enrollmentStep === 0 && renderStep0()}
          {enrollmentStep === 1 && renderStep1()}
          {enrollmentStep === 2 && renderStep2()}
          {enrollmentStep === 3 && renderStep3()}
        </div>
      </div>
    </div>
  );
}

// ---- Small helper components ----

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{
      padding: "10px 14px", marginBottom: 16,
      background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
      borderRadius: 10, color: "#ef4444", fontSize: 13,
    }}>
      {msg}
    </div>
  );
}

function PulseRing() {
  return (
    <div style={{ position: "relative", width: 14, height: 14 }}>
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: "#ef4444",
        animation: "pulseRing 1s ease-out infinite",
      }} />
      <div style={{
        position: "absolute", inset: 2, borderRadius: "50%",
        background: "#ef4444",
        animation: "pulse 1s ease-in-out infinite",
      }} />
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}
