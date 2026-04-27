import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useAutomationStore } from "../stores/automation-store";
import { useMacroStore } from "../stores/macro-store";
import { MacroRunner } from "../engine/macro";
import { ActionExecutor } from "../engine/action-executor";
import { AccessibilityModule } from "../native/AccessibilityModule";
import { OverlayModule } from "../native/OverlayModule";
import type { Macro } from "../engine/types";

const executor = new ActionExecutor();
const runner = new MacroRunner(executor);

export function AutomationScreen() {
  const { isRunning, currentMacro, status, history, startAutomation, stopAutomation, addLog } =
    useAutomationStore();
  const macros = useMacroStore((s) => s.macros);
  const [serviceEnabled, setServiceEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    AccessibilityModule.isServiceEnabled().then(setServiceEnabled).catch(() => setServiceEnabled(false));
    const off = runner.on((e) => {
      addLog({
        id: `log_${e.timestamp}_${Math.random().toString(36).slice(2, 6)}`,
        macroId: e.macroId,
        timestamp: e.timestamp,
        level: e.type === "step_error" || e.type === "macro_error" ? "error" : "info",
        message: `${e.type}${e.stepIndex != null ? ` #${e.stepIndex}` : ""}${
          e.error ? ` — ${e.error}` : ""
        }`,
      });
      if (e.type === "macro_complete" || e.type === "macro_error" || e.type === "macro_cancelled") {
        stopAutomation();
        OverlayModule.updateStatus("●").catch(() => {});
      }
    });
    return () => { off(); };
  }, [addLog, stopAutomation]);

  const onRun = useCallback(
    async (macro: Macro) => {
      if (isRunning) return;
      startAutomation(macro);
      OverlayModule.showOverlay().catch(() => {});
      OverlayModule.updateStatus(`▶ ${macro.name}`).catch(() => {});
      try {
        await runner.run(macro);
      } catch (e) {
        Alert.alert("Macro failed", (e as Error).message);
      }
    },
    [isRunning, startAutomation],
  );

  const onStop = useCallback(() => {
    runner.cancel();
    stopAutomation();
  }, [stopAutomation]);

  const onEnableService = useCallback(() => {
    AccessibilityModule.openAccessibilitySettings();
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>Automation</Text>
      <Text style={styles.subtitle}>Run macros on your device</Text>

      {serviceEnabled === false && (
        <TouchableOpacity style={styles.warn} onPress={onEnableService}>
          <Text style={styles.warnText}>Accessibility service not enabled — tap to open settings</Text>
        </TouchableOpacity>
      )}

      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Status</Text>
        <Text style={styles.statusValue}>{status}</Text>
        {currentMacro && <Text style={styles.statusMacro}>{currentMacro.name}</Text>}
        {isRunning && (
          <TouchableOpacity style={styles.stopBtn} onPress={onStop}>
            <Text style={styles.btnText}>⏹ Stop</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.section}>Macros ({macros.length})</Text>
      {macros.length === 0 && (
        <Text style={styles.empty}>No macros yet. Create one from Macro Editor.</Text>
      )}
      {macros.map((m) => (
        <View key={m.id} style={styles.macroCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.macroName}>{m.name}</Text>
            <Text style={styles.macroMeta}>
              {m.steps.length} step{m.steps.length === 1 ? "" : "s"} · {m.trigger.type}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.runBtn, isRunning && styles.runBtnDisabled]}
            disabled={isRunning}
            onPress={() => onRun(m)}
          >
            <Text style={styles.btnText}>▶ Run</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Text style={styles.section}>History</Text>
      {history.slice(0, 20).map((h) => (
        <View key={h.id} style={styles.logRow}>
          <Text style={[styles.logLevel, h.level === "error" && styles.logError]}>
            {h.level === "error" ? "✖" : "✓"}
          </Text>
          <Text style={styles.logMsg}>{h.message}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#0f172a", flex: 1 },
  title: { color: "#f1f5f9", fontSize: 28, fontWeight: "700" },
  subtitle: { color: "#64748b", marginBottom: 16 },
  warn: {
    backgroundColor: "#7f1d1d",
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  warnText: { color: "#fecaca" },
  statusCard: {
    backgroundColor: "#1e293b",
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  statusLabel: { color: "#64748b", fontSize: 12, textTransform: "uppercase" },
  statusValue: { color: "#60a5fa", fontSize: 20, fontWeight: "600", marginTop: 4 },
  statusMacro: { color: "#cbd5e1", marginTop: 4 },
  section: { color: "#94a3b8", fontSize: 12, textTransform: "uppercase", marginTop: 20, marginBottom: 8 },
  empty: { color: "#64748b", fontStyle: "italic" },
  macroCard: {
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  macroName: { color: "#f1f5f9", fontSize: 16, fontWeight: "600" },
  macroMeta: { color: "#64748b", fontSize: 12, marginTop: 2 },
  runBtn: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  runBtnDisabled: { opacity: 0.4 },
  stopBtn: {
    backgroundColor: "#dc2626",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    marginTop: 12,
    alignSelf: "flex-start",
  },
  btnText: { color: "#fff", fontWeight: "600" },
  logRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomColor: "#1e293b",
    borderBottomWidth: 1,
  },
  logLevel: { color: "#10b981", width: 20 },
  logError: { color: "#ef4444" },
  logMsg: { color: "#cbd5e1", flex: 1, fontSize: 12 },
});
