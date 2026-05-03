import { getClient } from "../hooks/useGateway";

// ── Types ─────────────────────────────────────────────────────────────

interface AccessibilityError {
  ok: false;
  code: string;
  error: string;
  details?: string;
  permissionNeeded?: string;
}

// ── Utilities ─────────────────────────────────────────────────────────

export function buildEndpointCandidates(path: string): string[] {
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
}

export async function fetchWithFallback<T>(paths: string[]): Promise<{ data: T; usedPath: string }> {
  let lastError = "Not found";
  for (const path of paths) {
    try {
      const res = await fetch(path);
      const rawText = await res.text();
      const data = (() => {
        try {
          return JSON.parse(rawText) as T & { ok?: boolean; error?: string; details?: string };
        } catch {
          return { ok: res.ok, error: rawText } as T & { ok?: boolean; error?: string; details?: string };
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
}
