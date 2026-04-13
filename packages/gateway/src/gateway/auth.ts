import type { GatewayConfig } from "../config/schema.js";
import { getDb } from "../db/database.js";
import { SessionRepository } from "../db/session-repository.js";
import { DeviceRepository } from "../db/device-repository.js";

export interface AuthResult {
  ok: boolean;
  userId?: string;
  email?: string;
  /** Set when authenticated via a device JWT (type: "device"). */
  deviceId?: string;
  reason?: string;
}

/**
 * Authenticate a WebSocket connection.
 * Supports 4 modes:
 * 1. localAutoApprove + localhost → ok, anonymous
 * 2. User session JWT → validate, extract userId
 * 3. Device JWT (type: "device") → validate, extract deviceId, touch last_seen
 * 4. Legacy static token → ok, anonymous (backward compat)
 */
export function authenticateConnection(
  token: string | undefined,
  config: GatewayConfig,
  isLocalhost: boolean,
  remoteIp?: string
): AuthResult {
  // Mode 1: Local auto-approve
  if (config.gateway.auth.localAutoApprove && isLocalhost) {
    return { ok: true };
  }

  if (!token) {
    return { ok: false, reason: "Authentication token required" };
  }

  const db = getDb();

  // Mode 2: Try user session JWT first
  const sessionRepo = new SessionRepository(db);
  const sessionPayload = sessionRepo.verifyAccessToken(token);

  if (sessionPayload) {
    sessionRepo.touchSession(sessionPayload.sessionId);
    return { ok: true, userId: sessionPayload.userId, email: sessionPayload.email };
  }

  // Mode 3: Try device JWT
  try {
    const deviceRepo = new DeviceRepository(db);
    const device = deviceRepo.verifyDeviceToken(token);

    if (device) {
      // Update last_seen metadata (verifyDeviceToken already touches last_seen_at;
      // this also records the remote IP)
      if (remoteIp) {
        deviceRepo.updateDeviceLastSeen(device.id, remoteIp);
      }
      return { ok: true, deviceId: device.id };
    }
  } catch {
    // DeviceRepository may not exist yet in older deployments — degrade gracefully
  }

  // Mode 4: Legacy static token
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
