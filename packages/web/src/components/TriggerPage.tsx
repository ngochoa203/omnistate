import { useEffect, useState, useCallback } from "react";
import { getClient } from "../hooks/useGateway";
import type { ClientMessage } from "../lib/protocol";

function send(msg: object) {
  getClient().send(msg as unknown as ClientMessage);
}

// ─── Types ───────────────────────────────────────────────────────────────────

type TriggerConditionType =
  | "cpu_threshold"
  | "memory_threshold"
  | "cron"
  | "filesystem_change"
  | "process_event"
  | "webhook"
  | "event_match";

interface TriggerCondition {
  type: TriggerConditionType;
  config: Record<string, unknown>;
}

interface TriggerAction {
  type: "execute_task";
  goal: string;
  layer?: "deep" | "surface" | "auto";
}

interface TriggerDef {
  id: string;
  userId: string;
  name: string;
  description: string;
  condition: TriggerCondition;
  action: TriggerAction;
  enabled: boolean;
  cooldownMs: number;
  fireCount: number;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TriggerLogEntry {
  id: string;
  trigger_id: string;
  fired_at: string;
  status: "fired" | "executed" | "failed";
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function conditionIcon(type: TriggerConditionType) {
  switch (type) {
    case "cpu_threshold":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <line x1="9" y1="1" x2="9" y2="4" />
          <line x1="15" y1="1" x2="15" y2="4" />
          <line x1="9" y1="20" x2="9" y2="23" />
          <line x1="15" y1="20" x2="15" y2="23" />
          <line x1="20" y1="9" x2="23" y2="9" />
          <line x1="20" y1="14" x2="23" y2="14" />
          <line x1="1" y1="9" x2="4" y2="9" />
          <line x1="1" y1="14" x2="4" y2="14" />
        </svg>
      );
    case "memory_threshold":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 19V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v14" />
          <path d="M3 19h18" />
          <line x1="10" y1="7" x2="14" y2="7" />
          <line x1="10" y1="11" x2="14" y2="11" />
          <line x1="10" y1="15" x2="14" y2="15" />
        </svg>
      );
    case "cron":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "filesystem_change":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 3h6l2 3h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
        </svg>
      );
    case "process_event":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      );
    case "webhook":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case "event_match":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      );
  }
}

function conditionLabel(type: TriggerConditionType): string {
  const map: Record<TriggerConditionType, string> = {
    cpu_threshold: "CPU Threshold",
    memory_threshold: "Memory Threshold",
    cron: "Cron Schedule",
    filesystem_change: "File System",
    process_event: "Process Event",
    webhook: "Webhook",
    event_match: "Event Match",
  };
  return map[type];
}

function conditionSummary(condition: TriggerCondition): string {
  const { type, config } = condition;
  if (type === "cpu_threshold" || type === "memory_threshold") {
    return `${config.operator === "gt" ? ">" : "<"} ${config.value}%`;
  }
  if (type === "cron") return String(config.expression ?? "");
  if (type === "filesystem_change") return String(config.path ?? "");
  if (type === "process_event") return `${config.name} ${config.event}`;
  if (type === "webhook") return "POST /webhook/:id";
  if (type === "event_match") {
    const parts = [config.source, config.kind, config.severity].filter(Boolean);
    return parts.length > 0 ? parts.join(" / ") : "any event";
  }
  return "";
}

function formatTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleString();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

// ─── Default form values ──────────────────────────────────────────────────────

const DEFAULT_FORM = {
  name: "",
  description: "",
  conditionType: "cpu_threshold" as TriggerConditionType,
  // cpu / memory
  operator: "gt",
  thresholdValue: 80,
  memUnit: "percent",
  // cron
  cronExpression: "0 9 * * *",
  // filesystem
  fsPath: "",
  fsEvents: ["rename", "change"],
  // process
  processName: "",
  processEvent: "start",
  // event_match
  eventMatchSource: "",
  eventMatchKind: "",
  eventMatchSeverity: "",
  eventMatchTagsAny: "",
  eventMatchText: "",
  // action
  goal: "",
  layer: "auto" as "deep" | "surface" | "auto",
  cooldownMinutes: 1,
};

type FormState = typeof DEFAULT_FORM;

// ─── Condition config builder ─────────────────────────────────────────────────

