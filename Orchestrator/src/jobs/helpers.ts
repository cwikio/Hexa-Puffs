import { JobStorage } from './storage.js';
import { logger } from '@mcp/shared/Utils/logger.js';

/** Singleton storage instance shared across all job functions. */
export const storage = new JobStorage();

/** System timezone auto-detected from the OS. Used as default for cron jobs/skills. */
export const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Send a Telegram notification via the tool router. */
export async function notifyTelegram(message: string): Promise<void> {
  const { getOrchestrator } = await import('../core/orchestrator.js');
  const orchestrator = await getOrchestrator();
  const agentDef = orchestrator.getAgentDefinition('annabelle');
  const chatId = agentDef?.costControls?.notifyChatId || process.env.NOTIFY_CHAT_ID;
  if (!chatId) {
    logger.warn('Cannot send Telegram notification — no chat_id configured');
    return;
  }
  await orchestrator.getToolRouter().routeToolCall('telegram_send_message', { chat_id: chatId, message });
}

/** Store a fact via the tool router. */
export async function storeErrorFact(fact: string): Promise<void> {
  const { getOrchestrator } = await import('../core/orchestrator.js');
  const orchestrator = await getOrchestrator();
  await orchestrator.getToolRouter().routeToolCall('memory_store_fact', {
    fact,
    category: 'error',
    agent_id: 'orchestrator',
  });
}
