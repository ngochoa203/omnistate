import { useEffect, useRef, useCallback, useState } from "react";
import { buildClaudeMemPayloadFromState, useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";
import { ChatInput } from "./ChatInput";
import { MessageBubble } from "./MessageBubble";
import { getCopy } from "../lib/i18n";
import { buildTaskGoalWithMemory } from "../lib/session-memory";

type RuntimeProvider = {
  id: string;
  model?: string;
  models?: string[];
};

const QUICK_CMDS = [
  { label: "Disk space", cmd: "check disk space", icon: "💾" },
  { label: "CPU usage", cmd: "show CPU usage and top processes", icon: "🖥️" },
  { label: "Memory", cmd: "how much memory is available?", icon: "🧠" },
  { label: "Network", cmd: "check network connectivity", icon: "📡" },
  { label: "Hostname", cmd: "what is my hostname?", icon: "🏠" },
  { label: "Uptime", cmd: "how long has the system been running?", icon: "⏱️" },
];

function EmptyState({ onSend, disabled }: { onSend: (t: string) => void; disabled: boolean }) {
  const appLanguage = useChatStore((s) => s.appLanguage);
  const copy = getCopy(appLanguage);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
      <div className="animate-float" style={{ fontSize: 56, marginBottom: 16 }}>🧠</div>
      <h2 style={{ margin: "0 0 6px", fontSize: "1.4rem", fontWeight: 700 }}>
        <span className="gradient-text-cyber">OmniState</span>
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
            className="glow-card"
            style={{
              padding: "10px 14px", textAlign: "left",
              fontSize: "0.78rem", color: "var(--color-text-secondary)",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.4 : 1,
              transition: "all 0.18s",
            }}
          >
            <span style={{ fontSize: "0.9rem", display: "block", marginBottom: 4 }}>{item.icon}</span>
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
  const setConversationRuntime = useChatStore((s) => s.setConversationRuntime);
  const setSharedMemoryManual = useChatStore((s) => s.setSharedMemoryManual);
  const sessionStateByConversation = useChatStore((s) => s.sessionStateByConversation);
  const sharedMemorySummary = useChatStore((s) => s.sharedMemorySummary);
  const sharedMemoryLog = useChatStore((s) => s.sharedMemoryLog);
  const runtimeConfig = useChatStore((s) => s.runtimeConfig);
  const llmPreflight = useChatStore((s) => s.llmPreflight);
  const connectionState = useChatStore((s) => s.connectionState);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [memorySummaryDraft, setMemorySummaryDraft] = useState(sharedMemorySummary);
  const [memoryLogDraft, setMemoryLogDraft] = useState(sharedMemoryLog.join("\n"));

  const currentSessionState = sessionStateByConversation[currentConversationId];

  const providers = (() => {
    const cfg = runtimeConfig as { providers?: RuntimeProvider[] } | null;
    if (Array.isArray(cfg?.providers) && cfg.providers.length > 0) return cfg.providers;
    return [
      { id: "anthropic", model: "claude-haiku-4.5", models: ["claude-haiku-4.5", "claude-sonnet-4.6"] },
      { id: "router9", model: "cx/gpt-5.4", models: ["cx/gpt-5.4", "gh/claude-sonnet-4.6", "gh/gemini-3-flash-preview"] },
    ];
  })();

  const selectedProvider = providers.find((p) => p.id === currentSessionState?.provider);
  const modelOptions = selectedProvider?.models?.length
    ? selectedProvider.models
    : selectedProvider?.model
      ? [selectedProvider.model]
      : (currentSessionState?.model ? [currentSessionState.model] : []);

  useEffect(() => {
    if (!currentSessionState) {
      const provider = llmPreflight?.providerId || "anthropic";
      const model = llmPreflight?.model || "";
      setConversationRuntime(currentConversationId, { provider, model });
    }
  }, [currentConversationId, currentSessionState, llmPreflight, setConversationRuntime]);

  useEffect(() => {
    if (connectionState !== "connected") return;
    if (!currentSessionState) return;
    if (currentSessionState.provider) getClient().setRuntimeConfig("provider", currentSessionState.provider);
    if (currentSessionState.model) getClient().setRuntimeConfig("model", currentSessionState.model);
  }, [connectionState, currentConversationId, currentSessionState]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    setMemorySummaryDraft(sharedMemorySummary);
    setMemoryLogDraft(sharedMemoryLog.join("\n"));
  }, [sharedMemorySummary, sharedMemoryLog]);

  const handleSend = useCallback((text: string) => {
    const state = useChatStore.getState();
    const sessionState = state.sessionStateByConversation[state.currentConversationId];
    const provider = sessionState?.provider || llmPreflight?.providerId || "anthropic";
    const model = sessionState?.model || llmPreflight?.model || "";

    state.addUserMessage(text);
    state.noteOutboundTaskRequest(state.currentConversationId);

    if (provider) getClient().setRuntimeConfig("provider", provider);
    if (model) getClient().setRuntimeConfig("model", model);

    const contextualGoal = buildTaskGoalWithMemory({
      goal: text,
      provider,
      model,
      sharedMemorySummary: state.sharedMemorySummary,
      sessionMemorySummary: sessionState?.memorySummary ?? "",
    });
    getClient().sendTask(contextualGoal);
  }, [llmPreflight?.model, llmPreflight?.providerId]);

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

  const handleSaveSharedMemory = useCallback(() => {
    const nextSummary = memorySummaryDraft.trim();
    const nextLog = memoryLogDraft
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    setSharedMemoryManual(nextSummary, nextLog);

    const payload = buildClaudeMemPayloadFromState(useChatStore.getState());
    getClient().syncClaudeMem(payload);
  }, [memoryLogDraft, memorySummaryDraft, setSharedMemoryManual]);

  return (
    <div style={{ height: "100%", display: "flex", minWidth: 0 }}>
      {/* Conversation sidebar */}
      <aside style={{ width: 250, borderRight: "1px solid rgba(255,255,255,0.06)", background: "rgba(5,5,8,0.5)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <button className="btn-primary" style={{ width: "100%", fontSize: "0.8rem", padding: "9px 12px" }} onClick={handleNewConversation}>
            + {copy.chat.newConversation}
          </button>
        </div>
        <div style={{ flex: 1, padding: "10px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            {copy.chat.conversations}
          </div>
          {conversations.map((conv) => {
            const active = conv.id === currentConversationId;
            return (
              <div
                key={conv.id}
                className={`conv-item ${active ? "active" : ""}`}
                onClick={() => switchConversation(conv.id)}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{
                    fontSize: "0.82rem", fontWeight: active ? 600 : 500,
                    color: active ? "white" : "var(--color-text-secondary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    flex: 1, minWidth: 0,
                  }}>
                    {conv.name}
                  </span>
                  {conv.messageCount > 0 && (
                    <span className="neon-badge neon-badge-accent" style={{ marginLeft: 6 }}>
                      {conv.messageCount}
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.65rem", color: "var(--color-text-muted)" }}>
                    {new Date(conv.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn-ghost" style={{ padding: "2px 6px", fontSize: "0.6rem", borderRadius: 6 }} onClick={() => handleRenameConversation(conv.id, conv.name)}>
                      ✏️
                    </button>
                    <button className="btn-ghost" style={{ padding: "2px 6px", fontSize: "0.6rem", borderRadius: 6, color: "#f43f5e", borderColor: "rgba(244,63,94,0.2)" }} onClick={() => deleteConversation(conv.id)}>
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Chat toolbar */}
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
              <span className="neon-badge neon-badge-warn">
                <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 15" />
                </svg>
                {pendingCount} {copy.common.executing}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setShowMemoryPanel((v) => !v)}
              className="btn-ghost"
              style={{ padding: "5px 12px", fontSize: "0.75rem" }}
            >
              {showMemoryPanel ? "Hide Memory" : "🧠 Memory"}
            </button>
            <select
              value={currentSessionState?.provider ?? "anthropic"}
              onChange={(e) => {
                const nextProvider = e.target.value;
                const providerModel = providers.find((p) => p.id === nextProvider)?.model ?? "";
                setConversationRuntime(currentConversationId, { provider: nextProvider, model: providerModel });
              }}
              className="omni-input"
              style={{ fontSize: "0.72rem", height: 30, minWidth: 120 }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.id}</option>
              ))}
            </select>
            <input
              list="session-model-options"
              value={currentSessionState?.model ?? ""}
              onChange={(e) => setConversationRuntime(currentConversationId, { model: e.target.value })}
              placeholder="model"
              className="omni-input"
              style={{ fontSize: "0.72rem", height: 30, minWidth: 180 }}
            />
            <datalist id="session-model-options">
              {modelOptions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button onClick={handleClear} className="btn-ghost" style={{ padding: "5px 12px", fontSize: "0.75rem" }}>
              {copy.common.clear}
            </button>
          </div>
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

      {/* Memory panel */}
      {showMemoryPanel && (
        <aside
          style={{
            width: 340,
            borderLeft: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(5,5,8,0.55)",
            display: "flex",
            flexDirection: "column",
            padding: "14px",
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: 4 }}>🧠 Shared Memory</div>
            <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
              Chỉnh tay memory dùng chung giữa các phiên và bấm Save để đồng bộ lên backend session store.
            </div>
          </div>

          <label style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>Summary</label>
          <textarea
            value={memorySummaryDraft}
            onChange={(e) => setMemorySummaryDraft(e.target.value)}
            className="omni-input"
            style={{ minHeight: 150, resize: "vertical", fontSize: "0.78rem", lineHeight: 1.5, padding: 10 }}
            placeholder="Shared memory summary..."
          />

          <label style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>Memory Log (mỗi dòng 1 entry)</label>
          <textarea
            value={memoryLogDraft}
            onChange={(e) => setMemoryLogDraft(e.target.value)}
            className="omni-input"
            style={{ minHeight: 170, resize: "vertical", fontSize: "0.75rem", lineHeight: 1.45, padding: 10 }}
            placeholder="- User prefers concise output\n- Last session focused on parser tests"
          />

          <button className="btn-primary" style={{ padding: "8px 12px", fontSize: "0.78rem" }} onClick={handleSaveSharedMemory}>
            {copy.common.save}
          </button>
        </aside>
      )}
    </div>
  );
}
