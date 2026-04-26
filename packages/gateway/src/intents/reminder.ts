import cron from "node-cron";
import { randomUUID } from "node:crypto";
import type { IntentHandler, StructuredResponse } from "./types.js";

interface ReminderEntry {
  id: string;
  message: string;
  at: string;
  task: cron.ScheduledTask;
}

// Keyed by sessionId -> reminderId -> entry
const reminderStore = new Map<string, Map<string, ReminderEntry>>();

function sessionReminders(sessionId: string): Map<string, ReminderEntry> {
  let m = reminderStore.get(sessionId);
  if (!m) {
    m = new Map();
    reminderStore.set(sessionId, m);
  }
  return m;
}

/**
 * Convert an ISO datetime string or cron expression into a cron expression.
 * Accepts: cron string (5 or 6 fields), or ISO-8601 datetime.
 */
function toCronExpression(at: string): string | null {
  const trimmed = at.trim();

  // Already a cron expression (5 or 6 space-separated fields)
  const cronFields = trimmed.split(/\s+/);
  if (cronFields.length >= 5 && cronFields.length <= 6) {
    return trimmed;
  }

  // Try ISO date parse
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;

  const min = d.getMinutes();
  const hour = d.getHours();
  const dom = d.getDate();
  const mon = d.getMonth() + 1;
  return `${min} ${hour} ${dom} ${mon} *`;
}

export const reminderSet: IntentHandler = async (args, ctx): Promise<StructuredResponse> => {
  const at = String(args.at ?? "").trim();
  const message = String(args.message ?? "").trim();
  const sid = ctx.sessionId ?? "default";

  if (!at || !message) {
    return { speak: "Please specify both a time (at) and a message for the reminder." };
  }

  const expr = toCronExpression(at);
  if (!expr) {
    return { speak: `Could not parse time: "${at}". Use a cron expression or ISO datetime.` };
  }

  const id = randomUUID();
  const reminders = sessionReminders(sid);

  const task = cron.schedule(expr, () => {
    reminders.delete(id);
    ctx.logger.info({ tag: "reminder", id, message }, "reminder fired");
  });

  reminders.set(id, { id, message, at, task });

  return {
    speak: `Reminder set for "${at}": ${message}.`,
    data: { id, message, at },
  };
};

export const reminderList: IntentHandler = async (_args, ctx): Promise<StructuredResponse> => {
  const sid = ctx.sessionId ?? "default";
  const reminders = sessionReminders(sid);

  if (reminders.size === 0) return { speak: "No active reminders." };

  const list = Array.from(reminders.values()).map((r) => ({
    id: r.id,
    message: r.message,
    at: r.at,
  }));

  const summary = list.map((r) => `"${r.message}" at ${r.at}`).join(", ");
  return { speak: `Active reminders: ${summary}.`, data: { reminders: list } };
};

export const reminderCancel: IntentHandler = async (args, ctx): Promise<StructuredResponse> => {
  const id = String(args.id ?? "");
  const sid = ctx.sessionId ?? "default";
  const reminders = sessionReminders(sid);
  const entry = reminders.get(id);

  if (!entry) {
    return { speak: `No reminder found with id ${id}.` };
  }

  entry.task.stop();
  reminders.delete(id);
  return { speak: `Reminder "${entry.message}" cancelled.`, data: { id } };
};
