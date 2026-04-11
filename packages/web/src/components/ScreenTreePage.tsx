import { useMemo, useState } from "react";
import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";

interface TreeNode {
  id: string;
  label: string;
  bounds?: { x: number; y: number; width: number; height: number } | null;
  children?: TreeNode[];
}

interface TreeApiResponse {
  ok: boolean;
  code?: string;
  accessibilityTrusted: boolean;
  totalElements: number;
  tree: TreeNode;
  error?: string;
  details?: string;
}

interface LatencyApiResponse {
  ok: boolean;
  code?: string;
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

function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  return (
    <div style={{ marginLeft: depth * 14 }}>
      <div style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", padding: "4px 0" }}>
        {node.children?.length ? "📁" : "📄"} {node.label}
        {node.bounds ? (
          <span style={{ marginLeft: 8, color: "var(--color-text-muted)", fontFamily: "monospace", fontSize: "0.7rem" }}>
            [{node.bounds.x},{node.bounds.y},{node.bounds.width}x{node.bounds.height}]
          </span>
        ) : null}
      </div>
      {node.children?.map((child) => (
        <TreeItem key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function ScreenTreePage() {
  const appLanguage = useChatStore((s) => s.appLanguage);
  const isVi = appLanguage === "vi";

  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingLatency, setLoadingLatency] = useState(false);
  const [treeData, setTreeData] = useState<TreeApiResponse | null>(null);
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
        const errDetail = [data?.error, data?.details].filter(Boolean).join(" | ");
        lastError = errDetail || `${res.status} ${res.statusText}`;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        lastError = `${path}: ${reason}`;
      }
    }
    throw new Error(lastError);
  };

  const buildEndpointCandidates = (path: "/screen/tree" | "/latency/benchmark") => {
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
      const { data } = await fetchWithFallback<TreeApiResponse>(buildEndpointCandidates("/screen/tree"));
      setTreeData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTree(false);
    }
  };

  const runLatencyBenchmark = async () => {
    try {
      setLoadingLatency(true);
      setError("");
      const { data } = await fetchWithFallback<LatencyApiResponse>(
        buildEndpointCandidates("/latency/benchmark"),
      );
      setLatencyData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingLatency(false);
    }
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="glass" style={{ borderRadius: 16, padding: 18 }}>
          <h2 style={{ margin: 0, fontSize: "1.2rem", color: "white" }}>
            {isVi ? "Cây màn hình" : "Screen Tree"}
          </h2>
          <p style={{ margin: "8px 0 0", color: "var(--color-text-muted)", fontSize: "0.82rem" }}>
            {isVi
              ? "Vẽ cây các thành phần UI từ Accessibility API và đo độ trễ bridge nội bộ."
              : "Render UI tree from Accessibility API and benchmark local bridge latency."}
          </p>
        </div>

        <div className="glass" style={{ borderRadius: 16, padding: 18 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <button className="btn-primary" onClick={loadTree} disabled={loadingTree}>
              {loadingTree ? (isVi ? "Đang tải cây..." : "Loading tree...") : (isVi ? "Lấy cây màn hình" : "Load screen tree")}
            </button>
            <button className="btn-ghost" onClick={runLatencyBenchmark} disabled={loadingLatency}>
              {loadingLatency ? (isVi ? "Đang đo..." : "Benchmarking...") : (isVi ? "Đo độ trễ < 50ms" : "Benchmark < 50ms")}
            </button>
          </div>

          {error && (
            <div style={{ fontSize: "0.8rem", color: "#ef4444", marginBottom: 10 }}>
              {error}
            </div>
          )}

          {latencyData && (
            <div className="alert-info" style={{ borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: "0.82rem", color: "var(--color-text-secondary)" }}>
                {isVi ? "Frame" : "Frame"}: p50: <b>{latencyData.frame?.p50 ?? latencyData.p50}ms</b> | p95: <b>{latencyData.frame?.p95 ?? latencyData.p95}ms</b> | max: <b>{latencyData.frame?.max ?? latencyData.max}ms</b>
              </div>
              {latencyData.tree && (
                <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginTop: 4 }}>
                  {isVi ? "Tree" : "Tree"}: p50: <b>{latencyData.tree.p50}ms</b> | p95: <b>{latencyData.tree.p95}ms</b> | max: <b>{latencyData.tree.max}ms</b>
                </div>
              )}
              {latencyData.combined && (
                <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginTop: 2 }}>
                  {isVi ? "Tổng" : "Combined"}: p50: <b>{latencyData.combined.p50}ms</b> | p95: <b>{latencyData.combined.p95}ms</b> | max: <b>{latencyData.combined.max}ms</b>
                </div>
              )}
              <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", marginTop: 6 }}>
                {isVi ? "Tiêu chí p95 < 50ms áp dụng cho frame capture để thao tác nhanh." : "The p95 < 50ms SLO is evaluated on frame capture for fast control."}
              </div>
              <div style={{ fontSize: "0.8rem", marginTop: 4, color: latencyData.passUnder50msP95 ? "#22c55e" : "#ef4444" }}>
                {latencyData.passUnder50msP95
                  ? (isVi ? "Đạt mục tiêu p95 < 50ms" : "Pass p95 < 50ms")
                  : (isVi ? "Chưa đạt mục tiêu p95 < 50ms" : "Not meeting p95 < 50ms")}
              </div>
            </div>
          )}

          {treeData?.tree ? (
            <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 12, maxHeight: 420, overflowY: "auto" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: 8 }}>
                {isVi ? "Accessibility trusted" : "Accessibility trusted"}: {String(treeData.accessibilityTrusted)} | {isVi ? "Tổng phần tử" : "Total elements"}: {treeData.totalElements}
              </div>
              <TreeItem node={treeData.tree} />
            </div>
          ) : null}
        </div>

        <div className="glass" style={{ borderRadius: 16, padding: 18 }}>
          <div style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", marginBottom: 8 }}>
            {isVi ? "Ví dụ lệnh điều khiển chuột và ghi nhớ click" : "Mouse and click-memory command examples"}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {mouseExamples.map((x) => (
              <button
                key={x}
                className="btn-ghost"
                onClick={() => {
                  useChatStore.getState().addUserMessage(x);
                  setError(isVi ? "Đã thêm lệnh vào phiên chat hiện tại." : "Added command to current chat session.");
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
