import { useState, useCallback } from "react";
import type { ChatMessage } from "../lib/chat-store";
import { useChatStore } from "../lib/chat-store";

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  const ttsEnabled = useChatStore((s) => s.ttsEnabled);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = message.content || "";
    navigator.clipboard.writeText(text)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => {});
  }, [message.content]);

  const handleSpeak = useCallback(() => {
    const text = message.content || "";
    if (!text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1; u.pitch = 1;
    window.speechSynthesis.speak(u);
  }, [message.content]);

  return (
    <div className="animate-fade-in" style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      {/* Avatar */}
      {!isUser && (
        <div style={{
          width: 30, height: 30, borderRadius: "50%", flexShrink: 0, marginRight: 10, marginTop: 2,
          background: "linear-gradient(135deg, #6366f1, #7c3aed)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, boxShadow: "0 2px 8px rgba(99,102,241,0.35)",
        }}>
          🧠
        </div>
      )}

      <div style={{ maxWidth: "78%" }}>
        {/* Bubble */}
        <div className={isUser ? "bubble-user" : "bubble-system"} style={{
          borderRadius: isUser ? "18px 18px 6px 18px" : "18px 18px 18px 6px",
          padding: "12px 16px",
        }}>
          {/* User content */}
          {isUser && (
            <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.875rem", lineHeight: 1.6 }}>{message.content}</p>
          )}

          {/* System content */}
          {!isUser && (
            <>
              {/* Loading */}
              {message.status === "pending" && (
                <div style={{ display: "flex", gap: 5, padding: "4px 0", alignItems: "center" }}>
                  <div className="animate-pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-text-muted)", animationDelay: "0ms" }} />
                  <div className="animate-pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-text-muted)", animationDelay: "200ms" }} />
                  <div className="animate-pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-text-muted)", animationDelay: "400ms" }} />
                </div>
              )}

              {message.status === "streaming" && !message.content && (
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#6366f1" }} className="animate-pulse-dot" />
              )}

              {/* Content */}
              {message.content && <OutputBlock content={message.content} data={message.data} />}

              {/* Error */}
              {message.status === "failed" && !message.content && (
                <p style={{ margin: 0, color: "#ef4444", fontSize: "0.875rem" }}>✗ Task failed</p>
              )}

              {/* Actions */}
              {message.content && message.status !== "pending" && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 4, marginTop: 10,
                  paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)"
                }}>
                  <ActionButton onClick={handleCopy} title={copied ? "Copied!" : "Copy"} icon={
                    copied
                      ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                      : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  } />
                  {ttsEnabled && (
                    <ActionButton onClick={handleSpeak} title="Read aloud" icon={
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                    } />
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Timestamp */}
        <div style={{ fontSize: "0.62rem", color: "var(--color-text-muted)", marginTop: 4, textAlign: isUser ? "right" : "left", paddingLeft: 4 }}>
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>

      {isUser && (
        <div style={{
          width: 30, height: 30, borderRadius: "50%", flexShrink: 0, marginLeft: 10, marginTop: 2,
          background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
        }}>
          👤
        </div>
      )}
    </div>
  );
}

function ActionButton({ onClick, title, icon }: { onClick: () => void; title: string; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "4px 8px", borderRadius: 6, fontSize: "0.7rem",
        color: "var(--color-text-muted)", background: "none", border: "none",
        cursor: "pointer", transition: "all 0.15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "var(--color-text-secondary)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--color-text-muted)"; }}
    >
      {icon}
      <span>{title}</span>
    </button>
  );
}

function OutputBlock({ content, data }: { content: string; data?: Record<string, unknown> }) {
  if (data && Object.keys(data).length > 0) return <FormattedData data={data} fallback={content} />;

  const trimmed = content.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try { return <FormattedData data={JSON.parse(trimmed)} fallback={content} />; } catch { /* fallthrough */ }
  }

  const looksLikeCode = /^(\s*[\/$~>]|.*\s{2,}\S|COMMAND\s+PID|USER\s+PID|Filesystem\s+)/m.test(trimmed);
  if (looksLikeCode) {
    return <pre className="code-output" style={{ margin: 0 }}>{content}</pre>;
  }

  return <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.875rem", lineHeight: 1.6, color: "var(--color-text-primary)" }}>{content}</p>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FormattedData({ data, fallback }: { data: any; fallback: string }) {
  if (data?.output && typeof data.output === "string") {
    return <pre className="code-output" style={{ margin: 0 }}>{data.output}</pre>;
  }

  if (typeof data === "object" && !Array.isArray(data)) {
    const entries = Object.entries(data).filter(([, v]) => v != null);
    if (entries.length <= 12 && entries.every(([, v]) => typeof v !== "object")) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: "0.82rem" }}>
          {entries.map(([key, value]) => (
            <div key={key} style={{ display: "flex", gap: 10 }}>
              <span style={{ color: "var(--color-text-muted)", minWidth: 100, flexShrink: 0 }}>{formatKey(key)}</span>
              <span style={{ color: "var(--color-text-primary)", fontFamily: "monospace", fontSize: "0.8rem" }}>{String(value)}</span>
            </div>
          ))}
        </div>
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object") {
    const keys = Object.keys(data[0]).slice(0, 5);
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ fontSize: "0.78rem", width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              {keys.map(k => <th key={k} style={{ textAlign: "left", color: "var(--color-text-muted)", padding: "4px 8px", fontWeight: 600 }}>{formatKey(k)}</th>)}
            </tr>
          </thead>
          <tbody>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {data.slice(0, 10).map((row: any, i: number) => (
              <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                {keys.map(k => <td key={k} style={{ padding: "5px 8px", fontFamily: "monospace", fontSize: "0.72rem", color: "var(--color-text-secondary)" }}>{String(row[k] ?? "")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {data.length > 10 && <p style={{ margin: "6px 0 0", fontSize: "0.7rem", color: "var(--color-text-muted)" }}>…and {data.length - 10} more rows</p>}
      </div>
    );
  }

  void fallback;
  return <pre className="code-output" style={{ margin: 0 }}>{JSON.stringify(data, null, 2)}</pre>;
}

function formatKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ").replace(/^\w/, c => c.toUpperCase()).trim();
}
