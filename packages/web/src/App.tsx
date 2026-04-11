import { useState } from "react";
import { useGateway } from "./hooks/useGateway";
import { useChatStore } from "./lib/chat-store";
import { ChatView } from "./components/ChatView";
import { HealthDashboard } from "./components/HealthDashboard";
import { SystemPanel } from "./components/SystemPanel";
import { SettingsPanel } from "./components/SettingsPanel";

type View = "chat" | "health" | "system" | "settings";

export function App() {
  const [view, setView] = useState<View>("chat");
  useGateway();
  const connectionState = useChatStore((s) => s.connectionState);
  const llmPreflight = useChatStore((s) => s.llmPreflight);

  const statusColor =
    connectionState === "connected" ? "bg-success" :
    connectionState === "connecting" ? "bg-warning" : "bg-error";

  const statusText =
    connectionState === "connected" ? "Connected" :
    connectionState === "connecting" ? "Connecting..." : "Disconnected";

  const llmStatusColor =
    !llmPreflight ? "bg-bg-hover" :
    llmPreflight.ok ? "bg-success" :
    llmPreflight.status === "insufficient_credits" ? "bg-warning" : "bg-error";

  const llmStatusText =
    !llmPreflight ? "Not checked" :
    llmPreflight.ok ? "Ready" :
    llmPreflight.status === "insufficient_credits" ? "No credits" :
    llmPreflight.status === "auth_error" ? "Auth failed" :
    llmPreflight.status === "missing_key" ? "Missing key" : "API error";

  const navItems: Array<{ id: View; label: string; icon: string }> = [
    { id: "chat", label: "Chat", icon: "💬" },
    { id: "system", label: "System", icon: "🖥️" },
    { id: "health", label: "Health", icon: "🩺" },
    { id: "settings", label: "Settings", icon: "⚙️" },
  ];

  return (
    <div className="flex h-screen bg-bg-primary text-text-primary">
      {/* Sidebar */}
      <aside className="w-64 bg-bg-secondary border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <span className="text-2xl">🧠</span> OmniState
          </h1>
          <p className="text-xs text-text-muted mt-1">Shadow OS for macOS</p>
        </div>

        <nav className="flex-1 p-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors flex items-center gap-2 ${
                view === item.id ? "bg-accent text-white" : "hover:bg-bg-hover text-text-secondary"
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Status */}
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <span className={`w-2 h-2 rounded-full ${statusColor}`} />
            {statusText}
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col">
        <header className="h-14 border-b border-border bg-bg-secondary px-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-text-primary">OmniState Console</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-bg-tertiary text-xs text-text-secondary">
              <span className={`w-2 h-2 rounded-full ${statusColor}`} />
              <span>{statusText}</span>
            </div>
            <div
              className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-bg-tertiary text-xs text-text-secondary"
              title={llmPreflight?.message ?? "No preflight result yet"}
            >
              <span className={`w-2 h-2 rounded-full ${llmStatusColor}`} />
              <span>LLM {llmStatusText}</span>
            </div>
          </div>
        </header>

        <div className="flex-1 min-h-0">
          {view === "chat" && <ChatView />}
          {view === "system" && <SystemPanel />}
          {view === "health" && <HealthDashboard />}
          {view === "settings" && <SettingsPanel />}
        </div>
      </main>
    </div>
  );
}
