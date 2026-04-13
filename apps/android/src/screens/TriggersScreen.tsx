import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useConnectionStore } from "../stores/connection-store";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduleOption {
  label: string;
  cron: string;
}

const SCHEDULE_OPTIONS: ScheduleOption[] = [
  { label: "Every hour", cron: "0 * * * *"   },
  { label: "Every 6h",   cron: "0 */6 * * *" },
  { label: "Daily",      cron: "0 9 * * *"   },
  { label: "Weekly",     cron: "0 9 * * 1"   },
];

interface Trigger {
  id: string;
  name: string;
  goal: string;
  schedule: ScheduleOption;
  enabled: boolean;
  lastRun: string | null;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function formatLastRun(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>⏱</Text>
      <Text style={styles.emptyTitle}>No triggers configured</Text>
      <Text style={styles.emptySubtitle}>
        Tap + to create your first automation trigger
      </Text>
    </View>
  );
}

// ─── Trigger Card ─────────────────────────────────────────────────────────────

interface TriggerCardProps {
  trigger: Trigger;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}

function TriggerCard({ trigger, onToggle, onDelete }: TriggerCardProps) {
  const handleDelete = () => {
    Alert.alert(
      "Delete Trigger",
      `Remove "${trigger.name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => onDelete(trigger.id),
        },
      ]
    );
  };

  return (
    <View style={styles.card}>
      {/* Title row + toggle */}
      <View style={styles.cardTitleRow}>
        <Text style={styles.triggerName} numberOfLines={1}>
          {trigger.name}
        </Text>
        <Switch
          value={trigger.enabled}
          onValueChange={(val) => onToggle(trigger.id, val)}
          trackColor={{ false: "#334155", true: "#1d4ed8" }}
          thumbColor={trigger.enabled ? "#60a5fa" : "#94a3b8"}
        />
      </View>

      {/* Goal */}
      <Text style={styles.triggerGoal} numberOfLines={2}>
        {trigger.goal}
      </Text>

      {/* Meta row */}
      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Schedule</Text>
          <Text style={styles.metaValue}>{trigger.schedule.label}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Last run</Text>
          <Text style={styles.metaValue}>{formatLastRun(trigger.lastRun)}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Status</Text>
          <Text
            style={[
              styles.metaValue,
              trigger.enabled ? styles.statusActive : styles.statusInactive,
            ]}
          >
            {trigger.enabled ? "Active" : "Paused"}
          </Text>
        </View>
      </View>

      {/* Footer: cron badge + delete */}
      <View style={styles.cardFooter}>
        <View style={styles.cronBadge}>
          <Text style={styles.cronBadgeText}>{trigger.schedule.cron}</Text>
        </View>
        <TouchableOpacity
          onPress={handleDelete}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Create Modal ─────────────────────────────────────────────────────────────

interface CreateModalProps {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string, goal: string, schedule: ScheduleOption) => void;
}

function CreateModal({ visible, onClose, onCreate }: CreateModalProps) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleOption>(
    SCHEDULE_OPTIONS[2] // Daily default
  );

  const reset = () => {
    setName("");
    setGoal("");
    setSelectedSchedule(SCHEDULE_OPTIONS[2]);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCreate = () => {
    const trimmedName = name.trim();
    const trimmedGoal = goal.trim();
    if (!trimmedName) {
      Alert.alert("Validation", "Please enter a trigger name.");
      return;
    }
    if (!trimmedGoal) {
      Alert.alert("Validation", "Please describe the trigger goal.");
      return;
    }
    onCreate(trimmedName, trimmedGoal, selectedSchedule);
    reset();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.modalSheet}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Trigger</Text>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.modalBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Name field */}
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Daily standup summary"
              placeholderTextColor="#475569"
              value={name}
              onChangeText={setName}
              autoFocus
              returnKeyType="next"
              maxLength={80}
            />

            {/* Goal field */}
            <Text style={styles.fieldLabel}>Goal</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              placeholder="Describe what this trigger should do…"
              placeholderTextColor="#475569"
              value={goal}
              onChangeText={setGoal}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              maxLength={500}
            />

            {/* Schedule picker */}
            <Text style={styles.fieldLabel}>Schedule</Text>
            <View style={styles.scheduleGrid}>
              {SCHEDULE_OPTIONS.map((opt) => {
                const active = opt.cron === selectedSchedule.cron;
                return (
                  <TouchableOpacity
                    key={opt.cron}
                    style={[
                      styles.scheduleChip,
                      active && styles.scheduleChipActive,
                    ]}
                    onPress={() => setSelectedSchedule(opt)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.scheduleChipLabel,
                        active && styles.scheduleChipLabelActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                    <Text
                      style={[
                        styles.scheduleChipCron,
                        active && styles.scheduleChipCronActive,
                      ]}
                    >
                      {opt.cron}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ height: 16 }} />
          </ScrollView>

          {/* Footer buttons */}
          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.createBtn} onPress={handleCreate}>
              <Text style={styles.createBtnText}>Create Trigger</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function TriggersScreen() {
  const client = useConnectionStore((s) => s.client);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [modalVisible, setModalVisible] = useState(false);

  // Gateway messaging
  const sendGateway = (type: string, payload: object) => {
    if (!client) return;
    try {
      client.send(JSON.stringify({ type, ...payload }));
    } catch {
      // best-effort; non-critical for local state
    }
  };

  // ── CRUD handlers ─────────────────────────────────────────────────────────

  const handleCreate = (
    name: string,
    goal: string,
    schedule: ScheduleOption
  ) => {
    const newTrigger: Trigger = {
      id: generateId(),
      name,
      goal,
      schedule,
      enabled: true,
      lastRun: null,
      createdAt: new Date().toISOString(),
    };
    setTriggers((prev) => [newTrigger, ...prev]);
    sendGateway("trigger.create", {
      id: newTrigger.id,
      name: newTrigger.name,
      goal: newTrigger.goal,
      cron: newTrigger.schedule.cron,
      enabled: newTrigger.enabled,
      createdAt: newTrigger.createdAt,
    });
  };

  const handleToggle = (id: string, enabled: boolean) => {
    setTriggers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, enabled } : t))
    );
    sendGateway("trigger.update", { id, enabled });
  };

  const handleDelete = (id: string) => {
    setTriggers((prev) => prev.filter((t) => t.id !== id));
    sendGateway("trigger.delete", { id });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Triggers</Text>

      <FlatList
        data={triggers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TriggerCard
            trigger={item}
            onToggle={handleToggle}
            onDelete={handleDelete}
          />
        )}
        ListEmptyComponent={<EmptyState />}
        contentContainerStyle={
          triggers.length === 0 ? styles.listEmpty : styles.listContent
        }
        showsVerticalScrollIndicator={false}
      />

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.85}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>

      <CreateModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onCreate={handleCreate}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const MONO_FONT =
  Platform.OS === "android" ? "monospace" : "Courier New";

const styles = StyleSheet.create({
  // Screen
  container:   { flex: 1, backgroundColor: "#0f172a", padding: 16 },
  header:      { fontSize: 24, fontWeight: "bold", color: "#f1f5f9", marginBottom: 20, marginTop: 48 },
  listContent: { paddingBottom: 100 },
  listEmpty:   { flexGrow: 1 },

  // Empty state
  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 },
  emptyIcon:      { fontSize: 48, marginBottom: 16 },
  emptyTitle:     { fontSize: 18, fontWeight: "600", color: "#f1f5f9", marginBottom: 8 },
  emptySubtitle:  { fontSize: 14, color: "#94a3b8", textAlign: "center", paddingHorizontal: 32 },

  // Card
  card:         { backgroundColor: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#334155" },
  cardTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  triggerName:  { fontSize: 16, fontWeight: "600", color: "#f1f5f9", flex: 1, marginRight: 12 },
  triggerGoal:  { fontSize: 13, color: "#94a3b8", lineHeight: 18, marginBottom: 12 },

  metaRow:     { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#334155", paddingTop: 12, marginBottom: 12 },
  metaItem:    { alignItems: "center", flex: 1 },
  metaLabel:   { fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  metaValue:   { fontSize: 13, fontWeight: "500", color: "#f1f5f9" },
  statusActive:   { color: "#22c55e" },
  statusInactive: { color: "#64748b" },

  cardFooter:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cronBadge:      { backgroundColor: "#0f172a", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: "#1d4ed8" },
  cronBadgeText:  { fontSize: 11, color: "#60a5fa", fontFamily: MONO_FONT },
  deleteText:     { fontSize: 13, color: "#ef4444", fontWeight: "500" },

  // FAB
  fab:     { position: "absolute", bottom: 28, right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: "#60a5fa", alignItems: "center", justifyContent: "center", elevation: 6, shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6 },
  fabIcon: { fontSize: 28, color: "#0f172a", fontWeight: "300", lineHeight: 32 },

  // Modal
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  modalSheet:   { backgroundColor: "#1e293b", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: "#334155", maxHeight: "90%", paddingBottom: Platform.OS === "ios" ? 34 : 16 },
  modalHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, borderBottomWidth: 1, borderBottomColor: "#334155" },
  modalTitle:   { fontSize: 18, fontWeight: "700", color: "#f1f5f9" },
  modalClose:   { fontSize: 18, color: "#64748b", fontWeight: "600" },
  modalBody:    { padding: 20 },
  modalFooter:  { flexDirection: "row", gap: 12, paddingHorizontal: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#334155" },

  // Form
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input:      { backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 8, padding: 12, color: "#f1f5f9", fontSize: 15, marginBottom: 20 },
  textarea:   { height: 96, textAlignVertical: "top" },

  // Schedule picker
  scheduleGrid:            { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  scheduleChip:            { flexBasis: "47%", flexGrow: 1, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, alignItems: "center" },
  scheduleChipActive:      { borderColor: "#60a5fa", backgroundColor: "#1e3a5f" },
  scheduleChipLabel:       { fontSize: 13, fontWeight: "500", color: "#94a3b8", marginBottom: 2 },
  scheduleChipLabelActive: { color: "#60a5fa" },
  scheduleChipCron:        { fontSize: 10, color: "#475569", fontFamily: MONO_FONT },
  scheduleChipCronActive:  { color: "#93c5fd" },

  // Buttons
  cancelBtn:     { flex: 1, paddingVertical: 13, borderRadius: 10, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", alignItems: "center" },
  cancelBtnText: { fontSize: 15, fontWeight: "500", color: "#94a3b8" },
  createBtn:     { flex: 2, paddingVertical: 13, borderRadius: 10, backgroundColor: "#60a5fa", alignItems: "center" },
  createBtnText: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
});
