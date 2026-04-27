import { useState, useEffect } from "react";

const GATEWAY_URL = "http://127.0.0.1:19800";
const POLL_INTERVAL = 2000;

type RiskLevel = "low" | "medium" | "high";

interface PendingApproval {
  id: string;
  intent: string;
  risk: RiskLevel;
  context: string;
  userId: string;
  createdAt: string;
}

const RISK_META: Record<RiskLevel, { color: string; bg: string; label: string }> = {
  low: { color: "#22c55e", bg: "rgba(34,197,94,0.1)", label: "Thấp" },
  medium: { color: "#f59e0b", bg: "rgba(245,158,11,0.1)", label: "Trung bình" },
  high: { color: "#ef4444", bg: "rgba(239,68,68,0.1)", label: "Cao" },
};

export function ApprovalCenter() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchApprovals = async () => {
    try {
      const res = await fetch(`${GATEWAY_URL}/api/approvals/pending`);
      const data = await res.json();
      setApprovals(data.approvals ?? []);
    } catch {
      // gateway may be offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApprovals();
    const interval = setInterval(fetchApprovals, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  const respond = async (id: string, action: "approve" | "reject", permanent = false) => {
    setActionLoading(id + action);
    try {
      await fetch(`${GATEWAY_URL}/api/approvals/${id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permanent }),
      });
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24, color: "var(--color-text-muted)", textAlign: "center" }}>
        Đang tải...
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "white" }}>🛡️ Trung tâm phê duyệt</h2>
        {approvals.length > 0 && (
          <span style={{ padding: "2px 10px", borderRadius: 99, background: "rgba(239,68,68,0.2)", color: "#ef4444", fontSize: "0.75rem", fontWeight: 700 }}>
            {approvals.length} chờ
          </span>
        )}
      </div>

      {approvals.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "var(--color-text-muted)" }}>
          <div style={{ fontSize: "3rem", marginBottom: 12 }}>✅</div>
          <div>Không có yêu cầu nào đang chờ phê duyệt</div>
          <div style={{ fontSize: "0.75rem", marginTop: 8 }}>Tự động cập nhật mỗi 2 giây</div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {approvals.map((approval) => {
          const risk = RISK_META[approval.risk];
          return (
            <div key={approval.id} style={{
              padding: 16, borderRadius: 12,
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${risk.color}44`,
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "white", marginBottom: 4 }}>{approval.intent}</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", lineHeight: 1.5 }}>{approval.context}</div>
                </div>
                <span style={{
                  flexShrink: 0,
                  padding: "3px 10px", borderRadius: 99, fontSize: "0.7rem", fontWeight: 700,
                  color: risk.color, background: risk.bg,
                }}>
                  Rủi ro {risk.label}
                </span>
              </div>

              <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginBottom: 12 }}>
                Người dùng: {approval.userId} · {new Date(approval.createdAt).toLocaleTimeString("vi-VN")}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => respond(approval.id, "approve")}
                  disabled={!!actionLoading}
                  style={{ flex: 1, padding: "8px", borderRadius: 8, background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}>
                  ✓ Đồng ý
                </button>
                <button
                  onClick={() => respond(approval.id, "reject")}
                  disabled={!!actionLoading}
                  style={{ flex: 1, padding: "8px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}>
                  ✕ Từ chối
                </button>
                <button
                  onClick={() => respond(approval.id, "approve", true)}
                  disabled={!!actionLoading}
                  style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", color: "#818cf8", cursor: "pointer", fontWeight: 600, fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                  ♾ Mãi mãi
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
