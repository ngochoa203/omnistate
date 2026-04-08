import type { ConnectMessage } from "./protocol.js";
import type { GatewayConfig } from "../config/schema.js";

export interface AuthResult {
  ok: boolean;
  reason?: string;
}

/**
 * Authenticate an incoming client connection.
 *
 * - Local connections (loopback) are auto-approved if localAutoApprove is true.
 * - Remote connections require a matching token.
 */
export function authenticateClient(
  msg: ConnectMessage,
  config: GatewayConfig
): AuthResult {
  // If local auto-approve is on and no token is required, approve.
  if (config.gateway.auth.localAutoApprove) {
    return { ok: true };
  }

  // Otherwise, require token match.
  const expectedToken = config.gateway.auth.token;
  if (!expectedToken) {
    return { ok: true }; // No token configured = open access
  }

  if (msg.auth.token === expectedToken) {
    return { ok: true };
  }

  return { ok: false, reason: "Invalid authentication token" };
}