function buildCondition(form: FormState): TriggerCondition {
  switch (form.conditionType) {
    case "cpu_threshold":
      return { type: "cpu_threshold", config: { operator: form.operator, value: form.thresholdValue } };
    case "memory_threshold":
      return { type: "memory_threshold", config: { operator: form.operator, value: form.thresholdValue, unit: form.memUnit } };
    case "cron":
      return { type: "cron", config: { expression: form.cronExpression } };
    case "filesystem_change":
      return { type: "filesystem_change", config: { path: form.fsPath, events: form.fsEvents } };
    case "process_event":
      return { type: "process_event", config: { name: form.processName, event: form.processEvent } };
    case "webhook":
      return { type: "webhook", config: {} };
    case "event_match":
      return {
        type: "event_match",
        config: {
          ...(form.eventMatchSource && { source: form.eventMatchSource }),
          ...(form.eventMatchKind && { kind: form.eventMatchKind }),
          ...(form.eventMatchSeverity && { severity: form.eventMatchSeverity }),
          ...(form.eventMatchTagsAny && { tagsAny: form.eventMatchTagsAny.split(",").map((t) => t.trim()).filter(Boolean) }),
          ...(form.eventMatchText && { text: form.eventMatchText }),
        },
      };
  }
}

function triggerToForm(t: TriggerDef): FormState {
  const base = { ...DEFAULT_FORM };
  base.name = t.name;
  base.description = t.description;
  base.conditionType = t.condition.type;
  base.goal = t.action.goal;
  base.layer = (t.action.layer ?? "auto") as "deep" | "surface" | "auto";
  base.cooldownMinutes = Math.max(1, Math.round(t.cooldownMs / 60000));

  const cfg = t.condition.config;
  if (t.condition.type === "cpu_threshold" || t.condition.type === "memory_threshold") {
    base.operator = String(cfg.operator ?? "gt");
    base.thresholdValue = Number(cfg.value ?? 80);
    base.memUnit = String(cfg.unit ?? "percent");
  }
  if (t.condition.type === "cron") base.cronExpression = String(cfg.expression ?? "");
  if (t.condition.type === "filesystem_change") {
    base.fsPath = String(cfg.path ?? "");
    base.fsEvents = Array.isArray(cfg.events) ? (cfg.events as string[]) : ["rename"];
  }
  if (t.condition.type === "process_event") {
    base.processName = String(cfg.name ?? "");
    base.processEvent = String(cfg.event ?? "start");
  }
  if (t.condition.type === "event_match") {
    base.eventMatchSource = String(cfg.source ?? "");
    base.eventMatchKind = String(cfg.kind ?? "");
    base.eventMatchSeverity = String(cfg.severity ?? "");
    base.eventMatchTagsAny = Array.isArray(cfg.tagsAny) ? (cfg.tagsAny as string[]).join(", ") : "";
    base.eventMatchText = String(cfg.text ?? "");
  }
  return base;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11, cursor: "pointer",
        background: checked ? "rgba(99,102,241,0.8)" : "rgba(255,255,255,0.1)",
        border: `1px solid ${checked ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.12)"}`,
        position: "relative", transition: "background 0.2s, border-color 0.2s",
        flexShrink: 0,
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

function Input({ label, value, onChange, type = "text", placeholder, min, max, step }: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: 5, fontWeight: 500 }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", padding: "8px 12px", borderRadius: 8, fontSize: "0.85rem",
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
          color: "white", outline: "none", boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: 5, fontWeight: 500 }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", padding: "8px 12px", borderRadius: 8, fontSize: "0.85rem",
          background: "rgba(20,20,35,0.95)", border: "1px solid rgba(255,255,255,0.1)",
          color: "white", outline: "none", boxSizing: "border-box", cursor: "pointer",
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─── Condition Config Panel ───────────────────────────────────────────────────

