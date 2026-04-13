// ---------------------------------------------------------------------------
// TokenManager — device token lifecycle for OmniState remote connections
// ---------------------------------------------------------------------------

export interface PairResult {
  deviceId: string;
  deviceToken: string;
  refreshToken: string;
}

export interface NetworkInfo {
  lan: string | null;
  tailscale: string | null;
  gatewayPort: number;
  httpPort: number;
}

export interface RefreshResult {
  deviceToken: string;
  refreshToken: string;
}

export class TokenManager {
  constructor(private readonly httpBaseUrl: string) {}

  // -------------------------------------------------------------------------
  // Token refresh — call /api/devices/refresh with the stored refresh token
  // -------------------------------------------------------------------------
  async refreshToken(refreshToken: string): Promise<RefreshResult | null> {
    try {
      const res = await fetch(`${this.httpBaseUrl}/api/devices/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.deviceToken || !data.refreshToken) return null;
      return { deviceToken: data.deviceToken, refreshToken: data.refreshToken };
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // isTokenExpiring — decode JWT payload (base64url), check exp within 24h
  // Returns true if token is missing, malformed, already expired, or expires
  // within the next 24 hours.
  // -------------------------------------------------------------------------
  isTokenExpiring(token: string): boolean {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return true;

      // base64url → base64 → JSON
      const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const jsonStr = atob(padded.padEnd(padded.length + (4 - (padded.length % 4)) % 4, "="));
      const payload = JSON.parse(jsonStr) as { exp?: number };

      if (typeof payload.exp !== "number") return true;

      const nowSeconds = Math.floor(Date.now() / 1000);
      const twentyFourHours = 60 * 60 * 24;
      return payload.exp - nowSeconds < twentyFourHours;
    } catch {
      return true;
    }
  }

  // -------------------------------------------------------------------------
  // pairDevice — POST /api/lan/pair with PIN (must be on LAN)
  // -------------------------------------------------------------------------
  async pairDevice(
    pin: string,
    deviceName: string,
    deviceType: string
  ): Promise<PairResult | null> {
    try {
      const res = await fetch(`${this.httpBaseUrl}/api/lan/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, deviceName, deviceType }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.deviceId || !data.deviceToken || !data.refreshToken) return null;
      return {
        deviceId: data.deviceId,
        deviceToken: data.deviceToken,
        refreshToken: data.refreshToken,
      };
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // getNetworkInfo — GET /api/network/info (requires device token)
  // -------------------------------------------------------------------------
  async getNetworkInfo(token: string): Promise<NetworkInfo | null> {
    try {
      const res = await fetch(`${this.httpBaseUrl}/api/network/info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }
}
