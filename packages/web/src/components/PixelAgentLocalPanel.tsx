import { useEffect, useMemo, useState } from "react";

type LayoutFurniture = {
  uid: string;
  type: string;
  col: number;
  row: number;
};

type LayoutData = {
  cols: number;
  rows: number;
  tiles: number[];
  furniture?: LayoutFurniture[];
};

type AgentPos = { col: number; row: number };

const TILE_SIZE = 24;
const EMPTY_TILE = 255;

const TILE_PALETTE: Record<number, string> = {
  0: "#374151",
  1: "#1f2937",
  7: "#7c5a3a",
  9: "#6b7280",
};

const NPCS: AgentPos[] = [
  { col: 5, row: 12 },
  { col: 16, row: 15 },
  { col: 8, row: 18 },
];

function tileColor(tile: number): string {
  return TILE_PALETTE[tile] ?? "#111827";
}

export function PixelAgentLocalPanel({ isVi }: { isVi: boolean }) {
  const [layout, setLayout] = useState<LayoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [avatarId, setAvatarId] = useState(2);
  const [agent, setAgent] = useState<AgentPos>({ col: 11, row: 14 });

  useEffect(() => {
    let active = true;
    const loadLayout = async () => {
      try {
        setLoading(true);
        setError("");
        const res = await fetch("/pixel-agent/default-layout-1.json");
        const data = (await res.json()) as LayoutData;
        if (!active) return;
        setLayout(data);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadLayout();
    return () => {
      active = false;
    };
  }, []);

  const gridWidth = (layout?.cols ?? 1) * TILE_SIZE;
  const gridHeight = (layout?.rows ?? 1) * TILE_SIZE;

  const walkable = useMemo(() => {
    if (!layout) return new Set<string>();
    const output = new Set<string>();
    for (let row = 0; row < layout.rows; row += 1) {
      for (let col = 0; col < layout.cols; col += 1) {
        const tile = layout.tiles[row * layout.cols + col];
        if (tile !== EMPTY_TILE) output.add(`${col}:${row}`);
      }
    }
    return output;
  }, [layout]);

  const isWalkable = (col: number, row: number) => walkable.has(`${col}:${row}`);

  const moveBy = (dx: number, dy: number) => {
    setAgent((prev) => {
      const next = { col: prev.col + dx, row: prev.row + dy };
      if (!layout || !isWalkable(next.col, next.row)) return prev;
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ padding: "12px 0", color: "var(--color-text-muted)", fontSize: "0.82rem" }}>
        {isVi ? "Đang nạp Pixel Agent local..." : "Loading local Pixel Agent..."}
      </div>
    );
  }

  if (!layout || error) {
    return (
      <div style={{ padding: "12px 0", color: "#ef4444", fontSize: "0.78rem" }}>
        {isVi ? "Không tải được layout local:" : "Failed to load local layout:"} {error || "unknown"}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
          {isVi
            ? "Pixel Agent chạy local trong OmniState. Dùng mũi tên hoặc WASD để di chuyển."
            : "Pixel Agent runs locally inside OmniState. Use arrows or WASD to move."}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
            {isVi ? "Avatar" : "Avatar"}
          </label>
          <select
            value={avatarId}
            onChange={(e) => setAvatarId(Number(e.target.value))}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              color: "var(--color-text-primary)",
              padding: "4px 8px",
              fontSize: "0.74rem",
            }}
          >
            {[0, 1, 2, 3, 4, 5].map((id) => (
              <option key={id} value={id}>char_{id}</option>
            ))}
          </select>
        </div>
      </div>

      <div
        role="application"
        tabIndex={0}
        onKeyDown={(e) => {
          const key = e.key.toLowerCase();
          if (key === "arrowup" || key === "w") moveBy(0, -1);
          if (key === "arrowdown" || key === "s") moveBy(0, 1);
          if (key === "arrowleft" || key === "a") moveBy(-1, 0);
          if (key === "arrowright" || key === "d") moveBy(1, 0);
        }}
        style={{
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12,
          padding: 10,
          background: "linear-gradient(180deg, rgba(15,23,42,0.7), rgba(15,23,42,0.35))",
          overflow: "auto",
          outline: "none",
        }}
      >
        <div
          style={{
            width: gridWidth,
            height: gridHeight,
            position: "relative",
            display: "grid",
            gridTemplateColumns: `repeat(${layout.cols}, ${TILE_SIZE}px)`,
            imageRendering: "pixelated",
          }}
        >
          {layout.tiles.map((tile, idx) => {
            const col = idx % layout.cols;
            const row = Math.floor(idx / layout.cols);
            const blocked = tile === EMPTY_TILE;
            return (
              <button
                key={`${col}-${row}`}
                onClick={() => {
                  if (isWalkable(col, row)) setAgent({ col, row });
                }}
                title={`(${col}, ${row})`}
                style={{
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                  border: "none",
                  padding: 0,
                  margin: 0,
                  background: blocked ? "transparent" : tileColor(tile),
                  opacity: blocked ? 0.1 : 0.9,
                  cursor: blocked ? "not-allowed" : "pointer",
                }}
              />
            );
          })}

          {layout.furniture?.map((item) => (
            <div
              key={item.uid}
              title={item.type}
              style={{
                position: "absolute",
                left: item.col * TILE_SIZE + 4,
                top: item.row * TILE_SIZE + 4,
                width: TILE_SIZE - 8,
                height: TILE_SIZE - 8,
                borderRadius: 4,
                background: "rgba(251,191,36,0.7)",
                border: "1px solid rgba(251,191,36,0.95)",
              }}
            />
          ))}

          {NPCS.map((npc, index) => (
            <img
              key={`npc-${index}`}
              src={`/pixel-agent/characters/char_${(index + 3) % 6}.png`}
              alt={`npc-${index}`}
              style={{
                position: "absolute",
                left: npc.col * TILE_SIZE,
                top: npc.row * TILE_SIZE,
                width: TILE_SIZE,
                height: TILE_SIZE,
                imageRendering: "pixelated",
                opacity: 0.75,
              }}
            />
          ))}

          <img
            src={`/pixel-agent/characters/char_${avatarId}.png`}
            alt="agent"
            style={{
              position: "absolute",
              left: agent.col * TILE_SIZE,
              top: agent.row * TILE_SIZE,
              width: TILE_SIZE,
              height: TILE_SIZE,
              imageRendering: "pixelated",
              filter: "drop-shadow(0 0 8px rgba(34,211,238,0.35))",
            }}
          />
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
        {isVi
          ? `Agent đang ở (${agent.col}, ${agent.row}) • Layout ${layout.cols}x${layout.rows}`
          : `Agent is at (${agent.col}, ${agent.row}) • Layout ${layout.cols}x${layout.rows}`}
      </div>
    </div>
  );
}
