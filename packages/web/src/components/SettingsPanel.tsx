import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";
import { getCopy } from "../lib/i18n";

function SettingRow({ label, sub, control }: { label: string; sub?: string; control: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px" }}>
      <div>
        <div style={{ fontSize: "0.875rem", color: "var(--color-text-primary)", fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", marginTop: 2 }}>{sub}</div>}
      </div>
      {control}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div className="section-title">{title}</div>
      <div className="glass" style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,0.07)", overflow: "hidden" }}>
        {children}
      </div>
    </section>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "0 18px" }} />;
}

function StatusBadge({ status }: { status: "ok" | "warn" | "error" | "none" }) {
  const colors = {
    ok: { bg: "rgba(34,197,94,0.12)", text: "#22c55e", border: "rgba(34,197,94,0.25)", label: "● Ready" },
    warn: { bg: "rgba(245,158,11,0.12)", text: "#f59e0b", border: "rgba(245,158,11,0.25)", label: "⚠ Warning" },
    error: { bg: "rgba(239,68,68,0.12)", text: "#ef4444", border: "rgba(239,68,68,0.25)", label: "✕ Error" },
    none: { bg: "rgba(90,90,122,0.12)", text: "#5a5a7a", border: "rgba(90,90,122,0.25)", label: "– Unchecked" },
  }[status];
  return (
    <span style={{
      fontSize: "0.72rem", fontWeight: 700, padding: "4px 10px", borderRadius: "20px",
      background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
    }}>
      {colors.label}
    </span>
  );
}

