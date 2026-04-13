import { execSync } from "node:child_process";
import { networkInterfaces } from "node:os";

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  ip: string | null;       // e.g. "100.64.1.23"
  hostname: string | null; // e.g. "hoahn-macbook"
  magicDns: string | null; // e.g. "hoahn-macbook.tail12345.ts.net"
  online: boolean;
}

export interface NetworkInfo {
  lan: { ip: string; interface: string }[];
  tailscale: TailscaleStatus;
  gatewayPort: number;   // 19800
  httpPort: number;      // 19801
}

// ─── Cache ────────────────────────────────────────────────────────────────────

let _cache: { status: TailscaleStatus; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

// ─── Core detection ──────────────────────────────────────────────────────────

/**
 * Detect Tailscale status by running `tailscale status --json`.
 * Result is cached for 30 seconds to avoid repeated exec calls.
 */
export function getTailscaleStatus(): TailscaleStatus {
  const now = Date.now();
  if (_cache && now < _cache.expiresAt) {
    return _cache.status;
  }

  const status = _detectTailscale();
  _cache = { status, expiresAt: now + CACHE_TTL_MS };
  return status;
}

/** Invalidate the cache (useful for tests). */
export function clearTailscaleCache(): void {
  _cache = null;
}

function _detectTailscale(): TailscaleStatus {
  // Step 1 — is tailscale installed?
  let installed = false;
  try {
    execSync("which tailscale", { stdio: "ignore", timeout: 3_000 });
    installed = true;
  } catch {
    return { installed: false, running: false, ip: null, hostname: null, magicDns: null, online: false };
  }

  // Step 2 — is the daemon running and can we query it?
  let raw: string;
  try {
    raw = execSync("tailscale status --json", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      encoding: "utf8",
    });
  } catch (err: any) {
    // tailscale installed but daemon not running, or permission denied
    const msg: string = err?.stderr ?? err?.message ?? "";
    const notRunning =
      msg.includes("connect: no such file") ||
      msg.includes("not running") ||
      msg.includes("daemon not running") ||
      msg.includes("is Tailscale running?");
    return { installed, running: !notRunning && false, ip: null, hostname: null, magicDns: null, online: false };
  }

  // Step 3 — parse JSON
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { installed, running: true, ip: null, hostname: null, magicDns: null, online: false };
  }

  const self = parsed?.Self ?? {};
  const ips: string[] = self.TailscaleIPs ?? [];
  const ip = ips.find((a: string) => a.includes(".")) ?? null; // prefer IPv4

  // DNSName typically ends with a dot — trim it
  const rawDns: string | null = self.DNSName ?? null;
  const magicDns = rawDns ? rawDns.replace(/\.$/, "") : null;

  return {
    installed,
    running: true,
    ip,
    hostname: self.HostName ?? null,
    magicDns,
    online: Boolean(self.Online),
  };
}

// ─── IP range helpers ─────────────────────────────────────────────────────────

/**
 * Return true if the given IP is in the Tailscale CGNAT range 100.64.0.0/10
 * (100.64.0.0 – 100.127.255.255).
 */
export function isTailscaleIp(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const a = parseInt(parts[0]!, 10);
  const b = parseInt(parts[1]!, 10);
  if (isNaN(a) || isNaN(b)) return false;
  // 100.64/10 covers 100.64.x.x – 100.127.x.x
  return a === 100 && b >= 64 && b <= 127;
}

// ─── Full network info ────────────────────────────────────────────────────────

/**
 * Collect LAN IPv4 addresses (non-internal, on common interface names) plus
 * the Tailscale status.
 */
export function getLocalNetworkInfo(gatewayPort = 19800, httpPort = 19801): NetworkInfo {
  const lan: { ip: string; interface: string }[] = [];
  const ifaces = networkInterfaces();

  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries) continue;
    // Skip loopback and virtual/docker bridges; keep physical + VPN-like ifaces
    if (name.startsWith("lo")) continue;
    if (name.startsWith("utun") || name.startsWith("ipsec")) continue;

    for (const entry of entries) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (isTailscaleIp(entry.address)) continue; // tailscale reported separately
      lan.push({ ip: entry.address, interface: name });
    }
  }

  return {
    lan,
    tailscale: getTailscaleStatus(),
    gatewayPort,
    httpPort,
  };
}
