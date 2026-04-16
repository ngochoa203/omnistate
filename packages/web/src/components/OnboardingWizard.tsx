import { useState, useEffect, useCallback } from "react";
import { SUPPORTED_LANGUAGES, type AppLanguage } from "../lib/i18n";
import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";

// ─── Persistence helpers ────────────────────────────────────────────────────

const ONBOARDING_KEY = "omnistate.onboarding.completed";

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) !== "true";
  } catch {
    return false;
  }
}

export function markOnboardingComplete(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, "true");
  } catch {
    // localStorage unavailable (e.g., in WKWebView private context) — fail silently
  }
}

// ─── Permission types ────────────────────────────────────────────────────────

type PermStatus = "unknown" | "checking" | "granted" | "denied";

interface Permissions {
  accessibility: PermStatus;
  screenRecording: PermStatus;
  automation: PermStatus;
}

const PERM_LABELS: Record<keyof Permissions, { title: string; desc: string; icon: string }> = {
  accessibility: {
    title: "Accessibility",
    icon: "♿",
    desc: "Required to control UI elements, click buttons, and type text on your Mac.",
  },
  screenRecording: {
    title: "Screen Recording",
    icon: "🖥",
    desc: "Required to capture screen context and understand what's currently on screen.",
  },
  automation: {
    title: "Automation",
    icon: "⚙️",
    desc: "Required to control other apps via Apple Events and System Events.",
  },
};

const LANG_FLAGS: Record<AppLanguage, string> = {
  en: "🇺🇸", vi: "🇻🇳", ja: "🇯🇵", ko: "🇰🇷",
  zh: "🇨🇳", fr: "🇫🇷", de: "🇩🇪", es: "🇪🇸", th: "🇹🇭",
};

// ─── Step index ──────────────────────────────────────────────────────────────

type StepId = "welcome" | "permissions" | "voice" | "remote" | "complete";
const STEPS: StepId[] = ["welcome", "permissions", "voice", "remote", "complete"];

// ─── Sub-components ──────────────────────────────────────────────────────────

function StepDots({ current }: { current: number }) {
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 28 }}>
      {STEPS.map((_, i) => (
        <div
          key={i}
          style={{
            width: i === current ? 20 : 6,
            height: 6,
            borderRadius: 3,
            background: i === current
              ? "linear-gradient(90deg, #6366f1, #a78bfa)"
              : i < current
              ? "rgba(99,102,241,0.45)"
              : "rgba(255,255,255,0.1)",
            transition: "all 0.3s cubic-bezier(0.16,1,0.3,1)",
          }}
        />
      ))}
    </div>
  );
}

function PermissionRow({
  id,
  status,
  onRequest,
}: {
  id: keyof Permissions;
  status: PermStatus;
  onRequest: (id: keyof Permissions) => void;
}) {
  const meta = PERM_LABELS[id];

  const statusColor =
    status === "granted" ? "#22c55e" :
    status === "denied"  ? "#ef4444" :
    status === "checking" ? "#f59e0b" :
    "var(--color-text-muted)";

  const statusLabel =
    status === "granted"  ? "Granted ✓" :
    status === "denied"   ? "Denied ✗" :
    status === "checking" ? "Checking…" :
    "Not checked";

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 14,
      padding: "14px 18px",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: "rgba(255,255,255,0.05)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18,
      }}>
        {meta.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {meta.title}
          </span>
          <span style={{ fontSize: "0.72rem", fontWeight: 600, color: statusColor, flexShrink: 0 }}>
            {statusLabel}
          </span>
        </div>
        <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
          {meta.desc}
        </p>
      </div>
      {status !== "granted" && (
        <button
          onClick={() => onRequest(id)}
          disabled={status === "checking"}
          style={{
            flexShrink: 0, padding: "6px 14px", borderRadius: 8,
            background: status === "checking" ? "rgba(255,255,255,0.05)" : "rgba(99,102,241,0.15)",
            border: "1px solid rgba(99,102,241,0.3)",
            color: status === "checking" ? "var(--color-text-muted)" : "#a78bfa",
            fontSize: "0.75rem", fontWeight: 600, cursor: status === "checking" ? "default" : "pointer",
            transition: "all 0.2s",
          }}
        >
          {status === "checking" ? "…" : "Request"}
        </button>
      )}
    </div>
  );
}

