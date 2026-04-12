import { useMemo, useState, useCallback } from "react";
import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";

// ── Types ─────────────────────────────────────────────────────────────

interface HierarchyNode {
  id: string;
  role: string;
  title?: string | null;
  value?: string | null;
  description?: string | null;
  bounds?: { x: number; y: number; width: number; height: number } | null;
  state?: { visible?: boolean; enabled?: boolean; focused?: boolean; selected?: boolean } | null;
  children: HierarchyNode[];
  attributes?: Record<string, string> | null;
}

// Legacy flat node format (used when mode=tree falls back)
interface FlatTreeNode {
  id: string;
  label: string;
  bounds?: { x: number; y: number; width: number; height: number } | null;
  children?: FlatTreeNode[];
}

interface AccessibilityError {
  ok: false;
  code: string;
  error: string;
  details?: string;
  permissionNeeded?: string;
}

interface HierarchyApiResponse {
  ok: boolean;
  code?: string;
  mode: "hierarchy" | "tree";
  accessibilityTrusted: boolean;
  totalElements: number;
  tree: HierarchyNode | FlatTreeNode;
  fallback?: string;
  warning?: string;
  nativeError?: string;
  error?: string;
  details?: string;
}

interface LatencyApiResponse {
  ok: boolean;
  code?: string;
  profile?: "full" | "frame-only";
  processContext?: {
    pid: number;
    ppid: number | null;
    tty: string | null;
    command: string;
    interactiveSession: boolean | null;
  };
  likelyHeadless?: boolean;
  recommendations?: string[];
  rounds: number;
  samples: number[];
  p50: number;
  p95: number;
  max: number;
  under50Rate: number;
  passUnder50msP95: boolean;
  frame?: { p50: number; p95: number; max: number; under50Rate: number };
  tree?: { p50: number; p95: number; max: number; under50Rate: number };
  combined?: { p50: number; p95: number; max: number; under50Rate: number };
  note?: string;
  error?: string;
  details?: string;
}

// ── Role color coding ─────────────────────────────────────────────────

function roleColor(role: string): string {
  if (role.includes("Button") || role.includes("Link")) return "#60a5fa"; // blue
  if (role.includes("Text") || role.includes("Label") || role.includes("StaticText"))
    return "#4ade80"; // green
  if (role.includes("Group") || role.includes("Scroll") || role.includes("Split"))
    return "#94a3b8"; // slate
  if (role.includes("Window") || role.includes("Application")) return "#f59e0b"; // amber
  if (role.includes("Menu") || role.includes("Toolbar")) return "#c084fc"; // purple
  if (role.includes("Table") || role.includes("List") || role.includes("Outline"))
    return "#fb923c"; // orange
  if (role.includes("CheckBox") || role.includes("Radio") || role.includes("Toggle"))
    return "#f472b6"; // pink
  if (role.includes("Tab")) return "#34d399"; // emerald
  if (role.includes("Image")) return "#a78bfa"; // violet
  if (role.includes("TextField") || role.includes("TextArea") || role.includes("Search"))
    return "#22d3ee"; // cyan
  return "#cbd5e1"; // light slate default
}

function roleBadgeStyle(role: string): React.CSSProperties {
  return {
    display: "inline-block",
    padding: "1px 6px",
    borderRadius: 4,
    fontSize: "0.68rem",
    fontFamily: "monospace",
    background: `${roleColor(role)}22`,
    color: roleColor(role),
    border: `1px solid ${roleColor(role)}44`,
    marginRight: 6,
    whiteSpace: "nowrap",
  };
}

// ── Hierarchy node component ──────────────────────────────────────────

interface HierarchyNodeProps {
  node: HierarchyNode;
  depth: number;
  path: string;
  defaultExpanded?: boolean;
}

