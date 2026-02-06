import { logger } from "../utils/logger.js";
import { getConfig } from "../config/index.js";
import type { EmailMessage } from "../types/gmail.js";

const notifyLogger = logger.child("notifications");

/**
 * Send a Telegram notification about a new email
 * Uses the Orchestrator's tool call endpoint to send via Telegram MCP
 */
export async function sendTelegramNotification(email: EmailMessage): Promise<void> {
  const config = getConfig();

  if (!config.notifications.telegram) {
    return;
  }

  if (!config.notifications.telegramChatId) {
    notifyLogger.warn("Telegram notifications enabled but no chat ID configured");
    return;
  }

  if (!config.notifications.orchestratorUrl) {
    notifyLogger.warn("Telegram notifications enabled but no orchestrator URL configured");
    return;
  }

  const fromName = email.from.name ?? email.from.email;
  const message = formatEmailNotification(email);

  try {
    const response = await fetch(
      `${config.notifications.orchestratorUrl}/tools/call`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "telegram_send_message",
          arguments: {
            chat_id: config.notifications.telegramChatId,
            message,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    notifyLogger.info("Sent Telegram notification", {
      from: fromName,
      subject: email.subject,
    });
  } catch (error) {
    notifyLogger.error("Failed to send Telegram notification", { error });
  }
}

/**
 * Format email for Telegram notification
 */
function formatEmailNotification(email: EmailMessage): string {
  const fromName = email.from.name ?? email.from.email;
  const truncatedSnippet =
    email.snippet.length > 200
      ? email.snippet.slice(0, 200) + "..."
      : email.snippet;

  return [
    `📧 **New Email**`,
    ``,
    `**From:** ${fromName}`,
    `**Subject:** ${email.subject}`,
    ``,
    `${truncatedSnippet}`,
    ``,
    `_ID: ${email.id}_`,
  ].join("\n");
}
