import { useState, useEffect, useCallback } from "react";

const GATEWAY_URL = "http://127.0.0.1:19800";

type MemoryCategory = "password" | "contact" | "address" | "birthday" | "preference" | "note";

interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  key: string;
  value: string;
  sensitive: boolean;
  createdAt: string;
}

const CATEGORY_META: Record<MemoryCategory, { icon: string; label: string }> = {
  password: { icon: "🔑", label: "Mật khẩu" },
  contact: { icon: "👤", label: "Liên hệ" },
  address: { icon: "📍", label: "Địa chỉ" },
  birthday: { icon: "🎂", label: "Ngày sinh" },
  preference: { icon: "⭐", label: "Tuỳ thích" },
  note: { icon: "📝", label: "Ghi chú" },
};

export function MemoryPalPage() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<MemoryCategory | "">("");
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [formCategory, setFormCategory] = useState<MemoryCategory>("note");
  const [formKey, setFormKey] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formSensitive, setFormSensitive] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = searchQuery
        ? `${GATEWAY_URL}/api/memory/search?q=${encodeURIComponent(searchQuery)}`
        : filterCategory
          ? `${GATEWAY_URL}/api/memory?category=${filterCategory}`
          : `${GATEWAY_URL}/api/memory`;
      const res = await fetch(url);
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      setError("Không thể tải dữ liệu từ gateway");
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filterCategory]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const revealEntry = async (id: string) => {
    if (revealedIds.has(id)) {
      setRevealedIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
      return;
    }
    try {
      const res = await fetch(`${GATEWAY_URL}/api/memory/${id}`);
      const data = await res.json();
      if (data.entry) {
        setEntries((prev) => prev.map((e) => e.id === id ? { ...e, value: data.entry.value } : e));
        setRevealedIds((prev) => new Set(prev).add(id));
      }
    } catch {
      // ignore
    }
  };

  const deleteEntry = async (id: string) => {
    if (!confirm("Xoá ghi nhớ này?")) return;
    await fetch(`${GATEWAY_URL}/api/memory/${id}`, { method: "DELETE" });
    fetchEntries();
  };

  const submitForm = async () => {
    if (!formKey.trim() || !formValue.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`${GATEWAY_URL}/api/memory`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: formCategory, key: formKey, value: formValue, sensitive: formSensitive }),
      });
      setFormKey(""); setFormValue(""); setFormSensitive(false); setShowForm(false);
      fetchEntries();
    } finally {
      setSubmitting(false);
    }
  };

  const grouped = entries.reduce<Record<string, MemoryEntry[]>>((acc, e) => {
    (acc[e.category] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "white" }}>🧠 Kho ghi nhớ</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{ padding: "8px 16px", borderRadius: 8, background: "linear-gradient(135deg,#6366f1,#7c3aed)", border: "none", color: "white", cursor: "pointer", fontWeight: 600 }}
        >
          + Thêm ghi nhớ
        </button>
      </div>

      {showForm && (
        <div style={{ padding: 16, borderRadius: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", display: "block", marginBottom: 4 }}>Loại</label>
              <select value={formCategory} onChange={(e) => setFormCategory(e.target.value as MemoryCategory)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}>
                {(Object.keys(CATEGORY_META) as MemoryCategory[]).map((c) => (
                  <option key={c} value={c}>{CATEGORY_META[c].icon} {CATEGORY_META[c].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", display: "block", marginBottom: 4 }}>Tên ghi nhớ</label>
              <input value={formKey} onChange={(e) => setFormKey(e.target.value)} placeholder="Ví dụ: Wifi nhà"
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", color: "white", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", display: "block", marginBottom: 4 }}>Nội dung</label>
            <textarea value={formValue} onChange={(e) => setFormValue(e.target.value)} rows={3} placeholder="Nhập nội dung..."
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", color: "white", resize: "vertical", boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "space-between" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
              <input type="checkbox" checked={formSensitive} onChange={(e) => setFormSensitive(e.target.checked)} />
              🔒 Ẩn nội dung (sensitive)
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowForm(false)} style={{ padding: "7px 14px", borderRadius: 8, background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "var(--color-text-muted)", cursor: "pointer" }}>Huỷ</button>
              <button onClick={submitForm} disabled={submitting}
                style={{ padding: "7px 14px", borderRadius: 8, background: "linear-gradient(135deg,#6366f1,#7c3aed)", border: "none", color: "white", cursor: "pointer", fontWeight: 600 }}>
                {submitting ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search & filter */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="🔍 Tìm theo tên..."
          style={{ flex: 1, padding: "8px 12px", borderRadius: 8, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }} />
        <select value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value as any); setSearchQuery(""); }}
          style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}>
          <option value="">Tất cả</option>
          {(Object.keys(CATEGORY_META) as MemoryCategory[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_META[c].icon} {CATEGORY_META[c].label}</option>
          ))}
        </select>
      </div>

      {loading && <div style={{ color: "var(--color-text-muted)", textAlign: "center", padding: 40 }}>Đang tải...</div>}
      {error && <div style={{ color: "#ef4444", textAlign: "center", padding: 20 }}>{error}</div>}

      {!loading && entries.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "var(--color-text-muted)" }}>
          <div style={{ fontSize: "3rem", marginBottom: 12 }}>🧠</div>
          <div>Chưa có ghi nhớ nào. Thêm ngay!</div>
        </div>
      )}

      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            {CATEGORY_META[cat as MemoryCategory]?.icon} {CATEGORY_META[cat as MemoryCategory]?.label ?? cat}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((entry) => (
              <div key={entry.id} style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "white", marginBottom: 2 }}>{entry.key}</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {revealedIds.has(entry.id) || !entry.sensitive ? entry.value : entry.value}
                  </div>
                </div>
                {entry.sensitive && (
                  <button onClick={() => revealEntry(entry.id)}
                    style={{ padding: "4px 10px", borderRadius: 6, background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "var(--color-text-muted)", cursor: "pointer", fontSize: "0.75rem" }}>
                    {revealedIds.has(entry.id) ? "Ẩn" : "Hiện"}
                  </button>
                )}
                <button onClick={() => deleteEntry(entry.id)}
                  style={{ padding: "4px 10px", borderRadius: 6, background: "none", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", cursor: "pointer", fontSize: "0.75rem" }}>
                  Xoá
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
