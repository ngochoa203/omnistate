import { useEffect, useMemo, useState } from "react";
import { useGateway } from "./hooks/useGateway";
import { useChatStore } from "./lib/chat-store";
import { ChatView } from "./components/ChatView";
import { HealthDashboard } from "./components/HealthDashboard";
import { SystemPanel } from "./components/SystemPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { VoicePage } from "./components/VoicePage";
import { DashboardOverview } from "./components/DashboardOverview";
import { LiveClock } from "./components/LiveClock";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { getCopy } from "./lib/i18n";
import { ConfigPage } from "./components/ConfigPage";
import { ScreenTreePage } from "./components/ScreenTreePage";
import { TriggerPage } from "./components/TriggerPage";
import { MemoryPalPage } from "./components/MemoryPalPage";
import { ApprovalCenter } from "./components/ApprovalCenter";
import { AuthPage } from "./components/AuthPage";
import { useAuthStore } from "./lib/auth-store";
import { initAuth } from "./lib/auth-client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OnboardingWizard, shouldShowOnboarding, markOnboardingComplete } from "./components/OnboardingWizard";

type View = "dashboard" | "chat" | "voice" | "health" | "system" | "settings" | "config" | "screenTree" | "triggers" | "memory" | "approvals";

const NAV_ITEMS: Array<{ id: View; labelKey: "dashboard" | "chat" | "voice" | "health" | "system" | "settings" | "config" | "screenTree" | "triggers" | "memory" | "approvals"; icon: React.ReactNode }> = [
  {
    id: "dashboard",
    labelKey: "dashboard",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="2" width="9" height="9" rx="2" />
        <rect x="13" y="2" width="9" height="9" rx="2" />
        <rect x="2" y="13" width="9" height="9" rx="2" />
        <rect x="13" y="13" width="9" height="9" rx="2" />
      </svg>
    ),
  },
  {
    id: "chat",
    labelKey: "chat",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: "voice",
    labelKey: "voice",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <line x1="12" y1="17" x2="12" y2="22" />
        <line x1="8" y1="22" x2="16" y2="22" />
      </svg>
    ),
  },
  {
    id: "health",
    labelKey: "health",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    id: "system",
    labelKey: "system",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    id: "config",
    labelKey: "config",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 7h10" />
        <path d="M4 17h16" />
        <circle cx="17" cy="7" r="3" />
        <circle cx="7" cy="17" r="3" />
      </svg>
    ),
  },
  {
    id: "settings",
    labelKey: "settings",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    id: "screenTree",
    labelKey: "screenTree",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="5" r="2" />
        <circle cx="6" cy="13" r="2" />
        <circle cx="18" cy="13" r="2" />
        <circle cx="12" cy="20" r="2" />
        <path d="M12 7v3" />
        <path d="M12 10h6" />
        <path d="M12 10H6" />
        <path d="M6 15v3" />
        <path d="M18 15v3" />
      </svg>
    ),
  },
  {
    id: "triggers",
    labelKey: "triggers",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    id: "memory",
    labelKey: "memory",
    icon: <span style={{ fontSize: 14 }}>🧠</span>,
  },
  {
    id: "approvals",
    labelKey: "approvals",
    icon: <span style={{ fontSize: 14 }}>🛡️</span>,
  },
];

