import { useEffect } from "react";
import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";

export function SystemPanel() {
  const systemInfo = useChatStore((s) => s.systemInfo);
  const connectionState = useChatStore((s) => s.connectionState);

  useEffect(() => {
    if (connectionState === "connected") {
      getClient().requestSystemDashboard();
      const interval = setInterval(() => getClient().requestSystemDashboard(), 15000);
      return () => clearInterval(interval);
    }
  }, [connectionState]);

  if (!systemInfo) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        {connectionState !== "connected" ? "Connect to gateway to view system info" : "Loading system data..."}
      </div>
    );
  }

  const cards = [
    {
      label: "Battery",
      icon: "🔋",
      value: systemInfo.battery?.percentage != null ? `${systemInfo.battery.percentage}%` :
             systemInfo.battery?.percent != null ? `${systemInfo.battery.percent}%` : "N/A",
      detail: systemInfo.battery?.charging ? "Charging" :
              systemInfo.battery?.state || systemInfo.battery?.status || "",
      color: (() => {
        const pct = systemInfo.battery?.percentage ?? systemInfo.battery?.percent ?? 100;
        return pct > 50 ? "text-success" : pct > 20 ? "text-warning" : "text-error";
      })(),
    },
    {
      label: "WiFi",
      icon: "📶",
      value: systemInfo.wifi?.ssid || (systemInfo.wifi?.connected ? "Connected" : "Disconnected"),
      detail: systemInfo.wifi?.ip || "",
      color: systemInfo.wifi?.connected ? "text-success" : "text-error",
    },
    {
      label: "Disk",
      icon: "💾",
      value: systemInfo.disk?.usePercent || "N/A",
      detail: systemInfo.disk ? `${systemInfo.disk.used} / ${systemInfo.disk.total}` : "",
      color: (() => {
        const pct = parseInt(systemInfo.disk?.usePercent || "0");
        return pct < 70 ? "text-success" : pct < 90 ? "text-warning" : "text-error";
      })(),
    },
    {
      label: "CPU",
      icon: "🖥️",
      value: systemInfo.cpu?.loadAvg || "N/A",
      detail: "Load average",
      color: "text-accent",
    },
    {
      label: "Memory",
      icon: "🧠",
      value: systemInfo.memory?.freeMB != null ? `${Math.round(systemInfo.memory.freeMB)}MB free` : "N/A",
      detail: systemInfo.memory?.totalMB ? `of ${Math.round(systemInfo.memory.totalMB)}MB` : "",
      color: (() => {
        if (!systemInfo.memory?.totalMB || !systemInfo.memory?.freeMB) return "text-text-secondary";
        const usedPct = ((systemInfo.memory.totalMB - systemInfo.memory.freeMB) / systemInfo.memory.totalMB) * 100;
        return usedPct < 70 ? "text-success" : usedPct < 90 ? "text-warning" : "text-error";
      })(),
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-semibold">System</h2>
            <p className="text-text-muted text-sm">{systemInfo.hostname}</p>
          </div>
          <button
            onClick={() => getClient().requestSystemDashboard()}
            className="px-4 py-2 bg-bg-tertiary hover:bg-bg-hover rounded-lg text-sm transition-colors"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <div key={card.label} className="bg-bg-tertiary rounded-xl p-5 border border-border hover:border-accent/30 transition-colors">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">{card.icon}</span>
                <span className="text-text-secondary text-sm font-medium">{card.label}</span>
              </div>
              <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              {card.detail && <p className="text-text-muted text-sm mt-1">{card.detail}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
