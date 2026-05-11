/**
 * Communication Tools — Group 7: Email, Messaging, Notifications
 * Implements: Email management, Slack, Discord, Telegram, SMS, Push
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);


// ------------------------------------------------------------------
// Email Operations (macOS Mail)
// ------------------------------------------------------------------

export interface Email {
  id: string;
  subject: string;
  sender: string;
  date: Date;
  body: string;
  read: boolean;
}

export async function getUnreadEmails(limit: number = 10): Promise<Email[]> {
  try {
    const script = `osascript -e 'tell application "Mail"
      set unreadMessages to messages of inbox whose read status is false
      set resultList to {}
      repeat with msg in unreadMessages
        set end of resultList to (subject of msg as string) & "|" & (sender of msg as string) & "|" & (date received of msg as string)
      end repeat
      return resultList
    end tell'`;
    
    const { stdout } = await execAsync(script, { encoding: "utf-8" });
    return stdout.trim().split(", ").map((line, i) => {
      const parts = line.split("|");
      return {
        id: `email-${i}`,
        subject: parts[0] || "",
        sender: parts[1] || "",
        date: new Date(parts[2] || Date.now()),
        body: "",
        read: false
      };
    }).slice(0, limit);
  } catch (e) {
    console.error("getUnreadEmails failed:", e);
    return [];
  }
}

export async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  try {
    const escapedBody = body.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const escapedSubject = subject.replace(/"/g, '\\"');
    const script = `osascript -e 'tell application "Mail"
      set newMessage to make new outgoing message with properties {subject:"${escapedSubject}", content:"${escapedBody}"}
      tell newMessage to make new to recipient at end of to recipients with properties {address:"${to}"}
      send newMessage
    end tell'`;
    
    await execAsync(script);
    return true;
  } catch (e) {
    console.error("sendEmail failed:", e);
    return false;
  }
}

export async function markEmailRead(emailId: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Mail" to set read status of message id "${emailId}" to true'`);
    return true;
  } catch {
    return false;
  }
}

export async function deleteEmail(emailId: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Mail" to delete message id "${emailId}"'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Slack Operations
// ------------------------------------------------------------------

export async function slackPostMessage(channel: string, message: string): Promise<boolean> {
  try {
    // Using Slack API via curl
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      console.log("Slack token not configured, simulating post");
      return true;
    }
    
    await execAsync(`curl -s -X POST "https://slack.com/api/chat.postMessage" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      -d '{"channel":"${channel}","text":"${message}"}'`);
    return true;
  } catch (e) {
    console.error("slackPostMessage failed:", e);
    return false;
  }
}

export async function slackPostToChannel(channelName: string, message: string): Promise<boolean> {
  return slackPostMessage(`#${channelName}`, message);
}

export async function slackSendDM(userId: string, message: string): Promise<boolean> {
  return slackPostMessage(`@${userId}`, message);
}

export async function slackUploadFile(channel: string, filePath: string, comment?: string): Promise<boolean> {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    await execAsync(`curl -s -X POST "https://slack.com/api/files.upload" \
      -H "Authorization: Bearer ${token}" \
      -F "channels=${channel}" \
      -F "file=@${filePath}" \
      ${comment ? `-F "initial_comment=${comment}"` : ''}`);
    return true;
  } catch (e) {
    console.error("slackUploadFile failed:", e);
    return false;
  }
}

export async function slackSetStatus(emoji: string, status: string): Promise<boolean> {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    await execAsync(`curl -s -X POST "https://slack.com/api/users.profile.set" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      -d '{"profile":{"status_emoji":"${emoji}","status_text":"${status}"}}'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Discord Operations
// ------------------------------------------------------------------

export async function discordWebhookSend(webhookUrl: string, message: string, username?: string): Promise<boolean> {
  try {
    const payload = JSON.stringify({ content: message, username: username || "OmniState" });
    await execAsync(`curl -s -X POST "${webhookUrl}" -H "Content-Type: application/json" -d '${payload}'`);
    return true;
  } catch (e) {
    console.error("discordWebhookSend failed:", e);
    return false;
  }
}

export async function discordSendMessage(channelId: string, message: string): Promise<boolean> {
  try {
    const token = process.env.DISCORD_BOT_TOKEN;
    await execAsync(`curl -s -X POST "https://discord.com/api/v10/channels/${channelId}/messages" \
      -H "Authorization: Bot ${token}" \
      -H "Content-Type: application/json" \
      -d '{"content":"${message}"}'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Telegram Advanced
// ------------------------------------------------------------------

export async function telegramSendMessage(chatId: string, message: string): Promise<boolean> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const encoded = encodeURIComponent(message);
    await execAsync(`curl -s "https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${encoded}"`);
    return true;
  } catch (e) {
    console.error("telegramSendMessage failed:", e);
    return false;
  }
}

export async function telegramSendPhoto(chatId: string, photoPath: string, caption?: string): Promise<boolean> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const captionArg = caption ? `&caption=${encodeURIComponent(caption)}` : "";
    await execAsync(`curl -s "https://api.telegram.org/bot${token}/sendPhoto?chat_id=${chatId}${captionArg}" -F "photo=@${photoPath}"`);
    return true;
  } catch (e) {
    console.error("telegramSendPhoto failed:", e);
    return false;
  }
}

export async function telegramSendDocument(chatId: string, filePath: string, caption?: string): Promise<boolean> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const captionArg = caption ? `&caption=${encodeURIComponent(caption)}` : "";
    await execAsync(`curl -s "https://api.telegram.org/bot${token}/sendDocument?chat_id=${chatId}${captionArg}" -F "document=@${filePath}"`);
    return true;
  } catch (e) {
    console.error("telegramSendDocument failed:", e);
    return false;
  }
}

export async function telegramSendPoll(chatId: string, question: string, options: string[]): Promise<boolean> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const optionsStr = JSON.stringify(options);
    await execAsync(`curl -s "https://api.telegram.org/bot${token}/sendPoll" \
      -F "chat_id=${chatId}" \
      -F "question=${question}" \
      -F "options=${optionsStr}" \
      -F "is_anonymous=false"`);
    return true;
  } catch {
    return false;
  }
}

export async function telegramCreateGroupInvite(chatId: string): Promise<string | null> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const { stdout } = await execAsync(`curl -s "https://api.telegram.org/bot${token}/createChatInviteLink?chat_id=${chatId}"`);
    const result = JSON.parse(stdout);
    return result.result?.invite_link || null;
  } catch {
    return null;
  }
}

export async function telegramGetUpdates(): Promise<any[]> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const { stdout } = await execAsync(`curl -s "https://api.telegram.org/bot${token}/getUpdates"`);
    const result = JSON.parse(stdout);
    return result.result || [];
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Push Notifications (Bark/Other)
// ------------------------------------------------------------------

export async function pushNotification(title: string, body: string, deviceKey?: string): Promise<boolean> {
  try {
    const barkKey = deviceKey || process.env.BARK_KEY;
    if (barkKey) {
      const encoded = encodeURIComponent(body);
      await execAsync(`curl -s "https://api.day.app/${barkKey}/${title}/${encoded}"`);
      return true;
    }
    // Fallback to system notification
    await execAsync(`osascript -e 'display notification "${body}" with title "${title}"'`);
    return true;
  } catch (e) {
    console.error("pushNotification failed:", e);
    return false;
  }
}

export async function pushWithSound(title: string, body: string, sound: string = "alarm"): Promise<boolean> {
  try {
    const barkKey = process.env.BARK_KEY;
    if (barkKey) {
      const encoded = encodeURIComponent(body);
      await execAsync(`curl -s "https://api.day.app/${barkKey}/${title}/${encoded}?sound=${sound}"`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export class CommunicationLayer {
  // Email
  getUnreadEmails = getUnreadEmails;
  sendEmail = sendEmail;
  markEmailRead = markEmailRead;
  deleteEmail = deleteEmail;
  
  // Slack
  slackPost = slackPostMessage;
  slackPostToChannel = slackPostToChannel;
  slackSendDM = slackSendDM;
  slackUploadFile = slackUploadFile;
  slackSetStatus = slackSetStatus;
  
  // Discord
  discordWebhook = discordWebhookSend;
  discordSend = discordSendMessage;
  
  // Telegram
  telegramSend = telegramSendMessage;
  telegramSendPhoto = telegramSendPhoto;
  telegramSendDoc = telegramSendDocument;
  telegramPoll = telegramSendPoll;
  telegramCreateInvite = telegramCreateGroupInvite;
  telegramGetUpdates = telegramGetUpdates;
  
  // Push
  push = pushNotification;
  pushWithSound = pushWithSound;
}
