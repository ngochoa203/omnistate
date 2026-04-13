import { useEffect } from "react";
import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";

function GaugeCircle({ value, max, color, size = 56 }: { value: number; max: number; color: string; size?: number }) {
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(value / max, 1);
  return (
    <svg width={size} height={size} className="gauge-ring">
      <circle cx={size / 2} cy={size / 2} r={r} className="gauge-track" strokeWidth="4" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        className="gauge-value"
        stroke={color} strokeWidth="4"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - pct)}
      />
    </svg>
  );
}

function InfoCard({ label, value, detail, icon, valueColor, pct }: {
  label: string; value: string; detail?: string; icon: string; valueColor?: string; pct?: number;
}) {
  return (
    <div className="glow-card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>
        </div>
        {pct != null && (
          <div style={{ position: "relative" }}>
            <GaugeCircle value={pct} max={100} color={valueColor ?? "#6366f1"} size={44} />
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.55rem", fontWeight: 700, color: valueColor ?? "#6366f1" }}>
              {pct}%
            </div>
          </div>
        )}
      </div>
      <div style={{ fontSize: "1.3rem", fontWeight: 800, color: valueColor ?? "white", lineHeight: 1, marginBottom: 4 }}>{value}</div>
      {detail && <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: 4 }}>{detail}</div>}
      {pct != null && (
        <div className="progress-bar" style={{ marginTop: 10 }}>
          <div className="progress-fill" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${valueColor ?? "#6366f1"}80, ${valueColor ?? "#6366f1"})` }} />
        </div>
      )}
    </div>
  );
}

export function SystemPanel() {
  const systemInfo = useChatStore((s) => s.systemInfo);
  const health = useChatStore((s) => s.health);
  const connectionState = useChatStore((s) => s.connectionState);
  const appLanguage = useChatStore((s) => s.appLanguage);
  const isVi = appLanguage === "vi";

  useEffect(() => {
    if (connectionState === "connected") {
      getClient().requestSystemDashboard();
      getClient().requestHealth();
      const interval = setInterval(() => {
        getClient().requestSystemDashboard();
        getClient().requestHealth();
      }, 15000);
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
  const cpuVal = health?.sensors?.cpu?.value ?? 0;

  const cards = [
    {
      label: isVi ? "Tải CPU" : "CPU Load", icon: "🖥️",
      value: systemInfo.cpu?.loadAvg || `${cpuVal}%`,
      detail: isVi ? "Tải trung bình (1p / 5p / 15p)" : "Load average (1m / 5m / 15m)",
      valueColor: "#6366f1",
      pct: Math.round(cpuVal),
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
      valueColor: memPct != null ? (memPct < 70 ? "#22c55e" : memPct < 90 ? "#f59e0b" : "#ef4444") : "#22d3ee",
      pct: memPct ?? undefined,
    },
    {
      label: isVi ? "Dung lượng đĩa" : "Disk", icon: "💾",
      value: systemInfo.disk?.usePercent || "N/A",
      detail: systemInfo.disk ? `${systemInfo.disk.used} / ${systemInfo.disk.total}` : "",
      valueColor: diskColor,
      pct: diskPct,
    },
    {
      label: isVi ? "Pin" : "Battery", icon: battPct != null && battPct > 50 ? "🔋" : "🪫",
      value: battPct != null ? `${battPct}%` : "N/A",
      detail: systemInfo.battery?.charging
        ? (isVi ? "⚡ Đang sạc" : "⚡ Charging")
        : systemInfo.battery?.state || systemInfo.battery?.status || (isVi ? "Dùng pin" : "On battery"),
      valueColor: battColor,
      pct: battPct ?? undefined,
    },
    {
      label: "Wi-Fi", icon: "📶",
      value: systemInfo.wifi?.ssid || (systemInfo.wifi?.connected ? (isVi ? "Đã kết nối" : "Connected") : (isVi ? "Mất kết nối" : "Disconnected")),
      detail: systemInfo.wifi?.ip || "",
      valueColor: systemInfo.wifi?.connected ? "#22c55e" : "#ef4444",
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
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>

        {/* Header */}
        <div className="hero-gradient animate-fade-in" style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: "linear-gradient(135deg, rgba(16,185,129,0.3), rgba(34,211,238,0.2))",
              border: "1px solid rgba(16,185,129,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24,
            }}>
              🖥️
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: "white" }}>
                {isVi ? "Thông tin hệ thống" : "System Information"}
              </h2>
              <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
                {systemInfo.hostname} — {isVi ? "giám sát tài nguyên thời gian thực" : "real-time resource monitoring"}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`neon-badge ${connectionState === "connected" ? "neon-badge-ok" : "neon-badge-error"}`}>
              {connectionState === "connected" ? "● Live" : "● Offline"}
            </span>
            <button onClick={() => getClient().requestSystemDashboard()} className="btn-ghost" style={{ padding: "8px 16px", fontSize: "0.8rem" }}>
              {isVi ? "Làm mới" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Metrics grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24 }}>
          {cards.map((card, i) => (
            <div key={card.label} className="card-reveal" style={{ animationDelay: `${i * 0.06}s` }}>
              <InfoCard {...card} />
            </div>
          ))}
        </div>

        {/* Network details */}
        {systemInfo.wifi && (
          <div className="glow-card animate-fade-in" style={{ padding: 20, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 20 }}>🌐</span>
              <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "white" }}>
                {isVi ? "Chi tiết mạng" : "Network Details"}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              <div>
                <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>SSID</div>
                <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "white" }}>{systemInfo.wifi.ssid || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>IP</div>
                <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "white", fontFamily: "monospace" }}>{systemInfo.wifi.ip || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{isVi ? "Trạng thái" : "Status"}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div className={`status-dot ${systemInfo.wifi.connected ? "connected" : "disconnected"}`} />
                  <span style={{ fontSize: "0.9rem", fontWeight: 600, color: systemInfo.wifi.connected ? "#22c55e" : "#ef4444" }}>
                    {systemInfo.wifi.connected ? (isVi ? "Đã kết nối" : "Connected") : (isVi ? "Mất kết nối" : "Disconnected")}
                  </span>
                </div>
              </div>
            </div>
            {health?.sensors?.network?.message && (
              <div style={{ marginTop: 12, fontSize: "0.75rem", color: "var(--color-text-muted)", padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                {health.sensors.network.message}
              </div>
            )}
          </div>
        )}

        {/* Quick actions */}
        <div className="glow-card animate-fade-in" style={{ padding: 20 }}>
          <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
            {isVi ? "Tác vụ nhanh" : "Quick Actions"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-ghost" style={{ fontSize: "0.78rem", padding: "8px 14px" }} onClick={() => { useChatStore.getState().addUserMessage("check disk space"); getClient().sendTask("check disk space"); }}>
              💾 {isVi ? "Kiểm tra đĩa" : "Check Disk"}
            </button>
            <button className="btn-ghost" style={{ fontSize: "0.78rem", padding: "8px 14px" }} onClick={() => { useChatStore.getState().addUserMessage("show top processes by CPU"); getClient().sendTask("show top processes by CPU"); }}>
              ⚙️ {isVi ? "Top tiến trình" : "Top Processes"}
            </button>
            <button className="btn-ghost" style={{ fontSize: "0.78rem", padding: "8px 14px" }} onClick={() => { useChatStore.getState().addUserMessage("check network connectivity"); getClient().sendTask("check network connectivity"); }}>
              📡 {isVi ? "Kiểm tra mạng" : "Check Network"}
            </button>
            <button className="btn-ghost" style={{ fontSize: "0.78rem", padding: "8px 14px" }} onClick={() => { useChatStore.getState().addUserMessage("how long has the system been running?"); getClient().sendTask("how long has the system been running?"); }}>
              ⏱️ Uptime
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
