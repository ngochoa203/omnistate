import { useState, useCallback } from "react";
import { getClient } from "../hooks/useGateway";
import { useChatStore } from "../lib/chat-store";
import type { MemoryRecord } from "../lib/protocol";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

function scopeColor(scope: MemoryRecord["scope"]): string {
  switch (scope) {
    case "global": return "#22d3ee";
    case "conversation": return "#a78bfa";
    case "user": return "#22c55e";
  }
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", borderRadius: 8, fontSize: "0.83rem",
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  color: "white", outline: "none", boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.73rem", color: "rgba(255,255,255,0.4)",
  marginBottom: 5, fontWeight: 500,
};

const SCOPE_OPTIONS: MemoryRecord["scope"][] = ["global", "conversation", "user"];

// ─── Create Form ──────────────────────────────────────────────────────────────

const DEFAULT_CREATE_FORM = {
  title: "",
  content: "",
  scope: "global" as MemoryRecord["scope"],
  tags: "",
};

function CreateForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ ...DEFAULT_CREATE_FORM });
  const set = (patch: Partial<typeof DEFAULT_CREATE_FORM>) => setForm((f) => ({ ...f, ...patch }));

  const handleSave = () => {
    if (!form.title.trim() || !form.content.trim()) return;
    getClient().upsertMemoryRecord({
      title: form.title.trim(),
      content: form.content.trim(),
      scope: form.scope,
      tags: form.tags.trim() ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    });
    onClose();
  };

  const canSave = form.title.trim() && form.content.trim();

  return (
    <div style={{
      borderRadius: 12, padding: "18px 20px", marginBottom: 20,
      background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.2)",
    }}>
      <h3 style={{ margin: "0 0 16px", fontSize: "0.95rem", fontWeight: 700, color: "white" }}>
        New Memory Record
      </h3>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle} htmlFor="mem-title">Title *</label>
        <input id="mem-title" type="text" value={form.title} onChange={(e) => set({ title: e.target.value })}
          placeholder="Project preference" style={inputStyle} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle} htmlFor="mem-content">Content *</label>
        <textarea id="mem-content" value={form.content} onChange={(e) => set({ content: e.target.value })}
          placeholder="Detailed content..." rows={4}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={labelStyle} htmlFor="mem-scope">Scope</label>
          <select id="mem-scope" value={form.scope} onChange={(e) => set({ scope: e.target.value as MemoryRecord["scope"] })}
            style={{ ...inputStyle, background: "rgba(20,20,35,0.95)", cursor: "pointer" }}>
            {SCOPE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle} htmlFor="mem-tags">Tags (comma-separated)</label>
          <input id="mem-tags" type="text" value={form.tags} onChange={(e) => set({ tags: e.target.value })}
            placeholder="prefs, dev, work" style={inputStyle} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onClose} style={{
          flex: 1, padding: "8px 0", borderRadius: 8, cursor: "pointer",
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.5)", fontSize: "0.83rem", fontWeight: 600,
        }}>Cancel</button>
        <button onClick={handleSave} disabled={!canSave} style={{
          flex: 2, padding: "8px 0", borderRadius: 8, cursor: "pointer",
          background: "linear-gradient(135deg, #22d3ee, #6366f1)",
          border: "none", color: "white", fontSize: "0.83rem", fontWeight: 700,
          opacity: canSave ? 1 : 0.5,
        }}>Create</button>
      </div>
    </div>
  );
}

// ─── Edit Form ────────────────────────────────────────────────────────────────

function EditForm({ record, onClose }: { record: MemoryRecord; onClose: () => void }) {
  const [form, setForm] = useState({
    title: record.title,
    content: record.content,
    scope: record.scope,
    tags: record.tags.join(", "),
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const handleSave = () => {
    if (!form.title.trim() || !form.content.trim()) return;
    getClient().upsertMemoryRecord({
      id: record.id,
      title: form.title.trim(),
      content: form.content.trim(),
      scope: form.scope,
      tags: form.tags.trim() ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    });
    onClose();
  };

  const canSave = form.title.trim() && form.content.trim();

  return (
    <div style={{
      borderRadius: 10, padding: "16px 18px",
      background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.25)",
    }}>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle} htmlFor={`edit-title-${record.id}`}>Title</label>
        <input id={`edit-title-${record.id}`} type="text" value={form.title}
          onChange={(e) => set({ title: e.target.value })} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle} htmlFor={`edit-content-${record.id}`}>Content</label>
        <textarea id={`edit-content-${record.id}`} value={form.content}
          onChange={(e) => set({ content: e.target.value })} rows={4}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div>
          <label style={labelStyle} htmlFor={`edit-scope-${record.id}`}>Scope</label>
          <select id={`edit-scope-${record.id}`} value={form.scope}
            onChange={(e) => set({ scope: e.target.value as MemoryRecord["scope"] })}
            style={{ ...inputStyle, background: "rgba(20,20,35,0.95)", cursor: "pointer" }}>
            {SCOPE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle} htmlFor={`edit-tags-${record.id}`}>Tags</label>
          <input id={`edit-tags-${record.id}`} type="text" value={form.tags}
            onChange={(e) => set({ tags: e.target.value })} placeholder="comma-separated" style={inputStyle} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onClose} style={{
          flex: 1, padding: "7px 0", borderRadius: 8, cursor: "pointer",
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.5)", fontSize: "0.82rem", fontWeight: 600,
        }}>Cancel</button>
        <button onClick={handleSave} disabled={!canSave} style={{
          flex: 2, padding: "7px 0", borderRadius: 8, cursor: "pointer",
          background: "linear-gradient(135deg, #6366f1, #7c3aed)",
          border: "none", color: "white", fontSize: "0.82rem", fontWeight: 700,
          opacity: canSave ? 1 : 0.5,
        }}>Save</button>
      </div>
    </div>
  );
}