export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(shouldShowOnboarding);

  const currentProfile = useAuthStore((s) => s.currentProfile);

  useEffect(() => {
    initAuth();
  }, []);

  useGateway();
  const appLanguage = useChatStore((s) => s.appLanguage);
  const setAppLanguage = useChatStore((s) => s.setAppLanguage);
  const connectionState = useChatStore((s) => s.connectionState);
  const llmPreflight = useChatStore((s) => s.llmPreflight);
  const messages = useChatStore((s) => s.messages);
  const health = useChatStore((s) => s.health);
  const runtimeConfig = useChatStore((s) => s.runtimeConfig);
  const copy = getCopy(appLanguage);

  const unreadCount = useMemo(
    () => messages.reduce((acc, m) => acc + (m.role === "system" && m.status === "pending" ? 1 : 0), 0),
    [messages],
  );

  const alertCount = useMemo(() => {
    let c = 0;
    if (health?.alerts?.length) c += health.alerts.length;
    if (connectionState === "disconnected") c += 1;
    return c;
  }, [health, connectionState]);

  const activeNavLabel = useMemo(
    () => copy.nav[NAV_ITEMS.find((n) => n.id === view)?.labelKey ?? "dashboard"],
    [view, copy],
  );

  const activeModel = useMemo(() => {
    if (llmPreflight?.model) return llmPreflight.model;
    if (runtimeConfig && typeof runtimeConfig === "object" && "activeModel" in runtimeConfig) {
      return String((runtimeConfig as Record<string, unknown>).activeModel ?? "");
    }
    return "";
  }, [llmPreflight, runtimeConfig]);

  const activeProvider = useMemo(() => {
    if (llmPreflight?.providerId) return llmPreflight.providerId;
    if (runtimeConfig && typeof runtimeConfig === "object" && "activeProviderId" in runtimeConfig) {
      return String((runtimeConfig as Record<string, unknown>).activeProviderId ?? "");
    }
    return "";
  }, [llmPreflight, runtimeConfig]);

  const connColor =
    connectionState === "connected" ? "connected" :
    connectionState === "connecting" ? "connecting" : "disconnected";

  const connText =
    connectionState === "connected" ? copy.status.live :
    connectionState === "connecting" ? copy.status.connecting : copy.status.offline;

  // Show enrollment wizard if no enrolled voice profile
  if (!currentProfile || !currentProfile.isEnrolled) {
    return <AuthPage />;
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", position: "relative" }}>
      {/* Onboarding wizard — shown once on first visit */}
      {showOnboarding && (
        <OnboardingWizard
          onComplete={() => {
            markOnboardingComplete();
            setShowOnboarding(false);
          }}
          onNavigateToVoice={() => {
            setShowOnboarding(false);
            setView("voice");
          }}
        />
      )}
      {/* Background Effects */}
      <div className="bg-orb" style={{ width: 600, height: 600, top: -200, left: -200, background: "radial-gradient(circle, #6366f1, transparent)" }} />
      <div className="bg-orb" style={{ width: 500, height: 500, bottom: -150, right: -100, background: "radial-gradient(circle, #7c3aed, transparent)", opacity: 0.08 }} />
      <div className="bg-orb" style={{ width: 300, height: 300, top: "40%", right: "30%", background: "radial-gradient(circle, #22d3ee, transparent)", opacity: 0.05 }} />
      <div className="scanline-overlay" />
      <div className="cyber-grid" />

      {/* Sidebar */}
      <aside
        style={{
          width: sidebarCollapsed ? 64 : 240,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(5,5,8,0.85)",
          backdropFilter: "blur(20px)",
          transition: "width 0.3s cubic-bezier(0.16,1,0.3,1)",
          overflow: "hidden",
          position: "relative",
          zIndex: 10,
        }}
      >
        {/* Logo */}
        <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: "linear-gradient(135deg, #6366f1, #7c3aed)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 16px rgba(99,102,241,0.4)",
              fontSize: 18,
            }}>
              🧠
            </div>
            {!sidebarCollapsed && (
              <div className="animate-fade-in">
                <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "white", lineHeight: 1.2 }}>OmniState</div>
                <div style={{ fontSize: "0.65rem", color: "var(--color-text-muted)", letterSpacing: "0.05em" }}>SHADOW OS</div>
              </div>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`sidebar-item ${view === item.id ? "active" : ""}`}
              style={{ marginBottom: 4, justifyContent: sidebarCollapsed ? "center" : "flex-start", animationDelay: `${NAV_ITEMS.findIndex((n) => n.id === item.id) * 0.04}s` }}
              title={sidebarCollapsed ? copy.nav[item.labelKey] : undefined}
            >
              <span style={{ flexShrink: 0, opacity: view === item.id ? 1 : 0.7 }}>{item.icon}</span>
              {!sidebarCollapsed && (
                <span className="animate-fade-in" style={{ flex: 1 }}>{copy.nav[item.labelKey]}</span>
              )}
              {/* Chat unread badge */}
              {!sidebarCollapsed && item.id === "chat" && unreadCount > 0 && (
                <span className="alert-count-badge" style={{
                  background: "linear-gradient(135deg, #6366f1, #7c3aed)",
                  color: "white",
                }}>
                  {unreadCount}
                </span>
              )}
              {/* Health alert badge */}
              {!sidebarCollapsed && item.id === "health" && alertCount > 0 && (
                <span className="alert-count-badge" style={{
                  background: "linear-gradient(135deg, #f59e0b, #f43f5e)",
                  color: "white",
                }}>
                  {alertCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Bottom Status */}
        <div style={{ padding: "12px 8px 16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {!sidebarCollapsed ? (
            <div className="animate-fade-in" style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)" }}>{copy.status.gateway}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div className={`status-dot ${connColor}`}></div>
                  <span style={{ fontSize: "0.7rem", color: connColor === "connected" ? "#22c55e" : connColor === "connecting" ? "#f59e0b" : "#ef4444", fontWeight: 600 }}>{connText}</span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)" }}>{copy.status.llmApi}</span>
                <span style={{
                  fontSize: "0.7rem", fontWeight: 600,
                  color: !llmPreflight ? "#5a5a7a" : llmPreflight.ok ? "#22c55e" : "#ef4444"
                }}>
                  {!llmPreflight ? copy.status.unchecked : llmPreflight.ok ? copy.status.ready : copy.status.error}
                </span>
              </div>
              {activeProvider && (
                <div style={{ marginTop: 6, fontSize: "0.65rem", color: "var(--color-text-muted)", fontFamily: "monospace" }}>
                  {activeProvider} / {activeModel || "default"}
                </div>
              )}
              <div style={{ marginTop: 6, fontSize: "0.68rem", color: "var(--color-text-muted)", fontFamily: "monospace" }}>
                <LiveClock />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div className={`status-dot ${connColor}`} style={{ width: 10, height: 10 }}></div>
            </div>
          )}

          {/* Collapse toggle */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "100%", marginTop: 8, padding: "7px",
              borderRadius: 8, background: "none", border: "1px solid rgba(255,255,255,0.06)",
              color: "var(--color-text-muted)", cursor: "pointer",
              transition: "all 0.2s", fontSize: "0.75rem",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ transform: sidebarCollapsed ? "rotate(180deg)" : "none", transition: "transform 0.3s" }}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {/* Topbar */}
        <header style={{
          height: 56, flexShrink: 0,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(5,5,8,0.7)",
          backdropFilter: "blur(16px)",
          display: "flex", alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          position: "relative", zIndex: 5,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: "white" }}>
              {activeNavLabel}
            </h2>
            <span className="neon-badge neon-badge-accent">
              v0.1.0
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LanguageSwitch value={appLanguage} onChange={setAppLanguage} />

            {/* Connection badge */}
            <div className="topbar-chip">
              <div className={`status-dot ${connColor}`} style={{ width: 6, height: 6 }}></div>
              <span>{connText}</span>
            </div>

            {/* LLM badge */}
            <div className="topbar-chip" style={{
              borderColor: !llmPreflight ? undefined : llmPreflight.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)",
            }}>
              <span>🤖</span>
              <span style={{
                color: !llmPreflight ? "var(--color-text-muted)" : llmPreflight.ok ? "#22c55e" : "#ef4444",
              }}>
                {!llmPreflight
                  ? copy.status.unchecked
                  : llmPreflight.ok
                    ? `${activeModel || "LLM"} ✓`
                    : copy.status.error}
              </span>
            </div>

            {/* Time */}
            <div className="topbar-chip" style={{ fontFamily: "monospace" }}>
              <LiveClock />
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div key={view} className="view-transition" style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {view === "dashboard" && <ErrorBoundary><DashboardOverview onNavigate={setView} /></ErrorBoundary>}
          {view === "chat" && <ErrorBoundary><ChatView /></ErrorBoundary>}
          {view === "voice" && <ErrorBoundary><VoicePage /></ErrorBoundary>}
          {view === "health" && <ErrorBoundary><HealthDashboard /></ErrorBoundary>}
          {view === "system" && <ErrorBoundary><SystemPanel /></ErrorBoundary>}
          {view === "settings" && <ErrorBoundary><SettingsPanel /></ErrorBoundary>}
          {view === "config" && <ErrorBoundary><ConfigPage /></ErrorBoundary>}
          {view === "screenTree" && <ErrorBoundary><ScreenTreePage /></ErrorBoundary>}
          {view === "triggers" && <ErrorBoundary><TriggerPage /></ErrorBoundary>}
          {view === "memory" && <ErrorBoundary><MemoryPalPage /></ErrorBoundary>}
          {view === "approvals" && <ErrorBoundary><ApprovalCenter /></ErrorBoundary>}
        </div>
      </main>
    </div>
  );
}
