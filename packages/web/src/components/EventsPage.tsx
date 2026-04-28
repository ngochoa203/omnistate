import { useEffect, useState, useCallback } from "react";
import { getClient } from "../hooks/useGateway";
import { useChatStore } from "../lib/chat-store";
import type { EventSeverity } from "../lib/protocol";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventRule {
  id: string;
  name: string;
  eventPattern: string;
  condition?: string;
  action: { type: string; config: Record<string, unknown> };
  enabled: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

function severityColor(severity: EventSeverity): string {
  switch (severity) {
    case "debug": return "rgba(156,163,175,1)";
    case "info": return "#60a5fa";
    case "warning": return "#fbbf24";
    case "error": return "#f87171";
    case "critical": return "#e879f9";
  }
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11, cursor: "pointer",
        background: checked ? "rgba(99,102,241,0.8)" : "rgba(255,255,255,0.1)",
        border: `1px solid ${checked ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.12)"}`,
        position: "relative", transition: "background 0.2s, border-color 0.2s",
        flexShrink: 0, outline: "none",
      }}
    >
      <div style={{
        position: "absolute", top: 3, left: checked ? 20 : 3,
        width: 14, height: 14, borderRadius: "50%",
        background: "white", transition: "left 0.2s",
        boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
      }} />
    </div>
  );
}

// ─── Rule Card ────────────────────────────────────────────────────────────────

function RuleCard({ rule, onToggle }: { rule: EventRule; onToggle: () => void }) {
  return (
    <div style={{
      borderRadius: 12,
      background: "rgba(255,255,255,0.03)",
      border: `1px solid ${rule.enabled ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.06)"}`,
      padding: "14px 16px",
      marginBottom: 8,
      transition: "border-color 0.2s",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.88rem", fontWeight: 600, color: "white" }}>{rule.name}</span>
            <span style={{
              fontSize: "0.65rem", padding: "2px 7px", borderRadius: 20, fontFamily: "monospace",
              background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)",
              color: "#a78bfa",
            }}>
              {rule.eventPattern}
            </span>
          </div>
          {rule.condition && (
            <div style={{ fontSize: "0.74rem", color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginBottom: 4 }}>
              if: <span style={{ color: "rgba(255,255,255,0.6)" }}>{rule.condition}</span>
            </div>
          )}
          <div style={{ fontSize: "0.74rem", color: "rgba(255,255,255,0.4)" }}>
            action: <span style={{
              fontSize: "0.68rem", padding: "1px 6px", borderRadius: 6,
              background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.2)",
              color: "#22d3ee",
            }}>{rule.action.type}</span>
          </div>
        </div>
        <Toggle checked={rule.enabled} onChange={onToggle} />
      </div>
    </div>
  );
}

// ─── Add Rule Form ────────────────────────────────────────────────────────────

const ACTION_TYPES = ["execute_task", "run_script", "notify", "escalate_to_planner"];

const DEFAULT_RULE_FORM = {
  name: "",
  eventPattern: "",
  condition: "",
  actionType: "execute_task",
  actionConfig: "{}",
};

