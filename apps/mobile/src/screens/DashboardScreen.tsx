import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { useConnectionStore } from "../stores/connection-store";

interface HealthData {
  status: string;
  uptime: number;
  connections: number;
  timestamp: string;
}

export function DashboardScreen() {
  const client = useConnectionStore((s) => s.client);
  const connectionState = useConnectionStore((s) => s.connectionState);
  const gatewayUrl = useConnectionStore((s) => s.gatewayUrl);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHealth = async () => {
    if (!gatewayUrl) return;
    const httpUrl = gatewayUrl.replace("ws://", "http://").replace(/:\d+$/, ":19801");
    try {
      const res = await fetch(`${httpUrl}/health`);
      const data = await res.json();
      setHealth(data);
    } catch {
      setHealth(null);
    }
  };

  useEffect(() => {
    fetchHealth();
    const timer = setInterval(fetchHealth, 10000);
    return () => clearInterval(timer);
  }, [gatewayUrl]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchHealth();
    setRefreshing(false);
  };

  const formatUptime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60a5fa" />}
    >
      <Text style={styles.header}>OmniState Dashboard</Text>

      {/* Connection Status */}
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: connectionState === "connected" ? "#22c55e" : "#ef4444" }]} />
          <Text style={styles.statusText}>
            {connectionState === "connected" ? "Connected" : connectionState === "connecting" ? "Connecting..." : "Disconnected"}
          </Text>
        </View>
        {gatewayUrl && <Text style={styles.statusDetail}>{gatewayUrl}</Text>}
      </View>

      {/* Health Info */}
      {health && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Gateway Health</Text>
          <View style={styles.statsGrid}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{formatUptime(health.uptime)}</Text>
              <Text style={styles.statLabel}>Uptime</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{health.connections}</Text>
              <Text style={styles.statLabel}>Connections</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: health.status === "ok" ? "#22c55e" : "#ef4444" }]}>
                {health.status === "ok" ? "Healthy" : "Error"}
              </Text>
              <Text style={styles.statLabel}>Status</Text>
            </View>
          </View>
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Quick Actions</Text>
        <Text style={styles.hint}>Use the Chat tab to send commands to your Mac</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", padding: 16 },
  header: { fontSize: 24, fontWeight: "bold", color: "#f1f5f9", marginBottom: 20, marginTop: 48 },
  card: { backgroundColor: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#334155" },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#f1f5f9", marginBottom: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 16, fontWeight: "500", color: "#f1f5f9" },
  statusDetail: { fontSize: 12, color: "#64748b", marginTop: 4, fontFamily: "monospace" },
  statsGrid: { flexDirection: "row", justifyContent: "space-around" },
  stat: { alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "bold", color: "#f1f5f9" },
  statLabel: { fontSize: 12, color: "#94a3b8", marginTop: 4 },
  hint: { fontSize: 14, color: "#94a3b8" },
});
