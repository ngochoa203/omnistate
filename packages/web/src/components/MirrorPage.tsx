import { useEffect, useRef, useState } from "react";
import { MIRROR_FRAME_MAGIC } from "@omnistate/shared";

interface MirrorPageProps {
  gatewayWsUrl: string;
  sessionId?: string;
  streamId?: number;
}

/**
 * MirrorPage — live screen-mirror viewer.
 * Connects as a "viewer" to the gateway's /mirror WebSocket. Renders JPEG
 * frames to a canvas and forwards input events back to the source device.
 */
export function MirrorPage({
  gatewayWsUrl,
  sessionId = "default",
  streamId = 0,
}: MirrorPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [meta, setMeta] = useState<{ width: number; height: number; fps: number } | null>(null);
  const [latencyMs, setLatencyMs] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const lastFrameTime = useRef<number>(Date.now());

  useEffect(() => {
    const url = gatewayWsUrl.replace(/^http/, "ws") + "/mirror";
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello", role: "viewer", sessionId, streamId }));
      setConnected(true);
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "meta") setMeta({ width: msg.width, height: msg.height, fps: msg.fps });
          else if (msg.type === "pong") setLatencyMs(Date.now() - msg.ts);
        } catch { /* ignore */ }
        return;
      }
      const buf = new Uint8Array(ev.data as ArrayBuffer);
      if (buf[0] !== MIRROR_FRAME_MAGIC) return;
      const jpeg = buf.subarray(2);
      renderFrame(canvasRef.current, jpeg);
      const now = Date.now();
      setFrameCount((c) => c + 1);
      lastFrameTime.current = now;
    };

    const pingTimer = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
    }, 2000);

    return () => {
      clearInterval(pingTimer);
      try { ws.close(); } catch { /* ignore */ }
    };
  }, [gatewayWsUrl, sessionId, streamId]);

  const sendInput = (action: string, params: Record<string, unknown>): void => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "input", action, params }));
    }
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!meta || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * meta.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * meta.height);
    sendInput("tap", { x, y });
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Device Mirror</h2>
        <div style={styles.stats}>
          <StatusPill label="Connection" value={connected ? "Connected" : "Disconnected"} good={connected} />
          <StatusPill label="Latency" value={`${latencyMs}ms`} good={latencyMs < 200} />
          <StatusPill label="Frames" value={String(frameCount)} good={frameCount > 0} />
          {meta && <StatusPill label="Source" value={`${meta.width}×${meta.height} @ ${meta.fps}fps`} good />}
        </div>
      </div>

      <div style={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          width={meta?.width ?? 1080}
          height={meta?.height ?? 2400}
          onClick={onCanvasClick}
          style={styles.canvas}
        />
      </div>

      <div style={styles.controls}>
        <button style={styles.btn} onClick={() => sendInput("back", {})}>◁ Back</button>
        <button style={styles.btn} onClick={() => sendInput("home", {})}>○ Home</button>
        <button style={styles.btn} onClick={() => sendInput("recents", {})}>▢ Recents</button>
      </div>
    </div>
  );
}

function renderFrame(canvas: HTMLCanvasElement | null, jpegBytes: Uint8Array): void {
  if (!canvas) return;
  const blob = new Blob([jpegBytes as unknown as BlobPart], { type: "image/jpeg" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width;
        canvas.height = img.height;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    URL.revokeObjectURL(url);
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

function StatusPill({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div style={{
      ...styles.pill,
      background: good ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
      color: good ? "#10b981" : "#ef4444",
    }}>
      <span style={styles.pillLabel}>{label}</span>
      <span style={styles.pillValue}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, color: "#f1f5f9" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 },
  title: { fontSize: 24, fontWeight: 700, margin: 0 },
  stats: { display: "flex", gap: 8, flexWrap: "wrap" },
  pill: {
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 12,
    display: "flex",
    gap: 6,
    alignItems: "center",
  },
  pillLabel: { opacity: 0.7 },
  pillValue: { fontWeight: 600 },
  canvasWrap: {
    background: "#000",
    borderRadius: 12,
    overflow: "hidden",
    aspectRatio: "9 / 20",
    maxHeight: "70vh",
    margin: "0 auto",
  },
  canvas: { width: "100%", height: "100%", display: "block", cursor: "crosshair" },
  controls: { display: "flex", gap: 12, justifyContent: "center", marginTop: 16 },
  btn: {
    padding: "10px 20px",
    background: "#1e293b",
    color: "#f1f5f9",
    border: "1px solid #334155",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
  },
};
