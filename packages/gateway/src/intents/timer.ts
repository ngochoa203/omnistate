import { randomUUID } from "node:crypto";
import type { IntentHandler, StructuredResponse } from "./types.js";

interface TimerEntry {
  id: string;
  label: string;
  durationMs: number;
  endsAt: number;
  handle: ReturnType<typeof setTimeout>;
}

// Keyed by sessionId -> timerId -> entry
const timerStore = new Map<string, Map<string, TimerEntry>>();

function sessionTimers(sessionId: string): Map<string, TimerEntry> {
  let m = timerStore.get(sessionId);
  if (!m) {
    m = new Map();
    timerStore.set(sessionId, m);
  }
  return m;
}

export const timerSet: IntentHandler = async (args, ctx): Promise<StructuredResponse> => {
  const durationMs = Number(args.durationMs ?? 0);
  const label = typeof args.label === "string" ? args.label : "Timer";
  const sid = ctx.sessionId ?? "default";

  if (!durationMs || durationMs <= 0) {
    return { speak: "Please specify a valid duration in milliseconds." };
  }

  const id = randomUUID();
  const endsAt = Date.now() + durationMs;
  const timers = sessionTimers(sid);

  const handle = setTimeout(() => {
    timers.delete(id);
    ctx.logger.info({ tag: "timer", id, label }, "timer fired");
  }, durationMs);

  timers.set(id, { id, label, durationMs, endsAt, handle });

  const secs = Math.round(durationMs / 1000);
  return {
    speak: `Timer set for ${secs} second${secs !== 1 ? "s" : ""}: ${label}.`,
    data: { id, label, durationMs, endsAt },
  };
};

export const timerCancel: IntentHandler = async (args, ctx): Promise<StructuredResponse> => {
  const id = String(args.id ?? "");
  const sid = ctx.sessionId ?? "default";
  const timers = sessionTimers(sid);
  const entry = timers.get(id);

  if (!entry) {
    return { speak: `No timer found with id ${id}.` };
  }

  clearTimeout(entry.handle);
  timers.delete(id);
  return { speak: `Timer "${entry.label}" cancelled.`, data: { id } };
};

export const timerList: IntentHandler = async (_args, ctx): Promise<StructuredResponse> => {
  const sid = ctx.sessionId ?? "default";
  const timers = sessionTimers(sid);

  if (timers.size === 0) {
    return { speak: "No active timers." };
  }

  const now = Date.now();
  const list = Array.from(timers.values()).map((t) => ({
    id: t.id,
    label: t.label,
    remainingMs: Math.max(0, t.endsAt - now),
  }));

  const summary = list
    .map((t) => `${t.label} (${Math.round(t.remainingMs / 1000)}s remaining)`)
    .join(", ");

  return { speak: `Active timers: ${summary}.`, data: { timers: list } };
};