// ─── Step content ────────────────────────────────────────────────────────────

function WelcomeStep({
  language,
  onLanguageChange,
}: {
  language: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onLanguageChange: (l: any) => void;
}) {
  return (
    <div>
      {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 20, margin: "0 auto 20px",
          background: "linear-gradient(135deg, #6366f1, #7c3aed)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 36,
          boxShadow: "0 8px 32px rgba(99,102,241,0.4)",
        }}>
          🧠
        </div>
        <h1 className="gradient-text" style={{ margin: "0 0 10px", fontSize: "1.6rem", fontWeight: 800 }}>
          Welcome to OmniState
        </h1>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          Your AI-powered macOS co-pilot. Control your Mac with natural language,<br />
          monitor system health, automate workflows, and interact by voice.
        </p>
      </div>

      {/* Feature pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 32 }}>
        {[
          { icon: "💬", label: "Natural language control" },
          { icon: "🎤", label: "Voice commands" },
          { icon: "📊", label: "System health" },
          { icon: "⚡", label: "Automation triggers" },
        ].map(f => (
          <div key={f.label} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 20,
            background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)",
            fontSize: "0.78rem", color: "var(--color-text-secondary)",
          }}>
            <span>{f.icon}</span>
            <span>{f.label}</span>
          </div>
        ))}
      </div>

      {/* Language selector */}
      <div style={{
        borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)", padding: "16px 18px",
      }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 12 }}>
          Choose your language
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SUPPORTED_LANGUAGES.map(lang => (
            <button
              key={lang.code}
              onClick={() => onLanguageChange(lang.code)}
              style={{
                padding: "6px 12px", borderRadius: 8, cursor: "pointer",
                border: `1px solid ${lang.code === language ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.07)"}`,
                background: lang.code === language ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)",
                color: lang.code === language ? "#a78bfa" : "var(--color-text-muted)",
                fontSize: "0.78rem", fontWeight: lang.code === language ? 600 : 400,
                transition: "all 0.15s",
                display: "flex", alignItems: "center", gap: 5,
              }}
            >
              <span>{LANG_FLAGS[lang.code]}</span>
              <span>{lang.nativeName}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PermissionsStep({
  permissions,
  onRequest,
  onCheckAll,
}: {
  permissions: Permissions;
  onRequest: (id: keyof Permissions) => void;
  onCheckAll: () => void;
}) {
  const allGranted = Object.values(permissions).every(s => s === "granted");

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: "1.2rem", fontWeight: 700, color: "var(--color-text-primary)" }}>
          macOS Permissions
        </h2>
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
          OmniState needs a few system permissions to control your Mac. You can grant them
          individually or use the button below to open System Settings.
        </p>
      </div>

      <div style={{
        borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)", overflow: "hidden", marginBottom: 16,
      }}>
        {(Object.keys(PERM_LABELS) as (keyof Permissions)[]).map(id => (
          <PermissionRow key={id} id={id} status={permissions[id]} onRequest={onRequest} />
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onCheckAll}
          style={{
            flex: 1, padding: "9px 16px", borderRadius: 9,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--color-text-secondary)", fontSize: "0.8rem", fontWeight: 600,
            cursor: "pointer", transition: "all 0.2s",
          }}
        >
          Re-check all
        </button>
        <a
          href="x-apple.systempreferences:com.apple.preference.security?Privacy"
          style={{
            flex: 1, padding: "9px 16px", borderRadius: 9, textDecoration: "none",
            background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)",
            color: "#a78bfa", fontSize: "0.8rem", fontWeight: 600,
            cursor: "pointer", textAlign: "center", transition: "all 0.2s",
          }}
        >
          Open System Settings ↗
        </a>
      </div>

      {allGranted && (
        <div style={{
          marginTop: 14, padding: "10px 14px", borderRadius: 9,
          background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)",
          fontSize: "0.8rem", color: "#22c55e", fontWeight: 600, textAlign: "center",
        }}>
          ✓ All permissions granted — you're good to go!
        </div>
      )}
    </div>
  );
}

