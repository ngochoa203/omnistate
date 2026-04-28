import { useEffect, useRef } from "react";
import { GatewayClient } from "../lib/gateway-client";
import { buildClaudeMemPayloadFromState, useChatStore } from "../lib/chat-store";
import type { ServerMessage } from "../lib/protocol";
import { speakText } from "../lib/tts";

let _client: GatewayClient | null = null;

export function getClient(): GatewayClient {
  if (!_client) _client = new GatewayClient();
  return _client;
}

export function useGateway() {
  const clientRef = useRef(getClient());
  const store = useChatStore();

  useEffect(() => {
    const client = clientRef.current;
    const lastRemoteHashRef = { current: "" };
    const lastLocalHashRef = { current: "" };
    let syncTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleMemorySync = () => {
      const state = useChatStore.getState();
      const payload = buildClaudeMemPayloadFromState(state);
      const hash = JSON.stringify(payload);
      if (hash === lastRemoteHashRef.current || hash === lastLocalHashRef.current) {
        return;
      }

      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        lastLocalHashRef.current = hash;
        client.syncClaudeMem(payload);
      }, 300);
    };

    const unsubscribeMem = useChatStore.subscribe((state) => {
      void state.sharedMemorySummary;
      void state.sharedMemoryLog;
      void state.sessionStateByConversation;
      scheduleMemorySync();
    });

    store.setConnectionState("connecting");
    client.connect();

    const unsubs: Array<() => void> = [];

    unsubs.push(client.on("connected", () => {
      store.setConnectionState("connected");
      client.requestLlmPreflight();
      client.requestRuntimeConfig();
      client.queryClaudeMem();
      client.queryEvents({ limit: 50 });
      client.queryMemoryRecords({ limit: 50 });
    }));

    unsubs.push(client.on("event.ingested", (msg: ServerMessage) => {
      if (msg.type === "event.ingested") store.upsertEvent(msg.event);
    }));

    unsubs.push(client.on("event.query.result", (msg: ServerMessage) => {
      if (msg.type === "event.query.result") store.setEvents(msg.events);
    }));

    unsubs.push(client.on("event.detail", (msg: ServerMessage) => {
      if (msg.type === "event.detail") store.setSelectedEvent(msg.event);
    }));

    unsubs.push(client.on("memory.record.saved", (msg: ServerMessage) => {
      if (msg.type === "memory.record.saved") store.upsertMemoryRecordLocal(msg.record);
    }));

    unsubs.push(client.on("memory.record.query.result", (msg: ServerMessage) => {
      if (msg.type === "memory.record.query.result") store.setMemoryRecords(msg.records);
    }));

    unsubs.push(client.on("memory.record.deleted", (msg: ServerMessage) => {
      if (msg.type === "memory.record.deleted") store.removeMemoryRecord(msg.id);
    }));

    unsubs.push(client.on("_disconnected", () => {
      store.setConnectionState("disconnected");
    }));

    unsubs.push(client.on("task.accepted", (msg: ServerMessage) => {
      if (msg.type === "task.accepted") {
        store.addSystemMessage("Đang xử lý yêu cầu...", msg.taskId);
      }
    }));

    unsubs.push(client.on("task.step", (msg: ServerMessage) => {
      if (msg.type === "task.step") {
        store.addStep(msg.taskId, {
          step: msg.step,
          status: msg.status,
          layer: msg.layer,
          data: msg.data,
        });
      }
    }));

    unsubs.push(client.on("task.complete", (msg: ServerMessage) => {
      if (msg.type === "task.complete") {
        store.completeTask(msg.taskId, msg.result);

        const state = useChatStore.getState();
        if (!state.ttsEnabled) return;

        const speech =
          (typeof msg.result?.summary === "string" && msg.result.summary) ||
          (typeof msg.result?.message === "string" && msg.result.message) ||
          "";
        if (!speech.trim()) return;

        void speakText(speech, state.appLanguage === "vi" ? "vi" : "en");
      }
    }));

    unsubs.push(client.on("openclaw.result", (msg: ServerMessage) => {
      if (msg.type === "openclaw.result") {
        if (msg.status === "complete") {
          store.addSystemMessage(`OpenClaw sequence completed (${msg.taskId})`);
        } else {
          store.addSystemMessage(`OpenClaw sequence failed (${msg.taskId}): ${msg.error ?? "unknown error"}`);
        }
      }
    }));

    unsubs.push(client.on("task.error", (msg: ServerMessage) => {
      if (msg.type === "task.error") {
        store.failTask(msg.taskId, msg.error);
      }
    }));

    unsubs.push(client.on("health.report", (msg: ServerMessage) => {
      if (msg.type === "health.report") {
        store.setHealth({
          overall: msg.overall,
          timestamp: msg.timestamp,
          sensors: msg.sensors,
          alerts: msg.alerts,
        });
      }
    }));

    unsubs.push(client.on("voice.transcript", (msg: ServerMessage) => {
      if (msg.type === "voice.transcript") {
        store.setVoiceState("idle");
        // The voice transcript is auto-executed as a task by the gateway,
        // so task.accepted/task.step/task.complete will follow automatically
      }
    }));

    unsubs.push(client.on("voice.error", (msg: ServerMessage) => {
      if (msg.type === "voice.error") {
        store.setVoiceState("idle");
        store.addSystemMessage(`Voice error: ${(msg as any).error}`);
      }
    }));

    unsubs.push(client.on("vibevoice.partial", (msg: ServerMessage) => {
      if (msg.type === "vibevoice.partial") {
        store.addSystemMessage(
          `VibeVoice ${msg.sessionId}: ${msg.receivedChunks} chunks / ${msg.receivedBytes} bytes received`
        );
      }
    }));

    unsubs.push(client.on("vibevoice.transcript", (msg: ServerMessage) => {
      if (msg.type === "vibevoice.transcript") {
        store.setVoiceState("idle");
        store.addSystemMessage(`VibeVoice transcript: ${msg.text}`);
      }
    }));

    unsubs.push(client.on("vibevoice.error", (msg: ServerMessage) => {
      if (msg.type === "vibevoice.error") {
        store.setVoiceState("idle");
        store.addSystemMessage(`VibeVoice error (${msg.sessionId}): ${msg.error}`);
      }
    }));

    unsubs.push(client.on("voice.tts.audio", (msg: ServerMessage) => {
      if (msg.type === "voice.tts.audio") {
        const binary = atob(msg.audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
        void audio.play();
      }
    }));

    unsubs.push(client.on("voice.speaker.mismatch", (msg: ServerMessage) => {
      if (msg.type === "voice.speaker.mismatch") {
        console.warn("[voice] speaker mismatch", msg);
        store.addSystemMessage(
          `Voice doesn't match enrolled profile (score: ${msg.score.toFixed(2)})`
        );
      }
    }));

    unsubs.push(client.on("system.info", (msg: ServerMessage) => {
      if (msg.type === "system.info") {
        store.setSystemInfo((msg as any).data);
      }
    }));

    unsubs.push(client.on("llm.preflight.report", (msg: ServerMessage) => {
      if (msg.type === "llm.preflight.report") {
        store.setLlmPreflight({
          ok: msg.ok,
          status: msg.status,
          message: msg.message,
          required: msg.required,
          baseURL: msg.baseURL,
          providerId: msg.providerId,
          model: msg.model,
          checkedAt: msg.checkedAt,
        });
      }
    }));

    unsubs.push(client.on("runtime.config.report", (msg: ServerMessage) => {
      if (msg.type === "runtime.config.report") {
        store.setRuntimeConfig(msg.config);
      }
    }));

    unsubs.push(client.on("runtime.config.ack", (msg: ServerMessage) => {
      if (msg.type === "runtime.config.ack") {
        store.setRuntimeConfig(msg.config);
        store.setRuntimeConfigAck({
          ok: msg.ok,
          key: msg.key,
          message: msg.message,
          at: Date.now(),
        });
      }
    }));

    unsubs.push(client.on("claude.mem.state", (msg: ServerMessage) => {
      if (msg.type === "claude.mem.state") {
        const hash = JSON.stringify(msg.payload);
        lastRemoteHashRef.current = hash;
        store.applyClaudeMemState(msg.payload);
      }
    }));

    return () => {
      if (syncTimer) clearTimeout(syncTimer);
      unsubscribeMem();
      unsubs.forEach(u => u());
      client.disconnect();
    };
  }, []);

  return clientRef.current;
}
