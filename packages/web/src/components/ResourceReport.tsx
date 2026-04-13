import { useState } from "react";

interface ResourceChange {
  type: "file" | "process" | "system";
  action: "created" | "modified" | "deleted" | "started" | "stopped" | "changed";
  path?: string;
  pid?: number;
  name?: string;
  timestamp: string;
}

interface ResourceImpactReport {
  taskId: string;
  changes: ResourceChange[];
  summary: string;
  generatedAt: string;
}

interface Props {
  report: ResourceImpactReport;
}

const ACTION_ICONS: Record<string, string> = {
  created: "+",
  modified: "~",
  deleted: "-",
  started: "▶",
  stopped: "■",
  changed: "↻",
};

const ACTION_COLORS: Record<string, string> = {
  created: "#22c55e",
  modified: "#f59e0b",
  deleted: "#ef4444",
  started: "#3b82f6",
  stopped: "#9ca3af",
  changed: "#8b5cf6",
};

const TYPE_LABELS: Record<string, string> = {
  file: "File",
  process: "Process",
  system: "System",
};

export function ResourceReport({ report }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!report.changes.length) return null;

  const fileChanges = report.changes.filter(c => c.type === "file");
  const processChanges = report.changes.filter(c => c.type === "process");
  const systemChanges = report.changes.filter(c => c.type === "system");

  return (
    <div style={{
      marginTop: 8,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 10,
      overflow: "hidden",
    }}>
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "none",
          border: "none",
          color: "#a1a1aa",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
        }}
      >
        <span style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "0.2s" }}>▸</span>
        <span style={{ color: "#6366f1", fontWeight: 600 }}>Resource Impact</span>
        <span style={{ color: "#5a5a7a" }}>
          {report.changes.length} change{report.changes.length !== 1 ? "s" : ""}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#5a5a7a" }}>
          {report.summary}
        </span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div style={{ padding: "0 12px 12px", fontSize: 12 }}>
          {/* File changes */}
          {fileChanges.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: "#6366f1", fontWeight: 600, marginBottom: 4, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {TYPE_LABELS.file}s
              </div>
              {fileChanges.map((change, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                  <span style={{
                    width: 16, height: 16, borderRadius: 4, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    background: `${ACTION_COLORS[change.action]}20`,
                    color: ACTION_COLORS[change.action],
                    fontSize: 10, fontWeight: 700, flexShrink: 0,
                  }}>
                    {ACTION_ICONS[change.action]}
                  </span>
                  <span style={{ color: "#d4d4d8", fontFamily: "monospace", fontSize: 11 }}>
                    {change.path}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Process changes */}
          {processChanges.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: "#6366f1", fontWeight: 600, marginBottom: 4, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {TYPE_LABELS.process}es
              </div>
              {processChanges.map((change, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                  <span style={{
                    width: 16, height: 16, borderRadius: 4, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    background: `${ACTION_COLORS[change.action]}20`,
                    color: ACTION_COLORS[change.action],
                    fontSize: 10, flexShrink: 0,
                  }}>
                    {ACTION_ICONS[change.action]}
                  </span>
                  <span style={{ color: "#d4d4d8" }}>{change.name}</span>
                  {change.pid && (
                    <span style={{ color: "#5a5a7a", fontFamily: "monospace", fontSize: 10 }}>
                      PID {change.pid}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* System changes */}
          {systemChanges.length > 0 && (
            <div>
              <div style={{ color: "#6366f1", fontWeight: 600, marginBottom: 4, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {TYPE_LABELS.system}
              </div>
              {systemChanges.map((change, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                  <span style={{
                    width: 16, height: 16, borderRadius: 4, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    background: `${ACTION_COLORS[change.action]}20`,
                    color: ACTION_COLORS[change.action],
                    fontSize: 10, flexShrink: 0,
                  }}>
                    {ACTION_ICONS[change.action]}
                  </span>
                  <span style={{ color: "#d4d4d8" }}>{change.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
