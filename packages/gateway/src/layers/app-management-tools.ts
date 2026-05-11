/**
 * App Management Tools — Group 2
 * Implements 10 application control operations.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// UC1: Open Application
// ------------------------------------------------------------------

export async function openApp(appName: string): Promise<boolean> {
  try {
    await execAsync(`open -a "${appName}"`);
    return true;
  } catch (e) {
    console.error("openApp failed:", e);
    return false;
  }
}

export async function openAppByBundle(bundleId: string): Promise<boolean> {
  try {
    await execAsync(`open -b "${bundleId}"`);
    return true;
  } catch (e) {
    console.error("openAppByBundle failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// UC2: Force Quit Application
// ------------------------------------------------------------------

export async function forceQuitApp(appName: string): Promise<boolean> {
  try {
    // Try graceful quit first
    await execAsync(`osascript -e 'tell application "${appName}" to quit' 2>/dev/null || true`);
    await new Promise(r => setTimeout(r, 500));
    // Force kill
    await execAsync(`pkill -9 "${appName}" 2>/dev/null || true`);
    return true;
  } catch (e) {
    console.error("forceQuitApp failed:", e);
    return false;
  }
}

export async function forceQuitByPID(pid: number): Promise<boolean> {
  try {
    await execAsync(`kill -9 ${pid}`);
    return true;
  } catch (e) {
    console.error("forceQuitByPID failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// UC3: Minimize All Windows to Dock
// ------------------------------------------------------------------

export async function minimizeAllWindows(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to set visible of every process to true'`);
    await execAsync(`osascript -e 'tell application "System Events" to key code 51 using command down'`);
    return true;
  } catch (e) {
    console.error("minimizeAllWindows failed:", e);
    return false;
  }
}

export async function hideAllApps(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to keystroke "h" using command down, option down'`);
    return true;
  } catch (e) {
    console.error("hideAllApps failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// UC4: Apple Notes + Create Note
// ------------------------------------------------------------------

export async function createNoteInAppleNotes(title: string, content?: string): Promise<boolean> {
  try {
    // Open Notes app
    await execAsync(`open -a "Notes"`);
    await new Promise(r => setTimeout(r, 1000));
    
    // Create new note via AppleScript
    let script = 'tell application "Notes" to activate\n';
    script += 'tell application "System Events" to tell process "Notes"\n';
    script += '  keystroke "n" using command down\n';
    script += 'end tell\n';
    if (title) {
      script += `tell application "Notes" to set body of front note to "${title}"\n`;
    }
    
    await execAsync(`osascript -e '${script}'`);
    return true;
  } catch (e) {
    console.error("createNoteInAppleNotes failed:", e);
    return false;
  }
}

export async function appleNotesCreateNote(title: string): Promise<boolean> {
  try {
    const script = `osascript -e 'tell application "Notes"
      activate
      set newNote to make new note
      set body of newNote to "${title}"
    end tell'`;
    await execAsync(script);
    return true;
  } catch (e) {
    console.error("appleNotesCreateNote failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// UC5: Spotify Controls
// ------------------------------------------------------------------

export async function spotifyPlay(playlistUri?: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Spotify" to activate'`);
    if (playlistUri) {
      await execAsync(`osascript -e 'tell application "Spotify" to play track "${playlistUri}"'`);
    } else {
      // Play random from library
      await execAsync(`osascript -e 'tell application "Spotify" to play'`);
    }
    return true;
  } catch (e) {
    console.error("spotifyPlay failed:", e);
    return false;
  }
}

export async function spotifyPause(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Spotify" to pause'`);
    return true;
  } catch (e) {
    console.error("spotifyPause failed:", e);
    return false;
  }
}

export async function spotifyNextTrack(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Spotify" to next track'`);
    return true;
  } catch (e) {
    console.error("spotifyNextTrack failed:", e);
    return false;
  }
}

export async function spotifyPreviousTrack(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Spotify" to previous track'`);
    return true;
  } catch (e) {
    console.error("spotifyPreviousTrack failed:", e);
    return false;
  }
}

export async function spotifyPlayRandom(): Promise<boolean> {
  try {
    // Get random track from user's saved tracks
    await execAsync(`osascript -e 'tell application "Spotify" to activate'`);
    await execAsync(`osascript -e 'tell application "Spotify" to next track'`);
    return true;
  } catch (e) {
    console.error("spotifyPlayRandom failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// UC6: Calendar Today
// ------------------------------------------------------------------

export async function calendarShowToday(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Calendar" to activate'`);
    await execAsync(`osascript -e 'tell application "System Events" to tell process "Calendar" to keystroke "t" using command down'`);
    return true;
  } catch (e) {
    console.error("calendarShowToday failed:", e);
    return false;
  }
}

export async function calendarGetToday(): Promise<string[]> {
  try {
    const script = `osascript -e 'tell application "Calendar"
      tell calendar 1
        set todayEvents to events where start date is today
        set eventList to {}
        repeat with evt in todayEvents
          set end of eventList to (summary of evt as string) & " - " & (start date of evt as string)
        end repeat
        return eventList as string
      end tell
    end tell'`;
    const { stdout } = await execAsync(script, { encoding: "utf-8" });
    return stdout.trim().split(", ").filter(s => s.length > 0);
  } catch (e) {
    console.error("calendarGetToday failed:", e);
    return [];
  }
}

// ------------------------------------------------------------------
// UC7: Open Mail
// ------------------------------------------------------------------

export async function openMail(): Promise<boolean> {
  try {
    await execAsync(`open -a "Mail"`);
    return true;
  } catch (e) {
    console.error("openMail failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// UC8: Close Finder Windows
// ------------------------------------------------------------------

export async function closeFinderWindows(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Finder" to close every window'`);
    return true;
  } catch (e) {
    console.error("closeFinderWindows failed:", e);
    return false;
  }
}

export async function closeAllFinderWindows(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "System Events" to tell process "Finder" to tell menu bar 1 to click menu item "Close Window" of menu "File"'`);
    return true;
  } catch (e) {
    console.error("closeAllFinderWindows failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// UC9: App Running Status
// ------------------------------------------------------------------

export async function isAppRunning(appName: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`pgrep -x "${appName}"`);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function listRunningApps(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`osascript -e 'tell application "System Events" to get name of every process where background only is false'`, { encoding: "utf-8" });
    return stdout.trim().split(", ");
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Layer Export
// ------------------------------------------------------------------

export class AppManagementLayer {
  openApp = openApp;
  openAppByBundle = openAppByBundle;
  forceQuitApp = forceQuitApp;
  forceQuitByPID = forceQuitByPID;
  minimizeAllWindows = minimizeAllWindows;
  hideAllApps = hideAllApps;
  createNoteInAppleNotes = createNoteInAppleNotes;
  appleNotesCreateNote = appleNotesCreateNote;
  spotifyPlay = spotifyPlay;
  spotifyPause = spotifyPause;
  spotifyNextTrack = spotifyNextTrack;
  spotifyPreviousTrack = spotifyPreviousTrack;
  spotifyPlayRandom = spotifyPlayRandom;
  calendarShowToday = calendarShowToday;
  calendarGetToday = calendarGetToday;
  openMail = openMail;
  closeFinderWindows = closeFinderWindows;
  closeAllFinderWindows = closeAllFinderWindows;
  isAppRunning = isAppRunning;
  listRunningApps = listRunningApps;
}
