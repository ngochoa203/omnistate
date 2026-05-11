/**
 * Notification & Reminder Tools — Advanced alerting.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import * as os from "node:os";


// ------------------------------------------------------------------
// Rich Notifications
// ------------------------------------------------------------------

export interface NotificationOptions {
  title?: string;
  message: string;
  sound?: boolean;
  badge?: number;
  url?: string;
}

export async function showRichNotification(options: NotificationOptions): Promise<boolean> {
  try {
    const title = options.title || "OmniState";
    const sound = options.sound !== false ? "with sound" : "without sound";
    const escapedTitle = title.replace(/"/g, '\\"');
    const escapedMsg = options.message.replace(/"/g, '\\"');
    
    await execAsync(`osascript -e 'display notification "${escapedMsg}" with title "${escapedTitle}" ${sound}'`);
    
    if (options.badge) {
      // Set app badge
      await execAsync(`osascript -e 'set the unread count of the first message of mailbox "INBOX" of application "Mail" to ${options.badge}'`);
    }
    
    return true;
  } catch (e) {
    console.error("showRichNotification failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// Scheduled Reminders
// ------------------------------------------------------------------

export interface Reminder {
  id: string;
  message: string;
  scheduledAt: Date;
  repeat?: "daily" | "weekly" | "monthly";
  callback?: () => void;
}

const reminders: Map<string, Reminder> = new Map();
const timers: Map<string, NodeJS.Timeout> = new Map();

export function scheduleReminder(
  message: string,
  delayMinutes: number,
  repeat?: "daily" | "weekly" | "monthly"
): string {
  const id = `remind-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000);
  
  reminders.set(id, { id, message, scheduledAt, repeat });
  
  const timer = setTimeout(async () => {
    await showRichNotification({ message: `[Reminder] ${message}` });
    
    if (repeat) {
      // Reschedule
      const multiplier = repeat === "daily" ? 1440 : repeat === "weekly" ? 10080 : 43200;
      scheduleReminder(message, multiplier, repeat);
    } else {
      reminders.delete(id);
    }
  }, delayMinutes * 60 * 1000);
  
  timers.set(id, timer);
  return id;
}

export function cancelReminder(id: string): boolean {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
    reminders.delete(id);
    return true;
  }
  return false;
}

export function listReminders(): Reminder[] {
  return Array.from(reminders.values());
}

// ------------------------------------------------------------------
// Countdown Timer
// ------------------------------------------------------------------

export interface Countdown {
  id: string;
  label: string;
  targetTime: Date;
  finished: boolean;
}

const countdowns: Map<string, Countdown> = new Map();
const countdownTimers: Map<string, NodeJS.Timeout> = new Map();

export function startCountdown(label: string, minutes: number): string {
  const id = `countdown-${Date.now()}`;
  const targetTime = new Date(Date.now() + minutes * 60 * 1000);
  
  countdowns.set(id, { id, label, targetTime, finished: false });
  
  const timer = setTimeout(async () => {
    await showRichNotification({
      message: `[Countdown] ${label} finished!`,
      sound: true
    });
    
    const cd = countdowns.get(id);
    if (cd) cd.finished = true;
  }, minutes * 60 * 1000);
  
  countdownTimers.set(id, timer);
  return id;
}

export function getCountdown(id: string): Countdown | null {
  return countdowns.get(id) || null;
}

export function cancelCountdown(id: string): boolean {
  const timer = countdownTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    countdownTimers.delete(id);
    countdowns.delete(id);
    return true;
  }
  return false;
}

// ------------------------------------------------------------------
// Wake-up Alarm
// ------------------------------------------------------------------

export function setAlarm(time: string, message?: string): string {
  // Parse time (HH:MM format)
  const [hours, minutes] = time.split(":").map(Number);
  const now = new Date();
  const alarmDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
  
  if (alarmDate < now) {
    alarmDate.setDate(alarmDate.getDate() + 1);
  }
  
  const delayMs = alarmDate.getTime() - now.getTime();
  const label = message || "Wake up!";
  
  return startCountdown(label, Math.floor(delayMs / 60000));
}

// ------------------------------------------------------------------
// Telegram Integration
// ------------------------------------------------------------------

export async function sendTelegramMessage(message: string): Promise<boolean> {
  try {
    // Use existing Telegram API or webhook
    await execAsync(`curl -s "https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${process.env.TELEGRAM_CHAT_ID}" \
      -d "text=${encodeURIComponent(message)}"`, { encoding: "utf-8" });
    return true;
  } catch (e) {
    console.error("sendTelegramMessage failed:", e);
    return false;
  }
}

export async function sendTelegramWithPhoto(message: string, photoPath: string): Promise<boolean> {
  try {
    await execAsync(`curl -s "https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto" \
      -F "chat_id=${process.env.TELEGRAM_CHAT_ID}" \
      -F "caption=${encodeURIComponent(message)}" \
      -F "photo=@${photoPath}"`, { encoding: "utf-8" });
    return true;
  } catch (e) {
    console.error("sendTelegramWithPhoto failed:", e);
    return false;
  }
}

export class NotificationLayer {
  showNotification = showRichNotification;
  scheduleReminder = scheduleReminder;
  cancelReminder = cancelReminder;
  listReminders = listReminders;
  startCountdown = startCountdown;
  getCountdown = getCountdown;
  cancelCountdown = cancelCountdown;
  setAlarm = setAlarm;
  sendTelegram = sendTelegramMessage;
  sendTelegramPhoto = sendTelegramWithPhoto;
}
