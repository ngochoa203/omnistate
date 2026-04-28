import * as HybridAutomation from "../hybrid/automation.js";
import { loadLlmRuntimeConfig } from "../llm/runtime-config.js";
import type { ServerMessage, VoiceState } from "../gateway/protocol.js";
import { getCurrentContext, type OSContextPayload } from "../context/os-context.js";

type Send = (message: ServerMessage) => void;

interface VoiceSession {
  sessionId: string;
  source: "voice" | "wake" | "siri-handoff";
  state: VoiceState;
  chunks: Buffer[];
  transcript?: string;
  taskId?: string;
  contextId?: string;
  context?: OSContextPayload;
  startedAt: string;
  cancellation: AbortController;
  send?: Send;
  autoExecute?: boolean;
  includeContext?: boolean;
}

export class VoiceSessionService {
  private sessions = new Map<string, VoiceSession>();

  constructor(private readonly broadcast: Send) {}

  start(input: { sessionId: string; source?: VoiceSession["source"]; send?: Send; autoExecute?: boolean; includeContext?: boolean }): VoiceSession {
    const session: VoiceSession = {
      sessionId: input.sessionId,
      source: input.source ?? "voice",
      state: "recording",
      chunks: [],
      startedAt: new Date().toISOString(),
      cancellation: new AbortController(),
      send: input.send,
      autoExecute: input.autoExecute,
      includeContext: input.includeContext,
    };
    this.sessions.set(session.sessionId, session);
    this.setState(session.sessionId, "recording");
    return session;
  }

  appendChunk(sessionId: string, chunk: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.cancellation.signal.aborted) return;
    session.chunks.push(chunk);
    this.emit({ type: "voice.transcript.partial", sessionId, text: "" }, session);
  }

  async finalize(sessionId: string, options: { autoExecute?: boolean; includeContext?: boolean } = {}): Promise<{ text: string; provider: string; context?: OSContextPayload }> {
    const session = this.require(sessionId);
    this.setState(sessionId, "transcribing");
    const audio = Buffer.concat(session.chunks);
    const transcript = await this.transcribe(audio);
    session.transcript = transcript.text;

    if (options.includeContext ?? session.includeContext) {
      session.context = await getCurrentContext().catch((err) => ({
        contextId: `ctx-${crypto.randomUUID()}`,
        capturedAt: new Date().toISOString(),
        ttlMs: 5_000,
        source: "unavailable" as const,
        error: err instanceof Error ? err.message : String(err),
      }));
      session.contextId = session.context.contextId;
      this.emit({ type: "voice.context", sessionId, context: session.context }, session);
    }

    this.emit({ type: "voice.transcript.final", sessionId, text: transcript.text, provider: transcript.provider }, session);
    return { ...transcript, context: session.context };
  }

  completeWithText(sessionId: string, text: string, provider = "wake"): void {
    const session = this.sessions.get(sessionId) ?? this.start({ sessionId, source: "wake" });
    session.transcript = text;
    this.emit({ type: "voice.transcript.final", sessionId, text, provider }, session);
  }

  setTask(sessionId: string, taskId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.taskId = taskId;
    this.setState(sessionId, "executing", taskId);
  }

  setState(sessionId: string, state: VoiceState, taskId?: string, error?: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.state = state;
    this.emit({ type: "voice.state", sessionId, state, source: session?.source, taskId: taskId ?? session?.taskId, error }, session);
  }

  cancel(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    session.cancellation.abort();
    this.setState(sessionId, "interrupted");
    this.sessions.delete(sessionId);
    return session.taskId;
  }

  get(sessionId: string): VoiceSession | undefined {
    return this.sessions.get(sessionId);
  }

  private emit(message: ServerMessage, session?: VoiceSession): void {
    this.broadcast(message);
    session?.send?.(message);
  }

  private require(sessionId: string): VoiceSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown voice session: ${sessionId}`);
    return session;
  }

  private async transcribe(audioBuffer: Buffer): Promise<{ text: string; provider: string }> {
    if (!audioBuffer.length) return { text: "", provider: "" };
    const voice = loadLlmRuntimeConfig().voice;
    const providers = [voice.primaryProvider, ...voice.fallbackProviders]
      .filter((p, i, arr) => arr.indexOf(p) === i) as Array<"native" | "whisper-local" | "whisper-cloud">;
    const ordered = voice.lowLatency ? ["native", ...providers.filter((p) => p !== "native")] as typeof providers : providers;

    try {
      return await Promise.any(ordered.map(async (provider) => {
        const result = await HybridAutomation.transcribeAudio(audioBuffer, provider);
        const text = result.text.trim();
        if (!text) throw new Error(`empty transcript from ${provider}`);
        return { text, provider };
      }));
    } catch {
      for (const provider of ordered) {
        try {
          const result = await HybridAutomation.transcribeAudio(audioBuffer, provider);
          const text = result.text.trim();
          if (text) return { text, provider };
        } catch {
          // try next provider
        }
      }
    }
    return { text: "", provider: "" };
  }
}
