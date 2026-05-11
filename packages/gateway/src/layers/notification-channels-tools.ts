/**
 * Notification & Alerting Channels — Group 47
 * Implements: Slack, Discord, Email, SMS, Push, Webhook notifications
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Slack Notifications
// ------------------------------------------------------------------

export async function slackNotify(message: string, channel?: string): Promise<boolean> {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    const ch = channel || process.env.SLACK_CHANNEL || "#general";
    
    if (token) {
      await execAsync(`curl -s -X POST "https://slack.com/api/chat.postMessage" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        -d '{"channel":"${ch}","text":"${message}","unfurl_links":false}'`);
    } else {
      console.log(`[Slack] ${ch}: ${message}`);
    }
    return true;
  } catch {
    return false;
  }
}

export async function slackWithAttachment(
  message: string,
  attachment: { title: string; text: string; color?: string },
  channel?: string
): Promise<boolean> {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    const ch = channel || process.env.SLACK_CHANNEL || "#general";
    
    const payload = JSON.stringify({
      channel: ch,
      text: message,
      attachments: [{
        color: attachment.color || "#36a64f",
        title: attachment.title,
        text: attachment.text
      }]
    });
    
    await execAsync(`curl -s -X POST "https://slack.com/api/chat.postMessage" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      -d '${payload}'`);
    
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Discord Webhooks
// ------------------------------------------------------------------

export async function discordNotify(message: string, webhookUrl?: string): Promise<boolean> {
  try {
    const url = webhookUrl || process.env.DISCORD_WEBHOOK;
    if (url) {
      await execAsync(`curl -s -X POST "${url}" -H "Content-Type: application/json" -d '{"content":"${message}"}'`);
    } else {
      console.log(`[Discord] ${message}`);
    }
    return true;
  } catch {
    return false;
  }
}

export async function discordWithEmbed(
  title: string,
  description: string,
  color: number = 0x00ff00,
  webhookUrl?: string
): Promise<boolean> {
  try {
    const url = webhookUrl || process.env.DISCORD_WEBHOOK;
    const payload = JSON.stringify({
      embeds: [{
        title,
        description,
        color,
        timestamp: new Date().toISOString()
      }]
    });
    
    await execAsync(`curl -s -X POST "${url}" -H "Content-Type: application/json" -d '${payload}'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Email Notifications
// ------------------------------------------------------------------

export async function sendEmailNotification(
  to: string,
  subject: string,
  body: string,
  from?: string
): Promise<boolean> {
  try {
    const sender = from || process.env.SMTP_FROM || "noreply@omnistate.local";
    
    await execAsync(`echo "${body}" | mail -s "${subject}" -r "${sender}" ${to}`);
    return true;
  } catch {
    return false;
  }
}

export async function sendHTMLEmail(
  to: string,
  subject: string,
  html: string,
  from?: string
): Promise<boolean> {
  try {
    const sender = from || process.env.SMTP_FROM || "noreply@omnistate.local";
    
    await execAsync(`echo "${html}" | mail -s "${subject}" -r "${sender}" -a "Content-Type: text/html" ${to}`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Push Notifications (Bark)
// ------------------------------------------------------------------

export async function pushNotify(title: string, body: string, sound?: string): Promise<boolean> {
  try {
    const key = process.env.BARK_KEY;
    if (key) {
      const soundParam = sound ? `?sound=${sound}` : "";
      const encodedBody = encodeURIComponent(body);
      await execAsync(`curl -s "https://api.day.app/${key}/${title}/${encodedBody}${soundParam}"`);
    } else {
      // Fallback to macOS notification
      await execAsync(`osascript -e 'display notification "${body}" with title "${title}"'`);
    }
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// SMS Notifications
// ------------------------------------------------------------------

export async function sendSMS(phone: string, message: string, provider?: "twilio" | "nexmo"): Promise<boolean> {
  try {
    if (provider === "twilio") {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_FROM;
      
      if (accountSid && authToken && from) {
        await execAsync(`curl -s -X POST "https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json" \
          -u "${accountSid}:${authToken}" \
          -d "To=${phone}" -d "From=${from}" -d "Body=${message}"`);
      }
    }
    
    console.log(`[SMS] To ${phone}: ${message}`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Webhook Notifications
// ------------------------------------------------------------------

export async function sendWebhookNotify(
  webhookUrl: string,
  payload: object,
  headers?: Record<string, string>
): Promise<boolean> {
  try {
    const headersStr = headers 
      ? Object.entries(headers).map(([k, v]) => `-H "${k}: ${v}"`).join(" ")
      : "";
    
    const bodyStr = JSON.stringify(payload).replace(/"/g, '\\"');
    
    await execAsync(`curl -s -X POST "${webhookUrl}" ${headersStr} -d '${bodyStr}'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Teams Notifications
// ------------------------------------------------------------------

export async function teamsNotify(message: string, webhookUrl?: string): Promise<boolean> {
  try {
    const url = webhookUrl || process.env.TEAMS_WEBHOOK;
    
    const payload = JSON.stringify({
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      "themeColor": "0076D7",
      "summary": message,
      "sections": [{
        "activityTitle": "OmniState",
        "activitySubtitle": "",
        "facts": [{ "name": "Message", "value": message }],
        "text": message
      }]
    });
    
    await execAsync(`curl -s -X POST "${url}" -H "Content-Type: application/json" -d '${payload}'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Multi-channel Notification
// ------------------------------------------------------------------

export interface NotificationConfig {
  slack?: boolean;
  discord?: boolean;
  email?: boolean;
  push?: boolean;
  sms?: boolean;
  teams?: boolean;
}

export async function notifyAll(
  message: string,
  config: NotificationConfig,
  details?: { title?: string; severity?: string; link?: string }
): Promise<{ channels: string[]; failed: string[] }> {
  const channels: string[] = [];
  const failed: string[] = [];
  
  if (config.slack) {
    if (await slackNotify(`[${details?.severity || "INFO"}] ${details?.title || "Notification"}: ${message}`)) {
      channels.push("slack");
    } else failed.push("slack");
  }
  
  if (config.discord) {
    if (await discordNotify(`[${details?.severity || "INFO"}] ${message}`)) {
      channels.push("discord");
    } else failed.push("discord");
  }
  
  if (config.push) {
    if (await pushNotify(details?.title || "Notification", message)) {
      channels.push("push");
    } else failed.push("push");
  }
  
  if (config.email && details?.title) {
    if (await sendEmailNotification(process.env.NOTIFY_EMAIL || "admin@example.com", details.title, message)) {
      channels.push("email");
    } else failed.push("email");
  }
  
  return { channels, failed };
}

export class NotificationChannelsLayer {
  slack = slackNotify;
  slackAttachment = slackWithAttachment;
  
  discord = discordNotify;
  discordEmbed = discordWithEmbed;
  
  email = sendEmailNotification;
  emailHTML = sendHTMLEmail;
  
  push = pushNotify;
  
  sms = sendSMS;
  
  webhook = sendWebhookNotify;
  
  teams = teamsNotify;
  
  notifyAll = notifyAll;
}