function HierarchyNodeItem({ node, depth, path, defaultExpanded = false }: HierarchyNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded || depth < 2);

  const hasChildren = node.children && node.children.length > 0;
  const label = node.title || node.value || node.description || null;
  const nodeRole = node.role || "Unknown";
  const currentPath = path ? `${path} › ${nodeRole}${label ? ` "${label}"` : ""}` : nodeRole;

  const toggle = useCallback(() => {
    if (hasChildren) setExpanded((e) => !e);
  }, [hasChildren]);

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 16 }}>
      {/* Row */}
      <div
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          padding: "2px 4px",
          borderRadius: 4,
          cursor: hasChildren ? "pointer" : "default",
          userSelect: "none",
          "&:hover": { background: "rgba(255,255,255,0.04)" },
        }}
        title={currentPath}
      >
        {/* Expand toggle */}
        <span style={{ width: 14, flexShrink: 0, color: "#64748b", fontSize: "0.7rem" }}>
          {hasChildren ? (expanded ? "▾" : "▸") : " "}
        </span>

        {/* Role badge */}
        <span style={roleBadgeStyle(nodeRole)}>{nodeRole}</span>

        {/* Label */}
        {label && (
          <span
            style={{
              fontSize: "0.78rem",
              color: "var(--color-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 320,
            }}
          >
            {label}
          </span>
        )}

        {/* Extra badges */}
        {node.state?.focused && (
          <span style={{ fontSize: "0.65rem", color: "#f59e0b", marginLeft: 4 }}>⬤ focused</span>
        )}
        {node.state?.selected && (
          <span style={{ fontSize: "0.65rem", color: "#60a5fa", marginLeft: 4 }}>✓ selected</span>
        )}
        {node.state?.enabled === false && (
          <span style={{ fontSize: "0.65rem", color: "#64748b", marginLeft: 4 }}>disabled</span>
        )}

        {/* Bounds */}
        {node.bounds && (node.bounds.width > 0 || node.bounds.height > 0) && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: "0.65rem",
              color: "#475569",
              fontFamily: "monospace",
              whiteSpace: "nowrap",
              paddingLeft: 8,
            }}
          >
            {Math.round(node.bounds.x)},{Math.round(node.bounds.y)}{" "}
            {Math.round(node.bounds.width)}×{Math.round(node.bounds.height)}
          </span>
        )}

        {/* Child count */}
        {hasChildren && (
          <span
            style={{
              fontSize: "0.62rem",
              color: "#475569",
              background: "rgba(255,255,255,0.05)",
              borderRadius: 3,
              padding: "0 4px",
              marginLeft: 4,
              whiteSpace: "nowrap",
            }}
          >
            {node.children.length}
          </span>
        )}
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div
          style={{
            borderLeft: `1px solid ${roleColor(nodeRole)}22`,
            marginLeft: 7,
            paddingLeft: 1,
          }}
        >
          {node.children.map((child) => (
            <HierarchyNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              path={currentPath}
              defaultExpanded={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Legacy flat tree (fallback) ────────────────────────────────────────

function FlatTreeItem({ node, depth = 0 }: { node: FlatTreeNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = (node.children?.length ?? 0) > 0;

  return (
    <div style={{ marginLeft: depth * 14 }}>
      <div
        style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", padding: "4px 0", cursor: hasChildren ? "pointer" : "default" }}
        onClick={() => hasChildren && setExpanded((e) => !e)}
      >
        {hasChildren ? (expanded ? "📂" : "📁") : "📄"} {node.label}
        {node.bounds ? (
          <span style={{ marginLeft: 8, color: "var(--color-text-muted)", fontFamily: "monospace", fontSize: "0.7rem" }}>
            [{node.bounds.x},{node.bounds.y} {node.bounds.width}×{node.bounds.height}]
          </span>
        ) : null}
      </div>
      {expanded && node.children?.map((child) => (
        <FlatTreeItem key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────

export function ScreenTreePage() {
  const appLanguage = useChatStore((s) => s.appLanguage);
  const isVi = appLanguage === "vi";

  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingLatency, setLoadingLatency] = useState(false);
  const [treeData, setTreeData] = useState<HierarchyApiResponse | null>(null);
  const [latencyData, setLatencyData] = useState<LatencyApiResponse | null>(null);
  const [error, setError] = useState<string>("");

  const mouseExamples = useMemo(
    () => [
      "move mouse to x 640 y 360 and left click",
      "drag mouse from x 400 y 300 to x 900 y 300",
      "double click at x 1200 y 80",
      "scroll down 600 pixels",
      "remember all clicks on this screen and summarize them",
    ],
    [],
  );

  const fetchWithFallback = async <T,>(paths: string[]): Promise<{ data: T; usedPath: string }> => {
    let lastError = "Not found";
    for (const path of paths) {
      try {
        const res = await fetch(path);
        const rawText = await res.text();
        const data = (() => {
          try {
            return JSON.parse(rawText) as T & { ok?: boolean; error?: string };
          } catch {
            return { ok: res.ok, error: rawText } as T & { ok?: boolean; error?: string };
          }
        })();
        if (res.ok && data && data.ok !== false) {
          return { data: data as T, usedPath: path };
        }
        if (data.ok === false && (data as unknown as AccessibilityError).code === "ACCESSIBILITY_NOT_TRUSTED") {
          const axErr = new Error((data as unknown as AccessibilityError).error);
          (axErr as Error & { code: string; details?: string }).code = "ACCESSIBILITY_NOT_TRUSTED";
          (axErr as Error & { details?: string }).details = (data as unknown as AccessibilityError).details;
          throw axErr;
        }
        if (data.ok === false && (data as unknown as AccessibilityError).code === "SCREEN_CAPTURE_FAILED") {
          const scErr = new Error((data as unknown as AccessibilityError).error);
          (scErr as Error & { code: string; details?: string }).code = "SCREEN_CAPTURE_FAILED";
          (scErr as Error & { details?: string }).details = (data as unknown as AccessibilityError).details;
          throw scErr;
        }
        const errDetail = [data?.error, data?.details].filter(Boolean).join(" | ");
        lastError = errDetail || `${res.status} ${res.statusText}`;
      } catch (err) {
        const tagged = err as Error & { code?: string };
        if (
          tagged.code === "ACCESSIBILITY_NOT_TRUSTED" ||
          tagged.code === "SCREEN_CAPTURE_FAILED"
        ) {
          throw tagged;
        }
        const reason = err instanceof Error ? err.message : String(err);
        lastError = `${path}: ${reason}`;
      }
    }
    throw new Error(lastError);
  };

  const buildEndpointCandidates = (path: string) => {
    const output: string[] = [`/api${path}`, path, `${window.location.origin}${path}`];
    try {
      const wsUrl = new URL(getClient().url);
      const protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
      const host = wsUrl.hostname;
      if (wsUrl.port) output.push(`${protocol}//${host}:${wsUrl.port}${path}`);
      output.push(`${protocol}//${host}:19801${path}`);
    } catch {
      // ignore URL parsing issues and keep defaults
    }
    output.push(`http://127.0.0.1:19801${path}`);
    return [...new Set(output)];
  };

  const loadTree = async () => {
    try {
      setLoadingTree(true);
      setError("");
      // Default to hierarchy mode for the full hierarchical tree
      const { data } = await fetchWithFallback<HierarchyApiResponse>(
        buildEndpointCandidates("/screen/tree?mode=hierarchy"),
      );
      setTreeData(data);
    } catch (err) {
      const axErr = err as Error & { code?: string; details?: string };
      if (axErr.code === "ACCESSIBILITY_NOT_TRUSTED") {
        setError(`__ACCESSIBILITY_NOT_TRUSTED__::${axErr.details ?? ""}`);
      } else {
        setError(axErr.message ?? "Failed to load screen tree");
      }
    } finally {
      setLoadingTree(false);
    }
  };

  const runLatencyBenchmark = async (profile: "full" | "frame-only" = "full") => {
    try {
      setLoadingLatency(true);
      setError("");
      const { data } = await fetchWithFallback<LatencyApiResponse>(
        buildEndpointCandidates(`/latency/benchmark?profile=${profile}`),
      );
      setLatencyData(data);
    } catch (err) {
      const permErr = err as Error & { code?: string; details?: string };
      if (permErr.code === "SCREEN_CAPTURE_FAILED") {
        setError(`__SCREEN_CAPTURE_FAILED__::${permErr.details ?? ""}`);
      } else {
        setError(permErr.message ?? "Benchmark failed");
      }
    } finally {
      setLoadingLatency(false);
    }
  };

  // Determine if this is hierarchy mode or legacy flat mode
  const isHierarchyMode =
    treeData?.mode === "hierarchy" ||
    (treeData?.tree && "role" in treeData.tree && "children" in treeData.tree && !("label" in treeData.tree));

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="glass" style={{ borderRadius: 16, padding: 18 }}>
          <h2 style={{ margin: 0, fontSize: "1.2rem", color: "white" }}>
            {isVi ? "Cây màn hình" : "Screen Tree"}
          </h2>
          <p style={{ margin: "8px 0 0", color: "var(--color-text-muted)", fontSize: "0.82rem" }}>
            {isVi
              ? "Vẽ cây phân cấp đầy đủ từ Accessibility API và đo độ trễ bridge nội bộ."
              : "Render full hierarchical tree from Accessibility API and benchmark local bridge latency."}
          </p>
        </div>

        <div className="glass" style={{ borderRadius: 16, padding: 18 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <button className="btn-primary" onClick={loadTree} disabled={loadingTree}>
              {loadingTree
                ? isVi ? "Đang tải cây..." : "Loading tree..."
                : isVi ? "Lấy cây màn hình" : "Load screen tree"}
            </button>
            <button className="btn-ghost" onClick={() => runLatencyBenchmark("full")} disabled={loadingLatency}>
              {loadingLatency
                ? isVi ? "Đang đo..." : "Benchmarking..."
                : isVi ? "Đo độ trễ < 50ms" : "Benchmark < 50ms"}
            </button>
            <button
              className="btn-ghost"
              onClick={() => runLatencyBenchmark("frame-only")}
              disabled={loadingLatency}
            >
              {loadingLatency
                ? isVi ? "Đang đo frame..." : "Frame profiling..."
                : isVi ? "Đo frame-only" : "Frame-only benchmark"}
            </button>
          </div>

          {error && (
            <div style={{ fontSize: "0.8rem", marginBottom: 10 }}>
              {error.startsWith("__ACCESSIBILITY_NOT_TRUSTED__") ? (
                <div style={{ padding: "24px", maxWidth: 480 }}>
                  <h3 style={{ color: "#ff6b6b", marginBottom: 8 }}>⚠️ Accessibility Permission Required</h3>
                  <p style={{ marginBottom: 16, lineHeight: 1.6 }}>
                    OmniState needs Accessibility permission to inspect the UI tree.
                  </p>
                  <ol style={{ lineHeight: 2, paddingLeft: 20 }}>
                    <li>Open <strong>System Settings</strong></li>
                    <li>Go to <strong>Privacy &amp; Security → Accessibility</strong></li>
                    <li>Add your <strong>Terminal</strong> (or VS Code / iTerm2)</li>
                    <li>Restart the OmniState gateway</li>
                  </ol>
                  <button onClick={loadTree} style={{ marginTop: 16, padding: "8px 16px" }}>
                    Retry
                  </button>
                </div>
              ) : error.startsWith("__SCREEN_CAPTURE_FAILED__") ? (
                <div style={{ padding: "24px", maxWidth: 480 }}>
                  <h3 style={{ color: "#ff9944", marginBottom: 8 }}>📹 Screen Recording Permission Required</h3>
                  <p style={{ marginBottom: 16, lineHeight: 1.6 }}>
                    OmniState needs Screen Recording permission for latency benchmarking.
                  </p>
                  <ol style={{ lineHeight: 2, paddingLeft: 20 }}>
                    <li>Open <strong>System Settings</strong></li>
                    <li>Go to <strong>Privacy &amp; Security → Screen Recording</strong></li>
                    <li>Add your <strong>Terminal</strong> (or VS Code / iTerm2)</li>
                    <li>Restart the OmniState gateway</li>
                  </ol>
                  <button onClick={() => runLatencyBenchmark("full")} style={{ marginTop: 16, padding: "8px 16px" }}>
                    Retry
                  </button>
                </div>
              ) : (
                <div style={{ color: "red" }}>{error}</div>
              )}
            </div>
          )}

          {latencyData && (
            <div className="alert-info" style={{ borderRadius: 12, padding: 12, marginBottom: 12 }}>
              {(() => {
                const frameP50 = latencyData.frame?.p50 ?? latencyData.p50;
                const frameP95 = latencyData.frame?.p95 ?? latencyData.p95;
                const frameMax = latencyData.frame?.max ?? latencyData.max;
                const hasFrame =
                  typeof frameP50 === "number" &&
                  typeof frameP95 === "number" &&
                  typeof frameMax === "number";
                const passKnown = typeof latencyData.passUnder50msP95 === "boolean";

                return (
                  <>
              <div style={{ fontSize: "0.82rem", color: "var(--color-text-secondary)" }}>
                {isVi ? "Frame" : "Frame"}: p50: <b>{hasFrame ? `${frameP50}ms` : "N/A"}</b> | p95:{" "}
                <b>{hasFrame ? `${frameP95}ms` : "N/A"}</b> | max:{" "}
                <b>{hasFrame ? `${frameMax}ms` : "N/A"}</b>
              </div>
              {latencyData.tree && (
                <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginTop: 4 }}>
                  Tree: p50: <b>{latencyData.tree.p50}ms</b> | p95: <b>{latencyData.tree.p95}ms</b> | max:{" "}
                  <b>{latencyData.tree.max}ms</b>
                </div>
              )}
              {latencyData.combined && (
                <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginTop: 2 }}>
                  {isVi ? "Tổng" : "Combined"}: p50: <b>{latencyData.combined.p50}ms</b> | p95:{" "}
                  <b>{latencyData.combined.p95}ms</b> | max: <b>{latencyData.combined.max}ms</b>
                </div>
              )}
              <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", marginTop: 6 }}>
                {isVi
                  ? "Tiêu chí p95 < 50ms áp dụng cho frame capture để thao tác nhanh."
                  : "The p95 < 50ms SLO is evaluated on frame capture for fast control."}
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", marginTop: 2 }}>
                {isVi ? "Profile:" : "Profile:"} <b>{latencyData.profile ?? "full"}</b>
              </div>
              {latencyData.processContext && (
                <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", marginTop: 2 }}>
                  {isVi ? "Process:" : "Process:"} pid <b>{latencyData.processContext.pid}</b> | tty <b>{latencyData.processContext.tty ?? "?"}</b> | {isVi ? "interactive" : "interactive"} <b>{String(latencyData.processContext.interactiveSession)}</b>
                </div>
              )}
              {!!latencyData.recommendations?.length && (
                <div style={{ marginTop: 6, fontSize: "0.72rem", color: "#f59e0b" }}>
                  {latencyData.recommendations.map((x, idx) => (
                    <div key={`${idx}-${x}`}>- {x}</div>
                  ))}
                </div>
              )}
              <div
                style={{
                  fontSize: "0.8rem",
                  marginTop: 4,
                  color: !passKnown ? "#f59e0b" : latencyData.passUnder50msP95 ? "#22c55e" : "#ef4444",
                }}
              >
                {!hasFrame
                  ? isVi
                    ? "Chưa có số đo frame (N/A). Kiểm tra quyền Screen Recording."
                    : "Frame metrics unavailable (N/A). Check Screen Recording permission."
                  : !passKnown
                    ? isVi ? "Không đủ dữ liệu để đánh giá p95 < 50ms" : "Insufficient data for p95 < 50ms verdict"
                    : latencyData.passUnder50msP95
                      ? isVi ? "Đạt mục tiêu p95 < 50ms" : "Pass p95 < 50ms"
                      : isVi ? "Chưa đạt mục tiêu p95 < 50ms" : "Not meeting p95 < 50ms"}
              </div>
                  </>
                );
              })()}
            </div>
          )}

          {treeData?.tree ? (
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                padding: 12,
                maxHeight: 560,
                overflowY: "auto",
              }}
            >
              {/* Warning banner */}
              {treeData.warning && (
                <div style={{
                  padding: "8px 12px",
                  background: "#78350f22",
                  border: "1px solid #f59e0b44",
                  borderRadius: 4,
                  marginBottom: 8,
                  fontSize: "0.75rem",
                  color: "#f59e0b",
                }}>
                  ⚠️ {treeData.warning}
                </div>
              )}

              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 10,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                  {isVi ? "Accessibility" : "Accessibility"}:{" "}
                  <b style={{ color: treeData.accessibilityTrusted ? "#22c55e" : "#ef4444" }}>
                    {treeData.accessibilityTrusted ? "✓ trusted" : "✗ not trusted"}
                  </b>
                </span>
                <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                  {isVi ? "Tổng" : "Total"}:{" "}
                  <b style={{ color: "var(--color-text-secondary)" }}>{treeData.totalElements} elements</b>
                </span>
                <span
                  style={{
                    fontSize: "0.68rem",
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: isHierarchyMode ? "#22c55e22" : "#f59e0b22",
                    color: isHierarchyMode ? "#22c55e" : "#f59e0b",
                    border: `1px solid ${isHierarchyMode ? "#22c55e44" : "#f59e0b44"}`,
                  }}
                >
                  {isHierarchyMode ? "hierarchy" : "flat (legacy)"}
                </span>
                {treeData.fallback && (
                  <span style={{ fontSize: "0.68rem", color: "#f59e0b" }}>
                    ⚠ fallback: {treeData.fallback}
                  </span>
                )}
              </div>

              {/* Legend */}
              {isHierarchyMode && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginBottom: 10,
                    paddingBottom: 8,
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {[
                    "AXButton",
                    "AXStaticText",
                    "AXGroup",
                    "AXWindow",
                    "AXMenuBar",
                    "AXTable",
                    "AXTextField",
                    "AXImage",
                    "AXTabGroup",
                    "AXCheckBox",
                  ].map((role) => (
                    <span key={role} style={roleBadgeStyle(role)}>
                      {role.replace("AX", "")}
                    </span>
                  ))}
                </div>
              )}

              {/* Tree content */}
              {isHierarchyMode ? (
                <HierarchyNodeItem
                  node={treeData.tree as HierarchyNode}
                  depth={0}
                  path=""
                  defaultExpanded={true}
                />
              ) : (
                <FlatTreeItem node={treeData.tree as FlatTreeNode} depth={0} />
              )}
            </div>
          ) : null}
        </div>

        <div className="glass" style={{ borderRadius: 16, padding: 18 }}>
          <div style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", marginBottom: 8 }}>
            {isVi
              ? "Ví dụ lệnh điều khiển chuột và ghi nhớ click"
              : "Mouse and click-memory command examples"}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {mouseExamples.map((x) => (
              <button
                key={x}
                className="btn-ghost"
                onClick={() => {
                  useChatStore.getState().addUserMessage(x);
                  setError(
                    isVi
                      ? "Đã thêm lệnh vào phiên chat hiện tại."
                      : "Added command to current chat session.",
                  );
                }}
                style={{
                  textAlign: "left",
                  fontSize: "0.75rem",
                  color: "var(--color-text-muted)",
                  fontFamily: "monospace",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 8,
                  padding: "8px 10px",
                }}
              >
                {x}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
