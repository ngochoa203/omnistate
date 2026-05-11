/**
 * Notes & Tasks Layer — Notes, Reminders.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface Note { id: string; title: string; content: string; created: Date; modified: Date; }

export async function searchNotes(query: string): Promise<Note[]> {
  try {
    const script = `tell application "Notes" to get name of every note whose body contains "${query.replace(/"/g, '\\"')}"`;
    const { stdout } = await execAsync(`osascript -e '${script}'`, { encoding: "utf-8", timeout: 15000 });
    return stdout.split(",").map(n => ({ id: "", title: n.trim(), content: "", created: new Date(), modified: new Date() })).filter(n => n.title);
  } catch {
    return [];
  }
}

export async function createNote(title: string, content: string): Promise<{ success: boolean; noteId?: string; error?: string }> {
  try {
    const escapedTitle = title.replace(/"/g, '\\"');
    const escapedContent = content.replace(/"/g, '\\"');
    const script = `tell application "Notes" to tell account "iCloud" to make new note at end with properties {name:"${escapedTitle}", body:"${escapedContent}"}`;
    await execAsync(`osascript -e '${script}'`, { timeout: 10000 });
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listNotes(limit: number = 50): Promise<Note[]> {
  try {
    const script = `tell application "Notes" to get name of every note`;
    const { stdout } = await execAsync(`osascript -e '${script}'`, { encoding: "utf-8", timeout: 15000 });
    return stdout.split(",").slice(0, limit).map(n => ({ id: "", title: n.trim(), content: "", created: new Date(), modified: new Date() })).filter(n => n.title);
  } catch {
    return [];
  }
}

export interface Reminder { id: string; title: string; dueDate?: Date; completed: boolean; priority: number; }

export async function listReminders(): Promise<Reminder[]> {
  try {
    const script = `tell application "Reminders" to get name of every reminder whose completed is false`;
    const { stdout } = await execAsync(`osascript -e '${script}'`, { encoding: "utf-8", timeout: 15000 });
    return stdout.split(",").map(r => ({ id: "", title: r.trim(), completed: false, priority: 0 })).filter(r => r.title);
  } catch {
    return [];
  }
}

export async function createReminder(title: string, options: { dueDate?: Date; priority?: number } = {}): Promise<{ success: boolean; reminderId?: string; error?: string }> {
  try {
    const escapedTitle = title.replace(/"/g, '\\"');
    let script = `tell application "Reminders" to tell list "Reminders" to make new reminder with properties {name:"${escapedTitle}"}`;
    if (options.priority) script = script.replace("}", `, priority:${options.priority}}`);
    await execAsync(`osascript -e '${script}'`, { timeout: 10000 });
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}