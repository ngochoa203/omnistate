import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const bridgeProbeScriptPath = fileURLToPath(new URL("../../scripts/bridge-probe.mjs", import.meta.url));
const DEFAULT_TTL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 1_200;

export interface OSContextPayload {
  contextId: string;
  capturedAt: string;
  ttlMs: number;
  source: "accessibility-tree" | "screen-tree" | "cached" | "unavailable";
  activeApp?: { name?: string; bundleId?: string; pid?: number };
  activeWindow?: { title?: string; bounds?: { x: number; y: number; width: number; height: number } };
  focusedElement?: { role?: string; title?: string; value?: string; description?: string };
  selection?: { text?: string };
  treeSummary?: string;
  rawTreeRef?: string;
  stale?: boolean;
  error?: string;
}

export interface OSContextPolicy {
  ttlMs?: number;
  timeoutMs?: number;
  forceRefresh?: boolean;
}

let cached: OSContextPayload | null = null;

function unavailable(ttlMs: number, error: string): OSContextPayload {
  return {
    contextId: `ctx-${crypto.randomUUID()}`,
    capturedAt: new Date().toISOString(),
    ttlMs,
    source: "unavailable",
    error: error.slice(0, 500),
  };
}

function summarizeTree(value: unknown): string | undefined {
  const text = JSON.stringify(value ?? {}).replace(/\s+/g, " ").trim();
  if (!text || text === "{}") return undefined;
  return text.slice(0, 1_500);
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 300);
  }
  return undefined;
}

function normalize(raw: unknown, ttlMs: number): OSContextPayload {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const app = obj.activeApp && typeof obj.activeApp === "object" ? obj.activeApp as Record<string, unknown> : {};
  const win = obj.activeWindow && typeof obj.activeWindow === "object" ? obj.activeWindow as Record<string, unknown> : {};
  const focused = obj.focusedElement && typeof obj.focusedElement === "object" ? obj.focusedElement as Record<string, unknown> : {};

  return {
    contextId: `ctx-${crypto.randomUUID()}`,
    capturedAt: new Date().toISOString(),
    ttlMs,
    source: "accessibility-tree",
    activeApp: {
      name: pickString(app, ["name", "title", "appName"]),
      bundleId: pickString(app, ["bundleId", "bundleID"]),
      pid: typeof app.pid === "number" ? app.pid : undefined,
    },
    activeWindow: {
      title: pickString(win, ["title", "name"]),
    },
    focusedElement: {
      role: pickString(focused, ["role"]),
      title: pickString(focused, ["title", "name"]),
      value: pickString(focused, ["value"]),
      description: pickString(focused, ["description", "help"]),
    },
    treeSummary: summarizeTree(obj),
  };
}

export async function getCurrentContext(policy: OSContextPolicy = {}): Promise<OSContextPayload> {
  const ttlMs = policy.ttlMs ?? DEFAULT_TTL_MS;
  const timeoutMs = policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (cached && !policy.forceRefresh && Date.now() - Date.parse(cached.capturedAt) < cached.ttlMs) {
    return { ...cached, source: "cached" };
  }

  try {
    const { stdout } = await execFileAsync(process.execPath, [bridgeProbeScriptPath, "tree"], {
      timeout: timeoutMs,
      maxBuffer: 512 * 1024,
    });
    cached = normalize(JSON.parse(stdout), ttlMs);
    return cached;
  } catch (err) {
    const fallback = unavailable(ttlMs, err instanceof Error ? err.message : String(err));
    if (cached) return { ...cached, source: "cached", stale: true, error: fallback.error };
    return fallback;
  }
}

export function summarizeForIntent(context: OSContextPayload): string {
  const parts = [
    context.activeApp?.name ? `app=${context.activeApp.name}` : undefined,
    context.activeWindow?.title ? `window=${context.activeWindow.title}` : undefined,
    context.focusedElement?.role ? `focus=${context.focusedElement.role}` : undefined,
    context.focusedElement?.title ? `focusTitle=${context.focusedElement.title}` : undefined,
    context.selection?.text ? `selection=${context.selection.text.slice(0, 200)}` : undefined,
    context.treeSummary ? `summary=${context.treeSummary.slice(0, 800)}` : undefined,
    context.error ? `contextError=${context.error}` : undefined,
  ].filter(Boolean);
  return parts.join("; ");
}
