import { useEffect } from "react";
import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";

export function HealthDashboard() {
  const health = useChatStore((s) => s.health);
  const connectionState = useChatStore((s) => s.connectionState);

  useEffect(() => {
    if (connectionState === "connected") {
      getClient().requestHealth();
      const interval = setInterval(() => getClient().requestHealth(), 30000);
      return () => clearInterval(interval);
    }
  }, [connectionState]);

  if (!health) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        {connectionState !== "connected"
          ? "Connect to gateway to view health"
          : "Loading health data..."}
      </div>
    );
  }

  const overallColor =
    health.overall === "healthy" ? "text-success" :
    health.overall === "degraded" ? "text-warning" : "text-error";

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-semibold">System Health</h2>
            <p className="text-text-muted text-sm">{health.timestamp}</p>
          </div>
          <div className={`text-xl font-bold ${overallColor}`}>
            {health.overall.toUpperCase()}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {Object.entries(health.sensors).map(([name, sensor]) => {
            const color =
              sensor.status === "ok" ? "border-success/30 bg-success/5" :
              sensor.status === "warning" ? "border-warning/30 bg-warning/5" :
              "border-error/30 bg-error/5";
            const textColor =
              sensor.status === "ok" ? "text-success" :
              sensor.status === "warning" ? "text-warning" : "text-error";

            return (
              <div key={name} className={`border rounded-xl p-4 ${color}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-text-secondary capitalize">{name}</span>
                  <span className={`text-sm font-medium ${textColor}`}>
                    {sensor.status.toUpperCase()}
                  </span>
                </div>
                <div className="text-2xl font-bold">{sensor.value}<span className="text-sm text-text-muted ml-1">{sensor.unit}</span></div>
                {sensor.message && <p className="text-text-muted text-xs mt-1">{sensor.message}</p>}
              </div>
            );
          })}
        </div>

        {health.alerts.length > 0 && (
          <div className="border border-warning/30 rounded-xl p-4">
            <h3 className="font-medium mb-2">Alerts</h3>
            {health.alerts.map((alert, i) => (
              <div key={i} className="flex items-center gap-2 text-sm py-1">
                <span className={alert.severity === "critical" ? "text-error" : "text-warning"}>
                  [{alert.severity}]
                </span>
                <span>{alert.sensor}: {alert.message}</span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => getClient().requestHealth()}
          className="mt-4 px-4 py-2 bg-bg-tertiary hover:bg-bg-hover rounded-lg text-sm transition-colors"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
