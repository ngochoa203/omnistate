import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";


const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScreenTreeResult {
  ok: boolean;
  mode?: string;
  tree?: unknown;
  hierarchy?: unknown;
  error?: string;
  cached?: boolean;
  cachedAt?: number;
}

// ---------------------------------------------------------------------------
// Cache state
// ---------------------------------------------------------------------------

let cachedResult: ScreenTreeResult | null = null;
let cachedAt = 0;

const DEFAULT_TTL_MS = 1500;

function getTtlMs(): number {
  const env = process.env.OMNISTATE_SCREEN_TREE_TTL_MS;
  if (env) {
    const val = parseInt(env, 10);
    if (Number.isFinite(val) && val > 0) return val;
  }
  return DEFAULT_TTL_MS;
}

// ---------------------------------------------------------------------------
// Bridge detection
// ---------------------------------------------------------------------------

/** Try to load the native N-API bridge module if available */
async function tryNativeBridge(mode: string): Promise<ScreenTreeResult | null> {
  try {
    // Attempt dynamic import of native bridge (optional dependency)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = await import("@omnistate/native-bridge" as string) as any;
    if (typeof bridge.getUiTree === "function") {
      const tree = await bridge.getUiTree(mode);
      return { ok: true, mode, tree, cached: false };
    }
  } catch {
    // Native bridge not available — fall through
  }
  return null;
}

/** AppleScript fallback for screen tree collection */
async function appleScriptFallback(mode: string): Promise<ScreenTreeResult | null> {
  if (process.platform !== "darwin") return null;

  try {
    const script = mode === "hierarchy"
      ? 'tell application "System Events" to get properties of every process whose visible is true'
      : 'tell application "System Events" to get name of every process whose visible is true';

    const { stdout } = await execFileAsync("osascript", ["-e", script], {
      timeout: 5_000,
    });

    return {
      ok: true,
      mode,
      tree: stdout.trim().split(", ").map((name: string) => ({ name: name.trim(), type: "process" })),
      cached: false,
    };
  } catch {
    return null;
  }
}

/** Child process fallback (legacy path — preserved as last resort) */
async function childProcessFallback(mode: string): Promise<ScreenTreeResult> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // Walk up from src/planner/ to find the bridge probe script
  const bridgeProbeScriptPath = resolve(__dirname, "../../scripts/bridge-probe.mjs");

  const { stdout } = await execFileAsync(
    process.execPath,
    [bridgeProbeScriptPath, mode],
    { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
  );

  return JSON.parse(stdout);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the screen tree with caching.
 * Priority: N-API bridge (<10ms) → AppleScript (<50ms) → child process (legacy)
 *
 * Results are cached with configurable TTL (default 1500ms).
 */
export async function getScreenTree(
  mode: string = "tree",
  ttlOverrideMs?: number,
): Promise<ScreenTreeResult> {
  const ttl = ttlOverrideMs ?? getTtlMs();
  const now = Date.now();

  // Return cached result if still valid
  if (cachedResult && (now - cachedAt) < ttl) {
    return { ...cachedResult, cached: true, cachedAt };
  }

  // Try sources in priority order
  const result =
    await tryNativeBridge(mode) ??
    await appleScriptFallback(mode) ??
    await childProcessFallback(mode);

  // Cache the result
  cachedResult = result;
  cachedAt = Date.now();

  return result;
}

/** Manually invalidate the screen tree cache */
export function invalidateScreenTree(): void {
  cachedResult = null;
  cachedAt = 0;
}
