import React, { useCallback, useState } from "react";
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useMacroStore } from "../stores/macro-store";
import { parseCommands } from "../engine/intent-parser";
import { createMacro } from "../engine/macro";
import type { MacroStep } from "../engine/types";

export function MacroEditorScreen() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState<MacroStep[]>([]);
  const addMacro = useMacroStore((s) => s.addMacro);

  const onParse = useCallback(() => {
    const intents = parseCommands(input);
    const now = Date.now();
    const newSteps: MacroStep[] = intents.map((intent, idx) => ({
      id: `step_${now}_${idx}`,
      action: intent,
      delayMs: intent.action === "wait" ? 0 : 250,
      description: intent.raw,
    }));
    setSteps(newSteps);
  }, [input]);

  const onSave = useCallback(() => {
    if (!name.trim()) {
      Alert.alert("Missing name", "Please enter a macro name");
      return;
    }
    if (steps.length === 0) {
      Alert.alert("No steps", "Parse commands first");
      return;
    }
    const macro = createMacro(name.trim(), steps, {
      description: description.trim() || undefined,
      trigger: { type: "manual" },
    });
    addMacro(macro);
    setName("");
    setDescription("");
    setInput("");
    setSteps([]);
    Alert.alert("Saved", `Macro "${macro.name}" created with ${macro.steps.length} steps`);
  }, [name, description, steps, addMacro]);

  const onRemoveStep = useCallback((id: string) => {
    setSteps((s) => s.filter((st) => st.id !== id));
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>Macro Editor</Text>
      <Text style={styles.subtitle}>Author automations in natural language</Text>

      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Open messenger and reply"
        placeholderTextColor="#475569"
      />

      <Text style={styles.label}>Description (optional)</Text>
      <TextInput
        style={styles.input}
        value={description}
        onChangeText={setDescription}
        placeholder="What this macro does"
        placeholderTextColor="#475569"
      />

      <Text style={styles.label}>Commands</Text>
      <Text style={styles.hint}>
        One per line. Examples: "mở Messenger", "đợi 2s", "tap Chat", "gõ Hello", "vuốt xuống"
      </Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        value={input}
        onChangeText={setInput}
        placeholder={"mở Messenger\nđợi 2s\ntap Chat\ngõ Hello"}
        placeholderTextColor="#475569"
        multiline
      />

      <View style={styles.row}>
        <TouchableOpacity style={styles.parseBtn} onPress={onParse}>
          <Text style={styles.btnText}>Parse</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.saveBtn} onPress={onSave}>
          <Text style={styles.btnText}>Save Macro</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>Preview ({steps.length} steps)</Text>
      {steps.map((s, i) => (
        <View key={s.id} style={styles.step}>
          <Text style={styles.stepIdx}>{i + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.stepAction}>{s.action.action}</Text>
            {s.action.target && <Text style={styles.stepTarget}>→ {s.action.target}</Text>}
            {s.description && <Text style={styles.stepRaw}>{s.description}</Text>}
          </View>
          <TouchableOpacity onPress={() => onRemoveStep(s.id)} style={styles.removeBtn}>
            <Text style={styles.removeText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#0f172a", flex: 1 },
  title: { color: "#f1f5f9", fontSize: 28, fontWeight: "700" },
  subtitle: { color: "#64748b", marginBottom: 16 },
  label: { color: "#94a3b8", fontSize: 12, textTransform: "uppercase", marginTop: 16, marginBottom: 6 },
  hint: { color: "#64748b", fontSize: 12, marginBottom: 6 },
  input: {
    backgroundColor: "#1e293b",
    color: "#f1f5f9",
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
  },
  textarea: { minHeight: 120, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 12, marginTop: 16 },
  parseBtn: {
    backgroundColor: "#334155",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 6,
    flex: 1,
    alignItems: "center",
  },
  saveBtn: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 6,
    flex: 1,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "600" },
  section: { color: "#94a3b8", fontSize: 12, textTransform: "uppercase", marginTop: 24, marginBottom: 8 },
  step: {
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  stepIdx: {
    color: "#60a5fa",
    fontWeight: "700",
    width: 24,
    textAlign: "center",
    marginRight: 8,
  },
  stepAction: { color: "#f1f5f9", fontSize: 15, fontWeight: "600" },
  stepTarget: { color: "#cbd5e1", fontSize: 13 },
  stepRaw: { color: "#64748b", fontSize: 11, fontStyle: "italic" },
  removeBtn: { padding: 8 },
  removeText: { color: "#ef4444", fontSize: 18 },
});
