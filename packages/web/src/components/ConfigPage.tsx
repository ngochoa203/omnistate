import { useEffect, useMemo, useState } from "react";
import { getClient } from "../hooks/useGateway";
import { useChatStore } from "../lib/chat-store";

type RuntimeProvider = {
  id: string;
  kind?: string;
  baseURL?: string;
  apiKey?: string;
  model?: string;
  models?: string[];
  enabled?: boolean;
};

export function ConfigPage() {
  const appLanguage = useChatStore((s) => s.appLanguage);
  const llmPreflight = useChatStore((s) => s.llmPreflight);
  const runtimeConfig = useChatStore((s) => s.runtimeConfig);
  const runtimeConfigAck = useChatStore((s) => s.runtimeConfigAck);

  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [lastAction, setLastAction] = useState<string>("");
  const [actionState, setActionState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [actionMessage, setActionMessage] = useState("");
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProviderId, setNewProviderId] = useState("");
  const [newProviderKind, setNewProviderKind] = useState<"anthropic" | "openai-compatible">("openai-compatible");
  const [newProviderBaseUrl, setNewProviderBaseUrl] = useState("");
  const [newProviderApiKey, setNewProviderApiKey] = useState("");
  const [newProviderModel, setNewProviderModel] = useState("");
  const [newProviderModels, setNewProviderModels] = useState("");
  const [newProviderEnabled, setNewProviderEnabled] = useState(true);
  const [activateNewProvider, setActivateNewProvider] = useState(true);
  const [fallbackNewProvider, setFallbackNewProvider] = useState(false);

  const activeProvider = useMemo(() => {
    const cfg = runtimeConfig as { activeProviderId?: string; providers?: RuntimeProvider[] } | null;
    if (!cfg?.providers || !cfg.activeProviderId) return null;
    return cfg.providers.find((p) => p.id === cfg.activeProviderId) ?? null;
  }, [runtimeConfig]);

  const providers = useMemo(() => {
    const cfg = runtimeConfig as { providers?: RuntimeProvider[] } | null;
    if (Array.isArray(cfg?.providers) && cfg.providers.length > 0) return cfg.providers;
    return [
      { id: "anthropic", kind: "anthropic", baseURL: "https://chat.trollllm.xyz", model: "claude-haiku-4.5", enabled: true },
      { id: "router9", kind: "openai-compatible", baseURL: "http://localhost:20128/v1", model: "cx/gpt-5.4", enabled: true },
    ];
  }, [runtimeConfig]);

  const suggestedModels = useMemo(() => {
    const providerId = provider.trim().toLowerCase();
    const selectedProvider = providers.find((p) => p.id === provider);
    const modelsFromProvider = Array.isArray(selectedProvider?.models)
      ? selectedProvider.models.filter(Boolean)
      : [];
    if (modelsFromProvider.length > 0) {
      return modelsFromProvider;
    }
    const base = selectedProvider?.model;
    if (providerId === "anthropic") {
      return [
        "claude-haiku-4.5",
        "claude-sonnet-4.6",
        "claude-opus-4.6",
      ];
    }
    if (providerId === "router9") {
      return [
        "cx/gpt-5.4",
        "kr/deepseek-3.2",
      ];
    }
    return base ? [base] : [];
  }, [provider, providers]);

  const title = appLanguage === "vi" ? "OmniState Config" : "OmniState Config";
  const subtitle =
    appLanguage === "vi"
      ? "Cấu hình provider/model/base URL/API key và chạy lệnh cấu hình runtime"
      : "Configure provider/model/base URL/API key and execute runtime config commands";

  const providerHint = useMemo(() => {
    if (!llmPreflight) return appLanguage === "vi" ? "Chưa có dữ liệu preflight" : "No preflight data";
    return `${llmPreflight.providerId ?? "unknown"} · ${llmPreflight.model ?? "unknown"}`;
  }, [llmPreflight, appLanguage]);

  const runCommand = (command: string) => {
    setActionState("loading");
    setActionMessage(appLanguage === "vi" ? "Đang chạy lệnh..." : "Running command...");
    useChatStore.getState().addUserMessage(command);
    getClient().sendTask(command);
    setLastAction(command);
    window.setTimeout(() => {
      setActionState("success");
      setActionMessage(appLanguage === "vi" ? "Đã gửi lệnh thành công." : "Command sent.");
    }, 300);
  };

  const loadRealtimeConfig = () => {
    setActionState("loading");
    setActionMessage(appLanguage === "vi" ? "Đang tải realtime config..." : "Loading realtime config...");
    getClient().requestRuntimeConfig();
  };

  useEffect(() => {
    loadRealtimeConfig();
  }, []);

  useEffect(() => {
    const cfg = runtimeConfig as { activeProviderId?: string; activeModel?: string; providers?: Array<Record<string, unknown>> } | null;
    if (!cfg) return;
    if (cfg.activeProviderId) setProvider(String(cfg.activeProviderId));
    if (cfg.activeModel) setModel(String(cfg.activeModel));
    if (activeProvider?.baseURL) setBaseURL(String(activeProvider.baseURL));
  }, [runtimeConfig, activeProvider]);

  const applyRealtimeConfig = () => {
    setActionState("loading");
    setActionMessage(appLanguage === "vi" ? "Đang áp dụng cấu hình, chờ ACK realtime..." : "Applying config, waiting for realtime ACK...");
    if (provider.trim()) getClient().setRuntimeConfig("provider", provider.trim());
    if (model.trim()) getClient().setRuntimeConfig("model", model.trim());
    if (baseURL.trim()) getClient().setRuntimeConfig("baseURL", baseURL.trim());
    if (apiKey.trim()) getClient().setRuntimeConfig("apiKey", apiKey.trim());
    getClient().requestLlmPreflight();
  };

  const toggleVoiceRealtime = (key: "voice.lowLatency" | "voice.autoExecuteTranscript", value: boolean) => {
    setActionState("loading");
    setActionMessage(`${appLanguage === "vi" ? "Đang cập nhật" : "Updating"} ${key}=${String(value)}`);
    getClient().setRuntimeConfig(key, value);
  };

  const changeProvider = (nextProvider: string) => {
    if (!nextProvider.trim()) return;
    const selectedProvider = providers.find((p) => p.id === nextProvider);
    setProvider(nextProvider);
    if (selectedProvider?.baseURL) setBaseURL(String(selectedProvider.baseURL));
    if (selectedProvider?.model) setModel(String(selectedProvider.model));
    setActionState("loading");
    setActionMessage(appLanguage === "vi" ? "Đang chuyển provider..." : "Switching provider...");
    getClient().setRuntimeConfig("provider", nextProvider);
    getClient().requestLlmPreflight();
  };

  const addProvider = () => {
    const providerId = newProviderId.trim();
    const providerModel = newProviderModel.trim();
    const providerBaseURL = newProviderBaseUrl.trim();

    if (!providerId || !providerModel || !providerBaseURL) {
      setActionState("error");
      setActionMessage(
        appLanguage === "vi"
          ? "Cần nhập đầy đủ Provider ID, Base URL và Default model."
          : "Provider ID, Base URL, and default model are required.",
      );
      return;
    }

    const models = newProviderModels
      .split(/[,\n]/g)
      .map((x) => x.trim())
      .filter(Boolean);

    setActionState("loading");
    setActionMessage(appLanguage === "vi" ? "Đang thêm provider..." : "Adding provider...");

    getClient().upsertRuntimeProvider(
      {
        id: providerId,
        kind: newProviderKind,
        baseURL: providerBaseURL,
        apiKey: newProviderApiKey.trim(),
        model: providerModel,
        enabled: newProviderEnabled,
        models,
      },
      {
        activate: activateNewProvider,
        addToFallback: fallbackNewProvider,
      },
    );

    if (activateNewProvider) {
      setProvider(providerId);
      setModel(providerModel);
      setBaseURL(providerBaseURL);
    }

    setShowAddProvider(false);
    setNewProviderId("");
    setNewProviderBaseUrl("");
    setNewProviderApiKey("");
    setNewProviderModel("");
    setNewProviderModels("");
    setNewProviderEnabled(true);
    setActivateNewProvider(true);
    setFallbackNewProvider(false);
    getClient().requestRuntimeConfig();
    getClient().requestLlmPreflight();
  };

  const switchPresetProvider = (preset: "trollllm" | "router9") => {
    setActionState("loading");
    setActionMessage(
      preset === "trollllm"
        ? (appLanguage === "vi" ? "Đang chuyển sang TrollLLM..." : "Switching to TrollLLM...")
        : (appLanguage === "vi" ? "Đang chuyển sang 9router..." : "Switching to 9router..."),
    );

    if (preset === "trollllm") {
      setProvider("anthropic");
      setBaseURL("https://chat.trollllm.xyz");
      if (!model.trim()) setModel("claude-haiku-4.5");
      getClient().setRuntimeConfig("provider", "anthropic");
      getClient().setRuntimeConfig("baseURL", "https://chat.trollllm.xyz");
      getClient().setRuntimeConfig("model", model.trim() || "claude-haiku-4.5");
    } else {
      setProvider("router9");
      setBaseURL("http://localhost:20128/v1");
      if (!model.trim()) setModel("cx/gpt-5.4");
      getClient().setRuntimeConfig("provider", "router9");
      getClient().setRuntimeConfig("baseURL", "http://localhost:20128/v1");
      getClient().setRuntimeConfig("model", model.trim() || "cx/gpt-5.4");
    }

    getClient().requestRuntimeConfig();
    getClient().requestLlmPreflight();
  };

  useEffect(() => {
    if (!runtimeConfigAck) return;
    setActionState(runtimeConfigAck.ok ? "success" : "error");
    setActionMessage(runtimeConfigAck.message);
  }, [runtimeConfigAck]);

  useEffect(() => {
    if (!runtimeConfig || actionState !== "loading") return;
    setActionState("success");
    setActionMessage(appLanguage === "vi" ? "Đã nhận realtime config mới." : "Received latest realtime config.");
  }, [runtimeConfig, actionState, appLanguage]);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="glass" style={{ borderRadius: 16, padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", color: "white" }}>{title}</h2>
          <p style={{ margin: "6px 0 0", color: "var(--color-text-muted)", fontSize: "0.85rem" }}>{subtitle}</p>
        </div>

        <div className="glass" style={{ borderRadius: 16, padding: 20 }}>
          {actionState !== "idle" && (
            <div
              style={{
                marginBottom: 12,
                padding: "10px 12px",
                borderRadius: 10,
                fontSize: "0.8rem",
                border: actionState === "error" ? "1px solid rgba(239,68,68,0.35)" : "1px solid rgba(34,197,94,0.25)",
                background: actionState === "error" ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
                color: actionState === "error" ? "#ef4444" : actionState === "loading" ? "#f59e0b" : "#22c55e",
              }}
            >
              {actionState === "loading" ? "⏳ " : actionState === "error" ? "✗ " : "✓ "}
              {actionMessage}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                {appLanguage === "vi" ? "Provider" : "Provider"}
              </span>
              {providers.length > 0 ? (
                <select
                  className="omni-input"
                  value={provider}
                  onChange={(e) => changeProvider(e.target.value)}
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} {p.enabled === false ? (appLanguage === "vi" ? "(tắt)" : "(disabled)") : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="omni-input" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="anthropic | router9" />
              )}
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                {appLanguage === "vi" ? "Model" : "Model"}
              </span>
              <input
                className="omni-input"
                list="provider-model-options"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="claude-haiku-4.5"
              />
              <datalist id="provider-model-options">
                {suggestedModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                Base URL
              </span>
              <input className="omni-input" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://chat.trollllm.xyz" />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                API Key
              </span>
              <input className="omni-input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
            </label>
          </div>

          {activeProvider && (
            <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>
              {appLanguage === "vi" ? "Realtime config hiện tại:" : "Current realtime config:"}
              <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                provider={String((runtimeConfig as any)?.activeProviderId ?? "-")} | model={String((runtimeConfig as any)?.activeModel ?? "-")} | baseURL={String((activeProvider as any)?.baseURL ?? "-")}
              </div>
            </div>
          )}

          {providers.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: 6 }}>
                {appLanguage === "vi" ? "Danh sách provider:" : "Providers:"}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {providers.map((p) => (
                  <button
                    key={`provider-${p.id}`}
                    className="btn-ghost"
                    onClick={() => changeProvider(p.id)}
                    style={{
                      textAlign: "left",
                      justifyContent: "space-between",
                      display: "flex",
                      alignItems: "center",
                      padding: "8px 10px",
                      borderColor: provider === p.id ? "rgba(99,102,241,0.5)" : undefined,
                      background: provider === p.id ? "rgba(99,102,241,0.12)" : undefined,
                    }}
                  >
                    <span style={{ fontSize: "0.76rem", color: "var(--color-text-secondary)", fontFamily: "monospace" }}>
                      {p.id} · {p.kind ?? "-"} · {p.model ?? "-"}
                    </span>
                    <span style={{ fontSize: "0.72rem", color: p.enabled === false ? "#ef4444" : "#22c55e" }}>
                      {p.enabled === false ? (appLanguage === "vi" ? "Tắt" : "Off") : (appLanguage === "vi" ? "Bật" : "On")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn-ghost" onClick={() => setShowAddProvider((v) => !v)}>
              {showAddProvider
                ? (appLanguage === "vi" ? "Đóng form Add provider" : "Close add provider")
                : (appLanguage === "vi" ? "Add provider" : "Add provider")}
            </button>
            <button className="btn-primary" onClick={() => switchPresetProvider("trollllm")}>
              {appLanguage === "vi" ? "Switch TrollLLM" : "Switch TrollLLM"}
            </button>
            <button className="btn-ghost" onClick={() => switchPresetProvider("router9")}>
              {appLanguage === "vi" ? "Switch 9router" : "Switch 9router"}
            </button>
            <button className="btn-primary" onClick={applyRealtimeConfig}>
              {appLanguage === "vi" ? "Áp dụng cấu hình" : "Apply Config"}
            </button>
            <button className="btn-ghost" onClick={loadRealtimeConfig}>
              {appLanguage === "vi" ? "Đọc config realtime" : "Load realtime config"}
            </button>
            <button className="btn-ghost" onClick={() => runCommand("omnistate config show")}>
              {appLanguage === "vi" ? "Xem runtime config" : "Show runtime config"}
            </button>
            <button className="btn-ghost" onClick={() => getClient().requestLlmPreflight()}>
              {appLanguage === "vi" ? "Kiểm tra token/API" : "Check token/API"}
            </button>
          </div>

          {showAddProvider && (
            <div
              style={{
                marginTop: 12,
                borderRadius: 12,
                padding: 12,
                border: "1px solid rgba(99,102,241,0.28)",
                background: "rgba(99,102,241,0.08)",
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ fontSize: "0.78rem", color: "white", fontWeight: 600 }}>
                {appLanguage === "vi" ? "Thêm provider mới" : "Add new provider"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                    {appLanguage === "vi" ? "Provider ID" : "Provider ID"}
                  </span>
                  <input className="omni-input" value={newProviderId} onChange={(e) => setNewProviderId(e.target.value)} placeholder="router9" />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                    Kind
                  </span>
                  <select className="omni-input" value={newProviderKind} onChange={(e) => setNewProviderKind(e.target.value as "anthropic" | "openai-compatible")}>
                    <option value="anthropic">anthropic</option>
                    <option value="openai-compatible">openai-compatible</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>Base URL</span>
                  <input className="omni-input" value={newProviderBaseUrl} onChange={(e) => setNewProviderBaseUrl(e.target.value)} placeholder="https://chat.trollllm.xyz" />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>API Key</span>
                  <input className="omni-input" value={newProviderApiKey} onChange={(e) => setNewProviderApiKey(e.target.value)} placeholder="sk-..." />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                    {appLanguage === "vi" ? "Default model" : "Default model"}
                  </span>
                  <input className="omni-input" value={newProviderModel} onChange={(e) => setNewProviderModel(e.target.value)} placeholder="claude-haiku-4.5" />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                    {appLanguage === "vi" ? "List models (phân tách bởi dấu phẩy hoặc xuống dòng)" : "List models (comma or newline separated)"}
                  </span>
                  <textarea
                    className="omni-input"
                    value={newProviderModels}
                    onChange={(e) => setNewProviderModels(e.target.value)}
                    placeholder={"claude-haiku-4.5, claude-sonnet-4.6, claude-opus-4.6"}
                    rows={3}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={newProviderEnabled} onChange={(e) => setNewProviderEnabled(e.target.checked)} />
                  {appLanguage === "vi" ? "Enable provider" : "Enable provider"}
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={activateNewProvider} onChange={(e) => setActivateNewProvider(e.target.checked)} />
                  {appLanguage === "vi" ? "Kích hoạt ngay" : "Activate now"}
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={fallbackNewProvider} onChange={(e) => setFallbackNewProvider(e.target.checked)} />
                  {appLanguage === "vi" ? "Thêm vào fallback" : "Add to fallback"}
                </label>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-primary" onClick={addProvider}>
                  {appLanguage === "vi" ? "Lưu provider" : "Save provider"}
                </button>
                <button className="btn-ghost" onClick={() => setShowAddProvider(false)}>
                  {appLanguage === "vi" ? "Hủy" : "Cancel"}
                </button>
              </div>
            </div>
          )}

          {suggestedModels.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {suggestedModels.map((m) => (
                <button
                  key={`model-${m}`}
                  className="btn-ghost"
                  onClick={() => {
                    setModel(m);
                    setActionState("loading");
                    setActionMessage(appLanguage === "vi" ? "Đang chuyển model..." : "Switching model...");
                    getClient().setRuntimeConfig("model", m);
                    getClient().requestLlmPreflight();
                  }}
                  style={{
                    fontSize: "0.75rem",
                    padding: "6px 10px",
                    borderColor: model === m ? "rgba(99,102,241,0.5)" : undefined,
                    background: model === m ? "rgba(99,102,241,0.12)" : undefined,
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn-ghost"
              onClick={() => toggleVoiceRealtime("voice.lowLatency", true)}
              style={{ fontSize: "0.78rem" }}
            >
              {appLanguage === "vi" ? "Voice low-latency: ON" : "Voice low-latency: ON"}
            </button>
            <button
              className="btn-ghost"
              onClick={() => toggleVoiceRealtime("voice.lowLatency", false)}
              style={{ fontSize: "0.78rem" }}
            >
              {appLanguage === "vi" ? "Voice low-latency: OFF" : "Voice low-latency: OFF"}
            </button>
            <button
              className="btn-ghost"
              onClick={() => toggleVoiceRealtime("voice.autoExecuteTranscript", true)}
              style={{ fontSize: "0.78rem" }}
            >
              {appLanguage === "vi" ? "Auto execute transcript: ON" : "Auto execute transcript: ON"}
            </button>
            <button
              className="btn-ghost"
              onClick={() => toggleVoiceRealtime("voice.autoExecuteTranscript", false)}
              style={{ fontSize: "0.78rem" }}
            >
              {appLanguage === "vi" ? "Auto execute transcript: OFF" : "Auto execute transcript: OFF"}
            </button>
          </div>

          <div style={{ marginTop: 12, fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>
            {appLanguage === "vi" ? "Provider hiện tại:" : "Current provider:"} {providerHint}
          </div>
          {lastAction && (
            <div style={{ marginTop: 8, fontSize: "0.72rem", color: "var(--color-text-muted)", fontFamily: "monospace" }}>
              {appLanguage === "vi" ? "Lệnh vừa chạy:" : "Last command:"} {lastAction}
            </div>
          )}
          {runtimeConfigAck && (
            <div style={{ marginTop: 8, fontSize: "0.76rem", color: runtimeConfigAck.ok ? "#22c55e" : "#ef4444" }}>
              {runtimeConfigAck.ok ? "✓" : "✗"} {runtimeConfigAck.key}: {runtimeConfigAck.message}
            </div>
          )}
        </div>

        <div className="glass" style={{ borderRadius: 16, padding: 20 }}>
          <div style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", marginBottom: 10 }}>
            {appLanguage === "vi" ? "Thiết lập nhanh" : "Quick setup"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
            <button className="btn-ghost" onClick={() => runCommand("/session list")}>/session list</button>
            <button className="btn-ghost" onClick={() => runCommand("/voice show")}>/voice show</button>
            <button className="btn-ghost" onClick={() => runCommand("/wake show")}>/wake show</button>
            <button className="btn-ghost" onClick={() => runCommand("/status")}>/status</button>
            <button className="btn-ghost" onClick={() => runCommand("analyze latest logs and summarize failures")}>Log Analyze</button>
            <button className="btn-ghost" onClick={() => runCommand("check system health status")}>Health Check</button>
          </div>
        </div>

        <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          {appLanguage === "vi"
            ? "Mẹo: các lệnh config sẽ chạy qua gateway command router và phản hồi trong AI Chat của phiên hiện tại."
            : "Tip: config commands run via the gateway command router and responses appear in AI Chat for the current conversation."}
        </div>
      </div>
    </div>
  );
}
