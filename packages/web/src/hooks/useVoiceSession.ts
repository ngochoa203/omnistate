import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getClient } from "./useGateway";
import { cancelSpeech } from "../lib/tts";
import type { ServerMessage } from "../lib/protocol";

export type GatewayVoiceState =
  | "idle"
  | "wake-listening"
  | "wake-detected"
  | "recording"
  | "transcribing"
  | "thinking"
  | "executing"
  | "speaking"
  | "interrupted"
  | "error";

interface VoiceSessionSnapshot {
  sessionId?: string;
  state: GatewayVoiceState;
  transcript: string;
  partialTranscript: string;
  context?: unknown;
  error?: string;
  taskId?: string;
}

const VOICE_STATES: ReadonlySet<string> = new Set([
  "idle",
  "wake-listening",
  "wake-detected",
  "recording",
  "transcribing",
  "thinking",
  "executing",
  "speaking",
  "interrupted",
  "error",
]);

let snapshot: VoiceSessionSnapshot = { state: "idle", transcript: "", partialTranscript: "" };
const listeners = new Set<() => void>();
let subscribed = false;

function emit() {
  listeners.forEach((listener) => listener());
}

function setSnapshot(next: Partial<VoiceSessionSnapshot>) {
  snapshot = { ...snapshot, ...next };
  emit();
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readMessageError(msg: Record<string, unknown>): string | undefined {
  const direct = readString(msg.error) || readString(msg.message);
  if (direct) return direct;
  const nested = msg.error;
  if (nested && typeof nested === "object") {
    return readString((nested as Record<string, unknown>).message);
  }
  return undefined;
}

function handleVoiceEvent(msg: ServerMessage) {
  const event = msg as unknown as Record<string, unknown>;
  const type = readString(event.type);
  if (type === "voice.state") {
    const rawState = readString(event.state);
    if (!rawState || !VOICE_STATES.has(rawState)) return;
    setSnapshot({
      state: rawState as GatewayVoiceState,
      sessionId: readString(event.sessionId) ?? snapshot.sessionId,
      taskId: readString(event.taskId) ?? snapshot.taskId,
      error: rawState === "error" ? readMessageError(event) : undefined,
    });
    return;
  }

  if (type === "voice.transcript.partial") {
    setSnapshot({
      sessionId: readString(event.sessionId) ?? snapshot.sessionId,
      partialTranscript: readString(event.text) ?? readString(event.transcript) ?? "",
    });
    return;
  }

  if (type === "voice.transcript.final") {
    setSnapshot({
      sessionId: readString(event.sessionId) ?? snapshot.sessionId,
      transcript: readString(event.text) ?? readString(event.transcript) ?? "",
      partialTranscript: "",
    });
    return;
  }

  if (type === "voice.context") {
    setSnapshot({
      sessionId: readString(event.sessionId) ?? snapshot.sessionId,
      context: event.context ?? event,
      taskId: readString(event.taskId) ?? snapshot.taskId,
    });
    return;
  }

  if (type === "voice.stream.error") {
    setSnapshot({
      state: "error",
      sessionId: readString(event.sessionId) ?? snapshot.sessionId,
      error: readMessageError(event) ?? "Voice stream failed",
    });
    return;
  }

  if (type === "task.cancelled") {
    setSnapshot({
      state: "interrupted",
      taskId: readString(event.taskId) ?? snapshot.taskId,
      error: readMessageError(event),
    });
  }
}

function ensureGatewaySubscription() {
  if (subscribed) return;
  subscribed = true;
  const client = getClient();
  [
    "voice.state",
    "voice.transcript.partial",
    "voice.transcript.final",
    "voice.context",
    "voice.stream.error",
    "task.cancelled",
  ].forEach((event) => {
    void client.on(event, handleVoiceEvent);
  });
}

export function setLocalVoiceSession(next: Partial<VoiceSessionSnapshot>) {
  setSnapshot(next);
}

export function useVoiceSession() {
  useEffect(() => {
    ensureGatewaySubscription();
  }, []);

  const current = useSyncExternalStore(
    useCallback((listener) => {
      ensureGatewaySubscription();
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, []),
    () => snapshot,
    () => snapshot,
  );

  const cancel = useCallback(() => {
    const client = getClient();
    if (current.state === "speaking") {
      cancelSpeech();
      setLocalVoiceSession({ state: "interrupted" });
      return;
    }
    if (current.state === "executing" && current.taskId) {
      client.cancelTask(current.taskId, "user_cancelled");
      return;
    }
    if ((current.state === "transcribing" || current.state === "thinking") && current.sessionId) {
      client.cancelVoiceSession(current.sessionId, "user_cancelled");
    }
  }, [current.sessionId, current.state, current.taskId]);

  return { ...current, cancel };
}
