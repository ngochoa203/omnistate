# Phase 3: Tailscale-Based Remote Access

> **Status:** Planning  
> **Depends on:** Phase 1 (macOS app) ✅, Phase 2 (Android RN app) ✅  
> **Goal:** Android app can control the Mac gateway from any network via Tailscale VPN.

---

## Table of Contents

1. [Security Model](#security-model)
2. [Architecture Overview](#architecture-overview)
3. [Sub-Phase 3A: Gateway Device Registration & Tailscale Awareness](#sub-phase-3a-gateway-device-registration--tailscale-awareness)
4. [Sub-Phase 3B: Android Remote Connection Flow](#sub-phase-3b-android-remote-connection-flow)
5. [Sub-Phase 3C: macOS App Tailscale UI & Polish](#sub-phase-3c-macos-app-tailscale-ui--polish)
6. [Migration & Backward Compatibility](#migration--backward-compatibility)
7. [Testing Strategy](#testing-strategy)

---

## Security Model

### Threat Model

Tailscale provides an encrypted WireGuard tunnel between devices on the same tailnet. This eliminates network-level eavesdropping. However, **we still need app-level auth** because:

1. Multiple devices may exist on the same tailnet (roommates, family, work VMs)
2. A compromised device on the tailnet should not automatically control the Mac
3. Token revocation must be possible from the Mac without removing Tailscale peers

### Device Trust Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                     FIRST TIME (LAN pairing)                        │
│                                                                      │
│  Android ──── same WiFi ────> Mac Gateway                            │
│     │                            │                                   │
│     │  POST /api/devices/register│                                   │
│     │  { pin, deviceName,        │                                   │
│     │    deviceId }              │                                   │
│     │ ─────────────────────────> │                                   │
│     │                            │  verify PIN                       │
│     │                            │  create device record             │
│     │                            │  generate device token (JWT)      │
│     │ <───────────────────────── │                                   │
│     │  { deviceToken,            │                                   │
│     │    refreshToken,           │                                   │
│     │    gatewayId }             │                                   │
│     │                            │                                   │
│     │  Store tokens in           │                                   │
│     │  AsyncStorage              │                                   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                   SUBSEQUENT (Remote via Tailscale)                   │
│                                                                      │
│  Android ──── Tailscale VPN ────> Mac Gateway (100.x.x.x:19800)     │
│     │                                │                               │
│     │  WS connect with              │                                │
│     │  deviceToken in auth           │                                │
│     │ ─────────────────────────────> │                                │
│     │                                │  verify device JWT             │
│     │                                │  check device not revoked      │
│     │                                │  allow connection              │
│     │ <───────────────────────────── │                                │
│     │  { type: "connected" }         │                                │
└──────────────────────────────────────────────────────────────────────┘
```

### Token Design

| Token | Lifetime | Purpose | Stored Where |
|-------|----------|---------|--------------|
| **Device Access Token** | 30 days | WS auth + HTTP API auth when remote | Android AsyncStorage |
| **Device Refresh Token** | 90 days | Rotate access token without re-pairing | Android AsyncStorage |
| **LAN PIN** | 5 minutes | One-time pairing on local network | Mac menu bar (display only) |

**Device Access Token JWT payload:**

```json
{
  "deviceId": "uuid",
  "deviceName": "Android — Pixel 7",
  "gatewayId": "uuid",
  "scope": "remote",
  "iat": 1713000000,
  "exp": 1715592000
}
```

### Revocation

- Device tokens reference a `registered_devices` table row
- Setting `is_revoked = 1` in the DB immediately blocks all connections
- The macOS menu bar shows a "Paired Devices" list with a revoke button
- Revoking a device also kills any active WebSocket from that `deviceId`

---

## Architecture Overview

```
┌─────────────┐     Tailscale        ┌──────────────────────────────┐
│  Android RN │◄───(100.x.x.x)────►│  macOS                       │
│  App        │                      │  ┌────────────────────────┐  │
│             │     LAN              │  │  Swift menu bar app    │  │
│             │◄──(192.168.x.x)───►│  │  (shows Tailscale IP)  │  │
│             │                      │  └───────────┬────────────┘  │
│  stores:    │                      │              │ spawns         │
│  connection │                      │  ┌───────────▼────────────┐  │
│  -store.ts  │                      │  │  Node.js Gateway       │  │
│  (zustand + │◄═══ WebSocket ═════►│  │  :19800 WS             │  │
│   persist)  │                      │  │  :19801 HTTP           │  │
│             │                      │  │                        │  │
│  mobile-    │                      │  │  NEW:                  │  │
│  core       │                      │  │  /api/devices/*        │  │
│             │                      │  │  /api/network/info     │  │
│             │                      │  │  tailscale0 detection  │  │
└─────────────┘                      │  └────────────────────────┘  │
                                     └──────────────────────────────┘
```

### Bind Address Change

Currently `config.gateway.bind` defaults to `"127.0.0.1"`. For Tailscale access, the gateway must listen on `0.0.0.0` (or at minimum the Tailscale interface). Phase 3A adds a `remote` config block to control this.

---

## Sub-Phase 3A: Gateway Device Registration & Tailscale Awareness

> **Owner:** coder-a (gateway + macOS)  
> **Duration:** ~3 days  
> **Prerequisite:** None

### Objectives

1. Gateway detects its Tailscale IP (tailscale0 / utun interface)
2. New `registered_devices` DB table + device registration API
3. `authenticateConnection()` accepts device tokens for remote connections
4. Health/network-info endpoint exposes LAN IP + Tailscale IP
5. Gateway binds to `0.0.0.0` when remote access is enabled

### File-Level Changes

#### New Files

| File | Purpose |
|------|---------|
| `packages/gateway/src/network/tailscale.ts` | Detect Tailscale IP, check `tailscale status --json`, MagicDNS hostname |
| `packages/gateway/src/db/device-repository.ts` | CRUD for `registered_devices` table, token generation, revocation |
| `packages/gateway/src/http/device-routes.ts` | HTTP routes: `POST /api/devices/register`, `POST /api/devices/refresh`, `GET /api/devices`, `DELETE /api/devices/:id` |
| `packages/gateway/src/http/network-routes.ts` | `GET /api/network/info` — returns `{ lanIp, tailscaleIp, magicDnsName, hostname }` |
| `packages/gateway/src/__tests__/device-registration.test.ts` | Unit tests for device repo + routes |
| `packages/gateway/src/__tests__/tailscale-detection.test.ts` | Unit tests for tailscale IP detection (mocked) |

#### Modified Files

| File | Change |
|------|--------|
| `packages/gateway/src/db/database.ts` | Add migration v6: `registered_devices` table |
| `packages/gateway/src/db/index.ts` | Export `DeviceRepository` |
| `packages/gateway/src/gateway/auth.ts` | Add Mode 4: device token verification. Call `DeviceRepository.verifyDeviceToken()`, check `is_revoked` flag |
| `packages/gateway/src/gateway/server.ts` | In `handleConnection()`: pass `req.socket.remoteAddress` to auth check; detect if connection is from tailscale subnet (100.64.0.0/10). In `start()`: register device-routes + network-routes on the HTTP server |
| `packages/gateway/src/gateway/protocol.ts` | Add `DeviceRegisterMessage` and `DeviceListMessage` to `ClientMessage` union (for WS-based device management from macOS UI) |
| `packages/gateway/src/config/schema.ts` | Add `gateway.remote` config block: `{ enabled: boolean, bindAll: boolean, tailscaleOnly: boolean }` |
| `packages/gateway/src/http/index.ts` | Export `createDeviceRoutes`, `createNetworkRoutes` |
| `packages/gateway/src/index.ts` | Export `DeviceRepository` |

#### Database Migration v6: `registered_devices`

```sql
CREATE TABLE IF NOT EXISTS registered_devices (
  id TEXT PRIMARY KEY,                    -- UUID
  device_name TEXT NOT NULL,              -- "Android — Pixel 7"
  device_id TEXT NOT NULL UNIQUE,         -- client-generated UUID, stable per install
  device_token_hash TEXT NOT NULL,        -- bcrypt hash of latest access token JTI
  refresh_token TEXT NOT NULL UNIQUE,     -- for token rotation
  refresh_expires_at TEXT NOT NULL,       -- 90-day expiry
  gateway_id TEXT NOT NULL,               -- this gateway's stable UUID
  is_revoked INTEGER NOT NULL DEFAULT 0,  -- soft-revoke
  paired_via TEXT NOT NULL DEFAULT 'lan', -- 'lan' | 'manual'
  paired_ip TEXT,                         -- IP used during pairing
  last_seen_at TEXT,
  last_seen_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON registered_devices(device_id);
CREATE INDEX IF NOT EXISTS idx_devices_refresh ON registered_devices(refresh_token);
```

#### `packages/gateway/src/network/tailscale.ts` — Key Functions

```typescript
export interface TailscaleInfo {
  available: boolean;
  ip: string | null;          // 100.x.x.x
  hostname: string | null;    // MagicDNS name, e.g. "macbook.tail1234.ts.net"
  tailnetName: string | null; // e.g. "tail1234.ts.net"
  online: boolean;
}

/** Detect tailscale0 interface IP via `tailscale status --json`. */
export async function getTailscaleInfo(): Promise<TailscaleInfo>;

/** Get LAN IP from en0/en1 (Wi-Fi/Ethernet). */
export function getLanIp(): string | null;

/** Get all network addresses the gateway is reachable on. */
export async function getNetworkInfo(): Promise<{
  lanIp: string | null;
  tailscale: TailscaleInfo;
  hostname: string;
}>;
```

#### `packages/gateway/src/gateway/auth.ts` — Updated Logic

```typescript
export function authenticateConnection(
  token: string | undefined,
  config: GatewayConfig,
  isLocalhost: boolean,
  remoteAddress?: string      // NEW param
): AuthResult {
  // Mode 1: Local auto-approve (unchanged)
  // Mode 2: JWT session token (unchanged)
  // Mode 3: Legacy static token (unchanged)

  // Mode 4 (NEW): Device token
  if (token) {
    const db = getDb();
    const deviceRepo = new DeviceRepository(db);
    const device = deviceRepo.verifyDeviceToken(token);
    if (device && !device.is_revoked) {
      deviceRepo.touchDevice(device.id, remoteAddress);
      return { ok: true, deviceId: device.id, deviceName: device.device_name };
    }
  }

  return { ok: false, reason: "Invalid or expired authentication token" };
}
```

#### `packages/gateway/src/config/schema.ts` — New Config Block

```typescript
gateway: z.object({
  // ...existing fields...
  remote: z.object({
    enabled: z.boolean().default(false),
    bindAll: z.boolean().default(false),     // listen on 0.0.0.0
    tailscaleOnly: z.boolean().default(true),// reject non-tailscale remote IPs
  }).default({}),
}),
```

When `remote.enabled && remote.bindAll`, the gateway `start()` method overrides `config.gateway.bind` to `"0.0.0.0"`. When `remote.tailscaleOnly`, the auth layer rejects connections from non-100.64.0.0/10 remote IPs (unless localhost).

### Exit Criteria — 3A

- [ ] `tailscale status --json` is parsed; `GET /api/network/info` returns `{ lanIp, tailscaleIp, magicDnsName }`
- [ ] `POST /api/devices/register` accepts `{ pin, deviceName, deviceId }` and returns `{ deviceToken, refreshToken, gatewayId }`
- [ ] `POST /api/devices/refresh` rotates tokens
- [ ] `DELETE /api/devices/:id` soft-revokes; active WS from that device is terminated
- [ ] `GET /api/devices` lists all registered devices (for macOS UI)
- [ ] Gateway running with `remote.enabled: true` accepts WS connections from Tailscale IP using device token
- [ ] Gateway rejects non-tailscale remote IPs when `tailscaleOnly: true`
- [ ] Existing LAN pairing + JWT auth continue working (backward compat)
- [ ] All new code has unit tests; `pnpm --filter gateway test` passes

---

## Sub-Phase 3B: Android Remote Connection Flow

> **Owner:** coder-b (Android + mobile-core)  
> **Duration:** ~3 days  
> **Prerequisite:** 3A complete (device registration API available)

### Objectives

1. `GatewayClientCore` handles both `ws://192.168.x.x` and `ws://100.x.x.x` URLs
2. Connection store persists credentials + connection mode across app restarts
3. ConnectScreen has LAN / Remote toggle with distinct flows
4. SettingsScreen shows connection mode and Tailscale info
5. Token refresh logic runs on app foreground

### File-Level Changes

#### New Files

| File | Purpose |
|------|---------|
| `packages/mobile-core/src/device-identity.ts` | Generate + persist a stable `deviceId` (UUID v4, stored in AsyncStorage). Export `getDeviceId()`, `getDeviceName()` |
| `packages/mobile-core/src/token-manager.ts` | Token refresh logic: check expiry, call `/api/devices/refresh`, update stored tokens. Export `TokenManager` class |
| `apps/android/src/components/RemoteConnectForm.tsx` | UI for entering Tailscale IP or MagicDNS hostname, shown when mode = "remote" |
| `apps/android/src/components/ConnectionModeToggle.tsx` | Segmented control: LAN / Remote |
| `apps/android/src/hooks/useTokenRefresh.ts` | Hook that runs token refresh on mount + AppState "active" |

#### Modified Files

| File | Change |
|------|--------|
| `packages/mobile-core/src/gateway-client-core.ts` | Add `connectionMode: "lan" \| "remote"` to `GatewayClientOptions`. In `connect()`, if mode is remote and token is near-expiry, call `TokenManager.refresh()` before connecting. Add `getConnectionMode()` getter. Make `url` a mutable private field (already writable via `updateUrl`) |
| `packages/mobile-core/src/index.ts` | Export `TokenManager`, `getDeviceId`, `getDeviceName` |
| `apps/android/src/stores/connection-store.ts` | Major expansion (see below) |
| `apps/android/src/screens/ConnectScreen.tsx` | Add mode toggle, conditional rendering of LAN scan vs Remote form, PIN flow updates device registration endpoint |
| `apps/android/src/screens/SettingsScreen.tsx` | Add "Connection Mode" display, Tailscale IP display, "Registered Devices" section, "Forget This Gateway" button |
| `apps/android/src/screens/DashboardScreen.tsx` | Show connection mode badge (LAN / Remote) in header |
| `apps/android/src/navigation/AppNavigator.tsx` | No structural change, but ConnectScreen may need to handle deep link for Tailscale IP |

#### `apps/android/src/stores/connection-store.ts` — Expanded

```typescript
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GatewayClientCore, ConnectionState } from "@omnistate/mobile-core";

export type ConnectionMode = "lan" | "remote";

interface SavedGateway {
  id: string;            // gatewayId from pairing response
  name: string;          // e.g. "MacBook Pro"
  lanUrl: string | null; // ws://192.168.1.x:19800
  remoteUrl: string | null; // ws://100.x.x.x:19800 or ws://hostname.ts.net:19800
  deviceToken: string;
  refreshToken: string;
  tokenExpiresAt: number; // epoch ms
  pairedAt: number;
}

interface ConnectionStore {
  // ── Persisted ──
  mode: ConnectionMode;
  savedGateways: SavedGateway[];
  activeGatewayId: string | null;
  deviceId: string | null;

  // ── Ephemeral ──
  gatewayUrl: string | null;
  isConnected: boolean;
  connectionState: ConnectionState;
  client: GatewayClientCore | null;

  // ── Actions ──
  setMode: (mode: ConnectionMode) => void;
  saveGateway: (gateway: SavedGateway) => void;
  removeGateway: (id: string) => void;
  setActiveGateway: (id: string) => void;
  setGatewayUrl: (url: string) => void;
  setConnectionState: (state: ConnectionState) => void;
  setClient: (client: GatewayClientCore) => void;
  updateTokens: (gatewayId: string, deviceToken: string,
                  refreshToken: string, expiresAt: number) => void;
  disconnect: () => void;
  reconnect: () => void;
}
```

Key behaviors:
- `zustand/persist` with `AsyncStorage` adapter — survives app kill
- `reconnect()` picks the correct URL based on `mode` + `activeGatewayId`
- When mode switches, the active URL changes but the same token works (device tokens are mode-agnostic)

#### `apps/android/src/screens/ConnectScreen.tsx` — Updated Flow

```
┌───────────────────────────────────────────────┐
│       Connect to OmniState                     │
│                                                │
│   ┌────────────┐  ┌─────────────┐             │
│   │  🔵 LAN    │  │   Remote    │  ← toggle   │
│   └────────────┘  └─────────────┘             │
│                                                │
│   ─── LAN mode ───                             │
│   [Scanning for gateways...]                   │
│   ┌────────────────────────────┐               │
│   │ 🖥 MacBook Pro             │               │
│   │ 192.168.1.42:19800        │               │
│   └────────────────────────────┘               │
│   PIN: [______]                                │
│   [ Connect ]                                  │
│                                                │
│   ─── Remote mode ───                          │
│   Previously paired:                           │
│   ┌────────────────────────────┐               │
│   │ 🖥 MacBook Pro             │               │
│   │ 100.71.42.8:19800         │               │
│   │ Last connected 2h ago      │               │
│   │ [ Connect ]                │               │
│   └────────────────────────────┘               │
│                                                │
│   Or enter Tailscale IP:                       │
│   [100.___.___.___]                            │
│   [ Connect with saved token ]                 │
│                                                │
│   ℹ Both devices must have Tailscale           │
│     installed and be on the same tailnet       │
└───────────────────────────────────────────────┘
```

**LAN mode pairing** now calls the new `/api/devices/register` endpoint (instead of `/api/lan/pair`) which returns a persistent device token. The PIN flow UX is unchanged.

**Remote mode** uses the saved device token from a previous LAN pairing. If no saved gateways exist, shows a message directing the user to pair via LAN first.

#### `packages/mobile-core/src/token-manager.ts` — Key API

```typescript
export class TokenManager {
  constructor(
    private getHttpUrl: () => string,
    private getTokens: () => { deviceToken: string; refreshToken: string },
    private onTokensRefreshed: (deviceToken: string, refreshToken: string,
                                 expiresAt: number) => void,
  ) {}

  /** Check if current token needs refresh (< 24h remaining). */
  needsRefresh(): boolean;

  /** Call /api/devices/refresh and update stored tokens. */
  async refresh(): Promise<boolean>;

  /** Decode JWT expiry without verification (client-side check only). */
  static getExpiry(jwt: string): number;
}
```

### Exit Criteria — 3B

- [ ] ConnectScreen shows LAN/Remote toggle
- [ ] LAN pairing calls `/api/devices/register` and saves `{ deviceToken, refreshToken, gatewayId }` to AsyncStorage
- [ ] Remote mode lists previously paired gateways with "Connect" button
- [ ] Remote mode allows manual Tailscale IP entry for paired gateways
- [ ] `GatewayClientCore` connects via `ws://100.x.x.x:19800` using device token
- [ ] Token refresh runs on app foreground (< 24h remaining → auto refresh)
- [ ] Connection persists across app kills (AsyncStorage)
- [ ] `mode` toggle switches between LAN URL and Tailscale URL for the same gateway
- [ ] SettingsScreen shows connection mode, paired devices, "Forget" button
- [ ] Disconnecting + reconnecting works in both modes
- [ ] All new mobile-core code has unit tests

---

## Sub-Phase 3C: macOS App Tailscale UI & Polish

> **Owner:** coder-a (macOS + gateway)  
> **Duration:** ~2 days  
> **Prerequisite:** 3A complete; 3B in progress or complete

### Objectives

1. Menu bar shows Tailscale IP alongside LAN IP
2. Menu bar shows list of paired devices with revoke option
3. "Enable Remote Access" toggle in menu bar (flips `remote.enabled` in gateway config)
4. Gateway config is live-reloadable for remote access toggle
5. Connection from a new device triggers a macOS notification

### File-Level Changes

#### New Files

| File | Purpose |
|------|---------|
| `apps/macos/OmniState/OmniState/Services/TailscaleDetector.swift` | Polls `GET /api/network/info` from gateway HTTP API (localhost:19801). Publishes `tailscaleIp`, `magicDnsName`, `isAvailable` |
| `apps/macos/OmniState/OmniState/Services/DeviceManager.swift` | Polls `GET /api/devices` from gateway HTTP API. Lists paired devices. Calls `DELETE /api/devices/:id` for revocation |
| `apps/macos/OmniState/OmniState/Views/PairedDevicesView.swift` | SwiftUI view: list of paired devices with name, last seen, revoke button |

#### Modified Files

| File | Change |
|------|--------|
| `apps/macos/OmniState/OmniState/Views/MenuBarView.swift` | Add Tailscale IP row (from `TailscaleDetector`), remote access toggle, "Paired Devices" expandable section |
| `apps/macos/OmniState/OmniState/Services/GatewayManager.swift` | Parse Tailscale IP from gateway stdout (gateway prints it on startup). Pass `--remote` flag when remote access is enabled. Add `enableRemoteAccess()` / `disableRemoteAccess()` methods that restart gateway with updated config |
| `apps/macos/OmniState/OmniState/Services/HealthChecker.swift` | Extend health response parsing to include `tailscaleIp` field |
| `apps/macos/OmniState/OmniState/Services/NotificationBridge.swift` | Add `notifyNewDevice(name:)` — posts macOS notification when a new device pairs |

#### MenuBarView — Updated Layout

```
┌──────────────────────────────────┐
│ 🟢 Gateway Running               │
│ Uptime: 4h 22m                   │
│ Connections: 2                   │
│                                  │
│ ─────────────────────────────── │
│ LAN PIN: 847291                  │
│ LAN IP: 192.168.1.42            │
│                                  │
│ ─────────────────────────────── │
│ 🔵 Tailscale: Connected          │
│ IP: 100.71.42.8                  │
│ DNS: macbook.tail1234.ts.net     │
│                                  │
│ 🔒 Remote Access  [  ON ✓  ]    │
│                                  │
│ ─────────────────────────────── │
│ 📱 Paired Devices (1)            │
│ ┌──────────────────────────────┐ │
│ │ Android — Pixel 7            │ │
│ │ Last seen: 2m ago            │ │
│ │ [Revoke]                     │ │
│ └──────────────────────────────┘ │
│                                  │
│ ─────────────────────────────── │
│ [ Restart Gateway ]              │
│ [ Open Dashboard  ]  ⌘⇧O       │
│ [ Quit OmniState  ]  ⌘Q        │
└──────────────────────────────────┘
```

#### Gateway Startup Changes

When `remote.enabled: true`, the gateway logs:

```
[OmniState] Remote access enabled — binding to 0.0.0.0:19800
[OmniState] Tailscale IP: 100.71.42.8 (macbook.tail1234.ts.net)
[OmniState] LAN IP: 192.168.1.42
```

The macOS `GatewayManager.swift` parses these log lines (same pattern as existing LAN PIN parsing on line 113) to update `TailscaleDetector` published properties.

### Exit Criteria — 3C

- [ ] Menu bar shows Tailscale IP and MagicDNS name when Tailscale is connected
- [ ] Menu bar shows "Tailscale: Not connected" when offline
- [ ] "Remote Access" toggle starts/restarts gateway with `--remote` flag
- [ ] Paired devices list shows device name, last seen time
- [ ] "Revoke" button calls DELETE API and device is immediately disconnected
- [ ] macOS notification fires when a new device registers
- [ ] Gateway restart preserves remote-access setting (persisted to config file)

---

## Migration & Backward Compatibility

### What Doesn't Change

- **Web UI** (`packages/web/`): Connects via localhost, unaffected
- **CLI** (`packages/cli/`): Connects via localhost, unaffected
- **LAN pairing flow**: Still works; the new `/api/devices/register` endpoint supersedes `/api/lan/pair` but the old endpoint continues to work (returns a legacy token)
- **Existing JWT auth**: Sessions created via `/api/auth/signup` + `/api/auth/login` still work
- **Config defaults**: `remote.enabled: false` by default — zero behavior change unless opted in

### What Changes

| Before (Phase 2) | After (Phase 3) |
|---|---|
| Gateway binds to `127.0.0.1` | Gateway binds to `0.0.0.0` when `remote.enabled` |
| Auth: localhost auto-approve, JWT, static token | Auth: + device token (Mode 4) |
| Connection store: in-memory only | Connection store: persisted to AsyncStorage |
| ConnectScreen: LAN-only | ConnectScreen: LAN + Remote tabs |
| Menu bar: LAN PIN only | Menu bar: LAN PIN + Tailscale IP + paired devices |

### Database Migration

Migration v6 adds `registered_devices`. No existing tables are altered. Migration is auto-applied on gateway startup (existing pattern in `database.ts`).

---

## Testing Strategy

### Unit Tests (per sub-phase)

| Test File | Covers |
|-----------|--------|
| `gateway/__tests__/device-registration.test.ts` | DeviceRepository: create, verify, revoke, refresh, token hashing |
| `gateway/__tests__/tailscale-detection.test.ts` | `getTailscaleInfo()` with mocked exec — Tailscale present, absent, offline |
| `gateway/__tests__/auth-device-token.test.ts` | `authenticateConnection()` Mode 4: valid device token, revoked device, expired token |
| `gateway/__tests__/device-routes.test.ts` | HTTP routes: register, refresh, list, delete — with PIN validation |
| `mobile-core/__tests__/token-manager.test.ts` | Token refresh logic, expiry detection, error handling |
| `mobile-core/__tests__/device-identity.test.ts` | Stable deviceId generation and persistence |

### Integration Tests

| Scenario | How |
|----------|-----|
| LAN pair → remote connect | Start gateway with `remote.enabled`, pair via HTTP, then connect WS with device token from a non-localhost IP |
| Token refresh cycle | Pair, wait for near-expiry, call refresh, verify new token works |
| Device revocation | Pair, connect WS, revoke via API, verify WS is terminated |
| Tailscale IP detection | Mock `tailscale status --json` output, verify `/api/network/info` response |

### Manual QA Checklist

- [ ] Install Tailscale on Mac and Android
- [ ] Pair Android on same WiFi with LAN PIN
- [ ] Disable WiFi on Android (use mobile data only)
- [ ] Verify Tailscale shows both devices online
- [ ] Open OmniState Android → Remote tab → select saved gateway → Connect
- [ ] Send a task (e.g. "open Safari") and verify it executes on Mac
- [ ] Revoke device from Mac menu bar → verify Android disconnects
- [ ] Re-pair and verify fresh token works

---

## Summary Timeline

```
Week 1:
  Day 1-3 ── 3A: Gateway device registration + Tailscale detection (coder-a)
  Day 2-4 ── 3B: Android remote connection flow (coder-b, starts Day 2 with stub API)

Week 2:
  Day 5-6 ── 3C: macOS Tailscale UI + paired devices (coder-a)
  Day 5-6 ── 3B: Polish + token refresh + persistence (coder-b)
  Day 7   ── Integration testing + manual QA (both)
```

**Parallel work note:** coder-b can start 3B on Day 2 using a stub `/api/devices/register` response or a local mock server, then switch to the real API once 3A lands.

---

## Appendix: Gateway Startup Sequence (Phase 3)

```
1. loadDotEnv()
2. parseArgs()  ← now supports --remote flag
3. loadConfig()
4. If remote.enabled:
   a. Override bind to "0.0.0.0" (if bindAll)
   b. Detect Tailscale IP
   c. Log Tailscale IP + LAN IP
5. Port availability check
6. new OmniStateGateway(config)
7. gateway.start()
   a. WebSocketServer on 0.0.0.0:19800
   b. HTTP server on 0.0.0.0:19801
   c. Register device-routes, network-routes
   d. Start Siri bridge, wake listener, trigger engine
8. Health monitor
9. SIGINT/SIGTERM handlers
```
