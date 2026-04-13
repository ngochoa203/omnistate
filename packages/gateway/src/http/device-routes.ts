import type { IncomingMessage, ServerResponse } from "node:http";
import { getDb } from "../db/database.js";
import { SessionRepository } from "../db/session-repository.js";
import { DeviceRepository } from "../db/device-repository.js";
import { jsonResponse, getAuthToken } from "./auth-routes.js";

// ---------------------------------------------------------------------------
// PIN Manager
// ---------------------------------------------------------------------------

const PIN_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface ActivePin {
  pin: string;
  expiresAt: number;
}

let activePin: ActivePin | null = null;

/**
 * Generate a new random 6-digit PIN. Replaces any existing PIN.
 * Returns the PIN string.
 */
export function generatePin(): string {
  const pin = String(Math.floor(100_000 + Math.random() * 900_000));
  activePin = { pin, expiresAt: Date.now() + PIN_TTL_MS };
  return pin;
}

/**
 * Verify a PIN. Returns true only if it matches the current non-expired PIN.
 */
export function verifyPin(pin: string): boolean {
  if (!activePin) return false;
  if (Date.now() > activePin.expiresAt) {
    activePin = null;
    return false;
  }
  return activePin.pin === pin;
}

/**
 * Returns the current PIN if still valid, or null.
 */