// ─── Record Card ──────────────────────────────────────────────────────────────

function RecordCard({ record, onDelete }: { record: MemoryRecord; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const color = scopeColor(record.scope);

  return (
    <div style={{
      borderRadius: 12, marginBottom: 10,
      background: "rgba(255,255,255,0.03)",
      border: `1px solid ${editing ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.07)"}`,
      overflow: "hidden", transition: "border-color 0.2s",
    }}>
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
              <span style={{
                fontSize: "0.62rem", fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                background: `${color}22`, color, border: `1px solid ${color}44`, textTransform: "uppercase",
              }}>{record.scope}</span>
              <span style={{ fontSize: "0.88rem", fontWeight: 600, color: "white" }}>{record.title}</span>
            </div>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>
              {record.content.length > 200 ? record.content.slice(0, 200) + "…" : record.content}
            </p>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => setEditing((v) => !v)}
              aria-label={editing ? "Cancel edit" : "Edit record"}
              style={{
                padding: "5px 6px", borderRadius: 7, cursor: "pointer",
                background: editing ? "rgba(99,102,241,0.15)" : "none",
                border: `1px solid ${editing ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.08)"}`,
                color: editing ? "#a78bfa" : "rgba(255,255,255,0.4)",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              onClick={() => onDelete(record.id)}
              aria-label="Delete record"
              style={{
                padding: "5px 6px", borderRadius: 7, cursor: "pointer",
                background: "none", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", opacity: 0.7,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </div>
        </div>
        {record.tags.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
            {record.tags.map((tag) => (
              <span key={tag} style={{
                fontSize: "0.62rem", padding: "1px 6px", borderRadius: 6,
                background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)",
                color: "#a78bfa", fontFamily: "monospace",
              }}>{tag}</span>
            ))}
          </div>
        )}
        <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.25)" }}>
          Updated {timeAgo(record.updatedAt)} · Created {timeAgo(record.createdAt)}
        </div>
      </div>
      {editing && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "14px 16px", background: "rgba(0,0,0,0.15)" }}>
          <EditForm record={record} onClose={() => setEditing(false)} />
        </div>
      )}
    </div>
  );
}

// ─── Claude Mem Tab ───────────────────────────────────────────────────────────

