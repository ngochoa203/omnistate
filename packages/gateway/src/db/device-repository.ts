import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config/jwt-secret.js";

const JWT_SECRET = getJwtSecret();
const DEVICE_TOKEN_EXPIRY = "30d";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DeviceType = "android" | "ios" | "web" | "cli";
export type PairedVia = "lan_pin" | "qr_code" | "manual";

export interface DeviceInfo {
  id: string;
  deviceName: string;
  deviceType: DeviceType;
  userId: string | null;
  pairedVia: PairedVia;
  tailscaleIp: string | null;
  lastSeenAt: string | null;
  lastSeenIp: string | null;
  isRevoked: boolean;
  createdAt: string;
}

export interface RegisterDeviceOpts {
  deviceName: string;
  deviceType?: DeviceType;
  userId?: string;
  pairedVia?: PairedVia;
  tailscaleIp?: string;
  /** IP address of the registering client — stored as initial last_seen_ip */
  ipAddress?: string;
}

export interface RegisterDeviceResult {
  deviceId: string;
  deviceToken: string;
  refreshToken: string;
}

export interface DeviceTokenPayload {
  deviceId: string;
  type: "device";
}

// ── Raw DB row ────────────────────────────────────────────────────────────────

interface DeviceRow {
  id: string;
  device_name: string;
  device_type: string;
  device_token: string;
  refresh_token: string | null;
  user_id: string | null;
  paired_via: string;
  tailscale_ip: string | null;
  last_seen_at: string | null;
  last_seen_ip: string | null;
  is_revoked: number;
  created_at: string;
  updated_at: string;
}

function rowToDeviceInfo(row: DeviceRow): DeviceInfo {
  return {
    id: row.id,
    deviceName: row.device_name,
    deviceType: row.device_type as DeviceType,
    userId: row.user_id,
    pairedVia: row.paired_via as PairedVia,
    tailscaleIp: row.tailscale_ip,
    lastSeenAt: row.last_seen_at,
    lastSeenIp: row.last_seen_ip,
    isRevoked: row.is_revoked === 1,
    createdAt: row.created_at,
  };
}

// ── Repository ────────────────────────────────────────────────────────────────

export class DeviceRepository {
  constructor(private db: Database.Database) {}

  // Register a new device and return its long-lived tokens
  registerDevice(opts: RegisterDeviceOpts): RegisterDeviceResult {
    const deviceId = uuid();
    const refreshToken = uuid();
    const deviceType: DeviceType = opts.deviceType ?? "android";
    const pairedVia: PairedVia = opts.pairedVia ?? "lan_pin";
    const now = new Date().toISOString();

    const deviceToken = jwt.sign(
      { deviceId, type: "device" } satisfies DeviceTokenPayload,
      JWT_SECRET,
      { expiresIn: DEVICE_TOKEN_EXPIRY, subject: deviceId }
    );

    this.db.prepare(`
      INSERT INTO registered_devices (
        id, device_name, device_type, device_token, refresh_token,
        user_id, paired_via, tailscale_ip, last_seen_ip,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      deviceId,
      opts.deviceName,
      deviceType,
      deviceToken,
      refreshToken,
      opts.userId ?? null,
      pairedVia,
      opts.tailscaleIp ?? null,
      opts.ipAddress ?? null,
      now,
      now,
    );

    return { deviceId, deviceToken, refreshToken };
  }

  // Verify a device JWT; returns DeviceInfo on success, null otherwise
  verifyDeviceToken(token: string): DeviceInfo | null {
    let payload: DeviceTokenPayload;
    try {
      payload = jwt.verify(token, JWT_SECRET) as DeviceTokenPayload;
    } catch {
      return null;
    }

    if (payload.type !== "device" || !payload.deviceId) return null;

    const row = this.db.prepare(
      "SELECT * FROM registered_devices WHERE id = ? AND device_token = ? AND is_revoked = 0"
    ).get(payload.deviceId, token) as DeviceRow | undefined;

    if (!row) return null;

    // Touch last_seen_at
    this.db.prepare(
      "UPDATE registered_devices SET last_seen_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(row.id);

    return rowToDeviceInfo(row);
  }

  // Rotate both tokens using the 90-day refresh token
  refreshDeviceToken(refreshToken: string): { deviceToken: string; refreshToken: string } | null {
    const row = this.db.prepare(
      "SELECT * FROM registered_devices WHERE refresh_token = ? AND is_revoked = 0"
    ).get(refreshToken) as DeviceRow | undefined;

    if (!row) return null;

    const newRefreshToken = uuid();
    const newDeviceToken = jwt.sign(
      { deviceId: row.id, type: "device" } satisfies DeviceTokenPayload,
      JWT_SECRET,
      { expiresIn: DEVICE_TOKEN_EXPIRY, subject: row.id }
    );

    this.db.prepare(`
      UPDATE registered_devices
      SET device_token = ?, refresh_token = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newDeviceToken, newRefreshToken, row.id);

    return { deviceToken: newDeviceToken, refreshToken: newRefreshToken };
  }

  // Soft-revoke a device — it can no longer authenticate
  revokeDevice(deviceId: string): boolean {
    const result = this.db.prepare(
      "UPDATE registered_devices SET is_revoked = 1, updated_at = datetime('now') WHERE id = ?"
    ).run(deviceId);
    return result.changes > 0;
  }

  // List all active (non-revoked) devices, optionally filtered by user
  listDevices(userId?: string): DeviceInfo[] {
    if (userId !== undefined) {
      return (
        this.db.prepare(
          "SELECT * FROM registered_devices WHERE user_id = ? AND is_revoked = 0 ORDER BY created_at DESC"
        ).all(userId) as DeviceRow[]
      ).map(rowToDeviceInfo);
    }
    return (
      this.db.prepare(
        "SELECT * FROM registered_devices WHERE is_revoked = 0 ORDER BY created_at DESC"
      ).all() as DeviceRow[]
    ).map(rowToDeviceInfo);
  }

  // Update last-seen metadata (called on each authenticated request)
  updateDeviceLastSeen(deviceId: string, ip: string): void {
    this.db.prepare(`
      UPDATE registered_devices
      SET last_seen_at = datetime('now'), last_seen_ip = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(ip, deviceId);
  }

  // Fetch a single device by ID regardless of revoke status
  getDevice(deviceId: string): DeviceInfo | null {
    const row = this.db.prepare(
      "SELECT * FROM registered_devices WHERE id = ?"
    ).get(deviceId) as DeviceRow | undefined;
    return row ? rowToDeviceInfo(row) : null;
  }
}
