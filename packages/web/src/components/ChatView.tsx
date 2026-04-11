import { useEffect, useRef, useCallback } from "react";
import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";
import { ChatInput } from "./ChatInput";
import { MessageBubble } from "./MessageBubble";
import { getCopy } from "../lib/i18n";

const QUICK_CMDS = [
  { label: "Disk space", cmd: "check disk space" },
  { label: "CPU usage", cmd: "show CPU usage and top processes" },
  { label: "Memory", cmd: "how much memory is available?" },
  { label: "Network", cmd: "check network connectivity" },
  { label: "Hostname", cmd: "what is my hostname?" },
  { label: "Uptime", cmd: "how long has the system been running?" },
];

function EmptyState({ onSend, disabled }: { onSend: (t: string) => void; disabled: boolean }) {
  const appLanguage = useChatStore((s) => s.appLanguage);
  const copy = getCopy(appLanguage);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
      <div className="animate-float" style={{ fontSize: 56, marginBottom: 16 }}>🧠</div>
      <h2 style={{ margin: "0 0 6px", fontSize: "1.4rem", fontWeight: 700 }}>
        <span className="gradient-text">OmniState</span>
      </h2>
      <p style={{ margin: "0 0 28px", color: "var(--color-text-muted)", fontSize: "0.875rem", textAlign: "center", maxWidth: 340, lineHeight: 1.6 }}>
        {copy.chat.emptyDesc}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, maxWidth: 480, width: "100%" }}>
        {QUICK_CMDS.map((item) => (
          <button
            key={item.cmd}
            onClick={() => onSend(item.cmd)}
            disabled={disabled}
            className="glass glass-hover"
            style={{
              padding: "10px 14px", borderRadius: 10, textAlign: "left",
              fontSize: "0.78rem", color: "var(--color-text-secondary)",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.4 : 1,
              border: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.03)",
              transition: "all 0.18s",
            }}
          >
            <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", display: "block", marginBottom: 2 }}>→</span>
            {item.label}
          </button>
        ))}
      </div>
      {disabled && (
        <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: "20px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <span style={{ color: "#ef4444", fontSize: "0.8rem" }}>⚠️ {copy.chat.gatewayOffline}</span>
        </div>
      )}
    </div>
  );
}

export function ChatView() {
  const appLanguage = useChatStore((s) => s.appLanguage);
  const copy = getCopy(appLanguage);
  const messages = useChatStore((s) => s.messages);
  const conversations = useChatStore((s) => s.conversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const createConversation = useChatStore((s) => s.createConversation);
  const switchConversation = useChatStore((s) => s.switchConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const connectionState = useChatStore((s) => s.connectionState);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = useCallback((text: string) => {
    useChatStore.getState().addUserMessage(text);
    getClient().sendTask(text);
  }, []);

  const handleClear = useCallback(() => {
    useChatStore.getState().clearMessages();
  }, []);

  const handleNewConversation = useCallback(() => {
    createConversation();
  }, [createConversation]);

  const handleRenameConversation = useCallback((id: string, currentName: string) => {
    const next = window.prompt(copy.chat.rename, currentName)?.trim();
    if (next) renameConversation(id, next);
  }, [renameConversation, copy.chat.rename]);

  const isConnected = connectionState === "connected";
  const pendingCount = messages.filter(m => m.status === "pending" || m.status === "streaming").length;

  return (
    <div style={{ height: "100%", display: "flex", minWidth: 0 }}>
      <aside style={{ width: 250, borderRight: "1px solid rgba(255,255,255,0.06)", background: "rgba(5,5,8,0.5)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <button className="btn-primary" style={{ width: "100%", fontSize: "0.8rem", padding: "9px 12px" }} onClick={handleNewConversation}>
            {copy.chat.newConversation}
          </button>
        </div>
        <div style={{ padding: "10px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            {copy.chat.conversations}
          </div>
          {conversations.map((conv) => {
            const active = conv.id === currentConversationId;
            return (
              <div
                key={conv.id}
                style={{
                  borderRadius: 10,
                  border: active ? "1px solid rgba(99,102,241,0.35)" : "1px solid rgba(255,255,255,0.06)",
                  background: active ? "rgba(99,102,241,0.14)" : "rgba(255,255,255,0.02)",
                  padding: "8px 10px",
                }}
              >
                <button
                  onClick={() => switchConversation(conv.id)}
                  style={{ width: "100%", background: "none", border: "none", color: active ? "white" : "var(--color-text-secondary)", textAlign: "left", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}
                >
                  {conv.name}
                </button>
                <div style={{ marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.68rem", color: "var(--color-text-muted)" }}>{conv.messageCount} {copy.common.messages}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn-ghost" style={{ padding: "2px 6px", fontSize: "0.64rem" }} onClick={() => handleRenameConversation(conv.id, conv.name)}>
                      {copy.chat.rename}
                    </button>
                    <button className="btn-ghost" style={{ padding: "2px 6px", fontSize: "0.64rem" }} onClick={() => deleteConversation(conv.id)}>
                      {copy.chat.delete}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(5,5,8,0.5)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
              {messages.length} {copy.common.messages}
            </span>
            {pendingCount > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.75rem", color: "#f59e0b" }}>
                <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="#f59e0b" strokeWidth="3" strokeDasharray="31.4 15" />
                </svg>
                {pendingCount} {copy.common.executing}
              </span>
            )}
          </div>
          <button onClick={handleClear} className="btn-ghost" style={{ padding: "5px 12px", fontSize: "0.75rem" }}>
            {copy.common.clear}
          </button>
        </div>

        {messages.length === 0 ? (
          <EmptyState onSend={handleSend} disabled={!isConnected} />
        ) : (
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
            <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
            </div>
          </div>
        )}

        <ChatInput onSend={handleSend} disabled={!isConnected} />
      </div>
    </div>
  );
}
