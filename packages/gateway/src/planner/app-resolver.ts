import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { resolve, isAbsolute } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Word-boundary aware app name matching.
 * Prevents "code" matching "vscode" — requires word boundary around the token.
 */
export function appWordBoundaryMatch(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[\\s/\\-_])${escaped}(?:[\\s/\\-_,.]|$)`, "i");
  return re.test(text);
}

/** Static alias map: common names → canonical app identifier */
const APP_ALIASES: Record<string, string> = {
  "chrome": "google chrome",
  "vs code": "visual studio code",
  "vscode": "visual studio code",
  "code": "visual studio code",  // only via resolveAppName, not substring
  "term": "terminal",
  "iterm": "iterm2",
  "ff": "firefox",
  "tg": "telegram",
  "fb": "facebook",
};

/**
 * Resolve a raw app name string to a canonical name.
 * Priority: static alias → word-boundary scan of KNOWN_APPS → optional mdfind fuzzy.
 */
export function resolveAppName(
  raw: string,
  knownApps: readonly string[] = [],
): string {
  const lower = raw.toLowerCase().trim();

  // 1. Static alias
  if (APP_ALIASES[lower]) return APP_ALIASES[lower];

  // 2. Word-boundary scan
  for (const app of knownApps) {
    if (appWordBoundaryMatch(lower, app)) return app;
  }

  // 3. Exact match
  if (knownApps.includes(lower)) return lower;

  return raw.trim();
}

/**
 * Fuzzy app resolution via macOS `mdfind` (Spotlight).
 * Only used when OMNISTATE_APP_FUZZY_MATCH=1.
 * Returns null if disabled or no match found.
 */
export async function resolveAppNameFuzzy(raw: string): Promise<string | null> {
  if (process.env.OMNISTATE_APP_FUZZY_MATCH !== "1") return null;

  try {
    const { stdout } = await execFileAsync("mdfind", [
      "kMDItemKind == 'Application'",
      "-name", raw,
    ], { timeout: 2000 });

    const firstMatch = stdout.trim().split("\n")[0];
    if (!firstMatch) return null;

    // Extract app name from path: /Applications/Foo.app → Foo
    const appName = firstMatch.match(/\/([^/]+)\.app$/)?.[1];
    return appName ?? null;
  } catch {
    return null;
  }
}

/**
 * Normalize a relative path to absolute using user's home directory.
 * "Documents/x.txt" → "/Users/<user>/Documents/x.txt"
 */
export function normalizePathToAbsolute(path: string): string {
  if (isAbsolute(path)) return path;

  // Handle ~ prefix
  if (path.startsWith("~/") || path === "~") {
    return resolve(homedir(), path.slice(2));
  }

  // Common relative dirs that should resolve from home
  const homeRelativePrefixes = ["Documents", "Desktop", "Downloads", "Pictures", "Music", "Movies", "Library"];
  for (const prefix of homeRelativePrefixes) {
    if (path.startsWith(prefix + "/") || path === prefix) {
      return resolve(homedir(), path);
    }
  }

  // Default: resolve from cwd
  return resolve(path);
}
