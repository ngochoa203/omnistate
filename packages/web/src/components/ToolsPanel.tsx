import { useState, useMemo } from "react";

interface ToolInfo {
  name: string;
  description: string;
  group: string;
}

interface SkillInfo {
  name: string;
  group: string;
}

interface ToolsPanelProps {
  tools: ToolInfo[];
  skills: SkillInfo[];
  onClose: () => void;
}

export function ToolsPanel({ tools, skills, onClose }: ToolsPanelProps) {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"tools" | "skills">("tools");

  const filteredTools = useMemo(() => {
    const q = search.toLowerCase();
    return tools.filter(t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
  }, [tools, search]);

  const filteredSkills = useMemo(() => {
    const q = search.toLowerCase();
    return skills.filter(s => s.name.toLowerCase().includes(q) || s.group.toLowerCase().includes(q));
  }, [skills, search]);

  const toolGroups = useMemo(() => {
    const groups = new Map<string, ToolInfo[]>();
    for (const t of filteredTools) {
      const arr = groups.get(t.group) || [];
      arr.push(t);
      groups.set(t.group, arr);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filteredTools]);

  const skillGroups = useMemo(() => {
    const groups = new Map<string, SkillInfo[]>();
    for (const s of filteredSkills) {
      const arr = groups.get(s.group) || [];
      arr.push(s);
      groups.set(s.group, arr);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filteredSkills]);

  return (
    <div
      role="dialog"
      aria-label="Tools and Skills"
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 400,
        backgroundColor: "var(--color-bg-primary, #0a0a0f)",
        borderLeft: "1px solid var(--color-border, #1e1e2e)",
        display: "flex", flexDirection: "column",
        zIndex: 1000, boxShadow: "-4px 0 24px rgba(0,0,0,0.5)",
      }}
    >
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid var(--color-border, #1e1e2e)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
          {activeTab === "tools" ? `Tools (${filteredTools.length})` : `Skills (${filteredSkills.length})`}
        </h3>
        <button
          onClick={onClose}
          aria-label="Close tools panel"
          style={{
            background: "none", border: "none",
            color: "var(--color-text-muted)", cursor: "pointer", fontSize: "1.2rem",
          }}
        >
          ✕
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: "12px 20px" }}>
        <input
          type="text"
          placeholder="Search tools..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search tools and skills"
          style={{
            width: "100%", padding: "8px 12px", borderRadius: 8,
            border: "1px solid var(--color-border, #1e1e2e)",
            backgroundColor: "var(--color-bg-secondary, #111118)",
            color: "var(--color-text-primary, #e0e0e0)",
            fontSize: "0.85rem", outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Tabs */}
      <div role="tablist" style={{ display: "flex", padding: "0 20px", gap: 8 }}>
        {(["tools", "skills"] as const).map(tab => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "6px 16px", borderRadius: 6, border: "none",
              backgroundColor: activeTab === tab ? "var(--color-accent, #4f46e5)" : "transparent",
              color: activeTab === tab ? "#fff" : "var(--color-text-muted)",
              cursor: "pointer", fontSize: "0.8rem", fontWeight: 500,
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div role="tabpanel" style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {activeTab === "tools" ? (
          toolGroups.length === 0 ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: "0.8rem", textAlign: "center", paddingTop: 24 }}>
              No tools found.
            </div>
          ) : (
            toolGroups.map(([group, items]) => (
              <div key={group} style={{ marginBottom: 16 }}>
                <h4 style={{
                  margin: "0 0 8px", fontSize: "0.78rem",
                  textTransform: "uppercase", color: "var(--color-text-muted)",
                  letterSpacing: "0.05em",
                }}>
                  {group} ({items.length})
                </h4>
                {items.map(t => (
                  <div key={t.name} style={{
                    padding: "8px 12px", marginBottom: 4, borderRadius: 6,
                    backgroundColor: "var(--color-bg-secondary, #111118)",
                    fontSize: "0.8rem",
                  }}>
                    <div style={{ fontWeight: 500, color: "var(--color-text-primary, #e0e0e0)" }}>{t.name}</div>
                    <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", marginTop: 2 }}>{t.description}</div>
                  </div>
                ))}
              </div>
            ))
          )
        ) : (
          skillGroups.length === 0 ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: "0.8rem", textAlign: "center", paddingTop: 24 }}>
              No skills found.
            </div>
          ) : (
            skillGroups.map(([group, items]) => (
              <div key={group} style={{ marginBottom: 16 }}>
                <h4 style={{
                  margin: "0 0 8px", fontSize: "0.78rem",
                  textTransform: "uppercase", color: "var(--color-text-muted)",
                  letterSpacing: "0.05em",
                }}>
                  {group} ({items.length})
                </h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {items.map(s => (
                    <span key={s.name} style={{
                      padding: "4px 10px", borderRadius: 12,
                      backgroundColor: "var(--color-bg-secondary, #111118)",
                      fontSize: "0.75rem", color: "var(--color-text-secondary, #a0a0b0)",
                    }}>
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
}