export function SettingsPanel() {
  const appLanguage = useChatStore((s) => s.appLanguage);
  const copy = getCopy(appLanguage);
  const ttsEnabled = useChatStore((s) => s.ttsEnabled);
  const setTtsEnabled = useChatStore((s) => s.setTtsEnabled);
  const connectionState = useChatStore((s) => s.connectionState);
  const llmPreflight = useChatStore((s) => s.llmPreflight);
  const endpoint = getClient().url;

  const connStatus = connectionState === "connected" ? "ok" : connectionState === "connecting" ? "warn" : "error";
  const llmStatus: "ok" | "warn" | "error" | "none" = !llmPreflight ? "none" : llmPreflight.ok ? "ok" : llmPreflight.status === "insufficient_credits" ? "warn" : "error";

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>

        {/* Header */}
        <div className="animate-fade-in" style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: "linear-gradient(135deg, rgba(99,102,241,0.3), rgba(139,92,246,0.2))",
            border: "1px solid rgba(99,102,241,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
          }}>
            ⚙️
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: "white" }}>Settings</h2>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
              {appLanguage === "vi" ? "Cấu hình gateway, AI và voice" : "Configure gateway, AI, and voice preferences"}
            </p>
          </div>
        </div>

        {/* Connection */}
        <Section title={appLanguage === "vi" ? "Kết nối Gateway" : "Gateway Connection"}>
          <SettingRow
            label={appLanguage === "vi" ? "Trạng thái" : "Status"}
            sub={appLanguage === "vi" ? "Kết nối WebSocket tới gateway local" : "WebSocket connection to local gateway"}
            control={<StatusBadge status={connStatus} />}
          />
          <Divider />
          <SettingRow
            label="Endpoint"
            sub={appLanguage === "vi" ? "Địa chỉ Gateway WebSocket" : "Gateway WebSocket URL"}
            control={
              <span style={{ fontSize: "0.78rem", fontFamily: "monospace", color: "var(--color-text-muted)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {endpoint}
              </span>
            }
          />
        </Section>

        {/* LLM */}
        <Section title={appLanguage === "vi" ? "Nhà cung cấp LLM / AI" : "LLM / AI Provider"}>
          <SettingRow
            label={appLanguage === "vi" ? "Trạng thái Preflight" : "Preflight Status"}
            sub={llmPreflight?.message ?? (appLanguage === "vi" ? "Kiểm tra kết nối với API đã cấu hình" : "Run a connectivity check against the configured API")}
            control={<StatusBadge status={llmStatus} />}
          />
          <Divider />
          <SettingRow
            label={appLanguage === "vi" ? "Nhà cung cấp" : "Provider"}
            control={
              <span style={{ fontSize: "0.78rem", color: "var(--color-text-secondary)", fontWeight: 500 }}>
                {llmPreflight?.providerId ?? "—"}
              </span>
            }
          />
          <Divider />
          <SettingRow
            label="Model"
            control={
              <span style={{ fontSize: "0.78rem", fontFamily: "monospace", color: "var(--color-text-muted)" }}>
                {llmPreflight?.model ?? "—"}
              </span>
            }
          />
          <Divider />
          <SettingRow
            label="Base URL"
            control={
              <span style={{ fontSize: "0.72rem", fontFamily: "monospace", color: "var(--color-text-muted)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {llmPreflight?.baseURL ?? "—"}
              </span>
            }
          />
          <Divider />
          <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
              {llmPreflight?.checkedAt ? `Last checked: ${new Date(llmPreflight.checkedAt).toLocaleString()}` : "Never checked"}
            </span>
            <button
              onClick={() => getClient().requestLlmPreflight()}
              disabled={connectionState !== "connected"}
              className="btn-ghost"
              style={{ padding: "7px 14px", fontSize: "0.78rem" }}
            >
              {appLanguage === "vi" ? "Kiểm tra API" : "Check API"}
            </button>
          </div>
        </Section>

        {/* Voice */}
        <Section title="Voice">
          <SettingRow
            label={appLanguage === "vi" ? "Voice Input" : "Voice Input"}
            sub={appLanguage === "vi" ? "Ghi âm lệnh giọng nói từ chat" : "Record voice commands directly from the chat panel"}
            control={<StatusBadge status="ok" />}
          />
          <Divider />
          <SettingRow
            label={appLanguage === "vi" ? "Text-to-Speech" : "Text-to-Speech"}
            sub={appLanguage === "vi" ? "Đọc to phản hồi AI bằng Web Speech API" : "Read AI responses aloud using Web Speech API"}
            control={
              <button onClick={() => setTtsEnabled(!ttsEnabled)} className={`toggle ${ttsEnabled ? "on" : ""}`}>
                <div className="toggle-knob" />
              </button>
            }
          />
          <Divider />
          <SettingRow
            label="STT Engine"
            sub={appLanguage === "vi" ? "Backend speech-to-text" : "Speech-to-text backend"}
            control={
              <span style={{ fontSize: "0.78rem", fontFamily: "monospace", color: "var(--color-text-muted)" }}>
                Whisper (local)
              </span>
            }
          />
          <Divider />
          <SettingRow
            label={appLanguage === "vi" ? "Nhận diện người nói" : "Speaker Recognition"}
            sub={appLanguage === "vi" ? "Xác thực voiceprint ECAPA-TDNN" : "ECAPA-TDNN voiceprint authentication"}
            control={<StatusBadge status="ok" />}
          />
        </Section>

        {/* About */}
        <Section title={appLanguage === "vi" ? "Thông tin" : "About"}>
          <SettingRow label="Application" control={<span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>OmniState</span>} />
          <Divider />
          <SettingRow label="Version" control={<span style={{ fontSize: "0.78rem", fontFamily: "monospace", color: "var(--color-text-muted)" }}>0.1.0</span>} />
          <Divider />
          <SettingRow label="Runtime" control={<span style={{ fontSize: "0.78rem", fontFamily: "monospace", color: "var(--color-text-muted)" }}>Node.js 22 + Rust N-API</span>} />
          <Divider />
          <SettingRow label="License" control={<span style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>MIT</span>} />
          <Divider />
          <div style={{ padding: "12px 18px" }}>
            <a
              href="https://github.com/ngochoa203/omnistate"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "0.8rem", color: "#6366f1", textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.11.82-.26.82-.58v-2.03c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23.96-.27 1.98-.4 3-.4s2.04.14 3 .4c2.28-1.55 3.29-1.23 3.29-1.23.66 1.65.25 2.87.12 3.17.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.63-5.48 5.93.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              View on GitHub
            </a>
          </div>
        </Section>

      </div>
    </div>
  );
}