function AddRuleForm({ onSave, onCancel }: { onSave: (form: typeof DEFAULT_RULE_FORM) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ ...DEFAULT_RULE_FORM });
  const [configError, setConfigError] = useState("");

  const set = (patch: Partial<typeof DEFAULT_RULE_FORM>) => setForm((f) => ({ ...f, ...patch }));

  const handleSave = () => {
    try {
      JSON.parse(form.actionConfig);
      setConfigError("");
      onSave(form);
    } catch {
      setConfigError("Action config must be valid JSON");
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px", borderRadius: 8, fontSize: "0.83rem",
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
    color: "white", outline: "none", boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "0.73rem", color: "rgba(255,255,255,0.4)",
    marginBottom: 5, fontWeight: 500,
  };

  return (
    <div style={{
      borderRadius: 12, padding: "18px 20px", marginBottom: 16,
      background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)",
    }}>
      <h4 style={{ margin: "0 0 16px", fontSize: "0.9rem", fontWeight: 700, color: "white" }}>New Rule</h4>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle} htmlFor="rule-name">Name</label>
        <input id="rule-name" type="text" value={form.name} onChange={(e) => set({ name: e.target.value })}
          placeholder="Alert on zoom open" style={inputStyle} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle} htmlFor="rule-pattern">Event Pattern</label>
        <input id="rule-pattern" type="text" value={form.eventPattern} onChange={(e) => set({ eventPattern: e.target.value })}
          placeholder="app.opened" style={inputStyle} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle} htmlFor="rule-condition">Condition (optional)</label>
        <input id="rule-condition" type="text" value={form.condition} onChange={(e) => set({ condition: e.target.value })}
          placeholder='payload.app === "zoom.us"' style={inputStyle} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle} htmlFor="rule-action">Action Type</label>
        <select id="rule-action" value={form.actionType} onChange={(e) => set({ actionType: e.target.value })}
          style={{ ...inputStyle, background: "rgba(20,20,35,0.95)", cursor: "pointer" }}>
          {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle} htmlFor="rule-config">Action Config (JSON)</label>
        <textarea id="rule-config"
          value={form.actionConfig}
          onChange={(e) => set({ actionConfig: e.target.value })}
          rows={3}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: "0.78rem" }}
        />
        {configError && <div style={{ fontSize: "0.72rem", color: "#ef4444", marginTop: 4 }}>{configError}</div>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{
          flex: 1, padding: "8px 0", borderRadius: 8, cursor: "pointer",
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.5)", fontSize: "0.83rem", fontWeight: 600,
        }}>Cancel</button>
        <button
          onClick={handleSave}
          disabled={!form.name.trim() || !form.eventPattern.trim()}
          style={{
            flex: 2, padding: "8px 0", borderRadius: 8, cursor: "pointer",
            background: "linear-gradient(135deg, #6366f1, #7c3aed)",
            border: "none", color: "white", fontSize: "0.83rem", fontWeight: 700,
            opacity: !form.name.trim() || !form.eventPattern.trim() ? 0.5 : 1,
          }}
        >Save Rule</button>
      </div>
    </div>
  );
}

// ─── Simulate Observation Form ─────────────────────────────────────────────────

const SEVERITY_OPTIONS: EventSeverity[] = ["debug", "info", "warning", "error", "critical"];

const DEFAULT_SIM_FORM = {
  source: "",
  kind: "",
  severity: "info" as EventSeverity,
  title: "",
  body: "",
  tags: "",
};

function SimulateForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ ...DEFAULT_SIM_FORM });
  const set = (patch: Partial<typeof DEFAULT_SIM_FORM>) => setForm((f) => ({ ...f, ...patch }));

  const handleSubmit = () => {
    if (!form.source.trim() || !form.kind.trim() || !form.title.trim()) return;
    getClient().ingestEvent({
      source: form.source.trim(),
      kind: form.kind.trim(),
      severity: form.severity,
      title: form.title.trim(),
      body: form.body.trim() || undefined,
      tags: form.tags.trim() ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    });
    onClose();
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px", borderRadius: 8, fontSize: "0.83rem",
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
    color: "white", outline: "none", boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "0.73rem", color: "rgba(255,255,255,0.4)",
    marginBottom: 5, fontWeight: 500,
  };

  const canSubmit = form.source.trim() && form.kind.trim() && form.title.trim();

  return (
    <div style={{
      borderRadius: 12, padding: "18px 20px", marginBottom: 24,
      background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.2)",
    }}>
      <h3 style={{ margin: "0 0 16px", fontSize: "0.95rem", fontWeight: 700, color: "white" }}>
        Simulate Observation
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle} htmlFor="sim-source">Source *</label>
          <input id="sim-source" type="text" value={form.source} onChange={(e) => set({ source: e.target.value })}
            placeholder="app.monitor" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="sim-kind">Kind *</label>
          <input id="sim-kind" type="text" value={form.kind} onChange={(e) => set({ kind: e.target.value })}
            placeholder="cpu.spike" style={inputStyle} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle} htmlFor="sim-severity">Severity</label>
        <select id="sim-severity" value={form.severity} onChange={(e) => set({ severity: e.target.value as EventSeverity })}
          style={{ ...inputStyle, background: "rgba(20,20,35,0.95)", cursor: "pointer" }}>
          {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle} htmlFor="sim-title">Title *</label>
        <input id="sim-title" type="text" value={form.title} onChange={(e) => set({ title: e.target.value })}
          placeholder="CPU usage exceeded 90%" style={inputStyle} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle} htmlFor="sim-body">Body</label>
        <textarea id="sim-body" value={form.body} onChange={(e) => set({ body: e.target.value })}
          placeholder="Additional details..." rows={2}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle} htmlFor="sim-tags">Tags (comma-separated)</label>
        <input id="sim-tags" type="text" value={form.tags} onChange={(e) => set({ tags: e.target.value })}
          placeholder="cpu, alert, system" style={inputStyle} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onClose} style={{
          flex: 1, padding: "8px 0", borderRadius: 8, cursor: "pointer",
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.5)", fontSize: "0.83rem", fontWeight: 600,
        }}>Cancel</button>
        <button onClick={handleSubmit} disabled={!canSubmit} style={{
          flex: 2, padding: "8px 0", borderRadius: 8, cursor: "pointer",
          background: "linear-gradient(135deg, #a78bfa, #7c3aed)",
          border: "none", color: "white", fontSize: "0.83rem", fontWeight: 700,
          opacity: canSubmit ? 1 : 0.5,
        }}>Send Event</button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function EventsPage() {
  const events = useChatStore((s) => s.events);
  const eventsLoading = useChatStore((s) => s.eventsLoading);
  const eventsError = useChatStore((s) => s.eventsError);
  const selectedEvent = useChatStore((s) => s.selectedEvent);
  const setSelectedEvent = useChatStore((s) => s.setSelectedEvent);

  const [rules, setRules] = useState<EventRule[]>([]);
  const [showAddRule, setShowAddRule] = useState(false);
  const [showSimulate, setShowSimulate] = useState(false);

  // Filters
  const [filterText, setFilterText] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterKind, setFilterKind] = useState("");
  const [filterSeverity, setFilterSeverity] = useState<EventSeverity | "">("");
  const [filterTags, setFilterTags] = useState("");

  useEffect(() => {
    const client = getClient();

    const unsub = client.on("events.rules.result", (msg: any) => {
      if (Array.isArray(msg.rules)) setRules(msg.rules);
    });

    client.queryEventRules();

    return () => { unsub(); };
  }, []);

  const handleRefresh = useCallback(() => {
    getClient().queryEvents({ limit: 50 });
  }, []);

  const handleToggleRule = useCallback((ruleId: string, enabled: boolean) => {
    getClient().toggleEventRule(ruleId, !enabled);
    setRules((prev) => prev.map((r) => r.id === ruleId ? { ...r, enabled: !r.enabled } : r));
  }, []);

  const handleAddRule = useCallback((form: typeof DEFAULT_RULE_FORM) => {
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(form.actionConfig); } catch { /* ignore */ }
    getClient().addEventRule({
      name: form.name,
      eventPattern: form.eventPattern,
      condition: form.condition || undefined,
      action: { type: form.actionType, config },
    });
    const newRule: EventRule = {
      id: `rule-${Date.now()}`,
      name: form.name,
      eventPattern: form.eventPattern,
      condition: form.condition || undefined,
      action: { type: form.actionType, config },
      enabled: true,
    };
    setRules((prev) => [newRule, ...prev]);
    setShowAddRule(false);
  }, []);

  const tagList = filterTags.trim() ? filterTags.split(",").map((t) => t.trim()).filter(Boolean) : [];

  const sortedEvents = [...events].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );

  const filteredEvents = sortedEvents.filter((e) => {
    if (filterText && !e.title.toLowerCase().includes(filterText.toLowerCase()) && !e.body?.toLowerCase().includes(filterText.toLowerCase())) return false;
    if (filterSource && !e.source.toLowerCase().includes(filterSource.toLowerCase())) return false;
    if (filterKind && !e.kind.toLowerCase().includes(filterKind.toLowerCase())) return false;
    if (filterSeverity && e.severity !== filterSeverity) return false;
    if (tagList.length > 0 && !tagList.some((t) => e.tags.includes(t))) return false;
    return true;
  });

  const inputStyle: React.CSSProperties = {
    padding: "7px 12px", borderRadius: 8, fontSize: "0.8rem",
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
    color: "white", outline: "none",
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "28px 32px" }}>
      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: "linear-gradient(135deg, rgba(99,102,241,0.3), rgba(167,139,250,0.2))",
            border: "1px solid rgba(99,102,241,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.8">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: "white" }}>Events</h1>
            <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "rgba(255,255,255,0.4)" }}>
              Durable observations and automation rules
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setShowSimulate((v) => !v)}
            style={{
              padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600,
              background: showSimulate ? "rgba(239,68,68,0.1)" : "rgba(167,139,250,0.15)",
              border: `1px solid ${showSimulate ? "rgba(239,68,68,0.3)" : "rgba(167,139,250,0.3)"}`,
              color: showSimulate ? "#ef4444" : "#a78bfa",
            }}
          >
            {showSimulate ? "Cancel" : "+ Simulate Observation"}
          </button>
          <button
            onClick={handleRefresh}
            style={{
              padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600,
              background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)", color: "#a78bfa",
            }}
            aria-label="Refresh events"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Simulate form */}
      {showSimulate && <SimulateForm onClose={() => setShowSimulate(false)} />}

      {/* Stats */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total Events", value: events.length, color: "#6366f1" },
          { label: "Filtered", value: filteredEvents.length, color: "#a78bfa" },
          { label: "Active Rules", value: rules.filter((r) => r.enabled).length, color: "#22c55e" },
          { label: "Total Rules", value: rules.length, color: "#22d3ee" },
        ].map((s) => (
          <div key={s.label} style={{
            padding: "12px 18px", borderRadius: 10,
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
            display: "flex", flexDirection: "column", gap: 2,
          }}>
            <span style={{ fontSize: "1.3rem", fontWeight: 800, color: s.color }}>{s.value}</span>
            <span style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.4)" }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text" value={filterText} onChange={(e) => setFilterText(e.target.value)}
          placeholder="Search title/body..." aria-label="Search events"
          style={{ ...inputStyle, flex: "1 1 160px" }}
        />
        <input
          type="text" value={filterSource} onChange={(e) => setFilterSource(e.target.value)}
          placeholder="Source..." aria-label="Filter by source"
          style={{ ...inputStyle, flex: "1 1 120px" }}
        />
        <input
          type="text" value={filterKind} onChange={(e) => setFilterKind(e.target.value)}
          placeholder="Kind..." aria-label="Filter by kind"
          style={{ ...inputStyle, flex: "1 1 120px" }}
        />
        <select
          value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value as EventSeverity | "")}
          aria-label="Filter by severity"
          style={{ ...inputStyle, background: "rgba(20,20,35,0.95)", cursor: "pointer", flex: "0 0 auto" }}
        >
          <option value="">All severities</option>
          {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="text" value={filterTags} onChange={(e) => setFilterTags(e.target.value)}
          placeholder="Tags (comma-sep)..." aria-label="Filter by tags"
          style={{ ...inputStyle, flex: "1 1 140px" }}
        />
      </div>

      {/* Events List */}
      <section aria-label="Event records" style={{ marginBottom: 36 }}>
        <h2 style={{ margin: "0 0 14px", fontSize: "1rem", fontWeight: 700, color: "white" }}>Recent Events</h2>

        {eventsLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 0", color: "rgba(255,255,255,0.4)", fontSize: "0.85rem" }}>
            <div style={{ width: 14, height: 14, border: "2px solid rgba(99,102,241,0.3)", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            Loading events...
          </div>
        )}

        {eventsError && (
          <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", fontSize: "0.83rem", marginBottom: 16 }}>
            Error: {eventsError}
          </div>
        )}

        {!eventsLoading && filteredEvents.length === 0 ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            height: 140, gap: 10, borderRadius: 12,
            background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.07)",
          }}>
            <div style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.3)" }}>
              {events.length === 0 ? "No events yet — use Simulate to create one" : "No events match filters"}
            </div>
          </div>
        ) : (
          <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
            {filteredEvents.map((event, i) => (
              <button
                key={event.id}
                onClick={() => setSelectedEvent(selectedEvent?.id === event.id ? null : event)}
                style={{
                  width: "100%", textAlign: "left", cursor: "pointer",
                  padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 10,
                  borderBottom: i < filteredEvents.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  background: selectedEvent?.id === event.id ? "rgba(99,102,241,0.08)" : i === 0 ? "rgba(99,102,241,0.03)" : "transparent",
                  border: "none", color: "inherit",
                  transition: "background 0.15s",
                }}
                aria-selected={selectedEvent?.id === event.id}
                aria-label={`Event: ${event.title}`}
              >
                {/* Severity badge */}
                <span style={{
                  flexShrink: 0, marginTop: 2,
                  fontSize: "0.62rem", fontWeight: 700, padding: "2px 7px", borderRadius: 20,
                  background: `${severityColor(event.severity)}22`,
                  color: severityColor(event.severity),
                  border: `1px solid ${severityColor(event.severity)}44`,
                  fontFamily: "monospace", textTransform: "uppercase",
                }}>
                  {event.severity}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "white" }}>{event.title}</span>
                    <span style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>{event.source} / {event.kind}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.25)" }}>{timeAgo(event.occurredAt)}</span>
                    {event.tags.slice(0, 4).map((tag) => (
                      <span key={tag} style={{
                        fontSize: "0.62rem", padding: "1px 6px", borderRadius: 6,
                        background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)",
                        color: "#a78bfa", fontFamily: "monospace",
                      }}>{tag}</span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Detail Card */}
        {selectedEvent && (
          <div style={{
            marginTop: 16, borderRadius: 12, padding: "18px 20px",
            background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.25)",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: "0.65rem", fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                    background: `${severityColor(selectedEvent.severity)}22`,
                    color: severityColor(selectedEvent.severity),
                    border: `1px solid ${severityColor(selectedEvent.severity)}44`,
                    textTransform: "uppercase",
                  }}>{selectedEvent.severity}</span>
                  <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "white" }}>{selectedEvent.title}</h3>
                </div>
                <div style={{ fontSize: "0.73rem", color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
                  {selectedEvent.source} / {selectedEvent.kind}
                </div>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                aria-label="Close detail"
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", padding: 4, flexShrink: 0 }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {selectedEvent.body && (
              <p style={{ margin: "0 0 14px", fontSize: "0.82rem", color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
                {selectedEvent.body}
              </p>
            )}
            {selectedEvent.tags.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                {selectedEvent.tags.map((tag) => (
                  <span key={tag} style={{
                    fontSize: "0.65rem", padding: "2px 8px", borderRadius: 20,
                    background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)",
                    color: "#a78bfa", fontFamily: "monospace",
                  }}>{tag}</span>
                ))}
              </div>
            )}
            {Object.keys(selectedEvent.metadata).length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>Metadata</div>
                <pre style={{
                  margin: 0, fontSize: "0.72rem", color: "rgba(255,255,255,0.6)", fontFamily: "monospace",
                  background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "10px 12px",
                  overflowX: "auto",
                }}>
                  {JSON.stringify(selectedEvent.metadata, null, 2)}
                </pre>
              </div>
            )}
            <div style={{ display: "flex", gap: 20, fontSize: "0.72rem", color: "rgba(255,255,255,0.35)" }}>
              <span>Occurred: {new Date(selectedEvent.occurredAt).toLocaleString()}</span>
              <span>Created: {new Date(selectedEvent.createdAt).toLocaleString()}</span>
            </div>
          </div>
        )}
      </section>

      {/* Rules */}
      <section aria-label="Event rules">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "white" }}>Rules</h2>
          <button
            onClick={() => setShowAddRule((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 16px", borderRadius: 8, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600,
              background: showAddRule ? "rgba(239,68,68,0.1)" : "rgba(99,102,241,0.15)",
              border: `1px solid ${showAddRule ? "rgba(239,68,68,0.3)" : "rgba(99,102,241,0.3)"}`,
              color: showAddRule ? "#ef4444" : "#a78bfa",
            }}
          >
            {showAddRule ? "Cancel" : "+ Add Rule"}
          </button>
        </div>

        {showAddRule && (
          <AddRuleForm onSave={handleAddRule} onCancel={() => setShowAddRule(false)} />
        )}

        {rules.length === 0 && !showAddRule ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            height: 140, gap: 10, borderRadius: 12,
            background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.07)",
          }}>
            <div style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.3)" }}>No rules configured</div>
            <button
              onClick={() => setShowAddRule(true)}
              style={{
                padding: "6px 16px", borderRadius: 8, cursor: "pointer", fontSize: "0.78rem", fontWeight: 600,
                background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)",
                color: "#a78bfa",
              }}
            >
              + Add first rule
            </button>
          </div>
        ) : (
          rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onToggle={() => handleToggleRule(rule.id, rule.enabled)}
            />
          ))
        )}
      </section>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