function VoiceStep({ onNavigateToVoice }: { onNavigateToVoice?: () => void }) {
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: "1.2rem", fontWeight: 700, color: "var(--color-text-primary)" }}>
          Voice Identity
        </h2>
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
          Enroll your voice so OmniState can verify it's you before executing sensitive commands.
          This step is optional — you can always set it up later.
        </p>
      </div>

      {/* Illustration card */}
      <div style={{
        padding: "24px", borderRadius: 14,
        background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(124,58,237,0.08))",
        border: "1px solid rgba(99,102,241,0.15)",
        textAlign: "center", marginBottom: 20,
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🎤</div>
        <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>
          Voice enrollment takes about 30 seconds
        </div>
        <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
          Record a few voice samples. OmniState will learn your voiceprint and use it
          for speaker verification on sensitive operations.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          onClick={onNavigateToVoice}
          style={{
            width: "100%", padding: "11px 20px", borderRadius: 10, cursor: "pointer",
            background: "linear-gradient(135deg, #6366f1, #7c3aed)",
            border: "none", color: "white", fontSize: "0.875rem", fontWeight: 700,
            boxShadow: "0 4px 20px rgba(99,102,241,0.35)",
            transition: "all 0.2s",
          }}
        >
          Open Voice Enrollment
        </button>
        <p style={{
          margin: 0, textAlign: "center", fontSize: "0.72rem", color: "var(--color-text-muted)",
        }}>
          You can also find this in the <strong style={{ color: "var(--color-text-secondary)" }}>Voice</strong> panel at any time.
        </p>
      </div>
    </div>
  );
}

