import { useEffect } from "react";
import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";
import { getCopy } from "../lib/i18n";

type View = "dashboard" | "chat" | "voice" | "health" | "system" | "settings" | "config";

interface Props {
  onNavigate: (view: View) => void;
}

function GaugeCircle({ value, max, color, size = 72 }: { value: number; max: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(value / max, 1);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.06)" strokeWidth="6" fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        stroke={color} strokeWidth="6" fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - pct)}
        style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.16,1,0.3,1)" }}
      />
    </svg>
  );
}

function MetricGauge({
  label, value, displayValue, max, color, unit, icon
}: {
  label: string; value: number; displayValue?: string; max: number; color: string; unit: string; icon: string
}) {
  return (
    <div className="glass glass-hover" style={{ borderRadius: 16, padding: 20, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, right: 0, width: 80, height: 80, background: `radial-gradient(circle at 100% 0%, ${color}18, transparent)`, pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "white", lineHeight: 1 }}>
            {displayValue ?? value}<span style={{ fontSize: "0.6em", color, marginLeft: 3 }}>{unit}</span>
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <GaugeCircle value={value} max={max} color={color} size={60} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
            {icon}
          </div>
        </div>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${Math.min((value / max) * 100, 100)}%`, background: color }} />
      </div>
    </div>
  );
}

export function DashboardOverview({ onNavigate }: Props) {
  const health = useChatStore((s) => s.health);
  const systemInfo = useChatStore((s) => s.systemInfo);
  const connectionState = useChatStore((s) => s.connectionState);
  const messages = useChatStore((s) => s.messages);
  const appLanguage = useChatStore((s) => s.appLanguage);
  const copy = getCopy(appLanguage);
  const isVi = appLanguage === "vi";

  useEffect(() => {
    if (connectionState === "connected") {
      const refresh = () => {
        getClient().requestHealth();
        getClient().requestSystemDashboard();
      };

      refresh();

      const id = setInterval(() => {
        if (!document.hidden) refresh();
      }, 30000);

      const onVisibility = () => {
        if (!document.hidden) refresh();
      };

      document.addEventListener("visibilitychange", onVisibility);

      return () => {
        clearInterval(id);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }
  }, [connectionState]);

  // Parse sensor values
  const cpuVal = health?.sensors?.cpu?.value ?? 0;
  const memVal = health?.sensors?.memory?.value ?? 0;
  const diskVal = parseInt(systemInfo?.disk?.usePercent?.replace("%", "") ?? "0");
  const netOk = health?.sensors?.network?.status === "ok";

  const battPct = systemInfo?.battery?.percentage ?? systemInfo?.battery?.percent ?? null;
  const freeMB = systemInfo?.memory?.freeMB ?? 0;
  const totalMB = systemInfo?.memory?.totalMB ?? 1;
  const memUsedPct = Math.round(((totalMB - freeMB) / totalMB) * 100);

  const recentMessages = messages.slice(-3).reverse();

  const quickOps = [
    {
      title: appLanguage === "vi" ? "Phân tích log lỗi mới nhất" : "Analyze latest error logs",
      command: "analyze the latest system logs and summarize critical errors",
    },
    {
      title: appLanguage === "vi" ? "Kiểm tra token/preflight" : "Check token/preflight",
      command: "omnistate config show",
    },
    {
      title: appLanguage === "vi" ? "Kiểm tra trạng thái gateway" : "Check gateway status",
      command: "/status",
    },
    {
      title: appLanguage === "vi" ? "Mở trang cấu hình OmniState" : "Open OmniState config",
      command: "",
      openConfig: true,
    },
    {
      title: appLanguage === "vi" ? "Mở voice chat" : "Open voice chat",
      command: "",
      openVoice: true,
    },
  ];

  const runQuickOp = (op: (typeof quickOps)[number]) => {
    if (op.openConfig) {
      onNavigate("config");
      return;
    }
    if (op.openVoice) {
      onNavigate("voice");
      return;
    }
    useChatStore.getState().addUserMessage(op.command);
    getClient().sendTask(op.command);
    onNavigate("chat");
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px" }}>
      <div style={{ maxWidth: 1300, margin: "0 auto" }}>

        {/* Hero greeting */}
        <div className="animate-fade-in" style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 700 }}>
                <span className="gradient-text">OmniState</span> {isVi ? "Trung tâm điều khiển" : "Control Center"}
              </h1>
              <p style={{ margin: "4px 0 0", color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
                {isVi ? "Shadow OS — tự động hóa thông minh cho" : "Shadow OS — intelligent automation for"} {systemInfo?.hostname ?? (isVi ? "Mac của bạn" : "your Mac")}
              </p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn-ghost" style={{ fontSize: "0.8rem", padding: "8px 16px" }} onClick={() => { getClient().requestHealth(); getClient().requestSystemDashboard(); }}>
                {isVi ? "Làm mới" : "Refresh"}
              </button>
              <button className="btn-primary" style={{ fontSize: "0.8rem", padding: "8px 16px" }} onClick={() => onNavigate("chat")}>
                ⚡ {isVi ? "Chạy tác vụ" : "Run Task"}
              </button>
            </div>
          </div>
        </div>

        {/* Quick-action cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { label: "AI Chat", sub: isVi ? "Tác vụ bằng ngôn ngữ tự nhiên" : "Natural language tasks", icon: "💬", view: "chat" as const, color: "#6366f1" },
            { label: isVi ? "Điều khiển giọng nói" : "Voice Control", sub: isVi ? "Nói chuyện với OmniState" : "Speak to OmniState", icon: "🎙️", view: "voice" as const, color: "#22d3ee" },
            { label: isVi ? "Theo dõi hệ thống" : "Health Monitor", sub: isVi ? "Chẩn đoán hệ thống" : "System diagnostics", icon: "❤️‍🔥", view: "health" as const, color: "#f43f5e" },
            { label: isVi ? "Thông tin hệ thống" : "System Info", sub: isVi ? "Tài nguyên & cảm biến" : "Resources & sensors", icon: "🖥️", view: "system" as const, color: "#10b981" },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => onNavigate(item.view)}
              className="glass glass-hover card-reveal"
              style={{
                borderRadius: 14, padding: "16px 18px",
                cursor: "pointer", textAlign: "left", border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(13,13,26,0.7)", backdropFilter: "blur(20px)",
                position: "relative", overflow: "hidden", transition: "all 0.2s",
                animationDelay: `${["chat", "voice", "health", "system"].indexOf(item.view) * 0.05}s`,
              }}
            >
              <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, borderRadius: "50%", background: `radial-gradient(circle, ${item.color}25, transparent)`, pointerEvents: "none" }} />
              <div style={{ fontSize: 24, marginBottom: 8 }}>{item.icon}</div>
              <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "white", marginBottom: 2 }}>{item.label}</div>
              <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>{item.sub}</div>
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
          {/* System Gauges */}
          <div style={{ gridColumn: "1 / 3", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <MetricGauge label="CPU Load" value={cpuVal} max={100} color="#6366f1" unit="%" icon="🖥️" />
            <MetricGauge label={isVi ? "Bộ nhớ" : "Memory"} value={memUsedPct} max={100} color="#22d3ee" unit="%" icon="🧠" />
            <MetricGauge label="Disk" value={diskVal} max={100} color={diskVal > 90 ? "#ef4444" : diskVal > 70 ? "#f59e0b" : "#10b981"} unit="%" icon="💾" />
            <MetricGauge label="Battery" value={battPct ?? 100} max={100} color={battPct != null && battPct < 20 ? "#ef4444" : "#f59e0b"} unit="%" icon="🔋"
              displayValue={battPct != null ? `${battPct}` : "N/A"} />
            <div className="glass glass-hover" style={{ borderRadius: 16, padding: 20, gridColumn: "span 2" }}>
              <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>{isVi ? "Mạng" : "Network"}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                  background: netOk ? "#22c55e" : "#ef4444",
                  boxShadow: netOk ? "0 0 8px #22c55e" : "none"
                }} />
                <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "white" }}>
                  {netOk ? (isVi ? "Đã kết nối" : "Connected") : (isVi ? "Mất kết nối" : "Disconnected")}
                </span>
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                {systemInfo?.wifi?.ssid ? `Wi-Fi: ${systemInfo.wifi.ssid}` : (isVi ? "Không có thông tin trạng thái mạng" : "Network status unknown")}<br />
                {systemInfo?.wifi?.ip ? `IP: ${systemInfo.wifi.ip}` : ""}
              </div>
              {health?.sensors?.network?.message && (
                <div style={{ fontSize: "0.7rem", color: netOk ? "var(--color-text-muted)" : "#ef4444", marginTop: 6 }}>
                  {health.sensors.network.message}
                </div>
              )}
            </div>
          </div>

          {/* Right column: alerts + health */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Overall health */}
            <div className="glass glass-hover" style={{ borderRadius: 16, padding: 20, flex: "none" }}>
              <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>{isVi ? "Sức khỏe hệ thống" : "System Health"}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 36 }}>
                  {!health ? "⏳" : health.overall === "healthy" ? "✅" : health.overall === "degraded" ? "⚠️" : "🚨"}
                </div>
                <div>
                  <div style={{
                    fontSize: "1.1rem", fontWeight: 700,
                    color: !health ? "#5a5a7a" : health.overall === "healthy" ? "#22c55e" : health.overall === "degraded" ? "#f59e0b" : "#ef4444",
                    textTransform: "capitalize",
                  }}>
                    {health?.overall ?? (isVi ? "Đang tải..." : "Loading...")}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                    {health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* Alerts */}
            <div className="glass glass-hover" style={{ borderRadius: 16, padding: 20, flex: 1 }}>
              <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>{isVi ? "Cảnh báo đang hoạt động" : "Active Alerts"}</div>
              {!health || health.alerts.length === 0 ? (
                <div style={{ textAlign: "center", padding: "12px 0" }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>✨</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>{isVi ? "Không có cảnh báo" : "No active alerts"}</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {health.alerts.slice(0, 4).map((alert, i) => (
                    <div key={i} className={alert.severity === "critical" ? "alert-critical" : "alert-warning"}
                      style={{ borderRadius: 8, padding: "8px 10px", display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <span style={{ fontSize: "0.8rem", flexShrink: 0 }}>{alert.severity === "critical" ? "🚨" : "⚠️"}</span>
                      <div>
                        <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "capitalize", marginBottom: 2, color: alert.severity === "critical" ? "#f43f5e" : "#f59e0b" }}>{alert.sensor}</div>
                        <div style={{ fontSize: "0.68rem", color: "var(--color-text-secondary)", lineHeight: 1.4 }}>{alert.message}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom row: recent tasks + quick operations */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Recent Tasks */}
          <div className="glass" style={{ borderRadius: 16, padding: 20, border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{copy.common.recentTasks}</div>
              <button onClick={() => onNavigate("chat")} style={{ fontSize: "0.72rem", color: "#6366f1", background: "none", border: "none", cursor: "pointer" }}>{copy.common.viewAll}</button>
            </div>
            {recentMessages.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--color-text-muted)", fontSize: "0.8rem" }}>
                {copy.common.noTasks} <button onClick={() => onNavigate("chat")} style={{ color: "#6366f1", background: "none", border: "none", cursor: "pointer", fontSize: "0.8rem" }}>{copy.common.startTask}</button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {recentMessages.map((msg) => (
                  <div key={msg.id} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: "0.8rem", marginTop: 2, flexShrink: 0 }}>{msg.role === "user" ? "👤" : "🤖"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.78rem", color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {msg.content || "..."}
                      </div>
                      <div style={{ fontSize: "0.65rem", color: "var(--color-text-muted)", marginTop: 2 }}>
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                    {msg.status && (
                      <span style={{
                        fontSize: "0.65rem", fontWeight: 700, flexShrink: 0,
                        color: msg.status === "complete" ? "#22c55e" : msg.status === "failed" ? "#ef4444" : "#f59e0b"
                      }}>
                        {msg.status === "complete" ? "✓" : msg.status === "failed" ? "✗" : "…"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick operations */}
          <div className="glass" style={{ borderRadius: 16, padding: 20, border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>
              {copy.dashboard.quickOps}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              {quickOps.map((op) => (
                <button
                  key={op.title}
                  onClick={() => runQuickOp(op)}
                  className="btn-ghost"
                  style={{
                    textAlign: "left",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 12px",
                    borderRadius: 10,
                  }}
                >
                  <span style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)" }}>{op.title}</span>
                  <span style={{ fontSize: "0.72rem", color: "#6366f1", fontWeight: 700 }}>{copy.dashboard.run}</span>
                </button>
              ))}
              <button
                onClick={() => onNavigate("voice")}
                className="btn-primary"
                style={{ marginTop: 8, fontSize: "0.8rem" }}
              >
                {copy.dashboard.openVoice}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
