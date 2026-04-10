import { useState } from "react";

type View = "chat" | "health";

export function App() {
  const [view, setView] = useState<View>("chat");

  return (
    <div className="flex h-screen bg-bg-primary text-text-primary">
      {/* Sidebar */}
      <aside className="w-64 bg-bg-secondary border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <span className="text-2xl">🧠</span> OmniState
          </h1>
        </div>

        <nav className="flex-1 p-2">
          <button
            onClick={() => setView("chat")}
            className={`w-full text-left px-3 py-2 rounded-lg mb-1 transition-colors ${
              view === "chat" ? "bg-accent text-white" : "hover:bg-bg-hover text-text-secondary"
            }`}
          >
            💬 Chat
          </button>
          <button
            onClick={() => setView("health")}
            className={`w-full text-left px-3 py-2 rounded-lg mb-1 transition-colors ${
              view === "health" ? "bg-accent text-white" : "hover:bg-bg-hover text-text-secondary"
            }`}
          >
            🩺 Health
          </button>
        </nav>

        {/* Status */}
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <span className="w-2 h-2 rounded-full bg-error" />
            Disconnected
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col">
        {view === "chat" ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-muted">
            <p className="text-6xl mb-4">🧠</p>
            <p className="text-xl font-medium mb-2">OmniState</p>
            <p>Control your computer with natural language</p>
            <p className="text-sm mt-4">Connecting to gateway...</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-text-muted">
            <p className="text-4xl mb-4">🩺</p>
            <p>Health Dashboard — coming soon</p>
          </div>
        )}
      </main>
    </div>
  );
}
