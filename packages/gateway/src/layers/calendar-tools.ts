/**
 * Calendar & Scheduling Tools — Event management integration.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);


// ------------------------------------------------------------------
// Calendar Events
// ------------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  location?: string;
  notes?: string;
  isAllDay: boolean;
  calendar: string;
}

export async function getTodayEvents(): Promise<CalendarEvent[]> {
  try {
    const script = `osascript -e 'tell application "Calendar"
      tell calendar 1
        set todayStart to current date
        set time of todayStart to 0
        set todayEnd to todayStart + 86400
        set eventList to events where start date > todayStart and start date < todayEnd
        set resultList to {}
        repeat with evt in eventList
          set end of resultList to (summary of evt as string) & "|" & (start date of evt as string) & "|" & (end date of evt as string)
        end repeat
        return resultList
      end tell
    end tell'`;
    
    const { stdout } = await execAsync(script, { encoding: "utf-8" });
    const lines = stdout.trim().split(", ");
    
    return lines.map((line, i) => {
      const parts = line.split("|");
      return {
        id: `event-${i}`,
        title: parts[0] || "Untitled",
        startDate: new Date(parts[1] || Date.now()),
        endDate: new Date(parts[2] || Date.now() + 3600000),
        isAllDay: false,
        calendar: "Default"
      };
    });
  } catch (e) {
    console.error("getTodayEvents failed:", e);
    return [];
  }
}

export async function getNextEvent(): Promise<CalendarEvent | null> {
  try {
    const script = `osascript -e 'tell application "Calendar"
      tell calendar 1
        set now to current date
        set futureEvents to events where start date > now
        if (count of futureEvents) > 0 then
          set nextEvt to first item of futureEvents
          return (summary of nextEvt as string) & "|" & (start date of nextEvt as string)
        end if
      end tell
    end tell'`;
    
    const { stdout } = await execAsync(script, { encoding: "utf-8" });
    if (!stdout.trim()) return null;
    
    const parts = stdout.trim().split("|");
    return {
      id: "next-event",
      title: parts[0] || "Untitled",
      startDate: new Date(parts[1] || Date.now()),
      endDate: new Date(),
      isAllDay: false,
      calendar: "Default"
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// Create Events
// ------------------------------------------------------------------

export async function createEvent(
  title: string,
  startDate: Date,
  durationMinutes: number = 60,
  options?: { location?: string; notes?: string; calendar?: string }
): Promise<boolean> {
  try {
    const endDate = new Date(startDate.getTime() + durationMinutes * 60000);
    const startStr = startDate.toISOString();
    const endStr = endDate.toISOString();
    
    const script = `osascript -e 'tell application "Calendar"
      tell calendar "${options?.calendar || "Calendar"}"
        make new event at end with properties {summary:"${title}", start date:date "${startStr}", end date:date "${endStr}"}
      end tell
    end tell'`;
    
    await execAsync(script);
    return true;
  } catch (e) {
    console.error("createEvent failed:", e);
    return false;
  }
}

export async function createAllDayEvent(
  title: string,
  date: Date,
  options?: { location?: string; notes?: string }
): Promise<boolean> {
  try {
    const dateStr = date.toISOString().split("T")[0];
    const script = `osascript -e 'tell application "Calendar"
      tell calendar "Calendar"
        make new event at end with properties {summary:"${title}", start date:date "${dateStr}T00:00:00", allday event:true}
      end tell
    end tell'`;
    
    await execAsync(script);
    return true;
  } catch (e) {
    console.error("createAllDayEvent failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// Quick Event Creation
// ------------------------------------------------------------------

export async function quickEvent(title: string): Promise<boolean> {
  // Create event for today at next available hour
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
  
  return createEvent(title, nextHour, 60);
}

// ------------------------------------------------------------------
// Event Operations
// ------------------------------------------------------------------

export async function deleteEvent(eventTitle: string): Promise<boolean> {
  try {
    const script = `osascript -e 'tell application "Calendar"
      tell calendar 1
        set matchingEvents to events where summary contains "${eventTitle}"
        if (count of matchingEvents) > 0 then
          delete first item of matchingEvents
        end if
      end tell
    end tell'`;
    
    await execAsync(script);
    return true;
  } catch (e) {
    console.error("deleteEvent failed:", e);
    return false;
  }
}

export async function findEvents(query: string): Promise<CalendarEvent[]> {
  try {
    const script = `osascript -e 'tell application "Calendar"
      tell calendar 1
        set matchingEvents to events where summary contains "${query}"
        set resultList to {}
        repeat with evt in matchingEvents
          set end of resultList to (summary of evt as string) & "|" & (start date of evt as string)
        end repeat
        return resultList
      end tell
    end tell'`;
    
    const { stdout } = await execAsync(script, { encoding: "utf-8" });
    const lines = stdout.trim().split(", ");
    
    return lines.map((line, i) => {
      const parts = line.split("|");
      return {
        id: `found-${i}`,
        title: parts[0] || "Untitled",
        startDate: new Date(parts[1] || Date.now()),
        endDate: new Date(),
        isAllDay: false,
        calendar: "Default"
      };
    });
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Calendar Navigation
// ------------------------------------------------------------------

export async function openCalendarToday(): Promise<boolean> {
  try {
    await execAsync(`open -a "Calendar"`);
    await execAsync(`osascript -e 'tell application "Calendar" to activate'`);
    await execAsync(`osascript -e 'tell application "System Events" to keystroke "t" using command down'`);
    return true;
  } catch (e) {
    console.error("openCalendarToday failed:", e);
    return false;
  }
}

export async function openCalendarWeek(): Promise<boolean> {
  try {
    await execAsync(`open -a "Calendar"`);
    await execAsync(`osascript -e 'tell application "System Events" to keystroke "2" using command down'`);
    return true;
  } catch (e) {
    console.error("openCalendarWeek failed:", e);
    return false;
  }
}

export class CalendarLayer {
  getTodayEvents = getTodayEvents;
  getNextEvent = getNextEvent;
  createEvent = createEvent;
  createAllDayEvent = createAllDayEvent;
  quickEvent = quickEvent;
  deleteEvent = deleteEvent;
  findEvents = findEvents;
  openToday = openCalendarToday;
  openWeek = openCalendarWeek;
}
