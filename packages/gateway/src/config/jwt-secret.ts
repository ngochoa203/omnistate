/**
 * JWT secret management — auto-generates a secure secret on first run
 * and persists it to ~/.omnistate/jwt-secret.
 *
 * Priority:
 * 1. OMNISTATE_JWT_SECRET env var (for production/CI)
 * 2. Persisted secret from ~/.omnistate/jwt-secret
 * 3. Auto-generated random secret (saved for subsequent runs)
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SECRET_DIR = join(homedir(), ".omnistate");
const SECRET_FILE = join(SECRET_DIR, "jwt-secret");

let _cachedSecret: string | null = null;

export function getJwtSecret(): string {
  if (_cachedSecret) return _cachedSecret;

  // 1. Environment variable takes priority
  if (process.env.OMNISTATE_JWT_SECRET) {
    _cachedSecret = process.env.OMNISTATE_JWT_SECRET;
    return _cachedSecret;
  }

  // 2. Try to read persisted secret
  try {
    if (existsSync(SECRET_FILE)) {
      const secret = readFileSync(SECRET_FILE, "utf-8").trim();
      if (secret.length >= 32) {
        _cachedSecret = secret;
        return _cachedSecret;
      }
    }
  } catch {
    // Fall through to generation
  }

  // 3. Generate new secret and persist
  const newSecret = randomBytes(48).toString("base64url");
  try {
    mkdirSync(SECRET_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(SECRET_FILE, newSecret, { mode: 0o600 });
    console.log(
      `[OmniState] Generated new JWT secret → ${SECRET_FILE} (chmod 600)`
    );
  } catch (err) {
    console.warn(
      `[OmniState] Could not persist JWT secret: ${(err as Error).message}. Using ephemeral secret.`
    );
  }

  _cachedSecret = newSecret;
  return _cachedSecret;
}

/**
 * Check whether the current secret is the insecure dev default.
 */
export function isDevSecret(): boolean {
  return getJwtSecret() === "omnistate-dev-secret-change-in-production";
}
