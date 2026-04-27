import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { getCopy, SUPPORTED_LANGUAGES } from "@omnistate/mobile-core";
import type { AppLanguage } from "@omnistate/mobile-core";
import { useConnectionStore } from "../stores/connection-store";

interface GatewayHealth {
  version?: string;
  status?: string;
}

export default function SettingsScreen() {
  const gatewayUrl = useConnectionStore((s) => s.gatewayUrl);
  const connectionState = useConnectionStore((s) => s.connectionState);
  const disconnect = useConnectionStore((s) => s.disconnect);

  const [language, setLanguage] = useState<AppLanguage>("en");
  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [isVerified, setIsVerified] = useState(false);

  const copy = getCopy(language);
  const isConnected = connectionState === "connected";

  // Fetch gateway health for the ABOUT section
  useEffect(() => {
    if (!gatewayUrl) return;
    const httpUrl = gatewayUrl
      .replace("ws://", "http://")
      .replace(/:\d+$/, ":19801");
    fetch(`${httpUrl}/health`)
      .then((r) => r.json())
      .then((d: GatewayHealth) => setHealth(d))
      .catch(() => setHealth(null));
  }, [gatewayUrl]);

  const handleDisconnect = () => {
    Alert.alert(
      "Disconnect",
      "Are you sure you want to disconnect from the gateway?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Disconnect", style: "destructive", onPress: disconnect },
      ]
    );
  };

  const handleReEnroll = () => {
    Alert.alert(
      "Re-enroll Voice",
      "Go to the Voice tab to record new voice samples and re-enroll your profile.",
      [{ text: "OK" }]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>{copy.nav.settings}</Text>

      {/* ── CONNECTION ───────────────────────────────────────── */}
      <Text style={styles.sectionHeader}>CONNECTION</Text>
      <View style={styles.card}>
        {/* Gateway URL + status dot */}
        <View style={styles.urlRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isConnected ? "#22c55e" : "#ef4444" },
            ]}
          />
          <Text style={styles.urlText} numberOfLines={1} ellipsizeMode="middle">
            {gatewayUrl ?? "No gateway configured"}
          </Text>
        </View>
        <Text style={styles.connectionLabel}>
          {connectionState === "connected"
            ? copy.status.connected
            : connectionState === "connecting"
            ? copy.status.connecting
            : copy.status.disconnected}
        </Text>
        <TouchableOpacity
          style={[
            styles.button,
            styles.buttonDanger,
            connectionState === "disconnected" && styles.buttonDisabled,
          ]}
          onPress={handleDisconnect}
          disabled={connectionState === "disconnected"}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonText}>Disconnect</Text>
        </TouchableOpacity>
      </View>

      {/* ── LANGUAGE ─────────────────────────────────────────── */}
      <Text style={styles.sectionHeader}>LANGUAGE</Text>
      <View style={styles.card}>
        <View style={styles.langGrid}>
          {SUPPORTED_LANGUAGES.map((lang) => {
            const selected = lang.code === language;
            return (
              <TouchableOpacity
                key={lang.code}
                style={[styles.langItem, selected && styles.langItemSelected]}
                onPress={() => setLanguage(lang.code)}
                activeOpacity={0.7}
              >
                <Text style={styles.langFlag}>{lang.flag}</Text>
                <Text
                  style={[
                    styles.langName,
                    selected && styles.langNameSelected,
                  ]}
                  numberOfLines={1}
                >
                  {lang.nativeName}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── VOICE PROFILE ────────────────────────────────────── */}
      <Text style={styles.sectionHeader}>VOICE PROFILE</Text>
      <View style={styles.card}>
        <View style={styles.voiceRow}>
          <Text style={styles.voiceStatusText}>
            {isEnrolled ? "Voice profile enrolled" : "No voice profile enrolled"}
          </Text>
          {isEnrolled && isVerified && (
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedBadgeText}>✓ Verified</Text>
            </View>
          )}
          {isEnrolled && !isVerified && (
            <View style={styles.unverifiedBadge}>
              <Text style={styles.unverifiedBadgeText}>Unverified</Text>
            </View>
          )}
        </View>
        <Text style={styles.voiceHint}>
          {isEnrolled ? copy.voice.verified : copy.voice.enrollDesc}
        </Text>
        <TouchableOpacity
          style={[styles.button, styles.buttonPrimary]}
          onPress={handleReEnroll}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonText}>Re-enroll</Text>
        </TouchableOpacity>
      </View>

      {/* ── ABOUT ────────────────────────────────────────────── */}
      <Text style={styles.sectionHeader}>ABOUT</Text>
      <View style={[styles.card, styles.cardLast]}>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>App</Text>
          <Text style={styles.aboutValue}>OmniState Android v0.1.0</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Gateway version</Text>
          <Text style={styles.aboutValue}>
            {health?.version ? `v${health.version}` : gatewayUrl ? "—" : "Not connected"}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Gateway status</Text>
          <Text
            style={[
              styles.aboutValue,
              health?.status === "ok" ? styles.textSuccess : styles.textMuted,
            ]}
          >
            {health?.status ?? "—"}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

// ── Theme constants ─────────────────────────────────────────────────────────
const PRIMARY = "#60a5fa";
const BG = "#0f172a";
const CARD = "#1e293b";
const TEXT = "#f1f5f9";
const MUTED = "#94a3b8";
const BORDER = "#334155";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  content: {
    padding: 16,
  },
  header: {
    fontSize: 24,
    fontWeight: "bold",
    color: TEXT,
    marginBottom: 20,
    marginTop: 48,
  },

  // Section headers — uppercase
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED,
    letterSpacing: 1.2,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },

  // Cards
  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cardLast: {
    marginBottom: 40,
  },

  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 10,
  },

  // ── CONNECTION ─────────────────────────────────────────────────────────────
  urlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  urlText: {
    flex: 1,
    fontSize: 13,
    color: MUTED,
    fontFamily: "monospace",
  },
  connectionLabel: {
    fontSize: 13,
    color: "#64748b",
    marginBottom: 14,
    marginLeft: 18,
  },

  // ── Buttons ────────────────────────────────────────────────────────────────
  button: {
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: "center",
    marginTop: 4,
  },
  buttonPrimary: {
    backgroundColor: PRIMARY,
  },
  buttonDanger: {
    backgroundColor: "#ef4444",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "600",
    color: TEXT,
  },

  // ── LANGUAGE grid (3 columns) ──────────────────────────────────────────────
  langGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  langItem: {
    // 3 columns: (100% - 2 gaps) / 3 ≈ 30%
    width: "30%",
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    gap: 4,
  },
  langItemSelected: {
    borderColor: PRIMARY,
    backgroundColor: "#1d3a5f",
  },
  langFlag: {
    fontSize: 22,
  },
  langName: {
    fontSize: 11,
    color: MUTED,
    textAlign: "center",
  },
  langNameSelected: {
    color: PRIMARY,
    fontWeight: "600",
  },

  // ── VOICE PROFILE ──────────────────────────────────────────────────────────
  voiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 6,
  },
  voiceStatusText: {
    fontSize: 14,
    fontWeight: "500",
    color: TEXT,
    flex: 1,
  },
  verifiedBadge: {
    backgroundColor: "#14532d",
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  verifiedBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#4ade80",
  },
  unverifiedBadge: {
    backgroundColor: "#713f12",
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  unverifiedBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#fbbf24",
  },
  voiceHint: {
    fontSize: 13,
    color: "#64748b",
    marginBottom: 14,
    lineHeight: 18,
  },

  // ── ABOUT ──────────────────────────────────────────────────────────────────
  aboutRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  aboutLabel: {
    fontSize: 14,
    color: MUTED,
  },
  aboutValue: {
    fontSize: 14,
    fontWeight: "500",
    color: TEXT,
  },
  textSuccess: {
    color: "#22c55e",
  },
  textMuted: {
    color: MUTED,
  },
});
