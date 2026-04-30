import { useEffect, useState } from "react";
import { getClient } from "../hooks/useGateway";
import { useChatStore } from "../lib/chat-store";
import { resolveGatewayHttpBaseUrl } from "../lib/runtime-config";

type TtsProvider = "edge" | "rtvc";
type SttProvider = "whisper-local" | "whisper-cloud" | "native";
type WhisperModel = "tiny" | "base" | "small" | "medium" | "large-v3";

const WHISPER_MODELS: { value: WhisperModel; label: string }[] = [
  { value: "tiny",     label: "tiny" },
  { value: "base",     label: "base" },
  { value: "small",    label: "small (recommended)" },
  { value: "medium",   label: "medium" },
  { value: "large-v3", label: "large-v3" },
];

const VI_VOICES = [
  { value: "vi-VN-HoaiMyNeural", label: "HoaiMy (default)" },
  { value: "vi-VN-NamMinhNeural", label: "NamMinh" },
] as const;

const EN_VOICES = [
  { value: "en-US-AriaNeural", label: "Aria (default)" },
  { value: "en-US-JennyNeural", label: "Jenny" },
  { value: "en-US-GuyNeural", label: "Guy" },
] as const;

export function VoiceSettings() {
  const appLanguage = useChatStore((s) => s.appLanguage);
  const runtimeConfig = useChatStore((s) => s.runtimeConfig);

  const [ttsProvider, setTtsProvider] = useState<TtsProvider>("edge");
  const [voiceVi, setVoiceVi] = useState("vi-VN-HoaiMyNeural");
  const [voiceEn, setVoiceEn] = useState("en-US-AriaNeural");
  const [svEnabled, setSvEnabled] = useState(false);
  const [svThreshold, setSvThreshold] = useState(0.75);
  const [svOnMismatch, setSvOnMismatch] = useState<"warn" | "reject" | "silent">("warn");
  const [sttProvider, setSttProvider] = useState<SttProvider>("whisper-local");
  const [whisperModel, setWhisperModel] = useState<WhisperModel>("small");
  const [vadCalibrating, setVadCalibrating] = useState(false);
  const [vadCalibrationResult, setVadCalibrationResult] = useState<{ rms: number; suggested: number; message: string } | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  // Load current config on mount / when runtimeConfig changes
  useEffect(() => {
    const cfg = runtimeConfig as {
      tts?: { provider?: string; voiceVi?: string; voiceEn?: string };
      speakerVerification?: { enabled?: boolean; threshold?: number; onMismatch?: string };
      voice?: { sttProvider?: string; whisperLocalModel?: string };
    } | null;
    if (!cfg) return;
    if (cfg.tts?.provider === "edge" || cfg.tts?.provider === "rtvc") setTtsProvider(cfg.tts.provider);
    if (cfg.tts?.voiceVi) setVoiceVi(cfg.tts.voiceVi);
    if (cfg.tts?.voiceEn) setVoiceEn(cfg.tts.voiceEn);
    if (cfg.speakerVerification?.enabled !== undefined) setSvEnabled(cfg.speakerVerification.enabled);
    if (cfg.speakerVerification?.threshold !== undefined) setSvThreshold(cfg.speakerVerification.threshold);
    const om = cfg.speakerVerification?.onMismatch;
    if (om === "warn" || om === "reject" || om === "silent") setSvOnMismatch(om);
    const stt = cfg.voice?.sttProvider;
    if (stt === "whisper-local" || stt === "whisper-cloud" || stt === "native") setSttProvider(stt);
    const wm = cfg.voice?.whisperLocalModel;
    if (wm === "tiny" || wm === "base" || wm === "small" || wm === "medium" || wm === "large-v3") setWhisperModel(wm);
  }, [runtimeConfig]);

  const save = () => {
    setSaveState("saving");
    const setConfig = (k: Parameters<ReturnType<typeof getClient>["setRuntimeConfig"]>[0], v: string | boolean | number) => getClient().setRuntimeConfig(k, v);
    setConfig("tts.provider", ttsProvider);
    setConfig("tts.voiceVi", voiceVi);
    setConfig("tts.voiceEn", voiceEn);
    setConfig("speakerVerification.enabled", svEnabled);
    setConfig("speakerVerification.threshold", svThreshold);
    setConfig("speakerVerification.onMismatch", svOnMismatch);
    setConfig("voice.sttProvider", sttProvider);
    setConfig("voice.whisperLocalModel", whisperModel);
    window.setTimeout(() => setSaveState("saved"), 400);
    window.setTimeout(() => setSaveState("idle"), 2200);
  };

  const testVoice = async (lang: "vi" | "en") => {
    const text = lang === "vi" ? "Xin chào" : "Hello";
    const voice = lang === "vi" ? voiceVi : voiceEn;
    const baseUrl = resolveGatewayHttpBaseUrl();
    try {
      const res = await fetch(`${baseUrl}/api/tts/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, provider: ttsProvider }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const binary = atob(json.audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
      audio.play();
    } catch (err) {
      console.error("[VoiceSettings] TTS preview failed:", err);
    }
  };

  const calibrateVAD = async () => {
    setVadCalibrating(true);
    setVadCalibrationResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);

      await new Promise<void>((resolve) => {
        mediaRecorder.onstop = () => resolve();
        mediaRecorder.start();
        setTimeout(() => mediaRecorder.stop(), 3000);
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      const blob = new Blob(chunks, { type: "audio/webm" });
      const arrayBuffer = await blob.arrayBuffer();
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const channelData = audioBuffer.getChannelData(0);

      let sum = 0;
      for (let i = 0; i < channelData.length; i++) {
        sum += channelData[i] * channelData[i];
      }
      const rms = Math.sqrt(sum / channelData.length);

      stream.getTracks().forEach((t) => t.stop());
      audioContext.close();

      let suggested = 400;
      let message = "VAD looks good";
      if (rms > 0.01) {
        suggested = 200;
        message = "Noisy environment — suggest 200ms threshold";
      } else if (rms < 0.001) {
        suggested = 600;
        message = "Very quiet — suggest 600ms threshold";
      }

      setVadCalibrationResult({ rms: Math.round(rms * 10000) / 10000, suggested, message });
    } catch (err) {
      setVadCalibrationResult({
        rms: 0,
        suggested: 400,
        message: `Microphone error: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setVadCalibrating(false);
    }
  };

  const label = (vi: string, en: string) => appLanguage === "vi" ? vi : en;

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", marginBottom: 10, fontWeight: 600 }}>
        {label("Cài đặt TTS (Text-to-Speech)", "TTS (Text-to-Speech) Settings")}
      </div>

      {/* Provider */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          {label("Nhà cung cấp giọng đọc", "TTS Provider")}
        </span>
        <div style={{ display: "flex", gap: 16 }}>
          {(["edge", "rtvc"] as TtsProvider[]).map((p) => (
            <label key={p} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.78rem", color: "var(--color-text-secondary)", cursor: "pointer" }}>
              <input
                type="radio"
                name="tts-provider"
                value={p}
                checked={ttsProvider === p}
                onChange={() => setTtsProvider(p)}
              />
              {p === "edge"
                ? label("Edge TTS (giọng cute female)", "Edge TTS (cute female)")
                : label("RTVC (giọng clone)", "RTVC (cloned voice)")}
            </label>
          ))}
        </div>
      </div>

      {/* Vietnamese voice */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            {label("Giọng tiếng Việt", "Vietnamese Voice")}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <select className="omni-input" value={voiceVi} onChange={(e) => setVoiceVi(e.target.value)} style={{ flex: 1 }}>
              {VI_VOICES.map((v) => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
            <button className="btn-ghost" onClick={() => testVoice("vi")} style={{ fontSize: "0.75rem", padding: "4px 8px", whiteSpace: "nowrap" }}>
              {label("Thử", "Test")}
            </button>
          </div>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            {label("Giọng tiếng Anh", "English Voice")}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <select className="omni-input" value={voiceEn} onChange={(e) => setVoiceEn(e.target.value)} style={{ flex: 1 }}>
              {EN_VOICES.map((v) => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
            <button className="btn-ghost" onClick={() => testVoice("en")} style={{ fontSize: "0.75rem", padding: "4px 8px", whiteSpace: "nowrap" }}>
              {label("Thử", "Test")}
            </button>
          </div>
        </label>
      </div>

      {/* Speaker Verification */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14, paddingTop: 4 }}>
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontWeight: 600 }}>
          {label("Xác minh giọng nói", "Speaker Verification")}
        </span>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "0.78rem", color: "var(--color-text-secondary)", cursor: "pointer" }}>
          <input type="checkbox" checked={svEnabled} onChange={(e) => setSvEnabled(e.target.checked)} />
          {label("Bật xác minh giọng nói", "Enable speaker verification")}
        </label>
        {svEnabled && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                {label("Ngưỡng (0.5–0.95)", "Threshold (0.5–0.95)")}
              </span>
              <input
                className="omni-input"
                type="number"
                min={0.5}
                max={0.95}
                step={0.05}
                value={svThreshold}
                onChange={(e) => setSvThreshold(Number(e.target.value))}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                {label("Khi không khớp", "On mismatch")}
              </span>
              <select className="omni-input" value={svOnMismatch} onChange={(e) => setSvOnMismatch(e.target.value as "warn" | "reject" | "silent")}>
                <option value="warn">{label("Cảnh báo", "Warn")}</option>
                <option value="reject">{label("Từ chối", "Reject")}</option>
                <option value="silent">{label("Im lặng", "Silent")}</option>
              </select>
            </label>
          </div>
        )}
      </div>

      {/* STT Provider */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontWeight: 600 }}>
          {label("Engine nhận dạng giọng nói (STT)", "Speech-to-Text Engine (STT)")}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(
            [
              { val: "whisper-local",  labelVi: "Whisper cục bộ (khuyến nghị)", labelEn: "Whisper Local (recommended)" },
              { val: "whisper-cloud",  labelVi: "Whisper đám mây (OpenAI API)", labelEn: "Whisper Cloud (OpenAI API)" },
              { val: "native",         labelVi: "Native trình duyệt",            labelEn: "Browser native" },
            ] as { val: SttProvider; labelVi: string; labelEn: string }[]
          ).map((opt) => (
            <label key={opt.val} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.78rem", color: "var(--color-text-secondary)", cursor: "pointer" }}>
              <input
                type="radio"
                name="stt-provider"
                value={opt.val}
                checked={sttProvider === opt.val}
                onChange={() => setSttProvider(opt.val)}
              />
              {label(opt.labelVi, opt.labelEn)}
            </label>
          ))}
        </div>
      </div>

      {/* Whisper model size — only relevant when whisper-local is selected */}
      {sttProvider === "whisper-local" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            {label("Kích thước model Whisper", "Whisper Model Size")}
          </span>
          <select
            className="omni-input"
            value={whisperModel}
            onChange={(e) => setWhisperModel(e.target.value as WhisperModel)}
            style={{ maxWidth: 220 }}
          >
            {WHISPER_MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)" }}>
            {label(
              "Lớn hơn = chính xác hơn nhưng chậm hơn. 'small' cân bằng tốt cho hầu hết máy.",
              "Larger = more accurate but slower. 'small' is a good balance for most machines.",
            )}
          </span>
        </div>
      )}

      {/* VAD Calibration */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontWeight: 600 }}>
          {label("Hiệu chuẩn VAD", "VAD Calibration")}
        </span>
        <button
          className="btn-ghost"
          onClick={calibrateVAD}
          disabled={vadCalibrating}
          style={{ fontSize: "0.78rem", alignSelf: "flex-start" }}
        >
          {vadCalibrating ? label("Đang đo...", "Measuring...") : label("Calibrate VAD", "Calibrate VAD")}
        </button>
        {vadCalibrationResult && (
          <div style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)", display: "flex", flexDirection: "column", gap: 6 }}>
            <span>{vadCalibrationResult.message}</span>
            {vadCalibrationResult.suggested !== 400 && (
              <button
                className="btn-primary"
                onClick={() => getClient().setRuntimeConfig("vad.silenceThresholdMs", vadCalibrationResult.suggested)}
                style={{ fontSize: "0.75rem", alignSelf: "flex-start" }}
              >
                Apply {vadCalibrationResult.suggested}ms
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn-primary" onClick={save} disabled={saveState === "saving"}>
          {saveState === "saving"
            ? label("Đang lưu...", "Saving...")
            : saveState === "saved"
              ? label("✓ Đã lưu", "✓ Saved")
              : label("Lưu cài đặt TTS", "Save TTS settings")}
        </button>
        {saveState === "saved" && (
          <span style={{ fontSize: "0.75rem", color: "#22c55e" }}>
            {label("Cài đặt đã được áp dụng.", "Settings applied.")}
          </span>
        )}
      </div>
    </div>
  );
}
