import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";

export function SettingsPanel() {
  const ttsEnabled = useChatStore((s) => s.ttsEnabled);
  const setTtsEnabled = useChatStore((s) => s.setTtsEnabled);
  const connectionState = useChatStore((s) => s.connectionState);
  const llmPreflight = useChatStore((s) => s.llmPreflight);
  const endpoint = getClient().url;

  const llmStatusColor =
    !llmPreflight ? "text-text-muted" :
    llmPreflight.ok ? "text-success" :
    llmPreflight.status === "insufficient_credits" ? "text-warning" : "text-error";

  const llmStatusLabel =
    !llmPreflight ? "Not checked" :
    llmPreflight.ok ? "Ready" :
    llmPreflight.status === "insufficient_credits" ? "Insufficient credits" :
    llmPreflight.status === "auth_error" ? "Auth failed" :
    llmPreflight.status === "missing_key" ? "Missing key" : "API error";

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-semibold mb-6">Settings</h2>

        {/* Connection */}
        <section className="mb-8">
          <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-3">Connection</h3>
          <div className="bg-bg-tertiary rounded-xl p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-text-secondary">Gateway</span>
              <span className={`text-sm font-medium ${
                connectionState === "connected" ? "text-success" :
                connectionState === "connecting" ? "text-warning" : "text-error"
              }`}>
                {connectionState === "connected" ? "● Connected" :
                 connectionState === "connecting" ? "● Connecting..." : "● Disconnected"}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-text-secondary">Endpoint</span>
              <span className="text-text-muted text-sm font-mono">{endpoint}</span>
            </div>
          </div>
        </section>

        {/* LLM API */}
        <section className="mb-8">
          <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-3">LLM API</h3>
          <div className="bg-bg-tertiary rounded-xl p-4 space-y-3">
            <div className="flex justify-between items-center gap-3">
              <span className="text-text-secondary">Preflight</span>
              <span className={`text-sm font-medium ${llmStatusColor}`}>{llmStatusLabel}</span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-text-secondary">Required mode</span>
              <span className="text-text-muted text-sm">{llmPreflight?.required ? "Enabled" : "Disabled"}</span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-text-secondary">Base URL</span>
              <span className="text-text-muted text-xs font-mono truncate max-w-[60%] text-right">
                {llmPreflight?.baseURL ?? "Unknown"}
              </span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-text-secondary">Provider</span>
              <span className="text-text-muted text-sm">{llmPreflight?.providerId ?? "Unknown"}</span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-text-secondary">Model</span>
              <span className="text-text-muted text-sm font-mono">{llmPreflight?.model ?? "Unknown"}</span>
            </div>
            <div className="text-xs text-text-muted wrap-break-word">{llmPreflight?.message ?? "No preflight result yet."}</div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">
                {llmPreflight?.checkedAt ? `Last check: ${llmPreflight.checkedAt}` : "Never checked"}
              </span>
              <button
                onClick={() => getClient().requestLlmPreflight()}
                disabled={connectionState !== "connected"}
                className="px-3 py-1.5 bg-bg-hover hover:bg-accent/20 rounded-lg text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Check API
              </button>
            </div>
          </div>
        </section>

        {/* Voice */}
        <section className="mb-8">
          <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-3">Voice</h3>
          <div className="bg-bg-tertiary rounded-xl p-4 space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-text-primary">Voice Input</p>
                <p className="text-text-muted text-sm">Record voice commands via microphone</p>
              </div>
              <span className="text-success text-sm">Available</span>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-text-primary">Text-to-Speech</p>
                <p className="text-text-muted text-sm">Read responses aloud</p>
              </div>
              <button
                onClick={() => setTtsEnabled(!ttsEnabled)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  ttsEnabled ? "bg-accent" : "bg-bg-hover"
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  ttsEnabled ? "translate-x-5" : "translate-x-0"
                }`} />
              </button>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-text-primary">STT Engine</p>
                <p className="text-text-muted text-sm">Speech-to-text backend</p>
              </div>
              <span className="text-text-muted text-sm font-mono">Whisper (local)</span>
            </div>
          </div>
        </section>

        {/* About */}
        <section>
          <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-3">About</h3>
          <div className="bg-bg-tertiary rounded-xl p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-text-secondary">Version</span>
              <span className="text-text-muted text-sm">0.1.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Runtime</span>
              <span className="text-text-muted text-sm">Node.js + Rust N-API</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
