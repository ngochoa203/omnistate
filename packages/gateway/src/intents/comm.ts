import type { IntentHandler } from "./types.js";

export const emailCompose: IntentHandler = async (args, ctx) => {
  const to = String(args.to ?? "");
  const subject = String(args.subject ?? "");
  const body = String(args.body ?? "");
  await ctx.layers.deep.runAppleScript(`
    tell application "Mail"
      activate
      set newMsg to make new outgoing message with properties {subject:"${subject}", content:"${body}", visible:true}
      tell newMsg
        make new to recipient at end of to recipients with properties {address:"${to}"}
      end tell
      ${args.send ? "send newMsg" : ""}
    end tell
  `);
  return { speak: "Email composed.", data: { success: true, to, subject, sent: Boolean(args.send) } };
};

export const calendarCreate: IntentHandler = async (args, ctx) => {
  const title = String(args.title ?? args.event ?? "");
  const date = String(args.date ?? new Date().toISOString().split("T")[0]);
  const time = String(args.time ?? "09:00");
  const duration = Number(args.duration ?? 60);
  await ctx.layers.deep.runAppleScript(`
    tell application "Calendar"
      activate
      tell calendar "Home"
        set startDate to current date
        set hours of startDate to ${parseInt(time.split(":")[0])}
        set minutes of startDate to ${parseInt(time.split(":")[1] || "0")}
        set endDate to startDate + (${duration} * 60)
        make new event with properties {summary:"${title}", start date:startDate, end date:endDate}
      end tell
    end tell
  `);
  return { speak: "Calendar event created.", data: { success: true, title, date, time, duration } };
};

export const reminderCreate: IntentHandler = async (args, ctx) => {
  const title = String(args.title ?? args.text ?? "");
  const dueDate = String(args.dueDate ?? "");
  if (dueDate) {
    await ctx.layers.deep.runAppleScript(`
      tell application "Reminders"
        activate
        tell list "Reminders"
          make new reminder with properties {name:"${title}", due date:date "${dueDate}"}
        end tell
      end tell
    `);
  } else {
    await ctx.layers.deep.runAppleScript(`
      tell application "Reminders"
        activate
        tell list "Reminders"
          make new reminder with properties {name:"${title}"}
        end tell
      end tell
    `);
  }
  return { speak: "Reminder created.", data: { success: true, title, dueDate } };
};

// Communication layer wrappers
export const commSendEmail: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.sendEmail(args);
  return { speak: "Email sent.", data: { success: true } };
};

export const commGetUnreadEmails: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const emails = await comm.getUnreadEmails(args);
  return { speak: "Unread emails retrieved.", data: { emails } };
};

export const commReadEmail: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const email = await comm.readEmail(args.messageId as string);
  return { speak: "Email retrieved.", data: { email } };
};

export const commSearchEmails: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const emails = await comm.searchEmails(args);
  return { speak: "Email search complete.", data: { emails } };
};

export const commGetMailboxes: IntentHandler = async (_args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const mailboxes = await comm.getMailboxes();
  return { speak: "Mailboxes retrieved.", data: { mailboxes } };
};

export const commSendMessage: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.sendMessage(args);
  return { speak: "Message sent.", data: { success: true } };
};

export const commGetRecentMessages: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const messages = await comm.getRecentMessages(args);
  return { speak: "Recent messages retrieved.", data: { messages } };
};

export const commSearchMessages: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const messages = await comm.searchMessages(args.query as string);
  return { speak: "Message search complete.", data: { messages } };
};

export const commGetEvents: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const events = await comm.getEvents(args);
  return { speak: "Events retrieved.", data: { events } };
};

export const commCreateEvent: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.createEvent(args);
  return { speak: "Event created.", data: { success: true } };
};

export const commDeleteEvent: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.deleteEvent(args.eventId as string);
  return { speak: "Event deleted.", data: { success: true } };
};

export const commGetCalendars: IntentHandler = async (_args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const calendars = await comm.getCalendars();
  return { speak: "Calendars retrieved.", data: { calendars } };
};

