/**
 * Date, Time & Scheduling Tools — Group 21
 * Implements: Time operations, scheduling, calendar integration, world clock
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);


// ------------------------------------------------------------------
// Current Time Operations
// ------------------------------------------------------------------

export async function getCurrentTime(): Promise<{ time: string; date: string; timezone: string; unix: number }> {
  const now = new Date();
  return {
    time: now.toLocaleTimeString("en-US", { hour12: false }),
    date: now.toISOString().split("T")[0],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    unix: Math.floor(now.getTime() / 1000)
  };
}

export async function setSystemTime(date: Date): Promise<boolean> {
  try {
    const isoDate = date.toISOString();
    await execAsync(`date -f "%Y-%m-%dT%H:%M:%S" "${isoDate}" 2>/dev/null || echo 'sudo required'`);
    return true;
  } catch {
    return false;
  }
}

export async function getTimezones(): Promise<{ name: string; offset: string }[]> {
  return [
    { name: "America/New_York", offset: "-05:00" },
    { name: "America/Los_Angeles", offset: "-08:00" },
    { name: "Europe/London", offset: "+00:00" },
    { name: "Europe/Paris", offset: "+01:00" },
    { name: "Asia/Tokyo", offset: "+09:00" },
    { name: "Asia/Ho_Chi_Minh", offset: "+07:00" },
    { name: "Australia/Sydney", offset: "+11:00" }
  ];
}

export async function getTimeInZone(timezone: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `TZ=${timezone} date "+%Y-%m-%d %H:%M:%S %Z"`,
      { encoding: "utf-8" }
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------
// World Clock
// ------------------------------------------------------------------

export async function getWorldClock(cities: string[]): Promise<{ city: string; time: string; date: string }[]> {
  const timezoneMap: Record<string, string> = {
    "new york": "America/New_York",
    "los angeles": "America/Los_Angeles",
    "london": "Europe/London",
    "paris": "Europe/Paris",
    "tokyo": "Asia/Tokyo",
    "hanoi": "Asia/Ho_Chi_Minh",
    "saigon": "Asia/Ho_Chi_Minh",
    "sydney": "Australia/Sydney",
    "singapore": "Asia/Singapore",
    "dubai": "Asia/Dubai",
    "berlin": "Europe/Berlin"
  };
  
  return Promise.all(cities.map(async city => {
    const tz = timezoneMap[city.toLowerCase()] || city;
    const timeStr = await getTimeInZone(tz);
    const [dateTime] = timeStr.split(" ");
    
    return {
      city,
      time: timeStr.split(" ")[1] || timeStr,
      date: dateTime || timeStr
    };
  }));
}

// ------------------------------------------------------------------
// Timer & Stopwatch
// ------------------------------------------------------------------

interface Timer {
  id: string;
  label: string;
  endTime: number;
  callback?: () => void;
}

const activeTimers: Map<string, Timer> = new Map();

export async function startTimer(label: string, durationSeconds: number): Promise<string> {
  const id = `timer-${Date.now()}`;
  const endTime = Date.now() + durationSeconds * 1000;
  
  activeTimers.set(id, { id, label, endTime });
  
  setTimeout(() => {
    const timer = activeTimers.get(id);
    if (timer) {
      console.log(`Timer "${label}" finished!`);
      timer.callback?.();
      activeTimers.delete(id);
    }
  }, durationSeconds * 1000);
  
  return id;
}

export async function getTimerStatus(id: string): Promise<{ remaining: number; label: string } | null> {
  const timer = activeTimers.get(id);
  if (!timer) return null;
  
  const remaining = Math.max(0, timer.endTime - Date.now());
  return { remaining, label: timer.label };
}

export async function cancelTimer(id: string): Promise<boolean> {
  return activeTimers.delete(id);
}

export async function listTimers(): Promise<{ id: string; label: string; remaining: number }[]> {
  return Array.from(activeTimers.values()).map(t => ({
    id: t.id,
    label: t.label,
    remaining: Math.max(0, t.endTime - Date.now())
  }));
}

// ------------------------------------------------------------------
// Scheduled Tasks
// ------------------------------------------------------------------

interface ScheduledTask {
  id: string;
  name: string;
  schedule: "once" | "daily" | "weekly" | "hourly";
  time?: string;
  dayOfWeek?: number;
  action: string;
  nextRun: Date;
}

const scheduledTasks: Map<string, ScheduledTask> = new Map();

export async function scheduleTask(
  name: string,
  action: string,
  schedule: "once" | "daily" | "weekly" | "hourly",
  options?: { time?: string; dayOfWeek?: number; date?: Date }
): Promise<string> {
  const id = `task-${Date.now()}`;
  
  let nextRun = new Date();
  if (options?.date) {
    nextRun = options.date;
  } else if (schedule === "daily" && options?.time) {
    const [h, m] = options.time.split(":").map(Number);
    nextRun = new Date();
    nextRun.setHours(h, m, 0, 0);
    if (nextRun < new Date()) nextRun.setDate(nextRun.getDate() + 1);
  }
  
  scheduledTasks.set(id, {
    id,
    name,
    schedule,
    time: options?.time,
    dayOfWeek: options?.dayOfWeek,
    action,
    nextRun
  });
  
  // Set up recurring execution
  const delay = nextRun.getTime() - Date.now();
  setTimeout(() => {
    console.log(`Executing scheduled task: ${name}`);
    execAsync(action).catch(console.error);
    
    if (schedule !== "once") {
      // Reschedule
      const interval = schedule === "hourly" ? 3600000 : schedule === "daily" ? 86400000 : 604800000;
      setInterval(() => {
        execAsync(action).catch(console.error);
      }, interval);
    }
  }, Math.max(0, delay));
  
  return id;
}

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  return Array.from(scheduledTasks.values());
}

export async function cancelScheduledTask(id: string): Promise<boolean> {
  return scheduledTasks.delete(id);
}

// ------------------------------------------------------------------
// Pomodoro Integration
// ------------------------------------------------------------------

export async function startPomodoro(
  workMinutes: number = 25,
  breakMinutes: number = 5
): Promise<{ workTimer: string; breakTimer: string }> {
  const workTimer = await startTimer("Work", workMinutes * 60);
  const breakTimer = await startTimer("Break", (workMinutes + breakMinutes) * 60);
  
  return { workTimer, breakTimer };
}

// ------------------------------------------------------------------
// Reminders with Time
// ------------------------------------------------------------------

export async function remindAt(time: Date, message: string): Promise<string> {
  const delay = time.getTime() - Date.now();
  if (delay <= 0) return "";
  
  const id = `remind-${Date.now()}`;
  setTimeout(() => {
    console.log(`Reminder: ${message}`);
    execAsync(`osascript -e 'display notification "${message}" with title "Reminder"'`).catch(() => {});
  }, delay);
  
  return id;
}

export async function remindIn(minutes: number, message: string): Promise<string> {
  return remindAt(new Date(Date.now() + minutes * 60000), message);
}

// ------------------------------------------------------------------
// Calendar Integration
// ------------------------------------------------------------------

export async function getUpcomingEvents(hours: number = 24): Promise<{ title: string; start: Date; end: Date }[]> {
  try {
    const script = `osascript -e 'tell application "Calendar"
      set now to current date
      set futureDate to now + ${hours * 3600}
      tell calendar 1
        set upcoming to events where start date > now and start date < futureDate
        set resultList to {}
        repeat with evt in upcoming
          set end of resultList to (summary of evt as string) & "|" & (start date of evt as string)
        end repeat
        return resultList
      end tell
    end tell'`;
    
    const { stdout } = await execAsync(script, { encoding: "utf-8" });
    
    return stdout.trim().split(", ").filter(l => l.trim()).map(line => {
      const [title, startStr] = line.split("|");
      return {
        title: title || "Event",
        start: new Date(startStr || Date.now()),
        end: new Date()
      };
    });
  } catch {
    return [];
  }
}

export class DateTimeLayer {
  getTime = getCurrentTime;
  setTime = setSystemTime;
  getTimezones = getTimezones;
  getTimeInZone = getTimeInZone;
  
  worldClock = getWorldClock;
  
  startTimer = startTimer;
  getTimerStatus = getTimerStatus;
  cancelTimer = cancelTimer;
  listTimers = listTimers;
  
  scheduleTask = scheduleTask;
  listScheduled = listScheduledTasks;
  cancelScheduled = cancelScheduledTask;
  
  startPomodoro = startPomodoro;
  
  remindAt = remindAt;
  remindIn = remindIn;
  
  getUpcoming = getUpcomingEvents;
}
