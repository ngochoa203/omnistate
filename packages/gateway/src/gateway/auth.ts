import type { GatewayConfig } from "../config/schema.js";
import { getDb } from "../db/database.js";
import { SessionRepository } from "../db/session-repository.js";

export interface AuthResult {
  ok: boolean;
  userId?: string;
  email?: string;
  reason?: string;
}

/**
 * Authenticate a WebSocket connection.
 * Supports 3 modes:
 * 1. localAutoApprove + localhost → ok, anonymous
 * 2. JWT token → validate, extract userId
 * 3. Legacy static token → ok, anonymous (backward compat)
 */
export function authenticateConnection(
  token: string | undefined,
  config: GatewayConfig,
  isLocalhost: boolean
): AuthResult {
  // Mode 1: Local auto-approve
  if (config.gateway.auth.localAutoApprove && isLocalhost) {
    return { ok: true };
  }

  if (!token) {
    return { ok: false, reason: "Authentication token required" };
  }

  // Mode 2: Try JWT first
  const db = getDb();
  const sessionRepo = new SessionRepository(db);
  const payload = sessionRepo.verifyAccessToken(token);

  if (payload) {
    sessionRepo.touchSession(payload.sessionId);
    return { ok: true, userId: payload.userId, email: payload.email };
  }

  // Mode 3: Legacy static token
  const expectedToken = config.gateway.auth.token;
  if (expectedToken && token === expectedToken) {
    return { ok: true };
  }

  return { ok: false, reason: "Invalid or expired authentication token" };
}

// Keep the old function for backward compatibility during migration
export function authenticateClient(
  msg: { auth: { token?: string } },
  config: GatewayConfig
): { ok: boolean; reason?: string } {
  const result = authenticateConnection(msg.auth?.token, config, true);
  return { ok: result.ok, reason: result.reason };
}
