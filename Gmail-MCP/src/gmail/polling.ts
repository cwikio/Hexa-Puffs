import { logger } from "../utils/logger.js";
import { getProfile, getHistory, getEmail } from "./client.js";
import type { EmailMessage } from "../types/gmail.js";

const pollingLogger = logger.child("polling");

// State
let pollingInterval: NodeJS.Timeout | null = null;
let lastHistoryId: string | null = null;
let isPolling = false;

// Queue for new emails (max 100)
const MAX_QUEUE_SIZE = 100;
const newEmailQueue: EmailMessage[] = [];

/**
 * Get new emails since last poll
 */
export function getNewEmails(): EmailMessage[] {
  return [...newEmailQueue];
}

/**
 * Clear the new emails queue
 */
export function clearNewEmails(): void {
  newEmailQueue.length = 0;
  pollingLogger.debug("Cleared new emails queue");
}

/**
 * Add email to queue (maintains max size)
 */
function addToQueue(email: EmailMessage): void {
  newEmailQueue.unshift(email);
  if (newEmailQueue.length > MAX_QUEUE_SIZE) {
    newEmailQueue.pop();
  }
}

/**
 * Poll for new emails
 */
async function poll(): Promise<void> {
  if (isPolling) {
    pollingLogger.debug("Skipping poll - already in progress");
    return;
  }

  isPolling = true;

  try {
    // Initialize history ID if needed
    if (!lastHistoryId) {
      const profile = await getProfile();
      lastHistoryId = profile.historyId;
      pollingLogger.info("Initialized history ID", { historyId: lastHistoryId });
      isPolling = false;
      return;
    }

    // Get changes since last poll
    const history = await getHistory(lastHistoryId, ["messageAdded"]);

    if (history.messages.length === 0) {
      pollingLogger.debug("No new messages");
      lastHistoryId = history.historyId;
      isPolling = false;
      return;
    }

    pollingLogger.info("Found new messages", { count: history.messages.length });

    // Fetch full details for new messages
    for (const msg of history.messages) {
      if (msg.action === "added") {
        try {
          const email = await getEmail(msg.id);

          // Queue inbox messages for retrieval via get_new_emails
          if (email.labelIds.includes("INBOX")) {
            addToQueue(email);
          }
        } catch (error) {
          pollingLogger.warn("Failed to fetch message details", {
            id: msg.id,
            error,
          });
        }
      }
    }

    lastHistoryId = history.historyId;
    pollingLogger.debug("Poll completed", {
      queueSize: newEmailQueue.length,
      historyId: lastHistoryId,
    });
  } catch (error) {
    // Handle invalid history ID (can happen if too old)
    if (
      error instanceof Error &&
      error.message.includes("Invalid historyId")
    ) {
      pollingLogger.warn("History ID expired, reinitializing");
      lastHistoryId = null;
    } else {
      pollingLogger.error("Polling failed", { error });
    }
  } finally {
    isPolling = false;
  }
}

/**
 * Start polling for new emails
 */
export function startPolling(intervalMs: number): void {
  if (pollingInterval) {
    pollingLogger.warn("Polling already started");
    return;
  }

  pollingLogger.info("Starting email polling", { intervalMs });

  // Initial poll
  poll().catch((error) => {
    pollingLogger.error("Initial poll failed", { error });
  });

  // Set up interval
  pollingInterval = setInterval(() => {
    poll().catch((error) => {
      pollingLogger.error("Poll iteration failed", { error });
    });
  }, intervalMs);
}

/**
 * Stop polling
 */
export function stopPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    pollingLogger.info("Stopped email polling");
  }
}

/**
 * Check if polling is active
 */
export function isPollingActive(): boolean {
  return pollingInterval !== null;
}

/**
 * Get current queue size
 */
export function getQueueSize(): number {
  return newEmailQueue.length;
}
