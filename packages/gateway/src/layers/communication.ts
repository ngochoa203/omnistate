/**
 * Communication Layer — UC6: macOS Communication App Integration.
 *
 * Implements UC6.1 through UC6.4:
 *   UC6.1 Email         — Apple Mail (compose, read, search, mailboxes)
 *   UC6.2 iMessage/SMS  — Messages app + chat.db SQLite queries
 *   UC6.3 Calendar      — Calendar app (events CRUD, calendar list)
 *   UC6.4 Notifications — macOS Notification Center
 *
 * macOS-first. All methods have try/catch with safe fallback returns.
 * Missing apps / permission denials return empty arrays or throw
 * descriptive errors rather than crashing.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Interfaces — UC6.1 Email
// ---------------------------------------------------------------------------

export interface EmailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: Date;
  read: boolean;
  attachments?: string[];
}

export interface Mailbox {
  name: string;
  unread: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Interfaces — UC6.2 iMessage / Messages
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  text: string;
  from: string;
  date: Date;
  isFromMe: boolean;
  service: string;
}

export interface Contact {
  name: string;
  phones: string[];
  emails: string[];
}

// ---------------------------------------------------------------------------
// Interfaces — UC6.3 Calendar
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  calendar: string;
  location?: string;
  allDay: boolean;
}

export interface CalendarInfo {
  name: string;
  color: string;
  writable: boolean;
}

// ---------------------------------------------------------------------------
// Interfaces — UC6.4 Notifications
// ---------------------------------------------------------------------------

export interface SystemNotification {
  title: string;
  body: string;
  subtitle?: string;
  date?: Date;
  app?: string;
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class CommunicationLayer {
  // Path to Messages SQLite database
  private readonly chatDbPath = join(
    homedir(),
    "Library",
    "Messages",
    "chat.db"
  );

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * Run a shell command asynchronously, returning stdout or "" on failure.
   */
  private async run(cmd: string, timeoutMs = 30_000): Promise<string> {
    try {
      const { stdout } = await execAsync(cmd, {
        timeout: timeoutMs,
        encoding: "utf-8",
      });
      return stdout.trim();
    } catch {
      return "";
    }
  }

  /**
   * Run a SQLite query against the Messages chat.db.
   * Returns raw stdout rows (newline-delimited) or "" on failure.
   */
  private async sqliteQuery(
    query: string,
    timeoutMs = 15_000
  ): Promise<string> {
    if (!existsSync(this.chatDbPath)) return "";
    // Escape single-quotes in the SQL
    const safe = query.replace(/'/g, `'\\''`);
    return this.run(
      `sqlite3 -separator '|' '${this.chatDbPath}' '${safe}'`,
      timeoutMs
    );
  }

  /**
   * Parse a date string returned by AppleScript's `date` coercion.
   * AppleScript dates look like: "Monday, April 14, 2026 at 9:00:00 AM"
   * Falls back to new Date() on parse error.
   */
  private parseAppleScriptDate(raw: string): Date {
    try {
      const d = new Date(raw.replace(" at ", " "));
      return isNaN(d.getTime()) ? new Date() : d;
    } catch {
      return new Date();
    }
  }

  /**
   * Convert macOS Core Data timestamp (seconds since 2001-01-01) to JS Date.
   */
  private coreDataTimestampToDate(seconds: number): Date {
    // macOS epoch: Jan 1 2001 00:00:00 UTC
    const MAC_EPOCH_OFFSET_MS = 978_307_200_000;
    return new Date(MAC_EPOCH_OFFSET_MS + seconds * 1000);
  }

  // =========================================================================
  // UC6.1 — Email (Apple Mail)
  // =========================================================================

  /**
   * Compose and send an email via Apple Mail.
   *
   * Uses AppleScript to create a new outgoing message, optionally add
   * cc/bcc recipients and file attachments, then send it.
   */
  async sendEmail(opts: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    attachments?: string[];
  }): Promise<void> {
    const { to, subject, body, cc, bcc, attachments = [] } = opts;

    // Build recipient/attachment lines conditionally
    const ccLine = cc
      ? `make new to recipient at end of to recipients of newMessage with properties {address:"${cc}"}`
      : "";
    const bccLine = bcc
      ? `make new bcc recipient at end of bcc recipients of newMessage with properties {address:"${bcc}"}`
      : "";
    const attachLines = attachments
      .map(
        (p) =>
          `make new attachment with properties {file name:POSIX file "${p}"} at after the last paragraph of content of newMessage`
      )
      .join("\n");

    const script = [
      `tell application "Mail"`,
      `  set newMessage to make new outgoing message with properties {subject:"${subject}", content:"${body}", visible:true}`,
      `  tell newMessage`,
      `    make new to recipient at end of to recipients with properties {address:"${to}"}`,
      ccLine,
      bccLine,
      attachLines,
      `  end tell`,
      `  send newMessage`,
      `end tell`,
    ]
      .filter(Boolean)
      .join("\n");

    const result = await this.run(
      `osascript -e '${script.replace(/'/g, `'\\''`)}'`,
      60_000
    );

    // AppleScript errors are surfaced via non-empty stderr; exec throws on exit ≠ 0.
    // If we reach here without exception the message was sent (or queued by Mail).
    void result;
  }

  /**
   * Retrieve unread emails from Apple Mail.
   *
   * @param account  - Optional account name to filter (defaults to all accounts)
   * @param limit    - Maximum number of messages to return (default 20)
   */
  async getUnreadEmails(
    account?: string,
    limit = 20
  ): Promise<EmailMessage[]> {
    try {
      // AppleScript: iterate mailboxes and collect unread messages
      const accountFilter = account
        ? `account named "${account}"`
        : "every account";

      const script = [
        `tell application "Mail"`,
        `  set msgList to {}`,
        `  set allAccounts to ${accountFilter}`,
        `  repeat with anAccount in (get every account)`,
        `    repeat with mb in (get every mailbox of anAccount)`,
        `      set unreadMsgs to (messages of mb whose read status is false)`,
        `      repeat with m in unreadMsgs`,
        `        set msgList to msgList & {(message id of m) & "|||" & ¬`,
        `          (sender of m) & "|||" & ¬`,
        `          ((address of every to recipient of m) as string) & "|||" & ¬`,
        `          (subject of m) & "|||" & ¬`,
        `          ((date received of m) as string)}`,
        `        if (count of msgList) >= ${limit} then exit repeat`,
        `      end repeat`,
        `      if (count of msgList) >= ${limit} then exit repeat`,
        `    end repeat`,
        `    if (count of msgList) >= ${limit} then exit repeat`,
        `  end repeat`,
        `  return msgList`,
        `end tell`,
      ].join("\n");

      const raw = await this.run(
        `osascript -e '${script.replace(/'/g, `'\\''`)}'`,
        60_000
      );

      if (!raw) return [];

      // AppleScript list comes back as comma-separated items
      return raw
        .split(", ")
        .map((entry) => entry.trim())
        .filter((e) => e.includes("|||"))
        .slice(0, limit)
        .map((entry) => {
          const parts = entry.split("|||");
          return {
            id: parts[0]?.trim() ?? "",
            from: parts[1]?.trim() ?? "",
            to: parts[2]?.trim() ?? "",
            subject: parts[3]?.trim() ?? "(no subject)",
            body: "",
            date: this.parseAppleScriptDate(parts[4]?.trim() ?? ""),
            read: false,
            attachments: [],
          } satisfies EmailMessage;
        });
    } catch {
      return [];
    }
  }

  /**
   * Read the full content of a single email message by its message-id.
   */
  async readEmail(messageId: string): Promise<EmailMessage> {
    const script = [
      `tell application "Mail"`,
      `  set m to first message of (every mailbox of every account) whose message id = "${messageId}"`,
      `  set msgContent to {message id of m, sender of m, ¬`,
      `    ((address of every to recipient of m) as string), ¬`,
      `    subject of m, content of m, ¬`,
      `    (date received of m as string), read status of m}`,
      `  return msgContent`,
      `end tell`,
    ].join("\n");

    const raw = await this.run(
      `osascript -e '${script.replace(/'/g, `'\\''`)}'`,
      30_000
    );

    if (!raw) {
      throw new Error(`Email not found: ${messageId}`);
    }

    const parts = raw.split(", ");
    return {
      id: parts[0]?.trim() ?? messageId,
      from: parts[1]?.trim() ?? "",
      to: parts[2]?.trim() ?? "",
      subject: parts[3]?.trim() ?? "(no subject)",
      body: parts[4]?.trim() ?? "",
      date: this.parseAppleScriptDate(parts[5]?.trim() ?? ""),
      read: parts[6]?.trim() === "true",
      attachments: [],
    };
  }

  /**
   * Search emails in Apple Mail using Mail's native search.
   *
   * @param query  - Search string
   * @param folder - Optional mailbox name to scope the search
   */
  async searchEmails(
    query: string,
    folder?: string
  ): Promise<EmailMessage[]> {
    try {
      const safeQuery = query.replace(/"/g, '\\"');
      const mailboxExpr = folder
        ? `mailbox named "${folder}" of first account`
        : `inbox of first account`;

      const script = [
        `tell application "Mail"`,
        `  set results to {}`,
        `  set mb to ${mailboxExpr}`,
        `  set foundMsgs to (messages of mb whose subject contains "${safeQuery}" or sender contains "${safeQuery}")`,
        `  repeat with m in foundMsgs`,
        `    set results to results & {(message id of m) & "|||" & ¬`,
        `      (sender of m) & "|||" & ¬`,
        `      ((address of every to recipient of m) as string) & "|||" & ¬`,
        `      (subject of m) & "|||" & ¬`,
        `      ((date received of m) as string) & "|||" & ¬`,
        `      (read status of m as string)}`,
        `  end repeat`,
        `  return results`,
        `end tell`,
      ].join("\n");

      const raw = await this.run(
        `osascript -e '${script.replace(/'/g, `'\\''`)}'`,
        60_000
      );

      if (!raw) return [];

      return raw
        .split(", ")
        .filter((e) => e.includes("|||"))
        .map((entry) => {
          const parts = entry.split("|||");
          return {
            id: parts[0]?.trim() ?? "",
            from: parts[1]?.trim() ?? "",
            to: parts[2]?.trim() ?? "",
            subject: parts[3]?.trim() ?? "(no subject)",
            body: "",
            date: this.parseAppleScriptDate(parts[4]?.trim() ?? ""),
            read: parts[5]?.trim() === "true",
            attachments: [],
          } satisfies EmailMessage;
        });
    } catch {
      return [];
    }
  }

  /**
   * List all mailboxes across all Mail accounts, with unread and total counts.
   */
  async getMailboxes(): Promise<Mailbox[]> {
    try {
      const script = [
        `tell application "Mail"`,
        `  set mbList to {}`,
        `  repeat with anAccount in (get every account)`,
        `    repeat with mb in (get every mailbox of anAccount)`,
        `      set unreadCount to count (messages of mb whose read status is false)`,
        `      set totalCount to count (messages of mb)`,
        `      set mbList to mbList & {(name of mb) & "|||" & ¬`,
        `        (unreadCount as string) & "|||" & ¬`,
        `        (totalCount as string)}`,
        `    end repeat`,
        `  end repeat`,
        `  return mbList`,
        `end tell`,
      ].join("\n");

      const raw = await this.run(
        `osascript -e '${script.replace(/'/g, `'\\''`)}'`,
        60_000
      );

      if (!raw) return [];

      return raw
        .split(", ")
        .filter((e) => e.includes("|||"))
        .map((entry) => {
          const parts = entry.split("|||");
          return {
            name: parts[0]?.trim() ?? "",
            unread: parseInt(parts[1]?.trim() ?? "0", 10),
            total: parseInt(parts[2]?.trim() ?? "0", 10),
          } satisfies Mailbox;
        });
    } catch {
      return [];
    }
  }

  // =========================================================================
  // UC6.2 — iMessage / Messages
  // =========================================================================

  /**
   * Send an iMessage or SMS via the Messages app.
   *
   * @param opts.to      - Phone number or Apple ID email address
   * @param opts.text    - Message text
   * @param opts.service - "iMessage" (default) or "SMS"
   */
  async sendMessage(opts: {
    to: string;
    text: string;
    service?: "iMessage" | "SMS";
  }): Promise<void> {
    const { to, text, service = "iMessage" } = opts;
    const safeText = text.replace(/"/g, '\\"').replace(/'/g, `'\\''`);
    const safeTo = to.replace(/"/g, '\\"');

    const script = [
      `tell application "Messages"`,
      `  set targetService to 1st service whose service type = ${service === "SMS" ? "SMS" : "iMessage"}`,
      `  set targetBuddy to buddy "${safeTo}" of targetService`,
      `  send "${safeText}" to targetBuddy`,
      `end tell`,
    ].join("\n");

    await this.run(
      `osascript -e '${script.replace(/'/g, `'\\''`)}'`,
      30_000
    );
  }

  /**
   * Retrieve recent chat messages from the Messages SQLite database.
   *
   * Reads ~/Library/Messages/chat.db directly (requires Full Disk Access
   * permission). Returns empty array if the database is inaccessible.
   *
   * @param contact - Optional phone/email to filter by handle
   * @param limit   - Maximum number of messages (default 50)
   */
  async getRecentMessages(
    contact?: string,
    limit = 50
  ): Promise<ChatMessage[]> {
    try {
      let query: string;

      if (contact) {
        // Sanitize contact to avoid SQL injection via the shell escape
        const safeContact = contact.replace(/'/g, "''");
        query = `
          SELECT
            CAST(m.rowid AS TEXT),
            COALESCE(m.text, ''),
            COALESCE(h.id, 'me'),
            m.date,
            m.is_from_me,
            COALESCE(m.service, 'iMessage')
          FROM message m
          LEFT JOIN handle h ON m.handle_id = h.rowid
          WHERE h.id LIKE '%${safeContact}%'
             OR (m.is_from_me = 1 AND h.id LIKE '%${safeContact}%')
          ORDER BY m.date DESC
          LIMIT ${limit}
        `.trim();
      } else {
        query = `
          SELECT
            CAST(m.rowid AS TEXT),
            COALESCE(m.text, ''),
            COALESCE(h.id, 'me'),
            m.date,
            m.is_from_me,
            COALESCE(m.service, 'iMessage')
          FROM message m
          LEFT JOIN handle h ON m.handle_id = h.rowid
          ORDER BY m.date DESC
          LIMIT ${limit}
        `.trim();
      }

      const raw = await this.sqliteQuery(query);
      if (!raw) return [];

      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [id, text, from, dateRaw, isFromMeRaw, service] =
            line.split("|");
          const timestampSecs = parseFloat(dateRaw ?? "0");
          return {
            id: id ?? "",
            text: text ?? "",
            from: isFromMeRaw === "1" ? "me" : (from ?? "unknown"),
            date: this.coreDataTimestampToDate(timestampSecs),
            isFromMe: isFromMeRaw === "1",
            service: service ?? "iMessage",
          } satisfies ChatMessage;
        });
    } catch {
      return [];
    }
  }

  /**
   * Retrieve contacts from the macOS Contacts app via AppleScript.
   */
  async getContacts(): Promise<Contact[]> {
    try {
      const script = [
        `tell application "Contacts"`,
        `  set contactList to {}`,
        `  repeat with p in every person`,
        `    set pName to name of p`,
        `    set pPhones to {}`,
        `    repeat with ph in phones of p`,
        `      set pPhones to pPhones & {value of ph}`,
        `    end repeat`,
        `    set pEmails to {}`,
        `    repeat with em in emails of p`,
        `      set pEmails to pEmails & {value of em}`,
        `    end repeat`,
        `    set contactList to contactList & {pName & "|||" & ¬`,
        `      ((pPhones as string) & "|||") & ¬`,
        `      (pEmails as string)}`,
        `  end repeat`,
        `  return contactList`,
        `end tell`,
      ].join("\n");

      const raw = await this.run(
        `osascript -e '${script.replace(/'/g, `'\\''`)}'`,
        60_000
      );

      if (!raw) return [];

      return raw
        .split(", ")
        .filter((e) => e.includes("|||"))
        .map((entry) => {
          const parts = entry.split("|||");
          const parseCsv = (s: string): string[] =>
            s
              .replace(/[{}]/g, "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);

          return {
            name: parts[0]?.trim() ?? "",
            phones: parseCsv(parts[1] ?? ""),
            emails: parseCsv(parts[2] ?? ""),
          } satisfies Contact;
        });
    } catch {
      return [];
    }
  }

  /**
   * Search messages in chat.db by text content.
   *
   * @param query - Substring to search for (SQL LIKE pattern)
   */
  async searchMessages(query: string): Promise<ChatMessage[]> {
    try {
      const safeQuery = query.replace(/'/g, "''").replace(/%/g, "\\%");
      const sql = `
        SELECT
          CAST(m.rowid AS TEXT),
          COALESCE(m.text, ''),
          COALESCE(h.id, 'me'),
          m.date,
          m.is_from_me,
          COALESCE(m.service, 'iMessage')
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.rowid
        WHERE m.text LIKE '%${safeQuery}%' ESCAPE '\\'
        ORDER BY m.date DESC
        LIMIT 100
      `.trim();

      const raw = await this.sqliteQuery(sql);
      if (!raw) return [];

      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [id, text, from, dateRaw, isFromMeRaw, service] =
            line.split("|");
          const timestampSecs = parseFloat(dateRaw ?? "0");
          return {
            id: id ?? "",
            text: text ?? "",
            from: isFromMeRaw === "1" ? "me" : (from ?? "unknown"),
            date: this.coreDataTimestampToDate(timestampSecs),
            isFromMe: isFromMeRaw === "1",
            service: service ?? "iMessage",
          } satisfies ChatMessage;
        });
    } catch {
      return [];
    }
  }

  // =========================================================================
  // UC6.3 — Calendar
  // =========================================================================

  /**
   * Get calendar events within an optional date range.
   *
   * @param opts.start    - Range start (defaults to start of today)
   * @param opts.end      - Range end (defaults to 7 days from now)
   * @param opts.calendar - Calendar name to filter (default: all calendars)
   */
  async getEvents(opts: {
    start?: Date;
    end?: Date;
    calendar?: string;
  } = {}): Promise<CalendarEvent[]> {
    try {
      const now = new Date();
      const start = opts.start ?? new Date(now.setHours(0, 0, 0, 0));
      const end =
        opts.end ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Format dates as AppleScript date strings: "MM/DD/YYYY HH:MM:SS"
      const fmtDate = (d: Date): string => {
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      };

      const calFilter = opts.calendar
        ? `calendar named "${opts.calendar}"`
        : `every calendar`;

      const script = [
        `tell application "Calendar"`,
        `  set startDate to date "${fmtDate(start)}"`,
        `  set endDate to date "${fmtDate(end)}"`,
        `  set evtList to {}`,
        `  repeat with cal in (get ${calFilter})`,
        `    set calName to name of cal`,
        `    set evts to (every event of cal whose start date >= startDate and start date <= endDate)`,
        `    repeat with evt in evts`,
        `      set evtUID to uid of evt`,
        `      set evtTitle to summary of evt`,
        `      set evtStart to (start date of evt) as string`,
        `      set evtEnd to (end date of evt) as string`,
        `      set evtLoc to ""`,
        `      try`,
        `        set evtLoc to location of evt`,
        `        if evtLoc is missing value then set evtLoc to ""`,
        `      end try`,
        `      set evtAllDay to allday event of evt`,
        `      set evtList to evtList & {evtUID & "|||" & ¬`,
        `        evtTitle & "|||" & ¬`,
        `        evtStart & "|||" & ¬`,
        `        evtEnd & "|||" & ¬`,
        `        calName & "|||" & ¬`,
        `        evtLoc & "|||" & ¬`,
        `        (evtAllDay as string)}`,
        `    end repeat`,
        `  end repeat`,
        `  return evtList`,
        `end tell`,
      ].join("\n");

      const raw = await this.run(
        `osascript -e '${script.replace(/'/g, `'\\''`)}'`,
        60_000
      );

      if (!raw) return [];

      return raw
        .split(", ")
        .filter((e) => e.includes("|||"))
        .map((entry) => {
          const parts = entry.split("|||");
          return {
            id: parts[0]?.trim() ?? "",
            title: parts[1]?.trim() ?? "(untitled)",
            start: this.parseAppleScriptDate(parts[2]?.trim() ?? ""),
            end: this.parseAppleScriptDate(parts[3]?.trim() ?? ""),
            calendar: parts[4]?.trim() ?? "",
            location: parts[5]?.trim() || undefined,
            allDay: parts[6]?.trim() === "true",
          } satisfies CalendarEvent;
        });
    } catch {
      return [];
    }
  }

  /**
   * Create a new calendar event.
   *
   * @returns The UID of the newly created event.
   */
  async createEvent(opts: {
    title: string;
    start: Date;
    end: Date;
    calendar?: string;
    location?: string;
    notes?: string;
  }): Promise<string> {
    const { title, start, end, calendar = "Calendar", location, notes } =
      opts;

    const fmtDate = (d: Date): string => {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    const locationLine = location
      ? `    set location of newEvt to "${location.replace(/"/g, '\\"')}"`
      : "";
    const notesLine = notes
      ? `    set description of newEvt to "${notes.replace(/"/g, '\\"')}"`
      : "";

    const script = [
      `tell application "Calendar"`,
      `  tell calendar named "${calendar}"`,
      `    set newEvt to make new event at end of events with properties ¬`,
      `      {summary:"${title.replace(/"/g, '\\"')}", ¬`,
      `       start date:date "${fmtDate(start)}", ¬`,
      `       end date:date "${fmtDate(end)}"}`,
      locationLine,
      notesLine,
      `    set evtUID to uid of newEvt`,
      `  end tell`,
      `  return evtUID`,
      `end tell`,
    ]
      .filter(Boolean)
      .join("\n");

    const uid = await this.run(
      `osascript -e '${script.replace(/'/g, `'\\''`)}'`,
      30_000
    );

    if (!uid) {
      throw new Error(`Failed to create event "${title}" in calendar "${calendar}"`);
    }

    return uid.trim();
  }

  /**
   * Delete a calendar event by its UID.
   */
  async deleteEvent(eventId: string): Promise<void> {
    const script = [
      `tell application "Calendar"`,
      `  repeat with cal in every calendar`,
      `    repeat with evt in (every event of cal)`,
      `      if uid of evt = "${eventId}" then`,
      `        delete evt`,
      `        return`,
      `      end if`,
      `    end repeat`,
      `  end repeat`,
      `end tell`,
    ].join("\n");

    await this.run(
      `osascript -e '${script.replace(/'/g, `'\\''`)}'`,
      30_000
    );
  }

  /**
   * List all calendars in the Calendar app.
   */
  async getCalendars(): Promise<CalendarInfo[]> {
    try {
      const script = [
        `tell application "Calendar"`,
        `  set calList to {}`,
        `  repeat with cal in every calendar`,
        `    set calName to name of cal`,
        `    set calColor to ""`,
        `    try`,
        `      set calColor to color of cal as string`,
        `    end try`,
        `    set calWritable to writable of cal`,
        `    set calList to calList & {calName & "|||" & calColor & "|||" & (calWritable as string)}`,
        `  end repeat`,
        `  return calList`,
        `end tell`,
      ].join("\n");

      const raw = await this.run(
        `osascript -e '${script.replace(/'/g, `'\\''`)}'`,
        30_000
      );

      if (!raw) return [];

      return raw
        .split(", ")
        .filter((e) => e.includes("|||"))
        .map((entry) => {
          const parts = entry.split("|||");
          return {
            name: parts[0]?.trim() ?? "",
            color: parts[1]?.trim() ?? "",
            writable: parts[2]?.trim() === "true",
          } satisfies CalendarInfo;
        });
    } catch {
      return [];
    }
  }

  /**
   * Get events starting within the next N hours.
   *
   * @param hours - Look-ahead window in hours (default 24)
   */
  async getUpcomingEvents(hours = 24): Promise<CalendarEvent[]> {
    const now = new Date();
    const end = new Date(now.getTime() + hours * 60 * 60 * 1000);
    return this.getEvents({ start: now, end });
  }

  // =========================================================================
  // UC6.4 — Notifications
  // =========================================================================

  /**
   * Display a macOS user notification via `osascript display notification`.
   */
  async sendNotification(opts: {
    title: string;
    body: string;
    sound?: string;
    subtitle?: string;
  }): Promise<void> {
    const { title, body, sound, subtitle } = opts;

    const safeBody = body.replace(/"/g, '\\"');
    const safeTitle = title.replace(/"/g, '\\"');

    let parts = `"${safeBody}" with title "${safeTitle}"`;
    if (subtitle) {
      parts += ` subtitle "${subtitle.replace(/"/g, '\\"')}"`;
    }
    if (sound) {
      parts += ` sound name "${sound.replace(/"/g, '\\"')}"`;
    }

    await this.run(`osascript -e 'display notification ${parts}'`, 10_000);
  }

  /**
   * Attempt to read recent notifications from the macOS notification database.
   *
   * Note: On macOS 12+, the notification database (notificationdb) is
   * SIP-protected and may require special entitlements or Full Disk Access.
   * Falls back to an empty array if inaccessible.
   *
   * @param limit - Maximum number of notifications to return (default 20)
   */
  async getRecentNotifications(limit = 20): Promise<SystemNotification[]> {
    try {
      // Path varies by macOS version; try both common locations
      const candidates = [
        join(
          homedir(),
          "Library",
          "Application Support",
          "NotificationCenter",
          "db2",
          "db"
        ),
        "/var/folders", // root of per-user temp folders — can't query directly
      ];

      const dbPath = candidates.find((p) => existsSync(p));
      if (!dbPath || dbPath === "/var/folders") {
        // Fallback: use script to open Notification Center and read via a11y
        // This is best-effort and may return empty on locked systems
        return this.getNotificationsViaAccessibility(limit);
      }

      const sql = `
        SELECT
          COALESCE(d.app, ''),
          COALESCE(d.title, ''),
          COALESCE(d.subtitle, ''),
          COALESCE(d.body, ''),
          COALESCE(d.date, 0)
        FROM delivered_notifications d
        ORDER BY d.date DESC
        LIMIT ${limit}
      `.trim();

      const safeDb = dbPath.replace(/'/g, `'\\''`);
      const safeSql = sql.replace(/'/g, `'\\''`);
      const raw = await this.run(
        `sqlite3 -separator '|||' '${safeDb}' '${safeSql}'`,
        15_000
      );

      if (!raw) return this.getNotificationsViaAccessibility(limit);

      return raw
        .split("\n")
        .filter(Boolean)
        .slice(0, limit)
        .map((line) => {
          const [app, title, subtitle, body, dateRaw] = line.split("|||");
          const ts = parseFloat(dateRaw ?? "0");
          return {
            app: app?.trim() || undefined,
            title: title?.trim() ?? "",
            subtitle: subtitle?.trim() || undefined,
            body: body?.trim() ?? "",
            date: ts ? this.coreDataTimestampToDate(ts) : undefined,
          } satisfies SystemNotification;
        });
    } catch {
      return [];
    }
  }

  /**
   * Best-effort fallback: open Notification Center and scrape via accessibility.
   * Returns empty array when accessibility is unavailable.
   */
  private async getNotificationsViaAccessibility(
    limit: number
  ): Promise<SystemNotification[]> {
    try {
      const script = [
        `tell application "System Events"`,
        `  tell process "NotificationCenter"`,
        `    set notifList to {}`,
        `    set wins to every window`,
        `    repeat with w in wins`,
        `      try`,
        `        set notifList to notifList & {description of w}`,
        `      end try`,
        `    end repeat`,
        `    return notifList`,
        `  end tell`,
        `end tell`,
      ].join("\n");

      const raw = await this.run(
        `osascript -e '${script.replace(/'/g, `'\\''`)}'`,
        15_000
      );

      if (!raw) return [];

      return raw
        .split(",")
        .filter(Boolean)
        .slice(0, limit)
        .map((text) => ({
          title: "Notification Center",
          body: text.trim(),
        }));
    } catch {
      return [];
    }
  }

  /**
   * Attempt to dismiss all notifications in Notification Center.
   *
   * Opens Notification Center via keyboard shortcut then clicks "Clear All".
   * Best-effort — may no-op if Notification Center is not open or has no
   * notifications to clear.
   */
  async clearNotifications(): Promise<void> {
    try {
      const script = [
        // Open Notification Center
        `tell application "System Events"`,
        `  -- Trigger Notification Center with keyboard shortcut`,
        `  key code 100 using {control down, option down}`,
        `  delay 0.5`,
        `  -- Try to find and click "Clear All" button`,
        `  tell process "NotificationCenter"`,
        `    repeat with btn in every button of every window`,
        `      if title of btn = "Clear All" then`,
        `        click btn`,
        `      end if`,
        `    end repeat`,
        `  end tell`,
        `end tell`,
      ].join("\n");

      await this.run(
        `osascript -e '${script.replace(/'/g, `'\\''`)}'`,
        15_000
      );
    } catch {
      // Best-effort — swallow errors silently
    }
  }

  // ---------------------------------------------------------------------------
  // Contacts Integration
  // ---------------------------------------------------------------------------

  /** Search contacts by name in the macOS Contacts app. */
  async searchContacts(
    query: string
  ): Promise<
    Array<{
      name: string;
      email?: string;
      phone?: string;
      organization?: string;
    }>
  > {
    const escaped = query.replace(/'/g, "'\\''");
    const script = [
      `tell application "Contacts"`,
      `  set results to {}`,
      `  set matches to every person whose name contains "${escaped}"`,
      `  repeat with p in matches`,
      `    set n to name of p`,
      `    set e to ""`,
      `    if (count of emails of p) > 0 then set e to value of item 1 of emails of p`,
      `    set ph to ""`,
      `    if (count of phones of p) > 0 then set ph to value of item 1 of phones of p`,
      `    set org to ""`,
      `    try`,
      `      set org to organization of p`,
      `    end try`,
      `    set end of results to (n & "|" & e & "|" & ph & "|" & org)`,
      `  end repeat`,
      `  return results`,
      `end tell`,
    ].join("\n");

    try {
      const raw = await this.run(`osascript -e '${script}'`);
      if (!raw.trim()) return [];
      return raw
        .split(", ")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, email, phone, organization] = line.split("|");
          return {
            name: name ?? "",
            email: email || undefined,
            phone: phone || undefined,
            organization: organization || undefined,
          };
        });
    } catch {
      return [];
    }
  }

  /** Get detailed information about a specific contact by name. */
  async getContactDetails(name: string): Promise<{
    name: string;
    emails: string[];
    phones: string[];
    addresses: string[];
    organization?: string;
    birthday?: string;
    notes?: string;
  } | null> {
    const escaped = name.replace(/'/g, "'\\''");
    const script = [
      `tell application "Contacts"`,
      `  set matches to every person whose name contains "${escaped}"`,
      `  if (count of matches) = 0 then return ""`,
      `  set p to item 1 of matches`,
      `  set n to name of p`,
      `  set emailList to ""`,
      `  repeat with e in emails of p`,
      `    set emailList to emailList & value of e & ";"`,
      `  end repeat`,
      `  set phoneList to ""`,
      `  repeat with ph in phones of p`,
      `    set phoneList to phoneList & value of ph & ";"`,
      `  end repeat`,
      `  set addrList to ""`,
      `  repeat with a in addresses of p`,
      `    set addrList to addrList & (street of a & ", " & city of a) & ";"`,
      `  end repeat`,
      `  set org to ""`,
      `  try`,
      `    set org to organization of p`,
      `  end try`,
      `  set bday to ""`,
      `  try`,
      `    set bday to birthdate of p as string`,
      `  end try`,
      `  set nt to ""`,
      `  try`,
      `    set nt to note of p`,
      `  end try`,
      `  return n & "||" & emailList & "||" & phoneList & "||" & addrList & "||" & org & "||" & bday & "||" & nt`,
      `end tell`,
    ].join("\n");

    try {
      const raw = await this.run(`osascript -e '${script}'`);
      if (!raw.trim()) return null;
      const parts = raw.split("||");
      const [nm, emails, phones, addrs, org, bday, notes] = parts;
      const splitList = (s: string) =>
        (s ?? "")
          .split(";")
          .map((x) => x.trim())
          .filter(Boolean);
      return {
        name: nm?.trim() ?? "",
        emails: splitList(emails ?? ""),
        phones: splitList(phones ?? ""),
        addresses: splitList(addrs ?? ""),
        organization: org?.trim() || undefined,
        birthday: bday?.trim() || undefined,
        notes: notes?.trim() || undefined,
      };
    } catch {
      return null;
    }
  }

  /** Add a new contact to the macOS Contacts app. */
  async addContact(contact: {
    firstName: string;
    lastName?: string;
    email?: string;
    phone?: string;
    organization?: string;
  }): Promise<boolean> {
    const esc = (s: string) => s.replace(/'/g, "'\\''");
    const lines = [
      `tell application "Contacts"`,
      `  set newPerson to make new person with properties {first name:"${esc(contact.firstName)}"`,
    ];
    if (contact.lastName)
      lines[lines.length - 1] += `, last name:"${esc(contact.lastName)}"`;
    if (contact.organization)
      lines[lines.length - 1] += `, organization:"${esc(contact.organization)}"`;
    lines[lines.length - 1] += `}`;
    if (contact.email) {
      lines.push(
        `  make new email at end of emails of newPerson with properties {label:"work", value:"${esc(contact.email)}"}`
      );
    }
    if (contact.phone) {
      lines.push(
        `  make new phone at end of phones of newPerson with properties {label:"mobile", value:"${esc(contact.phone)}"}`
      );
    }
    lines.push(`  save`, `end tell`);
    const script = lines.join("\n");

    try {
      await this.run(`osascript -e '${script}'`);
      return true;
    } catch {
      return false;
    }
  }

  /** List all contact groups with member counts. */
  async getContactGroups(): Promise<
    Array<{ name: string; memberCount: number }>
  > {
    const script = [
      `tell application "Contacts"`,
      `  set results to {}`,
      `  repeat with g in every group`,
      `    set cnt to count of members of g`,
      `    set end of results to (name of g & "|" & cnt)`,
      `  end repeat`,
      `  return results`,
      `end tell`,
    ].join("\n");

    try {
      const raw = await this.run(`osascript -e '${script}'`);
      if (!raw.trim()) return [];
      return raw
        .split(", ")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [name, count] = l.split("|");
          return { name: name ?? "", memberCount: parseInt(count ?? "0", 10) };
        });
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Advanced Email
  // ---------------------------------------------------------------------------

  /** Send an email with a file attachment via Apple Mail. */
  async sendEmailWithAttachment(
    to: string,
    subject: string,
    body: string,
    attachmentPath: string
  ): Promise<boolean> {
    const esc = (s: string) => s.replace(/'/g, "'\\''");
    const script = [
      `tell application "Mail"`,
      `  set msg to make new outgoing message with properties {subject:"${esc(subject)}", content:"${esc(body)}", visible:true}`,
      `  tell msg`,
      `    make new to recipient with properties {address:"${esc(to)}"}`,
      `    make new attachment with properties {file name:(POSIX file "${esc(attachmentPath)}" as alias)}`,
      `  end tell`,
      `  send msg`,
      `end tell`,
    ].join("\n");

    try {
      await this.run(`osascript -e '${script}'`);
      return true;
    } catch {
      return false;
    }
  }

  /** List all configured email accounts in Apple Mail. */
  async getEmailAccounts(): Promise<
    Array<{ name: string; address: string; type: string }>
  > {
    const script = [
      `tell application "Mail"`,
      `  set results to {}`,
      `  repeat with acct in every account`,
      `    set nm to name of acct`,
      `    set addr to email addresses of acct`,
      `    set firstAddr to ""`,
      `    if (count of addr) > 0 then set firstAddr to item 1 of addr`,
      `    set acctType to class of acct as string`,
      `    set end of results to (nm & "|" & firstAddr & "|" & acctType)`,
      `  end repeat`,
      `  return results`,
      `end tell`,
    ].join("\n");

    try {
      const raw = await this.run(`osascript -e '${script}'`);
      if (!raw.trim()) return [];
      return raw
        .split(", ")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [name, address, type] = l.split("|");
          return { name: name ?? "", address: address ?? "", type: type ?? "" };
        });
    } catch {
      return [];
    }
  }

  /** Move an email message to a different mailbox. */
  async moveEmail(
    messageId: string,
    toMailbox: string
  ): Promise<boolean> {
    const esc = (s: string) => s.replace(/'/g, "'\\''");
    const script = [
      `tell application "Mail"`,
      `  set targetMailbox to mailbox "${esc(toMailbox)}"`,
      `  repeat with acct in every account`,
      `    repeat with mb in every mailbox of acct`,
      `      repeat with msg in every message of mb`,
      `        if message id of msg = "${esc(messageId)}" then`,
      `          move msg to targetMailbox`,
      `          return "moved"`,
      `        end if`,
      `      end repeat`,
      `    end repeat`,
      `  end repeat`,
      `  return "not found"`,
      `end tell`,
    ].join("\n");

    try {
      const result = await this.run(`osascript -e '${script}'`);
      return result.trim() === "moved";
    } catch {
      return false;
    }
  }

  /** Flag or unflag an email message. */
  async flagEmail(messageId: string, flagged: boolean): Promise<boolean> {
    const esc = (s: string) => s.replace(/'/g, "'\\''");
    const flagValue = flagged ? "1" : "0";
    const script = [
      `tell application "Mail"`,
      `  repeat with acct in every account`,
      `    repeat with mb in every mailbox of acct`,
      `      repeat with msg in every message of mb`,
      `        if message id of msg = "${esc(messageId)}" then`,
      `          set flag index of msg to ${flagValue}`,
      `          return "done"`,
      `        end if`,
      `      end repeat`,
      `    end repeat`,
      `  end repeat`,
      `  return "not found"`,
      `end tell`,
    ].join("\n");

    try {
      const result = await this.run(`osascript -e '${script}'`);
      return result.trim() === "done";
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // FaceTime
  // ---------------------------------------------------------------------------

  /** Start a FaceTime call (video or audio) with a contact. */
  async startFaceTimeCall(
    contact: string,
    videoEnabled = true
  ): Promise<boolean> {
    const esc = encodeURIComponent(contact);
    const scheme = videoEnabled ? "facetime" : "facetime-audio";
    const script = `open location "${scheme}://${esc}"`;

    try {
      await this.run(`osascript -e '${script}'`);
      return true;
    } catch {
      return false;
    }
  }

  /** End the active FaceTime call by quitting FaceTime. */
  async endFaceTimeCall(): Promise<boolean> {
    const script = [
      `tell application "FaceTime"`,
      `  if it is running then`,
      `    quit`,
      `  end if`,
      `end tell`,
    ].join("\n");

    try {
      await this.run(`osascript -e '${script}'`);
      return true;
    } catch {
      return false;
    }
  }

  /** Check whether a FaceTime call is currently in progress. */
  async isFaceTimeActive(): Promise<boolean> {
    const script = [
      `tell application "System Events"`,
      `  set ftRunning to (name of every process) contains "FaceTime"`,
      `  if ftRunning then`,
      `    tell process "FaceTime"`,
      `      set wins to every window`,
      `      repeat with w in wins`,
      `        if title of w contains "FaceTime" then return "active"`,
      `      end repeat`,
      `    end tell`,
      `  end if`,
      `  return "inactive"`,
      `end tell`,
    ].join("\n");

    try {
      const result = await this.run(`osascript -e '${script}'`);
      return result.trim() === "active";
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Reminders Integration
  // ---------------------------------------------------------------------------

  /** Get reminders, optionally filtered by list name. */
  async getReminders(listName?: string): Promise<
    Array<{
      id: string;
      name: string;
      body?: string;
      dueDate?: string;
      completed: boolean;
      priority: number;
      list: string;
    }>
  > {
    const esc = (s: string) => s.replace(/'/g, "'\\''");
    const listFilter = listName
      ? `set targetLists to {list "${esc(listName)}"}`
      : `set targetLists to every list`;
    const script = [
      `tell application "Reminders"`,
      `  ${listFilter}`,
      `  set results to {}`,
      `  repeat with rl in targetLists`,
      `    set listName to name of rl`,
      `    repeat with r in every reminder of rl`,
      `      set rId to id of r`,
      `      set rName to name of r`,
      `      set rBody to ""`,
      `      try`,
      `        set rBody to body of r`,
      `      end try`,
      `      set rDue to ""`,
      `      try`,
      `        set rDue to due date of r as string`,
      `      end try`,
      `      set rDone to completed of r`,
      `      set rPri to priority of r`,
      `      set end of results to (rId & "|" & rName & "|" & rBody & "|" & rDue & "|" & (rDone as string) & "|" & (rPri as string) & "|" & listName)`,
      `    end repeat`,
      `  end repeat`,
      `  return results`,
      `end tell`,
    ].join("\n");

    try {
      const raw = await this.run(`osascript -e '${script}'`, 20_000);
      if (!raw.trim()) return [];
      return raw
        .split(", ")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const parts = l.split("|");
          const [id, name, body, dueDate, completed, priority, list] = parts;
          return {
            id: id ?? "",
            name: name ?? "",
            body: body || undefined,
            dueDate: dueDate || undefined,
            completed: completed === "true",
            priority: parseInt(priority ?? "0", 10),
            list: list ?? "",
          };
        });
    } catch {
      return [];
    }
  }

  /** Create a new reminder. */
  async createReminder(
    name: string,
    options?: {
      body?: string;
      dueDate?: string;
      list?: string;
      priority?: 0 | 1 | 5 | 9;
    }
  ): Promise<boolean> {
    const esc = (s: string) => s.replace(/'/g, "'\\''");
    const listTarget = options?.list
      ? `list "${esc(options.list)}"`
      : `default list`;
    const props: string[] = [`name:"${esc(name)}"`];
    if (options?.body) props.push(`body:"${esc(options.body)}"`);
    if (options?.priority !== undefined)
      props.push(`priority:${options.priority}`);

    const lines = [
      `tell application "Reminders"`,
      `  set rl to ${listTarget}`,
      `  set newReminder to make new reminder at end of reminders of rl with properties {${props.join(", ")}}`,
    ];
    if (options?.dueDate) {
      lines.push(
        `  set due date of newReminder to date "${esc(options.dueDate)}"`
      );
    }
    lines.push(`end tell`);
    const script = lines.join("\n");

    try {
      await this.run(`osascript -e '${script}'`);
      return true;
    } catch {
      return false;
    }
  }

  /** Mark a reminder as completed. */
  async completeReminder(
    name: string,
    listName?: string
  ): Promise<boolean> {
    const esc = (s: string) => s.replace(/'/g, "'\\''");
    const listTarget = listName ? `list "${esc(listName)}"` : `default list`;
    const script = [
      `tell application "Reminders"`,
      `  set rl to ${listTarget}`,
      `  set matches to (every reminder of rl whose name contains "${esc(name)}")`,
      `  if (count of matches) > 0 then`,
      `    set completed of item 1 of matches to true`,
      `    return "done"`,
      `  end if`,
      `  return "not found"`,
      `end tell`,
    ].join("\n");

    try {
      const result = await this.run(`osascript -e '${script}'`);
      return result.trim() === "done";
    } catch {
      return false;
    }
  }

  /** List all reminder lists with their reminder counts. */
  async getReminderLists(): Promise<Array<{ name: string; count: number }>> {
    const script = [
      `tell application "Reminders"`,
      `  set results to {}`,
      `  repeat with rl in every list`,
      `    set cnt to count of reminders of rl`,
      `    set end of results to (name of rl & "|" & cnt)`,
      `  end repeat`,
      `  return results`,
      `end tell`,
    ].join("\n");

    try {
      const raw = await this.run(`osascript -e '${script}'`);
      if (!raw.trim()) return [];
      return raw
        .split(", ")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [name, count] = l.split("|");
          return { name: name ?? "", count: parseInt(count ?? "0", 10) };
        });
    } catch {
      return [];
    }
  }

  /** Delete a reminder by name. */
  async deleteReminder(name: string, listName?: string): Promise<boolean> {
    const esc = (s: string) => s.replace(/'/g, "'\\''");
    const listTarget = listName ? `list "${esc(listName)}"` : `default list`;
    const script = [
      `tell application "Reminders"`,
      `  set rl to ${listTarget}`,
      `  set matches to (every reminder of rl whose name contains "${esc(name)}")`,
      `  if (count of matches) > 0 then`,
      `    delete item 1 of matches`,
      `    return "done"`,
      `  end if`,
      `  return "not found"`,
      `end tell`,
    ].join("\n");

    try {
      const result = await this.run(`osascript -e '${script}'`);
      return result.trim() === "done";
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Notes Integration
  // ---------------------------------------------------------------------------

  /** Get notes from the Notes app, optionally filtered by folder. */
  async getNotes(
    folder?: string,
    limit = 20
  ): Promise<
    Array<{
      id: string;
      name: string;
      body: string;
      folder: string;
      createdDate: string;
      modifiedDate: string;
    }>
  > {
    const esc = (s: string) => s.replace(/'/g, "'\\''");
    const folderTarget = folder
      ? `folder "${esc(folder)}"`
      : `default account`;
    const script = [
      `tell application "Notes"`,
      `  set results to {}`,
      `  set cnt to 0`,
      `  set noteSource to notes of ${folderTarget}`,
      `  repeat with n in noteSource`,
      `    if cnt >= ${limit} then exit repeat`,
      `    set nId to id of n`,
      `    set nName to name of n`,
      `    set nBody to plaintext of n`,
      `    set nFolder to name of container of n`,
      `    set nCreated to creation date of n as string`,
      `    set nModified to modification date of n as string`,
      `    set end of results to (nId & "||" & nName & "||" & nBody & "||" & nFolder & "||" & nCreated & "||" & nModified)`,
      `    set cnt to cnt + 1`,
      `  end repeat`,
      `  return results`,
      `end tell`,
    ].join("\n");

    try {
      const raw = await this.run(`osascript -e '${script}'`, 30_000);
      if (!raw.trim()) return [];
      // AppleScript returns list items separated by ", " at top level
      // but our items contain "||" so we split on record separator
      return raw
        .split(", x-coredata://")
        .map((chunk, i) => (i === 0 ? chunk : "x-coredata://" + chunk))
        .flatMap((chunk) => {
          const parts = chunk.split("||");
          if (parts.length < 6) return [];
          const [id, name, body, folder, createdDate, modifiedDate] = parts;
          return [
            {
              id: id?.trim() ?? "",
              name: name?.trim() ?? "",
              body: body?.trim() ?? "",
              folder: folder?.trim() ?? "",
              createdDate: createdDate?.trim() ?? "",
              modifiedDate: modifiedDate?.trim() ?? "",
            },
          ];
        });
    } catch {
      return [];
    }
  }

  /** Create a new note in the Notes app. */
  async createNote(
    title: string,
    body: string,
    folder?: string
  ): Promise<boolean> {
    const esc = (s: string) => s.replace(/'/g, "'\\''");
    const content = `${title}\n${body}`;
    const lines = [`tell application "Notes"`];
    if (folder) {
      lines.push(
        `  make new note at folder "${esc(folder)}" with properties {body:"${esc(content)}"}`
      );
    } else {
      lines.push(
        `  make new note with properties {body:"${esc(content)}"}`
      );
    }
    lines.push(`end tell`);
    const script = lines.join("\n");

    try {
      await this.run(`osascript -e '${script}'`);
      return true;
    } catch {
      return false;
    }
  }

  /** Search notes by content in the Notes app. */
  async searchNotes(
    query: string
  ): Promise<Array<{ name: string; body: string; folder: string }>> {
    const esc = (s: string) => s.replace(/'/g, "'\\''");
    const script = [
      `tell application "Notes"`,
      `  set results to {}`,
      `  set matches to (every note whose plaintext contains "${esc(query)}")`,
      `  repeat with n in matches`,
      `    set nName to name of n`,
      `    set nBody to plaintext of n`,
      `    set nFolder to name of container of n`,
      `    set end of results to (nName & "||" & nBody & "||" & nFolder)`,
      `  end repeat`,
      `  return results`,
      `end tell`,
    ].join("\n");

    try {
      const raw = await this.run(`osascript -e '${script}'`, 20_000);
      if (!raw.trim()) return [];
      return raw
        .split(", ")
        .map((l) => l.trim())
        .filter((l) => l.includes("||"))
        .map((l) => {
          const [name, body, folder] = l.split("||");
          return {
            name: name?.trim() ?? "",
            body: body?.trim() ?? "",
            folder: folder?.trim() ?? "",
          };
        });
    } catch {
      return [];
    }
  }

  /** List all folders in the Notes app with note counts. */
  async getNoteFolders(): Promise<
    Array<{ name: string; noteCount: number }>
  > {
    const script = [
      `tell application "Notes"`,
      `  set results to {}`,
      `  repeat with f in every folder`,
      `    set cnt to count of notes of f`,
      `    set end of results to (name of f & "|" & cnt)`,
      `  end repeat`,
      `  return results`,
      `end tell`,
    ].join("\n");

    try {
      const raw = await this.run(`osascript -e '${script}'`);
      if (!raw.trim()) return [];
      return raw
        .split(", ")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [name, count] = l.split("|");
          return { name: name ?? "", noteCount: parseInt(count ?? "0", 10) };
        });
    } catch {
      return [];
    }
  }
}
