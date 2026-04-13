import type { IncomingMessage, ServerResponse } from "node:http";
import { getTailscaleStatus, getLocalNetworkInfo } from "../network/tailscale.js";
import { jsonResponse, getAuthToken } from "./auth-routes.js";
import { getDb } from "../db/database.js";
import { SessionRepository } from "../db/session-repository.js";

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function isLocalRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress ?? "";
  return (
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote.startsWith("::ffff:127.")
  );
}

function isAuthenticated(req: IncomingMessage): boolean {
  const token = getAuthToken(req);
  if (!token) return false;
  try {
    const db = getDb();
    const sessionRepo = new SessionRepository(db);
    const payload = sessionRepo.verifyAccessToken(token);
    return payload !== null;
  } catch {
    return false;
  }
}

function requireAuth(req: IncomingMessage, res: ServerResponse): boolean {
  // Localhost is always allowed (macOS app calling locally)
  if (isLocalRequest(req)) return true;
  // Remote callers must supply a valid session token
  if (isAuthenticated(req)) return true;
  jsonResponse(res, 401, { error: "Authentication required" });
  return false;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/**
 * GET /api/network/info
 * Returns full NetworkInfo: LAN IPs + Tailscale status + port config.
 * Accessible from localhost without auth; remote callers need a bearer token.
 */
const getNetworkInfo: RouteHandler = async (req, res) => {
  if (!requireAuth(req, res)) return;
  try {
    const info = getLocalNetworkInfo();
    jsonResponse(res, 200, info);
  } catch (err: any) {
    jsonResponse(res, 500, { error: err?.message ?? "Failed to get network info" });
  }
};

/**
 * GET /api/network/tailscale
 * Returns TailscaleStatus only.
 * Always requires authentication (no localhost bypass — Tailscale info is sensitive).
 */
const getTailscale: RouteHandler = async (req, res) => {
  if (!isLocalRequest(req) && !isAuthenticated(req)) {
    jsonResponse(res, 401, { error: "Authentication required" });
    return;
  }
  try {
    const status = getTailscaleStatus();
    jsonResponse(res, 200, status);
  } catch (err: any) {
    jsonResponse(res, 500, { error: err?.message ?? "Failed to get Tailscale status" });
  }
};

// ─── Router factory ───────────────────────────────────────────────────────────

export interface NetworkRoutes {
  match(method: string, pathname: string): RouteHandler | null;
}

export function createNetworkRoutes(): NetworkRoutes {
  return {
    match(method: string, pathname: string): RouteHandler | null {
      if (method === "GET" && pathname === "/api/network/info") return getNetworkInfo;
      if (method === "GET" && pathname === "/api/network/tailscale") return getTailscale;
      return null;
    },
  };
}