export const commGetUpcomingEvents: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const events = await comm.getUpcomingEvents(args.hours as number | undefined);
  return { speak: "Upcoming events retrieved.", data: { events } };
};

export const commSendNotification: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.sendNotification(args);
  return { speak: "Notification sent.", data: { success: true } };
};

export const commGetRecentNotifications: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const notifications = await comm.getRecentNotifications(args.limit as number | undefined);
  return { speak: "Recent notifications retrieved.", data: { notifications } };
};

export const commClearNotifications: IntentHandler = async (_args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.clearNotifications();
  return { speak: "Notifications cleared.", data: { success: true } };
};

export const commSearchContacts: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const contacts = await comm.searchContacts(args.query as string);
  return { speak: "Contacts searched.", data: { contacts } };
};

export const commGetContactDetails: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const contact = await comm.getContactDetails(args.contactId as string);
  return { speak: "Contact details retrieved.", data: { contact } };
};

export const commAddContact: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.addContact(args);
  return { speak: "Contact added.", data: { success: true } };
};

export const commGetContactGroups: IntentHandler = async (_args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const groups = await comm.getContactGroups();
  return { speak: "Contact groups retrieved.", data: { groups } };
};

export const commSendEmailWithAttachment: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.sendEmailWithAttachment(
    args.to as string,
    args.subject as string,
    args.body as string,
    args.attachmentPath as string,
  );
  return { speak: "Email with attachment sent.", data: { success: true } };
};

export const commGetEmailAccounts: IntentHandler = async (_args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const accounts = await comm.getEmailAccounts();
  return { speak: "Email accounts retrieved.", data: { accounts } };
};

export const commMoveEmail: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.moveEmail(args.messageId as string, args.mailbox as string);
  return { speak: "Email moved.", data: { success: true } };
};

export const commFlagEmail: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.flagEmail(args.messageId as string, Boolean(args.flagged));
  return { speak: "Email flagged.", data: { success: true } };
};

export const commStartFaceTimeCall: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.startFaceTimeCall(args.contact as string);
  return { speak: "FaceTime call started.", data: { success: true } };
};

export const commEndFaceTimeCall: IntentHandler = async (_args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.endFaceTimeCall();
  return { speak: "FaceTime call ended.", data: { success: true } };
};

export const commIsFaceTimeActive: IntentHandler = async (_args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const active = await comm.isFaceTimeActive();
  return { speak: active ? "FaceTime is active." : "FaceTime is not active.", data: { active } };
};

export const commGetReminders: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const reminders = await comm.getReminders(args);
  return { speak: "Reminders retrieved.", data: { reminders } };
};

export const commCreateReminder: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.createReminder(args);
  return { speak: "Reminder created.", data: { success: true } };
};

export const commCompleteReminder: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.completeReminder(args.reminderId as string);
  return { speak: "Reminder completed.", data: { success: true } };
};

export const commGetReminderLists: IntentHandler = async (_args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const lists = await comm.getReminderLists();
  return { speak: "Reminder lists retrieved.", data: { lists } };
};

export const commDeleteReminder: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.deleteReminder(args.reminderId as string);
  return { speak: "Reminder deleted.", data: { success: true } };
};

export const commGetNotes: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const notes = await comm.getNotes(args.folder as string | undefined);
  return { speak: "Notes retrieved.", data: { notes } };
};

export const commCreateNote: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  await comm.createNote(args.title as string, args.body as string, args.folder as string | undefined);
  return { speak: "Note created.", data: { success: true } };
};

export const commSearchNotes: IntentHandler = async (args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const notes = await comm.searchNotes(args.query as string);
  return { speak: "Notes searched.", data: { notes } };
};

export const commGetNoteFolders: IntentHandler = async (_args, ctx) => {
  const comm = (ctx.layers as any).communication;
  const folders = await comm.getNoteFolders();
  return { speak: "Note folders retrieved.", data: { folders } };
};
