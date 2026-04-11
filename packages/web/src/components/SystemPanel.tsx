import { useEffect, useState } from "react";
import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";

function InfoCard({ label, value, detail, icon, valueColor }: {
  label: string; value: string; detail?: string; icon: string; valueColor?: string;
}) {
  return (
    <div className="glass glass-hover" style={{ borderRadius: 16, padding: "20px", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>
      </div>
      <div style={{ fontSize: "1.4rem", fontWeight: 800, color: valueColor ?? "white", lineHeight: 1, marginBottom: 4 }}>{value}</div>
      {detail && <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: 4 }}>{detail}</div>}
    </div>
  );
}

export function SystemPanel() {
  const systemInfo = useChatStore((s) => s.systemInfo);
  const connectionState = useChatStore((s) => s.connectionState);
  const appLanguage = useChatStore((s) => s.appLanguage);
  const isVi = appLanguage === "vi";

  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voiceUserId, setVoiceUserId] = useState("owner");
  const [voiceDisplayName, setVoiceDisplayName] = useState("Owner");
  const [voiceThreshold, setVoiceThreshold] = useState("0.85");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceResult, setVoiceResult] = useState<string>("");

  const fileToBase64 = async (file: File): Promise<string> => {
    const buf = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk)
      binary += String.fromCharCode(...bytes.slice(i, i + chunk));
    return btoa(binary);
  };

  const guessAudioFormat = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".webm")) return "webm";
    if (lower.endsWith(".mp3")) return "mp3";
    if (lower.endsWith(".ogg")) return "ogg";
    if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "mp3";
    return "wav";
  };

  const callVoiceApi = async (path: "/api/voice/enroll" | "/api/voice/verify") => {
    if (!voiceFile) {
      setVoiceResult(isVi ? "Vui lòng chọn file âm thanh trước." : "Please choose an audio file first.");
      return;
    }
    try {
      setVoiceBusy(true);
      setVoiceResult("");
      const audioBase64 = await fileToBase64(voiceFile);
      const audioFormat = guessAudioFormat(voiceFile.name);
      const body: Record<string, unknown> = { audioBase64, audioFormat };
      if (path === "/api/voice/enroll") {
        body.userId = voiceUserId.trim() || "owner";
        body.displayName = voiceDisplayName.trim() || voiceUserId.trim() || "owner";
        body.threshold = Number(voiceThreshold) || 0.85;
      }
      const resp = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await resp.json();
      setVoiceResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setVoiceResult(`${isVi ? "Lỗi Voice API" : "Voice API error"}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setVoiceBusy(false);
    }
  };

  useEffect(() => {
    if (connectionState === "connected") {
      getClient().requestSystemDashboard();
      const interval = setInterval(() => getClient().requestSystemDashboard(), 15000);
      return () => clearInterval(interval);
    }
  }, [connectionState]);

  if (!systemInfo) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }} className="animate-float">🖥️</div>
          <div style={{ fontSize: "1rem", color: "var(--color-text-secondary)", marginBottom: 4 }}>
            {connectionState !== "connected"
              ? (isVi ? "Kết nối gateway để xem thông tin hệ thống" : "Connect to gateway to view system info")
              : (isVi ? "Đang tải dữ liệu hệ thống..." : "Loading system data...")}
          </div>
          {connectionState === "connected" && (
            <div className="skeleton" style={{ width: 140, height: 8, borderRadius: 4, margin: "12px auto" }} />
          )}
        </div>
      </div>
    );
  }

  const battPct = systemInfo.battery?.percentage ?? systemInfo.battery?.percent ?? null;
  const battColor = battPct == null ? "var(--color-text-muted)" : battPct > 50 ? "#22c55e" : battPct > 20 ? "#f59e0b" : "#ef4444";
  const memUsedMB = systemInfo.memory?.totalMB != null && systemInfo.memory?.freeMB != null
    ? Math.round(systemInfo.memory.totalMB - systemInfo.memory.freeMB) : null;
  const memPct = memUsedMB != null && systemInfo.memory?.totalMB
    ? Math.round((memUsedMB / systemInfo.memory.totalMB) * 100) : null;
  const diskPct = parseInt(systemInfo.disk?.usePercent?.replace("%", "") ?? "0");
  const diskColor = diskPct < 70 ? "#22c55e" : diskPct < 90 ? "#f59e0b" : "#ef4444";

  const cards = [
    {
      label: isVi ? "Pin" : "Battery", icon: battPct != null && battPct > 50 ? "🔋" : "🪫",
      value: battPct != null ? `${battPct}%` : "N/A",
      detail: systemInfo.battery?.charging
        ? (isVi ? "⚡ Đang sạc" : "⚡ Charging")
        : systemInfo.battery?.state || systemInfo.battery?.status || (isVi ? "Dùng pin" : "On battery"),
      valueColor: battColor,
    },
    {
      label: "Wi-Fi", icon: "📶",
      value: systemInfo.wifi?.ssid || (systemInfo.wifi?.connected ? (isVi ? "Đã kết nối" : "Connected") : (isVi ? "Mất kết nối" : "Disconnected")),
      detail: systemInfo.wifi?.ip || "",
      valueColor: systemInfo.wifi?.connected ? "#22c55e" : "#ef4444",
    },
    {
      label: isVi ? "Dung lượng đĩa" : "Disk Usage", icon: "💾",
      value: systemInfo.disk?.usePercent || "N/A",
      detail: systemInfo.disk ? `${systemInfo.disk.used} / ${systemInfo.disk.total}` : "",
      valueColor: diskColor,
    },
    {
      label: isVi ? "Tải CPU" : "CPU Load", icon: "🖥️",
      value: systemInfo.cpu?.loadAvg || "N/A",
      detail: isVi ? "Tải trung bình (1p / 5p / 15p)" : "Load average (1m / 5m / 15m)",
      valueColor: "#6366f1",
    },
    {
      label: isVi ? "Bộ nhớ" : "Memory", icon: "🧠",
      value: memUsedMB != null
        ? `${memUsedMB} MB`
        : systemInfo.memory?.freeMB != null
          ? (isVi ? `${Math.round(systemInfo.memory.freeMB)} MB trống` : `${Math.round(systemInfo.memory.freeMB)} MB free`)
          : "N/A",
      detail: memPct != null
        ? (isVi
          ? `${memPct}% đã dùng trên ${Math.round(systemInfo.memory?.totalMB ?? 0)} MB`
          : `${memPct}% used of ${Math.round(systemInfo.memory?.totalMB ?? 0)} MB`)
        : systemInfo.memory?.totalMB
          ? (isVi ? `tổng ${Math.round(systemInfo.memory.totalMB)} MB` : `of ${Math.round(systemInfo.memory.totalMB)} MB total`)
          : "",
      valueColor: memPct != null ? (memPct < 70 ? "#22c55e" : memPct < 90 ? "#f59e0b" : "#ef4444") : "var(--color-text-secondary)",
    },
    {
      label: isVi ? "Tên máy" : "Hostname", icon: "🏠",
      value: systemInfo.hostname || (isVi ? "Không rõ" : "Unknown"),
      detail: isVi ? "Định danh hệ thống" : "System identifier",
      valueColor: "#22d3ee",
    },
  ];

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>

        {/* Header */}
        <div className="animate-fade-in" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: "linear-gradient(135deg, rgba(16,185,129,0.3), rgba(34,211,238,0.2))",
              border: "1px solid rgba(16,185,129,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
            }}>
              🖥️
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: "white" }}>
                {isVi ? "Thông tin hệ thống" : "System Information"}
              </h2>
              <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
                {systemInfo.hostname} {isVi ? "- giám sát tài nguyên thời gian thực" : "- real-time resource monitoring"}
              </p>
            </div>
          </div>
          <button onClick={() => getClient().requestSystemDashboard()} className="btn-ghost" style={{ padding: "8px 16px", fontSize: "0.8rem" }}>
            {isVi ? "Làm mới" : "Refresh"}
          </button>
        </div>

        {/* Metrics grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
          {cards.map((card, i) => (
            <div key={card.label} className="animate-fade-in" style={{ animationDelay: `${i * 0.05}s` }}>
              <InfoCard {...card} />
            </div>
          ))}
        </div>

        {/* Voice Identity section */}
        <div className="glass animate-fade-in" style={{ borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{
            padding: "16px 22px", borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: "rgba(99,102,241,0.05)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>🎙️</span>
              <div>
                <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "white" }}>
                  {isVi ? "Định danh giọng nói" : "Voice Identity"}
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                  {isVi ? "Đăng ký/xác thực voiceprint người nói (SpeechBrain ECAPA-TDNN)" : "Enroll/verify speaker voiceprint (SpeechBrain ECAPA-TDNN)"}
                </div>
              </div>
            </div>
            <span style={{
              fontSize: "0.7rem", fontWeight: 700, padding: "4px 10px", borderRadius: "20px",
              background: connectionState === "connected" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
              color: connectionState === "connected" ? "#22c55e" : "#ef4444",
              border: connectionState === "connected" ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(239,68,68,0.3)",
            }}>
              {connectionState === "connected" ? (isVi ? "Gateway đang chạy" : "Gateway Live") : (isVi ? "Gateway ngoại tuyến" : "Gateway Offline")}
            </span>
          </div>

          <div style={{ padding: "20px 22px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{isVi ? "ID người nói" : "Speaker ID"}</span>
                <input className="omni-input" value={voiceUserId} onChange={e => setVoiceUserId(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{isVi ? "Tên hiển thị" : "Display Name"}</span>
                <input className="omni-input" value={voiceDisplayName} onChange={e => setVoiceDisplayName(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{isVi ? "Ngưỡng" : "Threshold"}</span>
                <input className="omni-input" type="number" min="0" max="1" step="0.01" value={voiceThreshold} onChange={e => setVoiceThreshold(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{isVi ? "File âm thanh" : "Audio File"}</span>
                <input
                  type="file" accept="audio/*"
                  onChange={e => setVoiceFile(e.target.files?.[0] ?? null)}
                  className="omni-input"
                  style={{ padding: "7px 14px" }}
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              <button
                onClick={() => callVoiceApi("/api/voice/enroll")}
                disabled={voiceBusy || !voiceFile}
                className="btn-primary"
              >
                {voiceBusy ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeDasharray="31.4 15" />
                    </svg>
                    {isVi ? "Đang xử lý..." : "Processing..."}
                  </span>
                ) : (isVi ? "🧬 Đăng ký giọng nói" : "🧬 Enroll Voice")}
              </button>
              <button
                onClick={() => callVoiceApi("/api/voice/verify")}
                disabled={voiceBusy || !voiceFile}
                className="btn-ghost"
              >
                {isVi ? "🔐 Xác thực giọng nói" : "🔐 Verify Voice"}
              </button>
            </div>

            {voiceResult && (
              <pre className="code-output animate-fade-in">
                {voiceResult}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