export function getCurrentPin(): string | null {
  if (!activePin) return null;
  if (Date.now() > activePin.expiresAt) {
    activePin = null;
    return null;
  }
  return activePin.pin;
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

/**
 * Returns true for LAN / Tailscale addresses that may perform pairing.
 * Accepted ranges:
 *   192.168.x.x
 *   10.x.x.x
 *   172.16.x.x – 172.31.x.x
 *   100.64.x.x – 100.127.x.x  (Tailscale CGNAT range)
 */
function isLocalNetworkIp(ip: string): boolean {
  // Strip IPv6-mapped IPv4 prefix
  const addr = ip.startsWith("::ffff:") ? ip.slice(7) : ip;

  // localhost is allowed for generate-pin, but not for /api/lan/pair
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return false;

  const [a, b] = parts;
  if (a === 192 && b === 168) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isLocalhostIp(ip: string): boolean {
  const addr = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  return addr === "127.0.0.1" || addr === "::1";
}

function getRemoteIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

// ---------------------------------------------------------------------------
// Route handler type (mirrors auth-routes.ts)
// ---------------------------------------------------------------------------

type RouteHandler = (req: IncomingMessage, res: ServerResponse, body: any) => Promise<void>;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/lan/generate-pin
 * Localhost-only. Returns a fresh 6-digit PIN the macOS app can display.
 */
const generatePinHandler: RouteHandler = async (req, res, _body) => {
  const ip = getRemoteIp(req);
  if (!isLocalhostIp(ip)) {
    return jsonResponse(res, 403, { error: "This endpoint is only accessible from localhost" });
  }

  const pin = generatePin();
  const expiresAt = new Date(Date.now() + PIN_TTL_MS).toISOString();
  return jsonResponse(res, 200, { pin, expiresAt });
};

/**
 * POST /api/lan/pair
 * Body: { pin, deviceName, deviceType }
 * LAN/Tailscale IPs only. Registers the device and returns tokens.
 */
const lanPairHandler: RouteHandler = async (req, res, body) => {
  const ip = getRemoteIp(req);

  if (!isLocalNetworkIp(ip) && !isLocalhostIp(ip)) {
    return jsonResponse(res, 403, { error: "LAN pairing is only allowed from a local network address" });
  }

  const { pin, deviceName, deviceType } = body ?? {};

  if (!pin || typeof pin !== "string") {
    return jsonResponse(res, 400, { error: "pin is required" });
  }
  if (!deviceName || typeof deviceName !== "string") {
    return jsonResponse(res, 400, { error: "deviceName is required" });
  }
  const validTypes = ["android", "ios", "web", "cli"] as const;
  if (!deviceType || !validTypes.includes(deviceType)) {
    return jsonResponse(res, 400, { error: "deviceType must be one of: android, ios, web, cli" });
  }

  if (!verifyPin(pin)) {
    return jsonResponse(res, 401, { error: "Invalid or expired PIN" });
  }

  // Consume the PIN so it can't be reused
  activePin = null;

  const db = getDb();
  const deviceRepo = new DeviceRepository(db);

  try {
    const result = await deviceRepo.registerDevice({
      deviceName,
      deviceType,
      ipAddress: ip,
    });

    return jsonResponse(res, 201, {
      deviceId: result.deviceId,
      deviceToken: result.deviceToken,
      refreshToken: result.refreshToken,
      expiresIn: 2_592_000, // 30 days in seconds
    });
  } catch (err: any) {
    return jsonResponse(res, 500, { error: "Failed to register device: " + err.message });
  }
};

/**
 * POST /api/devices/refresh
 * Body: { refreshToken }
 */
const refreshDeviceToken: RouteHandler = async (_req, res, body) => {
  const { refreshToken } = body ?? {};
  if (!refreshToken || typeof refreshToken !== "string") {
    return jsonResponse(res, 400, { error: "refreshToken is required" });
  }

  const db = getDb();
  const deviceRepo = new DeviceRepository(db);

  const result = await deviceRepo.refreshDeviceToken(refreshToken);
  if (!result) {
    return jsonResponse(res, 401, { error: "Invalid or expired refresh token" });
  }

  return jsonResponse(res, 200, {
    deviceToken: result.deviceToken,
    refreshToken: result.refreshToken,
  });
};

// ---------------------------------------------------------------------------
// Auth-guarded helpers
// ---------------------------------------------------------------------------

async function resolveAuth(req: IncomingMessage): Promise<{ userId: string } | null> {
  const token = getAuthToken(req);
  if (!token) return null;

  const db = getDb();
  const sessionRepo = new SessionRepository(db);
  const payload = sessionRepo.verifyAccessToken(token);
  if (!payload) return null;

  return { userId: payload.userId };
}

/**
 * GET /api/devices
 */
const listDevices: RouteHandler = async (req, res, _body) => {
  const auth = await resolveAuth(req);
  if (!auth) return jsonResponse(res, 401, { error: "Authentication required" });

  const db = getDb();
  const deviceRepo = new DeviceRepository(db);
  const devices = await deviceRepo.listDevices();
  return jsonResponse(res, 200, { devices });
};

/**
 * DELETE /api/devices/:id
 */
const revokeDevice: RouteHandler = async (req, res, _body) => {
  const auth = await resolveAuth(req);
  if (!auth) return jsonResponse(res, 401, { error: "Authentication required" });

  const url = new URL(req.url!, `http://${req.headers.host}`);
  const id = url.pathname.split("/").pop();
  if (!id) return jsonResponse(res, 400, { error: "Device ID required" });

  const db = getDb();
  const deviceRepo = new DeviceRepository(db);
  await deviceRepo.revokeDevice(id);
  return jsonResponse(res, 200, { success: true });
};

/**
 * GET /api/devices/:id
 */
const getDevice: RouteHandler = async (req, res, _body) => {
  const auth = await resolveAuth(req);
  if (!auth) return jsonResponse(res, 401, { error: "Authentication required" });

  const url = new URL(req.url!, `http://${req.headers.host}`);
  const id = url.pathname.split("/").pop();
  if (!id) return jsonResponse(res, 400, { error: "Device ID required" });

  const db = getDb();
  const deviceRepo = new DeviceRepository(db);
  const device = await deviceRepo.getDevice(id);
  if (!device) return jsonResponse(res, 404, { error: "Device not found" });
  return jsonResponse(res, 200, { device });
};

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

export interface DeviceRoutes {
  match(method: string, pathname: string): RouteHandler | null;
}

export function createDeviceRoutes(): DeviceRoutes {
  return {
    match(method: string, pathname: string): RouteHandler | null {
      // PIN generation (localhost only)
      if (method === "POST" && pathname === "/api/lan/generate-pin") return generatePinHandler;

      // LAN pairing
      if (method === "POST" && pathname === "/api/lan/pair") return lanPairHandler;

      // Device token refresh (public — only needs a valid refresh token)
      if (method === "POST" && pathname === "/api/devices/refresh") return refreshDeviceToken;

      // Auth-guarded device management
      if (method === "GET" && pathname === "/api/devices") return listDevices;
      if (method === "GET" && pathname.startsWith("/api/devices/")) return getDevice;
      if (method === "DELETE" && pathname.startsWith("/api/devices/")) return revokeDevice;

      return null;
    },
  };
}