function ConditionConfigPanel({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });

  switch (form.conditionType) {
    case "cpu_threshold":
    case "memory_threshold": {
      const isMemory = form.conditionType === "memory_threshold";
      return (
        <div>
          <Select
            label="Operator"
            value={form.operator}
            onChange={(v) => set({ operator: v })}
            options={[{ value: "gt", label: "Above (%)" }, { value: "lt", label: "Below (%)" }]}
          />
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: 5, fontWeight: 500 }}>
              Threshold: {form.thresholdValue}%
            </label>
            <input
              type="range" min={1} max={99} value={form.thresholdValue}
              onChange={(e) => set({ thresholdValue: Number(e.target.value) })}
              style={{ width: "100%", accentColor: "#6366f1" }}
            />
          </div>
          {isMemory && (
            <Select
              label="Unit"
              value={form.memUnit}
              onChange={(v) => set({ memUnit: v })}
              options={[{ value: "percent", label: "Percent (%)" }, { value: "mb", label: "Megabytes (MB)" }]}
            />
          )}
        </div>
      );
    }
    case "cron":
      return (
        <div>
          <Input
            label="Cron Expression"
            value={form.cronExpression}
            onChange={(v) => set({ cronExpression: v })}
            placeholder="0 9 * * *"
          />
          <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", marginTop: -8, marginBottom: 14, lineHeight: 1.6 }}>
            Format: <code style={{ color: "#a78bfa" }}>minute hour day month weekday</code>
            <br />Examples: <code style={{ color: "#6ee7b7" }}>*/15 * * * *</code> (every 15m) · <code style={{ color: "#6ee7b7" }}>0 8 * * 1-5</code> (weekdays 8am)
          </div>
        </div>
      );
    case "filesystem_change":
      return (
        <div>
          <Input
            label="Watch Path"
            value={form.fsPath}
            onChange={(v) => set({ fsPath: v })}
            placeholder="/Users/me/Projects"
          />
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: 8, fontWeight: 500 }}>
              Events
            </label>
            {(["rename", "change", "all"] as const).map((ev) => (
              <label key={ev} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer", fontSize: "0.82rem", color: "var(--color-text-secondary)" }}>
                <input
                  type="checkbox"
                  checked={form.fsEvents.includes(ev)}
                  onChange={(e) => {
                    const evts = e.target.checked
                      ? [...form.fsEvents, ev]
                      : form.fsEvents.filter((x) => x !== ev);
                    set({ fsEvents: evts });
                  }}
                  style={{ accentColor: "#6366f1" }}
                />
                {ev === "rename" ? "Create / Delete" : ev === "change" ? "Modify" : "All events"}
              </label>
            ))}
          </div>
        </div>
      );
    case "process_event":
      return (
        <div>
          <Input
            label="Process Name"
            value={form.processName}
            onChange={(v) => set({ processName: v })}
            placeholder="node"
          />
          <Select
            label="Event"
            value={form.processEvent}
            onChange={(v) => set({ processEvent: v })}
            options={[{ value: "start", label: "Process Started" }, { value: "stop", label: "Process Stopped" }]}
          />
        </div>
      );
    case "webhook":
      return (
        <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", marginBottom: 14 }}>
          <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: 4 }}>Webhook URL (after save)</div>
          <code style={{ fontSize: "0.78rem", color: "#a78bfa" }}>POST http://localhost:PORT/webhook/{"<trigger-id>"}</code>
          <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginTop: 6 }}>
            Fire this trigger by sending a POST request to the generated URL.
          </div>
        </div>
      );
    case "event_match":
      return (
        <div>
          <Input
            label="Source (optional)"
            value={form.eventMatchSource}
            onChange={(v) => set({ eventMatchSource: v })}
            placeholder="app.monitor"
          />
          <Input
            label="Kind (optional)"
            value={form.eventMatchKind}
            onChange={(v) => set({ eventMatchKind: v })}
            placeholder="cpu.spike"
          />
          <Select
            label="Severity (optional)"
            value={form.eventMatchSeverity}
            onChange={(v) => set({ eventMatchSeverity: v })}
            options={[
              { value: "", label: "Any severity" },
              { value: "debug", label: "Debug" },
              { value: "info", label: "Info" },
              { value: "warning", label: "Warning" },
              { value: "error", label: "Error" },
              { value: "critical", label: "Critical" },
            ]}
          />
          <Input
            label="Tags Any (comma-separated, optional)"
            value={form.eventMatchTagsAny}
            onChange={(v) => set({ eventMatchTagsAny: v })}
            placeholder="cpu, alert"
          />
          <Input
            label="Text search (optional)"
            value={form.eventMatchText}
            onChange={(v) => set({ eventMatchText: v })}
            placeholder="high usage"
          />
        </div>
      );
  }
}

// ─── Create/Edit Modal ────────────────────────────────────────────────────────

function TriggerModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: TriggerDef;
  onSave: (form: FormState) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    initial ? triggerToForm(initial) : { ...DEFAULT_FORM }
  );

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div style={{
        width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto",
        background: "rgba(12,12,20,0.98)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 16, padding: 28, boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "white" }}>
            {initial ? "Edit Trigger" : "Create Trigger"}
          </h3>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", padding: 4 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Basic info */}
        <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="High CPU Alert" />
        <Input label="Description (optional)" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="Fires when CPU is high" />

        {/* Condition type */}
        <Select
          label="Condition Type"
          value={form.conditionType}
          onChange={(v) => setForm({ ...form, conditionType: v as TriggerConditionType })}
          options={[
            { value: "cpu_threshold", label: "CPU Threshold" },
            { value: "memory_threshold", label: "Memory Threshold" },
            { value: "cron", label: "Cron Schedule" },
            { value: "filesystem_change", label: "File System Change" },
            { value: "process_event", label: "Process Event" },
            { value: "webhook", label: "Webhook" },
            { value: "event_match", label: "Event Match" },
          ]}
        />

        {/* Dynamic condition config */}
        <div style={{ padding: "14px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", marginBottom: 14 }}>
          <ConditionConfigPanel form={form} setForm={setForm} />
        </div>

        {/* Action */}
        <div style={{ marginBottom: 14, padding: "14px", borderRadius: 10, background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)" }}>
          <Input
            label="Task Goal (what to execute when triggered)"
            value={form.goal}
            onChange={(v) => setForm({ ...form, goal: v })}
            placeholder="Check CPU usage and notify if processes are runaway"
          />
          <Select
            label="Execution Layer"
            value={form.layer}
            onChange={(v) => setForm({ ...form, layer: v as "deep" | "surface" | "auto" })}
            options={[
              { value: "auto", label: "Auto (let planner decide)" },
              { value: "surface", label: "Surface (fast, shallow)" },
              { value: "deep", label: "Deep (full pipeline)" },
            ]}
          />
        </div>

        {/* Cooldown */}
        <Input
          label="Cooldown (minutes between fires)"
          value={form.cooldownMinutes}
          onChange={(v) => setForm({ ...form, cooldownMinutes: Math.max(0, Number(v)) })}
          type="number"
          min={0}
          step={1}
        />

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 8, cursor: "pointer",
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
              color: "var(--color-text-secondary)", fontSize: "0.85rem", fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.name.trim() || !form.goal.trim()}
            style={{
              flex: 2, padding: "10px 0", borderRadius: 8, cursor: "pointer",
              background: "linear-gradient(135deg, #6366f1, #7c3aed)",
              border: "none", color: "white", fontSize: "0.85rem", fontWeight: 700,
              opacity: !form.name.trim() || !form.goal.trim() ? 0.5 : 1,
            }}
          >
            {initial ? "Save Changes" : "Create Trigger"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── History Panel ────────────────────────────────────────────────────────────

function HistoryPanel({ entries }: { entries: TriggerLogEntry[] }) {
  if (entries.length === 0) {
    return <div style={{ padding: "12px 14px", fontSize: "0.78rem", color: "var(--color-text-muted)" }}>No history yet.</div>;
  }
  return (
    <div style={{ padding: "8px 0" }}>
      {entries.slice(0, 10).map((e) => (
        <div key={e.id} style={{
          display: "flex", alignItems: "center", gap: 10, padding: "7px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            background: e.status === "executed" ? "#22c55e" : e.status === "failed" ? "#ef4444" : "#f59e0b",
          }} />
          <span style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", flex: 1 }}>
            {formatTime(e.fired_at)}
          </span>
          <span style={{
            fontSize: "0.7rem", fontWeight: 600,
            color: e.status === "executed" ? "#22c55e" : e.status === "failed" ? "#ef4444" : "#f59e0b",
          }}>
            {e.status.toUpperCase()}
          </span>
          {e.error && (
            <span style={{ fontSize: "0.7rem", color: "#ef4444", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.error}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Trigger Card ─────────────────────────────────────────────────────────────

function TriggerCard({
  trigger,
  onToggle,
  onEdit,
  onDelete,
  onLoadHistory,
  history,
}: {
  trigger: TriggerDef;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLoadHistory: () => void;
  history: TriggerLogEntry[] | null;
}) {
  const [histOpen, setHistOpen] = useState(false);

  const handleHistToggle = () => {
    if (!histOpen) onLoadHistory();
    setHistOpen(!histOpen);
  };

  return (
    <div style={{
      borderRadius: 14,
      background: "rgba(255,255,255,0.03)",
      border: `1px solid ${trigger.enabled ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.07)"}`,
      marginBottom: 12,
      overflow: "hidden",
      transition: "border-color 0.2s",
    }}>
      {/* Main row */}
      <div style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          {/* Condition icon */}
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: trigger.enabled ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.06)",
            border: `1px solid ${trigger.enabled ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.1)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: trigger.enabled ? "#a78bfa" : "var(--color-text-muted)",
          }}>
            {conditionIcon(trigger.condition.type)}
          </div>

          {/* Name + details */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "white" }}>{trigger.name}</span>
              <span style={{
                fontSize: "0.65rem", fontWeight: 700, padding: "2px 7px", borderRadius: "20px",
                background: "rgba(255,255,255,0.06)", color: "var(--color-text-muted)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}>
                {conditionLabel(trigger.condition.type)}
              </span>
            </div>
            {trigger.description && (
              <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginBottom: 6 }}>{trigger.description}</div>
            )}
            <div style={{ fontSize: "0.78rem", color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#a78bfa", fontFamily: "monospace", fontSize: "0.75rem" }}>{conditionSummary(trigger.condition)}</span>
              <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
              <span>→</span>
              <span style={{
                maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {trigger.action.goal}
              </span>
            </div>
          </div>

          {/* Toggle + actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <Toggle checked={trigger.enabled} onChange={onToggle} />
            <button
              onClick={onEdit}
              style={{ padding: "6px", borderRadius: 7, background: "none", border: "1px solid rgba(255,255,255,0.08)", color: "var(--color-text-muted)", cursor: "pointer" }}
              title="Edit"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              onClick={onDelete}
              style={{ padding: "6px", borderRadius: 7, background: "none", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444", cursor: "pointer", opacity: 0.7 }}
              title="Delete"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
            Fired <strong style={{ color: "var(--color-text-secondary)" }}>{trigger.fireCount}</strong> times
          </span>
          <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
            Last: <strong style={{ color: "var(--color-text-secondary)" }}>
              {trigger.lastFiredAt ? timeAgo(trigger.lastFiredAt) : "never"}
            </strong>
          </span>
          <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
            Cooldown: <strong style={{ color: "var(--color-text-secondary)" }}>{Math.round(trigger.cooldownMs / 60000)}m</strong>
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={handleHistToggle}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              fontSize: "0.72rem", color: "#a78bfa", background: "none", border: "none",
              cursor: "pointer", padding: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {histOpen ? "Hide history" : "Show history"}
          </button>
        </div>
      </div>

      {/* History panel */}
      {histOpen && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.2)" }}>
          {history ? <HistoryPanel entries={history} /> : (
            <div style={{ padding: "12px 14px", fontSize: "0.78rem", color: "var(--color-text-muted)" }}>Loading…</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function TriggerPage() {
  const [triggers, setTriggers] = useState<TriggerDef[]>([]);
  const [modal, setModal] = useState<{ open: boolean; editing?: TriggerDef }>({ open: false });
  const [histories, setHistories] = useState<Record<string, TriggerLogEntry[]>>({});
  const [loading, setLoading] = useState(true);

  // Subscribe to WebSocket messages
  useEffect(() => {
    const client = getClient();

    const unsub = client.on("*", (raw) => {
      const msg = raw as any;
      if (msg.type === "trigger.list.result") {
        setTriggers(msg.triggers ?? []);
        setLoading(false);
      } else if (msg.type === "trigger.created") {
        setTriggers((prev) => [msg.trigger, ...prev]);
      } else if (msg.type === "trigger.updated" && msg.trigger) {
        setTriggers((prev) => prev.map((t: TriggerDef) => t.id === msg.trigger.id ? msg.trigger : t));
      } else if (msg.type === "trigger.deleted") {
        setTriggers((prev) => prev.filter((t: TriggerDef) => t.id !== msg.triggerId));
      } else if (msg.type === "trigger.history.result") {
        const entries: TriggerLogEntry[] = msg.entries ?? [];
        const triggerId = entries[0]?.trigger_id ?? msg.triggerId ?? "";
        if (triggerId) setHistories((prev) => ({ ...prev, [triggerId]: entries }));
      }
    });

    // Request initial list
    send({ type: "trigger.list" });

    return () => { unsub(); };
  }, []);

  const handleCreate = useCallback((form: FormState) => {
    send({
      type: "trigger.create",
      name: form.name,
      description: form.description,
      condition: buildCondition(form),
      action: { type: "execute_task", goal: form.goal, layer: form.layer },
      cooldownMs: form.cooldownMinutes * 60000,
    });
    setModal({ open: false });
  }, []);

  const handleUpdate = useCallback((id: string, updates: object) => {
    send({ type: "trigger.update", triggerId: id, updates });
  }, []);

  const handleUpdateForm = useCallback((form: FormState, id: string) => {
    send({
      type: "trigger.update",
      triggerId: id,
      updates: {
        name: form.name,
        description: form.description,
        condition: buildCondition(form),
        action: { type: "execute_task", goal: form.goal, layer: form.layer },
        cooldownMs: form.cooldownMinutes * 60000,
      },
    });
    setModal({ open: false });
  }, []);

  const handleDelete = useCallback((id: string) => {
    if (!confirm("Delete this trigger?")) return;
    send({ type: "trigger.delete", triggerId: id });
  }, []);

  const handleLoadHistory = useCallback((id: string) => {
    send({ type: "trigger.history", triggerId: id, limit: 20 });
  }, []);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "28px 32px" }}>
      {/* Header */}
      <div className="hero-gradient animate-fade-in" style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: "linear-gradient(135deg, rgba(167,139,250,0.3), rgba(99,102,241,0.2))",
            border: "1px solid rgba(167,139,250,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.8">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: "white" }}>
              Event Triggers
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
              Automate tasks when system conditions are met
            </p>
          </div>
        </div>
        <button
          onClick={() => setModal({ open: true })}
          className="btn-primary"
          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create Trigger
        </button>
      </div>

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Total", value: triggers.length, color: "#a78bfa" },
          { label: "Active", value: triggers.filter((t) => t.enabled).length, color: "#22c55e" },
          { label: "Total Fires", value: triggers.reduce((s, t) => s + t.fireCount, 0), color: "#f59e0b" },
        ].map((stat) => (
          <div key={stat.label} className="glow-card" style={{
            padding: "14px 22px",
            display: "flex", flexDirection: "column", gap: 2,
          }}>
            <span style={{ fontSize: "1.4rem", fontWeight: 800, color: stat.color }}>{stat.value}</span>
            <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", fontWeight: 500 }}>{stat.label}</span>
          </div>
        ))}
      </div>

      {/* Trigger list */}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "var(--color-text-muted)", fontSize: "0.85rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 16, height: 16, border: "2px solid rgba(99,102,241,0.3)", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            Loading triggers…
          </div>
        </div>
      ) : triggers.length === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          height: 220, gap: 14, borderRadius: 16,
          background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)",
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center", color: "#a78bfa",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "white", marginBottom: 4 }}>No triggers yet</div>
            <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>Create your first trigger to automate tasks</div>
          </div>
          <button
            onClick={() => setModal({ open: true })}
            style={{
              padding: "8px 20px", borderRadius: 8, cursor: "pointer",
              background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)",
              color: "#a78bfa", fontSize: "0.82rem", fontWeight: 600,
            }}
          >
            + Create Trigger
          </button>
        </div>
      ) : (
        triggers.map((trigger) => (
          <TriggerCard
            key={trigger.id}
            trigger={trigger}
            onToggle={() => handleUpdate(trigger.id, { enabled: !trigger.enabled })}
            onEdit={() => setModal({ open: true, editing: trigger })}
            onDelete={() => handleDelete(trigger.id)}
            onLoadHistory={() => handleLoadHistory(trigger.id)}
            history={histories[trigger.id] ?? null}
          />
        ))
      )}

      {/* Modal */}
      {modal.open && (
        <TriggerModal
          initial={modal.editing}
          onSave={(form) => {
            if (modal.editing) {
              handleUpdateForm(form, modal.editing.id);
            } else {
              handleCreate(form);
            }
          }}
          onClose={() => setModal({ open: false })}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
