import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { GatewayClientCore, ConnectionState } from "@omnistate/mobile-core";

// ---------------------------------------------------------------------------
// Simple in-memory storage adapter (replace with AsyncStorage in production)
// ---------------------------------------------------------------------------
const memoryStore = new Map<string, string>();

const storage = createJSONStorage(() => ({
  getItem: (name: string): string | null => memoryStore.get(name) ?? null,
  setItem: (name: string, value: string): void => { memoryStore.set(name, value); },
  removeItem: (name: string): void => { memoryStore.delete(name); },
}));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SavedGateway {
  id: string;
  name: string;
  lanUrl: string | null;       // ws://192.168.1.x:19800
  tailscaleUrl: string | null; // ws://100.64.x.x:19800
  magicDns: string | null;     // hostname.tailnet.ts.net
  lastConnected: string;       // ISO timestamp
}

interface ConnectionStore {
  // --- existing ---
  gatewayUrl: string | null;
  isConnected: boolean;
  connectionState: ConnectionState;
  /** Not persisted — recreated on app launch */
  client: GatewayClientCore | null;
  deviceName: string;
  /** Legacy LAN session token (short-lived) */
  lanToken: string | null;

  // --- NEW: connection mode ---
  connectionMode: "lan" | "remote";

  // --- NEW: device registration (long-lived) ---
  deviceId: string | null;
  deviceToken: string | null;
  refreshToken: string | null;

  // --- NEW: saved gateways ---
  savedGateways: SavedGateway[];

  // --- existing actions ---
  setGatewayUrl: (url: string) => void;
  setConnectionState: (state: ConnectionState) => void;
  setClient: (client: GatewayClientCore) => void;
  setLanToken: (token: string) => void;
  disconnect: () => void;

  // --- NEW actions ---
  setConnectionMode: (mode: "lan" | "remote") => void;
  saveDeviceCredentials: (creds: {
    deviceId: string;
    deviceToken: string;
    refreshToken: string;
  }) => void;
  clearDeviceCredentials: () => void;
  addSavedGateway: (gw: SavedGateway) => void;
  removeSavedGateway: (id: string) => void;
  updateSavedGateway: (id: string, updates: Partial<SavedGateway>) => void;
  /** Calls /api/devices/refresh and updates stored tokens. Returns true on success. */
  refreshDeviceTokenAction: () => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
export const useConnectionStore = create<ConnectionStore>()(
  persist(
    (set, get) => ({
      // --- state defaults ---
      gatewayUrl: null,
      isConnected: false,
      connectionState: "disconnected",
      client: null,         // never persisted (see partialize below)
      deviceName: "Android",
      lanToken: null,

      connectionMode: "lan",

      deviceId: null,
      deviceToken: null,
      refreshToken: null,

      savedGateways: [],

      // --- existing actions ---
      setGatewayUrl: (url) => set({ gatewayUrl: url }),

      setConnectionState: (state) =>
        set({ connectionState: state, isConnected: state === "connected" }),

      setClient: (client) => set({ client }),

      setLanToken: (token) => set({ lanToken: token }),

      disconnect: () => {
        get().client?.disconnect();
        set({
          client: null,
          isConnected: false,
          connectionState: "disconnected",
          gatewayUrl: null,
        });
      },

      // --- NEW actions ---
      setConnectionMode: (mode) => set({ connectionMode: mode }),

      saveDeviceCredentials: ({ deviceId, deviceToken, refreshToken }) =>
        set({ deviceId, deviceToken, refreshToken }),

      clearDeviceCredentials: () =>
        set({ deviceId: null, deviceToken: null, refreshToken: null }),

      addSavedGateway: (gw) =>
        set((s) => ({
          savedGateways: [
            ...s.savedGateways.filter((g) => g.id !== gw.id),
            gw,
          ],
        })),

      removeSavedGateway: (id) =>
        set((s) => ({ savedGateways: s.savedGateways.filter((g) => g.id !== id) })),

      updateSavedGateway: (id, updates) =>
        set((s) => ({
          savedGateways: s.savedGateways.map((g) =>
            g.id === id ? { ...g, ...updates } : g
          ),
        })),

      refreshDeviceTokenAction: async () => {
        const { refreshToken, gatewayUrl } = get();
        if (!refreshToken || !gatewayUrl) return false;

        // Derive HTTP base from ws URL: ws://host:port → http://host:(port+1)
        const httpBase = gatewayUrl
          .replace(/^ws:\/\//, "http://")
          .replace(/^wss:\/\//, "https://")
          .replace(/:(\d+)$/, (_, p) => `:${Number(p) + 1}`);

        try {
          const res = await fetch(`${httpBase}/api/devices/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken }),
          });
          if (!res.ok) return false;
          const data = await res.json();
          if (!data.deviceToken || !data.refreshToken) return false;
          set({ deviceToken: data.deviceToken, refreshToken: data.refreshToken });
          // Also update the live WS client token
          get().client?.updateToken(data.deviceToken);
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: "omnistate-connection",
      storage,
      // Never persist ephemeral WebSocket client instance
      partialize: (s) => {
        const { client: _client, ...rest } = s;
        return rest;
      },
    }
  )
);
