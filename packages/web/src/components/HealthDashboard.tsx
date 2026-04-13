import { useEffect } from "react";
import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";

function GaugeCircle({ value, max, color, size = 64 }: { value: number; max: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(value / max, 1);
  return (
    <svg width={size} height={size} className="gauge-ring">
      <circle cx={size / 2} cy={size / 2} r={r} className="gauge-track" strokeWidth="5" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        className="gauge-value"
        stroke={color} strokeWidth="5"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - pct)}
      />
    </svg>
  );
}

function SensorCard({ name, sensor }: { name: string; sensor: { status: string; value: number; unit: string; message?: string } }) {
  const isOk = sensor.status === "ok";
  const isWarn = sensor.status === "warning";

  const color = isOk ? "#22c55e" : isWarn ? "#f59e0b" : "#ef4444";

  const icons: Record<string, string> = {
    cpu: "🖥️", memory: "🧠", disk: "💾", network: "📡", processes: "⚙️",
  };

  const pct = Math.min((sensor.value / (name === "memory" ? 32768 : 100)) * 100, 100);

  return (
    <div className="glow-card" style={{ padding: 20 }}>
      <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, borderRadius: "50%", background: `radial-gradient(circle, ${color}18, transparent)`, pointerEvents: "none" }} />

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>{icons[name] ?? "📊"}</span>
          <span style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", textTransform: "capitalize", fontWeight: 600 }}>{name}</span>
        </div>
        <span className={`neon-badge ${isOk ? "neon-badge-ok" : isWarn ? "neon-badge-warn" : "neon-badge-error"}`}>
          {sensor.status}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
        <div style={{ position: "relative" }}>
          <GaugeCircle value={pct} max={100} color={color} size={56} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", fontWeight: 700, color }}>
            {Math.round(pct)}%
          </div>
        </div>
        <div>
          <span style={{ fontSize: "1.8rem", fontWeight: 800, color: "white", lineHeight: 1 }}>
            {sensor.value}
          </span>
          <span style={{ fontSize: "0.85rem", color, marginLeft: 4, fontWeight: 600 }}>{sensor.unit}</span>
        </div>
      </div>

      <div className="progress-bar" style={{ marginBottom: 8 }}>
        <div className="progress-fill" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}80, ${color})` }} />
      </div>

      {sensor.message && (
        <p style={{ margin: 0, fontSize: "0.73rem", color: "var(--color-text-muted)", lineHeight: 1.5 }}>{sensor.message}</p>
      )}
    </div>
  );
}

function AlertItem({ alert, index }: { alert: { sensor: string; severity: string; message: string }; index: number }) {
  const isCritical = alert.severity === "critical";
  return (
    <div
      className={`animate-fade-in ${isCritical ? "alert-critical" : "alert-warning"}`}
      style={{ borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 12, animationDelay: `${index * 0.05}s` }}
    >
      <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>{isCritical ? "🚨" : "⚠️"}</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: "0.78rem", fontWeight: 700, color: isCritical ? "#f43f5e" : "#f59e0b", textTransform: "capitalize" }}>{alert.sensor}</span>
          <span className={`neon-badge ${isCritical ? "neon-badge-error" : "neon-badge-warn"}`}>
            {alert.severity}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{alert.message}</p>
      </div>
    </div>
  );
}

export function HealthDashboard() {
  const health = useChatStore((s) => s.health);
  const connectionState = useChatStore((s) => s.connectionState);
  const appLanguage = useChatStore((s) => s.appLanguage);
  const isVi = appLanguage === "vi";

  useEffect(() => {
    if (connectionState === "connected") {
      getClient().requestHealth();
      const interval = setInterval(() => getClient().requestHealth(), 15000);
      return () => clearInterval(interval);
    }
  }, [connectionState]);

  const overallColor =
    health?.overall === "healthy" ? "#22c55e" :
    health?.overall === "degraded" ? "#f59e0b" : "#ef4444";

  const overallEmoji =
    health?.overall === "healthy" ? "✅" :
    health?.overall === "degraded" ? "⚠️" : "🚨";

  if (!health) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          {connectionState !== "connected" ? (
            <>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📡</div>
              <div style={{ fontSize: "1rem", color: "var(--color-text-secondary)", marginBottom: 4 }}>
                {isVi ? "Gateway chưa kết nối" : "Gateway not connected"}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                {isVi ? "Khởi động gateway daemon để xem sức khoẻ hệ thống" : "Start the gateway daemon to view health"}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 48, marginBottom: 12 }} className="animate-float">❤️‍🔥</div>
              <div style={{ fontSize: "1rem", color: "var(--color-text-secondary)", marginBottom: 4 }}>
                {isVi ? "Đang tải dữ liệu sức khoẻ..." : "Loading health data..."}
              </div>
              <div className="skeleton" style={{ width: 120, height: 8, borderRadius: 4, margin: "8px auto" }} />
            </>
          )}
        </div>
      </div>
    );
  }

  const sensorEntries = Object.entries(health.sensors);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>

        {/* Header with hero gradient */}
        <div className="hero-gradient animate-fade-in" style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: `${overallColor}20`,
              border: `1px solid ${overallColor}40`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24,
            }}>
              {overallEmoji}
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: "white" }}>
                {isVi ? "Theo dõi sức khoẻ" : "Health Monitor"}
              </h2>
              <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
                {isVi ? "Cập nhật lúc:" : "Last updated:"} {new Date(health.timestamp).toLocaleString()}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className={`neon-badge ${health.overall === "healthy" ? "neon-badge-ok" : health.overall === "degraded" ? "neon-badge-warn" : "neon-badge-error"}`}
              style={{ fontSize: "0.8rem", padding: "6px 14px" }}>
              {health.overall.toUpperCase()}
            </div>
            <button
              onClick={() => getClient().requestHealth()}
              className="btn-ghost" style={{ padding: "8px 16px", fontSize: "0.8rem" }}
            >
              {isVi ? "Làm mới" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Sensor grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24 }}>
          {sensorEntries.map(([name, sensor], i) => (
            <div key={name} className="card-reveal" style={{ animationDelay: `${i * 0.06}s` }}>
              <SensorCard name={name} sensor={sensor} />
            </div>
          ))}
        </div>

        {/* Alerts */}
        {health.alerts.length > 0 && (
          <div className="glow-card animate-fade-in" style={{ padding: 0, marginBottom: 20, overflow: "hidden" }}>
            <div style={{
              padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)",
              display: "flex", alignItems: "center", justifyContent: "space-between"
            }}>
              <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {isVi ? "Cảnh báo đang hoạt động" : "Active Alerts"} ({health.alerts.length})
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {health.alerts.filter(a => a.severity === "critical").length > 0 && (
                  <span className="neon-badge neon-badge-error">
                    🚨 {health.alerts.filter(a => a.severity === "critical").length} {isVi ? "nghiêm trọng" : "critical"}
                  </span>
                )}
                {health.alerts.filter(a => a.severity !== "critical").length > 0 && (
                  <span className="neon-badge neon-badge-warn">
                    ⚠️ {health.alerts.filter(a => a.severity !== "critical").length} {isVi ? "cảnh báo" : "warning"}
                  </span>
                )}
              </div>
            </div>
            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              {health.alerts.map((alert, i) => (
                <AlertItem key={i} alert={alert} index={i} />
              ))}
            </div>
          </div>
        )}

        {health.alerts.length === 0 && (
          <div className="glow-card animate-fade-in" style={{ padding: 28, textAlign: "center", borderColor: "rgba(34,197,94,0.15)" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🟢</div>
            <div style={{ fontSize: "0.95rem", color: "#22c55e", fontWeight: 600, marginBottom: 4 }}>
              {isVi ? "Tất cả hệ thống ổn định" : "All systems nominal"}
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
              {isVi ? "Không phát hiện cảnh báo. OmniState đang vận hành ổn định." : "No alerts detected. OmniState is running healthy."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
