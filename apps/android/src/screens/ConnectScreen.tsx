import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Alert, ScrollView,
} from "react-native";
import { useConnectionStore, SavedGateway } from "../stores/connection-store";
import { GatewayClientCore } from "@omnistate/mobile-core";

interface DiscoveredGateway {
  name: string;
  host: string;
  port: number;
  txt?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Mode toggle component
// ---------------------------------------------------------------------------
function ModeToggle({
  mode,
  onChange,
}: {
  mode: "lan" | "remote";
  onChange: (m: "lan" | "remote") => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <TouchableOpacity
        style={[styles.toggleBtn, mode === "lan" && styles.toggleBtnActive]}
        onPress={() => onChange("lan")}
      >
        <Text style={[styles.toggleBtnText, mode === "lan" && styles.toggleBtnTextActive]}>
          LAN
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.toggleBtn, mode === "remote" && styles.toggleBtnActive]}
        onPress={() => onChange("remote")}
      >
        <Text style={[styles.toggleBtnText, mode === "remote" && styles.toggleBtnTextActive]}>
          Remote
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Remote panel
// ---------------------------------------------------------------------------
function RemotePanel() {
  const [remoteHost, setRemoteHost] = useState("");
  const [connecting, setConnecting] = useState(false);

  const deviceToken = useConnectionStore((s) => s.deviceToken);
  const deviceId = useConnectionStore((s) => s.deviceId);
  const savedGateways = useConnectionStore((s) => s.savedGateways);
  const setClient = useConnectionStore((s) => s.setClient);
  const setGatewayUrl = useConnectionStore((s) => s.setGatewayUrl);
  const setConnectionState = useConnectionStore((s) => s.setConnectionState);
  const removeSavedGateway = useConnectionStore((s) => s.removeSavedGateway);
  const addSavedGateway = useConnectionStore((s) => s.addSavedGateway);
  const refreshDeviceTokenAction = useConnectionStore((s) => s.refreshDeviceTokenAction);

  const connectRemote = useCallback(
    async (wsUrl: string, gatewayName: string) => {
      if (!deviceToken || !deviceId) return;

      setConnecting(true);
      try {
        // Proactively refresh if token is close to expiry
        await refreshDeviceTokenAction();
        const freshToken = useConnectionStore.getState().deviceToken ?? deviceToken;

        const client = new GatewayClientCore({
          url: wsUrl,
          role: "remote",
          token: freshToken,
          tokenType: "device",
          deviceId,
          onStateChange: setConnectionState,
          onTokenExpiring: () => {
            // Background refresh — don't block UX
            refreshDeviceTokenAction();
          },
        });

        setClient(client);
        setGatewayUrl(wsUrl);
        client.connect();

        // Persist/update this gateway in saved list
        const existing = useConnectionStore
          .getState()
          .savedGateways.find((g) => g.tailscaleUrl === wsUrl || g.magicDns === wsUrl);
        addSavedGateway({
          id: existing?.id ?? `gw-${Date.now()}`,
          name: existing?.name ?? gatewayName,
          lanUrl: existing?.lanUrl ?? null,
          tailscaleUrl: wsUrl.startsWith("ws://100.") ? wsUrl : (existing?.tailscaleUrl ?? null),
          magicDns: !wsUrl.startsWith("ws://100.") ? wsUrl : (existing?.magicDns ?? null),
          lastConnected: new Date().toISOString(),
        });
      } finally {
        setConnecting(false);
      }
    },
    [deviceToken, deviceId, setClient, setGatewayUrl, setConnectionState,
      refreshDeviceTokenAction, addSavedGateway]
  );

  const handleManualRemoteConnect = () => {
    const host = remoteHost.trim();
    if (!host) {
      Alert.alert("Error", "Enter a Tailscale IP or MagicDNS hostname");
      return;
    }
    // Accept bare IPs/hostnames — prepend ws:// and append default port
    const wsUrl = host.startsWith("ws://") || host.startsWith("wss://")
      ? host
      : `ws://${host}:19800`;
    connectRemote(wsUrl, host);
  };

  if (!deviceToken) {
    return (
      <View style={styles.infoBox}>
        <Text style={styles.infoIcon}>🔒</Text>
        <Text style={styles.infoTitle}>Pair on LAN first</Text>
        <Text style={styles.infoText}>
          Switch to LAN mode and connect once with a PIN.
          Remote access will work automatically after that.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.remoteScroll} contentContainerStyle={styles.remoteContent}>
      {/* Manual Tailscale host entry */}
      <Text style={styles.sectionLabel}>Tailscale IP or MagicDNS</Text>
      <View style={styles.rowInput}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={remoteHost}
          onChangeText={setRemoteHost}
          placeholder="100.64.x.x  or  mymac.tailnet.ts.net"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.connectButton, styles.connectButtonSmall]}
          onPress={handleManualRemoteConnect}
          disabled={connecting}
        >
          {connecting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.connectButtonText}>Go</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Saved gateways */}
      {savedGateways.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Saved Gateways</Text>
          {savedGateways
            .slice()
            .sort((a, b) => b.lastConnected.localeCompare(a.lastConnected))
            .map((gw) => (
              <SavedGatewayCard
                key={gw.id}
                gateway={gw}
                connecting={connecting}
                onConnect={() => {
                  const url = gw.tailscaleUrl
                    ?? (gw.magicDns ? `ws://${gw.magicDns}:19800` : null);
                  if (!url) {
                    Alert.alert("No remote URL", "No Tailscale URL for this gateway.");
                    return;
                  }
                  connectRemote(url, gw.name);
                }}
                onRemove={() => removeSavedGateway(gw.id)}
              />
            ))}
        </>
      )}
    </ScrollView>
  );
}