function ClaudeMemTab() {
  const summary = useChatStore((s) => s.sharedMemorySummary);
  const log = useChatStore((s) => s.sharedMemoryLog);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 10px", fontSize: "0.9rem", fontWeight: 700, color: "white" }}>Shared Memory Summary</h3>
        <div style={{
          padding: "14px 16px", borderRadius: 10, fontSize: "0.82rem", color: "rgba(255,255,255,0.7)",
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", lineHeight: 1.6,
          minHeight: 60,
        }}>
          {summary || <span style={{ color: "rgba(255,255,255,0.25)" }}>No summary yet.</span>}
        </div>
      </div>
      <div>
        <h3 style={{ margin: "0 0 10px", fontSize: "0.9rem", fontWeight: 700, color: "white" }}>Memory Log</h3>
        {log.length === 0 ? (
          <div style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.25)" }}>No log entries yet.</div>
        ) : (
          <div style={{ maxHeight: 400, overflowY: "auto", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
            {log.map((entry, i) => (
              <div key={i} style={{
                padding: "8px 14px", fontSize: "0.78rem", color: "rgba(255,255,255,0.6)",
                borderBottom: i < log.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                fontFamily: "monospace",
              }}>
                {entry}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function MemoryPage() {
  const memoryRecords = useChatStore((s) => s.memoryRecords);
  const memoryRecordsLoading = useChatStore((s) => s.memoryRecordsLoading);
  const memoryRecordsError = useChatStore((s) => s.memoryRecordsError);

  const [tab, setTab] = useState<"records" | "claudemem">("records");
  const [showCreate, setShowCreate] = useState(false);
  const [searchText, setSearchText] = useState("");

  const handleRefresh = useCallback(() => {
    getClient().queryMemoryRecords({ limit: 50 });
  }, []);

  const handleDelete = useCallback((id: string) => {
    if (!confirm("Delete this memory record?")) return;
    getClient().deleteMemoryRecord(id);
  }, []);

  const filteredRecords = memoryRecords.filter((r) => {
    if (!searchText.trim()) return true;
    const q = searchText.toLowerCase();
    return r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q);
  });

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "28px 32px" }}>
      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: "linear-gradient(135deg, rgba(34,211,238,0.3), rgba(99,102,241,0.2))",
            border: "1px solid rgba(34,211,238,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.8">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
              <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
            </svg>
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: "white" }}>Memory</h1>
            <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "rgba(255,255,255,0.4)" }}>
              Durable memory records and Claude context
            </p>
          </div>
        </div>
        {tab === "records" && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setShowCreate((v) => !v)}
              style={{
                padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600,
                background: showCreate ? "rgba(239,68,68,0.1)" : "rgba(34,211,238,0.12)",
                border: `1px solid ${showCreate ? "rgba(239,68,68,0.3)" : "rgba(34,211,238,0.3)"}`,
                color: showCreate ? "#ef4444" : "#22d3ee",
              }}
            >
              {showCreate ? "Cancel" : "+ New Record"}
            </button>
            <button
              onClick={handleRefresh}
              style={{
                padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600,
                background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)", color: "#a78bfa",
              }}
              aria-label="Refresh memory records"
            >
              Refresh
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 0 }}>
        {(["records", "claudemem"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 20px", borderRadius: "8px 8px 0 0", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600,
              background: tab === t ? "rgba(99,102,241,0.15)" : "none",
              border: `1px solid ${tab === t ? "rgba(99,102,241,0.35)" : "transparent"}`,
              borderBottom: tab === t ? "1px solid rgba(12,12,20,1)" : "1px solid transparent",
              color: tab === t ? "#a78bfa" : "rgba(255,255,255,0.4)",
              marginBottom: -1, transition: "all 0.15s",
            }}
          >
            {t === "records" ? "Memory Records" : "Claude Mem"}
          </button>
        ))}
      </div>

      {tab === "records" && (
        <div>
          {/* Create Form */}
          {showCreate && <CreateForm onClose={() => setShowCreate(false)} />}

          {/* Stats */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Total Records", value: memoryRecords.length, color: "#22d3ee" },
              { label: "Global", value: memoryRecords.filter((r) => r.scope === "global").length, color: "#60a5fa" },
              { label: "Conversation", value: memoryRecords.filter((r) => r.scope === "conversation").length, color: "#a78bfa" },
              { label: "User", value: memoryRecords.filter((r) => r.scope === "user").length, color: "#22c55e" },
            ].map((s) => (
              <div key={s.label} style={{
                padding: "12px 16px", borderRadius: 10,
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                display: "flex", flexDirection: "column", gap: 2,
              }}>
                <span style={{ fontSize: "1.3rem", fontWeight: 800, color: s.color }}>{s.value}</span>
                <span style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.4)" }}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* Search */}
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by title or content..."
              aria-label="Search memory records"
              style={{
                ...inputStyle, width: "100%", maxWidth: 400,
                padding: "9px 14px", fontSize: "0.85rem",
              }}
            />
          </div>

          {/* Loading / Error */}
          {memoryRecordsLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 0", color: "rgba(255,255,255,0.4)", fontSize: "0.85rem" }}>
              <div style={{ width: 14, height: 14, border: "2px solid rgba(99,102,241,0.3)", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              Loading records...
            </div>
          )}

          {memoryRecordsError && (
            <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", fontSize: "0.83rem", marginBottom: 16 }}>
              Error: {memoryRecordsError}
            </div>
          )}

          {/* Records List */}
          {!memoryRecordsLoading && filteredRecords.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              height: 180, gap: 10, borderRadius: 12,
              background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.07)",
            }}>
              <div style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.3)" }}>
                {memoryRecords.length === 0 ? "No memory records yet — create one above" : "No records match search"}
              </div>
              {memoryRecords.length === 0 && (
                <button onClick={() => setShowCreate(true)} style={{
                  padding: "6px 16px", borderRadius: 8, cursor: "pointer", fontSize: "0.78rem", fontWeight: 600,
                  background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.25)", color: "#22d3ee",
                }}>
                  + Create first record
                </button>
              )}
            </div>
          ) : (
            filteredRecords.map((record) => (
              <RecordCard key={record.id} record={record} onDelete={handleDelete} />
            ))
          )}
        </div>
      )}

      {tab === "claudemem" && <ClaudeMemTab />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
