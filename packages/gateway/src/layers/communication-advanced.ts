/**
 * Communication Advanced Layer — Messages, Mail, Calendar.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function sendMessage(recipient: string, text: string): Promise<{ success: boolean; error?: string }> {
  try {
    const handle = recipient.replace(/[\s\-\(\)]/g, "");
    const escapedText = text.replace(/"/g, '\\"');
    const script = `tell application "Messages" to send "${escapedText}" to buddy "${handle}"`;
    await execAsync(`osascript -e '${script}'`, { timeout: 15000 });
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendEmail(to: string, subject: string, body: string, options: { cc?: string; attachments?: string[] } = {}): Promise<{ success: boolean; error?: string }> {
  void options;
  try {
    const escapedBody = body.replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const escapedSubject = subject.replace(/"/g, '\\"');
    let script = `tell application "Mail" to set newMessage to make new outgoing message with properties {subject:"${escapedSubject}", content:"${escapedBody}", visible:true}`;
    script += `; tell newMessage to make new to recipient at end of to recipients with properties {address:"${to}"}; send newMessage`;
    await execAsync(`osascript -e '${script}'`, { timeout: 20000 });
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getTodayEvents(): Promise<Array<{ title: string; start: Date; end: Date; location?: string }>> {
  try {
    const script = `tell application "Calendar" to tell calendar "Calendar" to get start date of every event`;
    const { stdout } = await execAsync(`osascript -e '${script}'`, { encoding: "utf-8", timeout: 15000 });
    if (!stdout.trim()) return [];
    return stdout.split(",").map(s => ({ title: s.trim(), start: new Date(), end: new Date() })).filter(e => e.title);
  } catch {
    return [];
  }
}

export async function createCalendarEvent(title: string, startDate: Date, endDate: Date, options: { location?: string; notes?: string } = {}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  void options;
  try {
    const escapedTitle = title.replace(/"/g, '\\"');
    const script = `tell application "Calendar" to tell calendar "Calendar" to make new event at end with properties {summary:"${escapedTitle}", start date:date "${startDate.toISOString()}", end date:date "${endDate.toISOString()}"}`;
    await execAsync(`osascript -e '${script}'`, { timeout: 10000 });
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}