function SavedGatewayCard({
  gateway,
  connecting,
  onConnect,
  onRemove,
}: {
  gateway: SavedGateway;
  connecting: boolean;
  onConnect: () => void;
  onRemove: () => void;
}) {
  const remoteUrl = gateway.tailscaleUrl
    ?? (gateway.magicDns ? `ws://${gateway.magicDns}:19800` : null);
  const lastSeen = gateway.lastConnected
    ? new Date(gateway.lastConnected).toLocaleDateString()
    : "never";

  return (
    <View style={styles.savedCard}>
      <View style={styles.savedCardInfo}>
        <Text style={styles.savedCardName}>{gateway.name}</Text>
        {remoteUrl && (
          <Text style={styles.savedCardUrl} numberOfLines={1}>{remoteUrl}</Text>
        )}
        <Text style={styles.savedCardDate}>Last: {lastSeen}</Text>
      </View>
      <View style={styles.savedCardActions}>
        <TouchableOpacity
          style={[styles.savedConnectBtn, (!remoteUrl || connecting) && styles.savedConnectBtnDisabled]}
          onPress={onConnect}
          disabled={connecting || !remoteUrl}
        >
          <Text style={styles.savedConnectBtnText}>Connect</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.savedRemoveBtn} onPress={onRemove}>
          <Text style={styles.savedRemoveBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// LAN panel (original logic, extracted into its own component)
// ---------------------------------------------------------------------------
function LanPanel() {
  const [scanning, setScanning] = useState(false);
  const [gateways, setGateways] = useState<DiscoveredGateway[]>([]);
  const [manualIp, setManualIp] = useState("");
  const [manualPort, setManualPort] = useState("19800");
  const [pin, setPin] = useState("");
  const [pairing, setPairing] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [selectedGateway, setSelectedGateway] = useState<DiscoveredGateway | null>(null);

  const setGatewayUrl = useConnectionStore((s) => s.setGatewayUrl);
  const setClient = useConnectionStore((s) => s.setClient);
  const setConnectionState = useConnectionStore((s) => s.setConnectionState);
  const setLanToken = useConnectionStore((s) => s.setLanToken);
  const saveDeviceCredentials = useConnectionStore((s) => s.saveDeviceCredentials);
  const addSavedGateway = useConnectionStore((s) => s.addSavedGateway);

  const startScan = useCallback(() => {
    setScanning(true);
    setGateways([]);

    try {
      const Zeroconf = require("react-native-zeroconf").default;
      const zeroconf = new Zeroconf();

      zeroconf.on("resolved", (service: any) => {
        if (service.name?.includes("OmniState")) {
          setGateways((prev) => {
            if (prev.some((g) => g.host === service.host)) return prev;
            return [...prev, {
              name: service.name,
              host: service.host,
              port: service.port || 19800,
              txt: service.txt,
            }];
          });
        }
      });

      zeroconf.scan("omnistate", "tcp", "local.");

      setTimeout(() => {
        zeroconf.stop();
        setScanning(false);
      }, 10000);
    } catch {
      setScanning(false);
      setShowManual(true);
    }
  }, []);

  useEffect(() => {
    startScan();
  }, [startScan]);

  const connectToGateway = async (host: string, port: number) => {
    const wsUrl = `ws://${host}:${port}`;
    const httpUrl = `http://${host}:${Number(port) + 1}`;
    const trimmedPin = pin.trim();

    if (trimmedPin) {
      setPairing(true);
      try {
        const res = await fetch(`${httpUrl}/api/lan/pair`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pin: trimmedPin,
            deviceName: useConnectionStore.getState().deviceName,
            deviceType: "android",
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          Alert.alert("Pairing Failed", data.error || "Invalid PIN");
          setPairing(false);
          return;
        }

        // Phase 3B: new pair response includes deviceId + long-lived tokens
        if (data.deviceId && data.deviceToken && data.refreshToken) {
          saveDeviceCredentials({
            deviceId: data.deviceId,
            deviceToken: data.deviceToken,
            refreshToken: data.refreshToken,
          });
          addSavedGateway({
            id: data.deviceId,
            name: host,
            lanUrl: wsUrl,
            tailscaleUrl: null,
            magicDns: null,
            lastConnected: new Date().toISOString(),
          });
          setLanToken(data.deviceToken);
        } else if (data.token) {
          // Legacy single-token response
          setLanToken(data.token);
        } else {
          Alert.alert("Pairing Failed", data.error || "No token received");
          setPairing(false);
          return;
        }
      } catch (err: any) {
        Alert.alert("Connection Error", err.message);
        setPairing(false);
        return;
      }
      setPairing(false);
    }

    const { deviceId, deviceToken } = useConnectionStore.getState();
    const client = new GatewayClientCore({
      url: wsUrl,
      role: "remote",
      token: deviceToken ?? useConnectionStore.getState().lanToken ?? undefined,
      tokenType: deviceId ? "device" : "session",
      deviceId: deviceId ?? undefined,
      onStateChange: setConnectionState,
    });

    setClient(client);
    setGatewayUrl(wsUrl);
    client.connect();
  };

  const handleManualConnect = () => {
    if (!manualIp.trim()) {
      Alert.alert("Error", "Please enter the gateway IP address");
      return;
    }
    connectToGateway(manualIp.trim(), parseInt(manualPort, 10) || 19800);
  };

  return (
    <View style={styles.lanPanel}>
      {scanning && (
        <View style={styles.scanningRow}>
          <ActivityIndicator color="#60a5fa" />
          <Text style={styles.scanningText}>Scanning network...</Text>
        </View>
      )}

      {gateways.length > 0 && (
        <FlatList
          data={gateways}
          keyExtractor={(item) => `${item.host}:${item.port}`}
          style={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.gatewayCard, selectedGateway?.host === item.host && styles.gatewaySelected]}
              onPress={() => setSelectedGateway(item)}
            >
              <Text style={styles.gatewayName}>{item.name}</Text>
              <Text style={styles.gatewayHost}>{item.host}:{item.port}</Text>
              {item.txt?.version && (
                <Text style={styles.gatewayVersion}>v{item.txt.version}</Text>
              )}
            </TouchableOpacity>
          )}
        />
      )}

      {!scanning && gateways.length === 0 && (
        <Text style={styles.noResults}>No gateways found on network</Text>
      )}

      {selectedGateway && (
        <View style={styles.pinSection}>
          <Text style={styles.pinLabel}>Enter PIN from Mac menu bar:</Text>
          <TextInput
            style={styles.pinInput}
            value={pin}
            onChangeText={setPin}
            placeholder="000000"
            placeholderTextColor="#64748b"
            keyboardType="number-pad"
            maxLength={6}
            textAlign="center"
          />
          <TouchableOpacity
            style={styles.connectButton}
            onPress={() => connectToGateway(selectedGateway.host, selectedGateway.port)}
            disabled={pairing}
          >
            {pairing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.connectButtonText}>Connect</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity onPress={() => setShowManual(!showManual)}>
        <Text style={styles.manualToggle}>
          {showManual ? "Hide manual entry" : "Enter IP manually"}
        </Text>
      </TouchableOpacity>

      {showManual && (
        <View style={styles.manualSection}>
          <TextInput
            style={styles.input}
            value={manualIp}
            onChangeText={setManualIp}
            placeholder="192.168.1.100"
            placeholderTextColor="#64748b"
            keyboardType="numeric"
          />
          <TextInput
            style={[styles.input, styles.portInput]}
            value={manualPort}
            onChangeText={setManualPort}
            placeholder="19800"
            placeholderTextColor="#64748b"
            keyboardType="number-pad"
          />
          <TextInput
            style={styles.input}
            value={pin}
            onChangeText={setPin}
            placeholder="PIN (optional)"
            placeholderTextColor="#64748b"
            keyboardType="number-pad"
            maxLength={6}
          />
          <TouchableOpacity style={styles.connectButton} onPress={handleManualConnect}>
            <Text style={styles.connectButtonText}>Connect</Text>
          </TouchableOpacity>
        </View>
      )}

      {!scanning && (
        <TouchableOpacity style={styles.rescanButton} onPress={startScan}>
          <Text style={styles.rescanText}>Scan Again</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main ConnectScreen
// ---------------------------------------------------------------------------
export function ConnectScreen() {
  const connectionMode = useConnectionStore((s) => s.connectionMode);
  const setConnectionMode = useConnectionStore((s) => s.setConnectionMode);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connect to OmniState</Text>
      <Text style={styles.subtitle}>
        {connectionMode === "lan"
          ? "Find your Mac on the local network"
          : "Connect via Tailscale from anywhere"}
      </Text>

      <ModeToggle mode={connectionMode} onChange={setConnectionMode} />

      {connectionMode === "lan" ? <LanPanel /> : <RemotePanel />}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", padding: 24, justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "bold", color: "#f1f5f9", textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#94a3b8", textAlign: "center", marginBottom: 20 },

  // mode toggle
  toggleRow: { flexDirection: "row", backgroundColor: "#1e293b", borderRadius: 10, padding: 4, marginBottom: 24, alignSelf: "center" },
  toggleBtn: { paddingVertical: 8, paddingHorizontal: 28, borderRadius: 8 },
  toggleBtnActive: { backgroundColor: "#2563eb" },
  toggleBtnText: { fontSize: 14, fontWeight: "600", color: "#64748b" },
  toggleBtnTextActive: { color: "#fff" },

  // LAN panel
  lanPanel: { flex: 1 },
  scanningRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  scanningText: { color: "#60a5fa", marginLeft: 8, fontSize: 14 },
  list: { maxHeight: 200, marginBottom: 16 },
  gatewayCard: { backgroundColor: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: "#334155" },
  gatewaySelected: { borderColor: "#60a5fa" },
  gatewayName: { fontSize: 16, fontWeight: "600", color: "#f1f5f9" },
  gatewayHost: { fontSize: 13, color: "#94a3b8", marginTop: 4 },
  gatewayVersion: { fontSize: 11, color: "#64748b", marginTop: 2 },
  noResults: { color: "#64748b", textAlign: "center", marginBottom: 24 },
  pinSection: { alignItems: "center", marginBottom: 24 },
  pinLabel: { color: "#94a3b8", marginBottom: 8, fontSize: 14 },
  pinInput: { backgroundColor: "#1e293b", color: "#f1f5f9", fontSize: 24, fontFamily: "monospace", borderRadius: 8, padding: 12, width: 160, borderWidth: 1, borderColor: "#334155", letterSpacing: 8 },
  connectButton: { backgroundColor: "#2563eb", borderRadius: 8, paddingVertical: 14, paddingHorizontal: 32, marginTop: 16, minWidth: 160, alignItems: "center" },
  connectButtonSmall: { paddingVertical: 14, paddingHorizontal: 20, marginTop: 0, minWidth: 0 },
  connectButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  manualToggle: { color: "#60a5fa", textAlign: "center", marginVertical: 16, fontSize: 14 },
  manualSection: { gap: 12, marginBottom: 16 },
  input: { backgroundColor: "#1e293b", color: "#f1f5f9", borderRadius: 8, padding: 14, fontSize: 16, borderWidth: 1, borderColor: "#334155" },
  portInput: { width: 120 },
  rescanButton: { marginTop: 16, alignItems: "center", padding: 12 },
  rescanText: { color: "#94a3b8", fontSize: 14 },

  // Remote panel
  remoteScroll: { flex: 1 },
  remoteContent: { paddingBottom: 32 },
  sectionLabel: { color: "#94a3b8", fontSize: 13, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  rowInput: { flexDirection: "row", gap: 8, alignItems: "center" },
  infoBox: { backgroundColor: "#1e293b", borderRadius: 16, padding: 24, alignItems: "center", marginTop: 16 },
  infoIcon: { fontSize: 32, marginBottom: 12 },
  infoTitle: { fontSize: 18, fontWeight: "700", color: "#f1f5f9", marginBottom: 8 },
  infoText: { fontSize: 14, color: "#94a3b8", textAlign: "center", lineHeight: 20 },

  // Saved gateway cards
  savedCard: { backgroundColor: "#1e293b", borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#334155", flexDirection: "row", alignItems: "center" },
  savedCardInfo: { flex: 1 },
  savedCardName: { fontSize: 15, fontWeight: "600", color: "#f1f5f9" },
  savedCardUrl: { fontSize: 12, color: "#60a5fa", marginTop: 2 },
  savedCardDate: { fontSize: 11, color: "#64748b", marginTop: 2 },
  savedCardActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  savedConnectBtn: { backgroundColor: "#2563eb", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  savedConnectBtnDisabled: { backgroundColor: "#334155" },
  savedConnectBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  savedRemoveBtn: { padding: 8 },
  savedRemoveBtnText: { color: "#64748b", fontSize: 16 },
});
