import { execSync } from "node:child_process";
import type { IntentHandler, StructuredResponse } from "./types.js";

function runAppleScript(script: string): string {
  return execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
    encoding: "utf-8",
    timeout: 10_000,
  }).trim();
}

export const calendarToday: IntentHandler = async (_args, _ctx): Promise<StructuredResponse> => {
  if (process.platform !== "darwin") {
    return { speak: "Calendar integration is only available on macOS." };
  }

  try {
    const script = `
      tell application "Calendar"
        set todayStart to current date
        set hours of todayStart to 0
        set minutes of todayStart to 0
        set seconds of todayStart to 0
        set todayEnd to todayStart + (24 * 60 * 60 - 1)
        set allCals to every calendar
        set evtList to {}
        repeat with cal in allCals
          set calEvents to (every event of cal whose start date >= todayStart and start date <= todayEnd)
          repeat with evt in calEvents
            set end of evtList to (summary of evt) & " at " & (time string of (start date of evt))
          end repeat
        end repeat
        if (count of evtList) = 0 then
          return "no events"
        else
          return evtList as string
        end if
      end tell
    `.trim();
    const output = runAppleScript(script);
    if (output === "no events") {
      return { speak: "No events scheduled for today.", data: { events: [] } };
    }
    return { speak: `Today's events: ${output}.`, data: { raw: output } };
  } catch (err) {
    return {
      speak: "Could not read calendar. Make sure Calendar.app has accessibility permission.",
      data: { error: err instanceof Error ? err.message : String(err) },
    };
  }
};

export const calendarNext: IntentHandler = async (_args, _ctx): Promise<StructuredResponse> => {
  if (process.platform !== "darwin") {
    return { speak: "Calendar integration is only available on macOS." };
  }

  try {
    const script = `
      tell application "Calendar"
        set nowDate to current date
        set allCals to every calendar
        set nextSummary to ""
        set nextStart to missing value
        repeat with cal in allCals
          set futureEvents to (every event of cal whose start date >= nowDate)
          repeat with evt in futureEvents
            set evtStart to start date of evt
            if nextStart is missing value or evtStart < nextStart then
              set nextStart to evtStart
              set nextSummary to (summary of evt) & " at " & (time string of evtStart) & " on " & (date string of evtStart)
            end if
          end repeat
        end repeat
        if nextSummary is "" then
          return "no upcoming events"
        else
          return nextSummary
        end if
      end tell
    `.trim();
    const output = runAppleScript(script);
    if (output === "no upcoming events") {
      return { speak: "No upcoming events found.", data: { event: null } };
    }
    return { speak: `Next event: ${output}.`, data: { raw: output } };
  } catch (err) {
    return {
      speak: "Could not read calendar. Make sure Calendar.app has accessibility permission.",
      data: { error: err instanceof Error ? err.message : String(err) },
    };
  }
};