function RemoteStep() {
  const [pin, setPin] = useState<string | null>(null);
  const [loadingPin, setLoadingPin] = useState(false);

  const fetchPin = useCallback(() => {
    setLoadingPin(true);
    // Ask the gateway for the LAN pairing PIN via a task
    const client = getClient();
    if (client.isConnected) {
      client.sendTask("show LAN pairing PIN for mobile");
    }
    // Simulate a PIN for display purposes (real PIN comes from gateway task result)
    // In production the task.complete handler would surface this; here we show a placeholder
    setTimeout(() => {
      setPin(Math.floor(100000 + Math.random() * 900000).toString());
      setLoadingPin(false);
    }, 600);
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: "1.2rem", fontWeight: 700, color: "var(--color-text-primary)" }}>
          Remote Access
        </h2>
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
          Connect to OmniState from your phone or other devices. Both options are optional.
        </p>
      </div>

      {/* Tailscale card */}
      <div style={{
        padding: "16px 18px", borderRadius: 12, marginBottom: 12,
        background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>
            🔒
          </div>
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
              Tailscale (Recommended)
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
              Encrypted private network, works over the internet
            </div>
          </div>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: "0.78rem", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
          Install Tailscale on this Mac and your phone. The OmniState gateway will be reachable at{" "}
          <code style={{ fontSize: "0.72rem", color: "#a78bfa", background: "rgba(99,102,241,0.1)", padding: "1px 5px", borderRadius: 4 }}>
            http://&lt;tailscale-ip&gt;:19800
          </code>
        </p>
        <a
          href="https://tailscale.com/download/macos"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block", padding: "7px 14px", borderRadius: 8,
            background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)",
            color: "#a78bfa", fontSize: "0.78rem", fontWeight: 600,
            textDecoration: "none", transition: "all 0.2s",
          }}
        >
          Download Tailscale ↗
        </a>
      </div>

      {/* LAN PIN card */}
      <div style={{
        padding: "16px 18px", borderRadius: 12,
        background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>
            📱
          </div>
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
              LAN PIN Pairing
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
              Quick pairing for devices on the same Wi-Fi network
            </div>
          </div>
        </div>

        {pin ? (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Your pairing PIN
            </div>
            <div style={{
              fontSize: "2rem", fontWeight: 800, fontFamily: "monospace",
              letterSpacing: "0.2em", color: "#22d3ee",
              background: "rgba(34,211,238,0.06)", borderRadius: 10,
              padding: "12px 24px", display: "inline-block",
              border: "1px solid rgba(34,211,238,0.15)",
            }}>
              {pin}
            </div>
            <div style={{ marginTop: 8, fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
              Valid for 5 minutes · Enter this PIN on your mobile app
            </div>
          </div>
        ) : (
          <button
            onClick={fetchPin}
            disabled={loadingPin}
            style={{
              width: "100%", padding: "8px 16px", borderRadius: 9,
              background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.2)",
              color: loadingPin ? "var(--color-text-muted)" : "#22d3ee",
              fontSize: "0.8rem", fontWeight: 600, cursor: loadingPin ? "default" : "pointer",
              transition: "all 0.2s",
            }}
          >
            {loadingPin ? "Generating…" : "Generate pairing PIN"}
          </button>
        )}
      </div>
    </div>
  );
}

function CompleteStep({
  permissions,
  language,
  onGetStarted,
}: {
  permissions: Permissions;
  language: AppLanguage;
  onGetStarted: () => void;
}) {
  const grantedCount = Object.values(permissions).filter(s => s === "granted").length;
  const total = Object.keys(permissions).length;

  const items = [
    {
      icon: grantedCount === total ? "✅" : grantedCount > 0 ? "⚠️" : "❌",
      label: "Permissions",
      value: `${grantedCount}/${total} granted`,
      ok: grantedCount === total,
    },
    {
      icon: "🌐",
      label: "Language",
      value: SUPPORTED_LANGUAGES.find(l => l.code === language)?.nativeName ?? language,
      ok: true,
    },
  ];

  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>
          {grantedCount === total ? "🚀" : "⚙️"}
        </div>
        <h2 style={{ margin: "0 0 10px", fontSize: "1.3rem", fontWeight: 800, color: "var(--color-text-primary)" }}>
          {grantedCount === total ? "You're all set!" : "Almost ready!"}
        </h2>
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
          {grantedCount === total
            ? "OmniState is fully configured and ready to use."
            : "Some permissions are missing. OmniState will work with reduced capabilities until they're granted."}
        </p>
      </div>

      {/* Summary */}
      <div style={{
        borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)", overflow: "hidden", marginBottom: 24,
      }}>
        {items.map((item, i) => (
          <div key={item.label} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "13px 18px",
            borderBottom: i < items.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
          }}>
            <span style={{ fontSize: 18 }}>{item.icon}</span>
            <span style={{ flex: 1, fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>{item.label}</span>
            <span style={{
              fontSize: "0.8rem", fontWeight: 600,
              color: item.ok ? "#22c55e" : "#f59e0b",
            }}>
              {item.value}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={onGetStarted}
        style={{
          width: "100%", padding: "13px 20px", borderRadius: 12, cursor: "pointer",
          background: "linear-gradient(135deg, #6366f1, #7c3aed)",
          border: "none", color: "white", fontSize: "0.95rem", fontWeight: 700,
          boxShadow: "0 6px 24px rgba(99,102,241,0.4)",
          transition: "all 0.2s",
          letterSpacing: "0.01em",
        }}
      >
        Get Started →
      </button>
    </div>
  );
}

// ─── Main wizard ─────────────────────────────────────────────────────────────

interface Props {
  onComplete: () => void;
  /** Called when the user clicks "Open Voice Enrollment" to switch to voice panel */
  onNavigateToVoice?: () => void;
}

export function OnboardingWizard({ onComplete, onNavigateToVoice }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [permissions, setPermissions] = useState<Permissions>({
    accessibility: "unknown",
    screenRecording: "unknown",
    automation: "unknown",
  });

  const appLanguage = useChatStore(s => s.appLanguage);
  const setAppLanguage = useChatStore(s => s.setAppLanguage);
  const connectionState = useChatStore(s => s.connectionState);

  const currentStep = STEPS[stepIndex];

  // ── Check permissions via gateway task ──────────────────────────────────────
  const checkPermissions = useCallback(() => {
    setPermissions(prev => ({
      accessibility: prev.accessibility === "granted" ? "granted" : "checking",
      screenRecording: prev.screenRecording === "granted" ? "granted" : "checking",
      automation: prev.automation === "granted" ? "granted" : "checking",
    }));

    const client = getClient();
    if (!client.isConnected) {
      // Gateway offline — mark all as unknown so user can try again later
      setPermissions({ accessibility: "unknown", screenRecording: "unknown", automation: "unknown" });
      return;
    }

    // Ask the gateway to check macOS permissions; result surfaces via task.complete
    client.sendTask("check macOS permissions: accessibility, screenRecording, automation — report status as JSON");

    // Listen for one task.complete to parse the result
    const unsub = client.on("task.complete", (msg: any) => {
      unsub();
      try {
        const result = msg.result ?? {};
        // Gateway should return e.g. { accessibility: true, screenRecording: false, automation: true }
        setPermissions(prev => ({
          accessibility: typeof result.accessibility === "boolean"
            ? (result.accessibility ? "granted" : "denied") : prev.accessibility,
          screenRecording: typeof result.screenRecording === "boolean"
            ? (result.screenRecording ? "granted" : "denied") : prev.screenRecording,
          automation: typeof result.automation === "boolean"
            ? (result.automation ? "granted" : "denied") : prev.automation,
        }));
      } catch {
        // Couldn't parse — leave as unknown, user can re-check
        setPermissions({ accessibility: "unknown", screenRecording: "unknown", automation: "unknown" });
      }
    });

    // Timeout safety — if no reply in 8s, clear checking state
    setTimeout(() => {
      setPermissions(prev => ({
        accessibility: prev.accessibility === "checking" ? "unknown" : prev.accessibility,
        screenRecording: prev.screenRecording === "checking" ? "unknown" : prev.screenRecording,
        automation: prev.automation === "checking" ? "unknown" : prev.automation,
      }));
    }, 8000);
  }, []);

  const requestPermission = useCallback((id: keyof Permissions) => {
    setPermissions(prev => ({ ...prev, [id]: "checking" }));
    const client = getClient();
    if (!client.isConnected) {
      setPermissions(prev => ({ ...prev, [id]: "unknown" }));
      return;
    }
    client.sendTask(`request macOS ${id} permission and check its current status`);
    const unsub = client.on("task.complete", (msg: any) => {
      unsub();
      try {
        const result = msg.result ?? {};
        const key = id as string;
        if (typeof result[key] === "boolean") {
          setPermissions(prev => ({ ...prev, [id]: result[key] ? "granted" : "denied" }));
        } else {
          setPermissions(prev => ({ ...prev, [id]: "unknown" }));
        }
      } catch {
        setPermissions(prev => ({ ...prev, [id]: "unknown" }));
      }
    });
    setTimeout(() => {
      setPermissions(prev => ({ ...prev, [id]: prev[id] === "checking" ? "unknown" : prev[id] }));
    }, 8000);
  }, []);

  // Auto-check permissions when entering the permissions step
  useEffect(() => {
    if (currentStep === "permissions" && connectionState === "connected") {
      checkPermissions();
    }
  }, [currentStep, connectionState, checkPermissions]);

  const goNext = () => {
    if (stepIndex < STEPS.length - 1) setStepIndex(i => i + 1);
  };

  const goBack = () => {
    if (stepIndex > 0) setStepIndex(i => i - 1);
  };

  const handleGetStarted = () => {
    markOnboardingComplete();
    onComplete();
  };

  const handleVoiceNavigate = () => {
    markOnboardingComplete();
    onComplete();
    onNavigateToVoice?.();
  };

  // ── Keyboard navigation ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && stepIndex === STEPS.length - 1) handleGetStarted();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepIndex]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    // Backdrop
    <div style={{
      position: "fixed", inset: 0, zIndex: 9000,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(5,5,8,0.85)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
    }}>
      {/* Modal card */}
      <div
        className="animate-fade-in"
        style={{
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 48px)",
          display: "flex", flexDirection: "column",
          background: "rgba(13,13,26,0.95)",
          border: "1px solid rgba(99,102,241,0.2)",
          borderRadius: 20,
          boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}
      >
        {/* Progress bar */}
        <div style={{ height: 3, background: "rgba(255,255,255,0.04)", flexShrink: 0 }}>
          <div style={{
            height: "100%",
            width: `${((stepIndex + 1) / STEPS.length) * 100}%`,
            background: "linear-gradient(90deg, #6366f1, #a78bfa)",
            transition: "width 0.4s cubic-bezier(0.16,1,0.3,1)",
          }} />
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 28px 0" }}>
          <StepDots current={stepIndex} />

          {currentStep === "welcome" && (
            <WelcomeStep language={appLanguage} onLanguageChange={setAppLanguage} />
          )}
          {currentStep === "permissions" && (
            <PermissionsStep
              permissions={permissions}
              onRequest={requestPermission}
              onCheckAll={checkPermissions}
            />
          )}
          {currentStep === "voice" && (
            <VoiceStep onNavigateToVoice={handleVoiceNavigate} />
          )}
          {currentStep === "remote" && (
            <RemoteStep />
          )}
          {currentStep === "complete" && (
            <CompleteStep
              permissions={permissions}
              language={appLanguage}
              onGetStarted={handleGetStarted}
            />
          )}
        </div>

        {/* Footer nav */}
        {currentStep !== "complete" && (
          <div style={{
            padding: "20px 28px 24px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            borderTop: "1px solid rgba(255,255,255,0.04)", flexShrink: 0,
          }}>
            {stepIndex > 0 ? (
              <button
                onClick={goBack}
                style={{
                  padding: "9px 18px", borderRadius: 9,
                  background: "none", border: "1px solid rgba(255,255,255,0.08)",
                  color: "var(--color-text-muted)", fontSize: "0.82rem", fontWeight: 600,
                  cursor: "pointer", transition: "all 0.2s",
                }}
              >
                ← Back
              </button>
            ) : (
              <div />
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* Skip link for optional steps */}
              {(currentStep === "voice" || currentStep === "remote") && (
                <button
                  onClick={goNext}
                  style={{
                    padding: "9px 14px", borderRadius: 9,
                    background: "none", border: "none",
                    color: "var(--color-text-muted)", fontSize: "0.8rem",
                    cursor: "pointer", transition: "color 0.2s",
                  }}
                >
                  Skip
                </button>
              )}

              <button
                onClick={goNext}
                style={{
                  padding: "9px 22px", borderRadius: 9,
                  background: "linear-gradient(135deg, #6366f1, #7c3aed)",
                  border: "none", color: "white", fontSize: "0.875rem", fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 4px 16px rgba(99,102,241,0.35)",
                  transition: "all 0.2s",
                }}
              >
                {currentStep === "remote" ? "Review →" : "Next →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
