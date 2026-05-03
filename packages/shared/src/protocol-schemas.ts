import { z } from "zod";

// ─── Core client message schemas ─────────────────────────────────────────────

export const ConnectMessageSchema = z.object({
  type: z.literal("connect"),
  auth: z.object({ token: z.string().optional() }),
  role: z.enum(["cli", "ui", "remote", "fleet-agent"]),
});

export const TaskMessageSchema = z.object({
  type: z.literal("task"),
  goal: z.string().min(1),
  mode: z.enum(["auto", "chat", "task"]).optional(),
  layer: z.enum(["deep", "surface", "auto"]).optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        mimeType: z.string(),
        size: z.number(),
        kind: z.enum(["image", "text", "file"]),
        textPreview: z.string().optional(),
        dataBase64: z.string().optional(),
      })
    )
    .optional(),
});

export const StatusQueryMessageSchema = z.object({
  type: z.literal("status.query"),
});

export const HealthQueryMessageSchema = z.object({
  type: z.literal("health.query"),
});

export const RuntimeConfigSetMessageSchema = z.object({
  type: z.literal("runtime.config.set"),
  key: z.enum([
    "provider",
    "model",
    "baseURL",
    "apiKey",
    "voice.lowLatency",
    "voice.autoExecuteTranscript",
    "voice.wake.enabled",
    "voice.wake.phrase",
    "voice.wake.cooldownMs",
    "voice.wake.commandWindowSec",
    "voice.siri.enabled",
    "voice.siri.mode",
    "voice.siri.shortcutName",
    "voice.siri.endpoint",
    "voice.siri.token",
    "vad.silenceThresholdMs",
    "vad.speechThreshold",
    "vad.minSpeechMs",
  ]),
  value: z.union([z.string(), z.boolean(), z.number()]),
});

export const VoiceTranscribeMessageSchema = z.object({
  type: z.literal("voice.transcribe"),
  id: z.string().optional(),
  sessionId: z.string().optional(),
  audio: z.string().min(1),
  format: z.string().optional(),
});

// ─── Discriminated union for incoming client messages ────────────────────────

const ClientMessageUnionSchema = z.discriminatedUnion("type", [
  ConnectMessageSchema,
  TaskMessageSchema,
  StatusQueryMessageSchema,
  HealthQueryMessageSchema,
  RuntimeConfigSetMessageSchema,
  VoiceTranscribeMessageSchema,
  // Remaining message types accepted as typed pass-through
  z.object({ type: z.literal("claude.mem.query") }),
  z.object({ type: z.literal("claude.mem.sync"), payload: z.record(z.unknown()) }),
  z.object({ type: z.literal("history.query"), limit: z.number().optional(), before: z.string().optional() }),
  z.object({ type: z.literal("llm.preflight.query") }),
  z.object({ type: z.literal("runtime.config.get") }),
  z.object({ type: z.literal("runtime.config.upsertProvider"), provider: z.record(z.unknown()), activate: z.boolean().optional(), addToFallback: z.boolean().optional() }),
  z.object({ type: z.literal("runtime.config.deleteProvider"), providerId: z.string().min(1) }),
  z.object({ type: z.literal("admin.shutdown") }),
  z.object({ type: z.literal("vibevoice.start"), sessionId: z.string(), format: z.string().optional(), sampleRate: z.number().optional() }),
  z.object({ type: z.literal("vibevoice.chunk"), sessionId: z.string(), audio: z.string() }),
  z.object({ type: z.literal("vibevoice.end"), sessionId: z.string(), autoExecute: z.boolean().optional(), provider: z.string().optional() }),
  z.object({ type: z.literal("voice.stream.start"), sessionId: z.string(), sampleRate: z.literal(16000), codec: z.literal("pcm16") }),
  z.object({ type: z.literal("voice.stream.stop"), sessionId: z.string() }),
  z.object({ type: z.literal("tts.cancel"), sessionId: z.string() }),
  z.object({ type: z.literal("voice.enroll"), profileId: z.string(), audio: z.string() }),
  z.object({ type: z.literal("voice.verify"), audio: z.string() }),
  z.object({ type: z.literal("system.dashboard"), id: z.string() }),
  z.object({ type: z.literal("permission.policy.get") }),
  z.object({ type: z.literal("permission.policy.update"), policy: z.record(z.unknown()) }),
  z.object({ type: z.literal("permission.history") }),
  z.object({ type: z.literal("permission.start") }),
  z.object({ type: z.literal("permission.stop") }),
  z.object({ type: z.literal("voice.enroll.start"), userId: z.string() }),
  z.object({ type: z.literal("voice.enroll.sample"), audio: z.string(), format: z.string(), phraseIndex: z.number() }),
  z.object({ type: z.literal("voice.enroll.finalize"), userId: z.string() }),
  z.object({ type: z.literal("voice.enroll.cancel"), userId: z.string() }),
  z.object({ type: z.literal("voice.wake.enable"), enabled: z.boolean() }),
  z.object({ type: z.literal("trigger.create"), name: z.string(), condition: z.record(z.unknown()), action: z.record(z.unknown()), description: z.string().optional(), cooldownMs: z.number().optional() }),
  z.object({ type: z.literal("trigger.list") }),
  z.object({ type: z.literal("trigger.update"), triggerId: z.string(), updates: z.record(z.unknown()) }),
  z.object({ type: z.literal("trigger.delete"), triggerId: z.string() }),
  z.object({ type: z.literal("trigger.history"), triggerId: z.string(), limit: z.number().optional() }),
  z.object({ type: z.literal("tools.list") }),
  z.object({ type: z.literal("openclaw.task"), task: z.record(z.unknown()), id: z.string().optional() }),
]);

/**
 * Parse and validate an incoming client message from raw JSON.
 * Returns the validated message or throws a ZodError.
 */
export function parseClientMessage(raw: unknown) {
  return ClientMessageUnionSchema.parse(raw);
}

/**
 * Safe variant — returns { success, data, error } instead of throwing.
 */
export function safeParseClientMessage(raw: unknown) {
  return ClientMessageUnionSchema.safeParse(raw);
}
