import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  ActivityIndicator,
  Animated,
  ScrollView,
} from "react-native";
import { useConnectionStore } from "../stores/connection-store";
import { getCopy } from "@omnistate/mobile-core";

// ── Constants ────────────────────────────────────────────────────────────────

const REQUIRED_SAMPLES = 3;
const RECORD_DURATION_MS = 2000;

// ── Types ────────────────────────────────────────────────────────────────────

type VerificationStatus = "not_enrolled" | "enrolled" | "verified";
type EnrollStep = "idle" | "recording" | "processing";
type VtStatus = "idle" | "recording" | "dispatched" | "error";

// ── Component ─────────────────────────────────────────────────────────────────

export default function VoiceScreen() {
  const copy = getCopy("en");
  const client = useConnectionStore((s) => s.client);
  const isConnected = useConnectionStore((s) => s.isConnected);

  // Enrollment
  const [samplesRecorded, setSamplesRecorded] = useState(0);
  const [enrollStep, setEnrollStep] = useState<EnrollStep>("idle");

  // Voice-to-task
  const [vtStatus, setVtStatus] = useState<VtStatus>("idle");
  const [lastDispatch, setLastDispatch] = useState<string | null>(null);

  // Pulse animation for Hold-to-Speak button
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);

  // ── Derived state ──────────────────────────────────────────────────────────

  const enrollComplete = samplesRecorded >= REQUIRED_SAMPLES;

  const verificationStatus: VerificationStatus = enrollComplete
    ? "verified"
    : samplesRecorded > 0
    ? "enrolled"
    : "not_enrolled";

  const badgeColor = {
    verified: "#22c55e",
    enrolled: "#eab308",
    not_enrolled: "#64748b",
  }[verificationStatus];

  const badgeLabel: string =
    copy.voice?.statusVerified != null && verificationStatus === "verified"
      ? copy.voice.statusVerified
      : verificationStatus === "enrolled"
      ? (copy.voice?.statusEnrolled ?? "Enrolled")
      : (copy.voice?.statusNotEnrolled ?? "Not Enrolled");

  // ── Enrollment: simulated 2 s recording ────────────────────────────────────

  const handleRecordSample = useCallback(() => {
    if (enrollComplete || enrollStep !== "idle") return;

    setEnrollStep("recording");
    const t1 = setTimeout(() => {
      setEnrollStep("processing");
      const t2 = setTimeout(() => {
        setSamplesRecorded((n) => n + 1);
        setEnrollStep("idle");
      }, 500);
      return () => clearTimeout(t2);
    }, RECORD_DURATION_MS);

    return () => clearTimeout(t1);
  }, [enrollComplete, enrollStep]);

  // ── Hold-to-Speak ───────────────────────────────────────────────────────────

  const startPulse = useCallback(() => {
    pulseRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.14,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    pulseRef.current.start();
  }, [pulseAnim]);

  const stopPulse = useCallback(() => {
    pulseRef.current?.stop();
    Animated.timing(pulseAnim, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, [pulseAnim]);

  const handleSpeakStart = useCallback(() => {
    if (!enrollComplete || vtStatus === "recording") return;
    setVtStatus("recording");
    setLastDispatch(null);
    startPulse();
  }, [enrollComplete, vtStatus, startPulse]);

  const handleSpeakEnd = useCallback(() => {
    if (vtStatus !== "recording") return;
    stopPulse();

    // Simulated transcript dispatch via gateway
    const simulatedText: string =
      copy.voice?.sampleTranscript ?? "Run a quick system status check";

    if (client) {
      client.sendTask(simulatedText);
      setLastDispatch(simulatedText);
      setVtStatus("dispatched");
    } else {
      setLastDispatch(copy.voice?.notConnected ?? "Not connected to gateway");
      setVtStatus("error");
    }
  }, [vtStatus, client, copy, stopPulse]);

  // ── Speak button label ──────────────────────────────────────────────────────

  const speakButtonLabel = (() => {
    if (vtStatus === "recording") return copy.voice?.listening ?? "Listening…";
    if (vtStatus === "dispatched") return copy.voice?.dispatched ?? "Dispatched!";
    if (!enrollComplete) return copy.voice?.enrollFirst ?? "Enroll first";
    return copy.voice?.holdToSpeak ?? "Hold to Speak";
  })();

  const canSpeak = enrollComplete;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <Text style={styles.title}>
        {copy.voice?.title ?? "Voice Control"}
      </Text>
      <Text style={styles.subtitle}>
        {copy.voice?.subtitle ?? "Enroll your voice, then speak tasks hands-free"}
      </Text>

      {/* Verification status badge */}
      <View style={styles.badgeRow}>
        <View style={[styles.badgeDot, { backgroundColor: badgeColor }]} />
        <Text style={styles.badgeLabel}>{badgeLabel}</Text>
      </View>

      {/* ── Enrollment card ────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {copy.voice?.enrollmentTitle ?? "Voice Enrollment"}
        </Text>

        {/* Count display */}
        <Text style={styles.enrollCount}>
          <Text style={styles.enrollCountNum}>{samplesRecorded}</Text>
          {"  "}
          <Text style={styles.enrollCountOf}>
            {copy.voice?.of ?? "of"} {REQUIRED_SAMPLES}
          </Text>
        </Text>

        <Text style={styles.enrollHint}>
          {enrollComplete
            ? (copy.voice?.enrollmentComplete ?? "Enrollment complete — voice profile ready")
            : (copy.voice?.enrollmentHint ??
                `Record ${REQUIRED_SAMPLES - samplesRecorded} more sample${
                  REQUIRED_SAMPLES - samplesRecorded !== 1 ? "s" : ""
                } to complete enrollment`)}
        </Text>

        {/* Progress dots */}
        <View style={styles.dotsRow}>
          {Array.from({ length: REQUIRED_SAMPLES }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i < samplesRecorded ? styles.dotFilled : styles.dotEmpty,
              ]}
            />
          ))}
        </View>

        {/* Record Sample button */}
        <TouchableOpacity
          style={[
            styles.recordButton,
            enrollStep === "recording" && styles.recordButtonRecording,
            (enrollComplete || enrollStep !== "idle") && styles.recordButtonDisabled,
          ]}
          onPress={handleRecordSample}
          disabled={enrollComplete || enrollStep !== "idle"}
          activeOpacity={0.75}
        >
          {enrollStep === "processing" ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.recordIcon}>
              {enrollStep === "recording" ? "⏺" : enrollComplete ? "✓" : "🎙"}
            </Text>
          )}
          <Text
            style={[
              styles.recordButtonText,
              (enrollComplete || enrollStep !== "idle") &&
                styles.recordButtonTextMuted,
            ]}
          >
            {enrollStep === "recording"
              ? (copy.voice?.recording ?? "Recording…")
              : enrollStep === "processing"
              ? (copy.voice?.processing ?? "Processing…")
              : enrollComplete
              ? (copy.voice?.allSamplesRecorded ?? "All Samples Recorded")
              : (copy.voice?.recordSample ?? "Record Sample")}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Voice Task Dispatch card ────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {copy.voice?.dispatchTitle ?? "Voice Task Dispatch"}
        </Text>

        {/* Connection row */}
        <View style={styles.connRow}>
          <View
            style={[
              styles.connDot,
              isConnected ? styles.connDotOnline : styles.connDotOffline,
            ]}
          />
          <Text style={styles.connLabel}>
            {isConnected
              ? (copy.voice?.gatewayConnected ?? "Gateway connected")
              : (copy.voice?.gatewayDisconnected ?? "No gateway — connect first")}
          </Text>
        </View>

        {/* Hold-to-Speak circular button */}
        <View style={styles.speakCenter}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableWithoutFeedback
              onPressIn={handleSpeakStart}
              onPressOut={handleSpeakEnd}
            >
              <View
                style={[
                  styles.speakButton,
                  vtStatus === "recording" && styles.speakButtonActive,
                  !canSpeak && styles.speakButtonDisabled,
                ]}
              >
                <Text style={styles.speakIcon}>
                  {vtStatus === "recording" ? "🔴" : "🎤"}
                </Text>
                <Text
                  style={[
                    styles.speakLabel,
                    !canSpeak && styles.speakLabelMuted,
                  ]}
                >
                  {speakButtonLabel}
                </Text>
              </View>
            </TouchableWithoutFeedback>
          </Animated.View>
        </View>

        {/* Last dispatch result */}
        {lastDispatch !== null && (
          <View
            style={[
              styles.resultBox,
              vtStatus === "error" && styles.resultBoxError,
            ]}
          >
            <Text style={styles.resultLabel}>
              {vtStatus === "error"
                ? (copy.voice?.errorLabel ?? "Error")
                : (copy.voice?.dispatchedLabel ?? "Dispatched")}
            </Text>
            <Text
              style={[
                styles.resultText,
                vtStatus === "error" && styles.resultTextError,
              ]}
            >
              {lastDispatch}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  content: {
    padding: 20,
    paddingTop: 40,
    paddingBottom: 48,
    alignItems: "center",
  },

  // Header
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#f1f5f9",
    textAlign: "center",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: "#94a3b8",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
    paddingHorizontal: 8,
  },

  // Status badge
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e293b",
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: "#334155",
    gap: 8,
  },
  badgeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  badgeLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#f1f5f9",
  },

  // Cards
  card: {
    width: "100%",
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#f1f5f9",
    marginBottom: 12,
  },

  // Enrollment count
  enrollCount: {
    marginBottom: 6,
    textAlign: "center",
  },
  enrollCountNum: {
    fontSize: 52,
    fontWeight: "bold",
    color: "#60a5fa",
    lineHeight: 60,
  },
  enrollCountOf: {
    fontSize: 18,
    color: "#94a3b8",
    fontWeight: "400",
  },
  enrollHint: {
    fontSize: 13,
    color: "#94a3b8",
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 18,
  },

  // Progress dots
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginBottom: 20,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  dotFilled: {
    backgroundColor: "#60a5fa",
  },
  dotEmpty: {
    backgroundColor: "#334155",
  },

  // Record button
  recordButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    gap: 10,
  },
  recordButtonRecording: {
    backgroundColor: "#dc2626",
  },
  recordButtonDisabled: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
  },
  recordIcon: {
    fontSize: 20,
  },
  recordButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  recordButtonTextMuted: {
    color: "#64748b",
  },

  // Connection indicator
  connRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    gap: 8,
  },
  connDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  connDotOnline: {
    backgroundColor: "#22c55e",
  },
  connDotOffline: {
    backgroundColor: "#64748b",
  },
  connLabel: {
    fontSize: 13,
    color: "#94a3b8",
  },

  // Hold-to-speak
  speakCenter: {
    alignItems: "center",
    marginBottom: 20,
  },
  speakButton: {
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: "#0f172a",
    borderWidth: 3,
    borderColor: "#60a5fa",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    shadowColor: "#60a5fa",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 8,
  },
  speakButtonActive: {
    borderColor: "#f87171",
    backgroundColor: "#1c0a0a",
    shadowColor: "#dc2626",
    shadowOpacity: 0.55,
  },
  speakButtonDisabled: {
    borderColor: "#334155",
    shadowOpacity: 0,
    opacity: 0.4,
  },
  speakIcon: {
    fontSize: 38,
  },
  speakLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#f1f5f9",
    textAlign: "center",
    paddingHorizontal: 12,
    lineHeight: 16,
  },
  speakLabelMuted: {
    color: "#64748b",
  },

  // Dispatch result
  resultBox: {
    backgroundColor: "#0f172a",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#334155",
  },
  resultBoxError: {
    borderColor: "#7f1d1d",
    backgroundColor: "#1c0a0a",
  },
  resultLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#60a5fa",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 5,
  },
  resultText: {
    fontSize: 14,
    color: "#f1f5f9",
    lineHeight: 20,
  },
  resultTextError: {
    color: "#fca5a5",
  },
});
