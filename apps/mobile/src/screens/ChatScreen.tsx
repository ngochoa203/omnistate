import React, { useState, useRef, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform,
} from "react-native";
import { useConnectionStore } from "../stores/connection-store";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  status?: "pending" | "streaming" | "complete" | "error";
}

export function ChatScreen() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const client = useConnectionStore((s) => s.client);
  const flatListRef = useRef<FlatList>(null);

  // Subscribe to gateway messages
  React.useEffect(() => {
    if (!client) return;

    const unsubStep = client.on("task.step", (msg: any) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.status === "streaming") {
          return [...prev.slice(0, -1), { ...last, content: last.content + "\n" + (msg.description || msg.result || "") }];
        }
        return [...prev, {
          id: `step-${Date.now()}`,
          role: "assistant",
          content: msg.description || msg.result || "Processing...",
          timestamp: Date.now(),
          status: "streaming",
        }];
      });
    });

    const unsubComplete = client.on("task.complete", (msg: any) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.status === "streaming") {
          return [...prev.slice(0, -1), { ...last, content: msg.summary || last.content, status: "complete" }];
        }
        return [...prev, {
          id: `complete-${Date.now()}`,
          role: "assistant",
          content: msg.summary || "Task completed",
          timestamp: Date.now(),
          status: "complete",
        }];
      });
    });

    const unsubError = client.on("task.error", (msg: any) => {
      setMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `Error: ${msg.error || "Unknown error"}`,
        timestamp: Date.now(),
        status: "error",
      }]);
    });

    return () => { unsubStep(); unsubComplete(); unsubError(); };
  }, [client]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || !client) return;

    setMessages((prev) => [...prev, {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    }]);

    client.sendTask(text);
    setInput("");

    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, [input, client]);

  const renderMessage = ({ item }: { item: ChatMessage }) => (
    <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.assistantBubble]}>
      <Text style={[styles.bubbleText, item.status === "error" && styles.errorText]}>
        {item.content}
      </Text>
      {item.status === "streaming" && <Text style={styles.streamingDot}>...</Text>}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={80}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.textInput}
          value={input}
          onChangeText={setInput}
          placeholder="What would you like to do?"
          placeholderTextColor="#64748b"
          multiline
          maxLength={2000}
          returnKeyType="send"
          onSubmitEditing={sendMessage}
        />
        <TouchableOpacity
          style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
          onPress={sendMessage}
          disabled={!input.trim()}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  messageList: { flex: 1 },
  messageContent: { padding: 16, paddingTop: 48 },
  bubble: { maxWidth: "80%", borderRadius: 12, padding: 12, marginBottom: 8 },
  userBubble: { backgroundColor: "#2563eb", alignSelf: "flex-end" },
  assistantBubble: { backgroundColor: "#1e293b", alignSelf: "flex-start", borderWidth: 1, borderColor: "#334155" },
  bubbleText: { color: "#f1f5f9", fontSize: 15, lineHeight: 22 },
  errorText: { color: "#fca5a5" },
  streamingDot: { color: "#60a5fa", fontSize: 18, marginTop: 4 },
  inputRow: { flexDirection: "row", padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: "#334155", backgroundColor: "#1e293b" },
  textInput: { flex: 1, backgroundColor: "#0f172a", color: "#f1f5f9", borderRadius: 8, padding: 12, fontSize: 15, maxHeight: 100, borderWidth: 1, borderColor: "#334155" },
  sendButton: { backgroundColor: "#2563eb", borderRadius: 8, paddingHorizontal: 20, justifyContent: "center" },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
