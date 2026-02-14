import { inngest } from './inngest-client.js';
import { notifyTelegram } from './helpers.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { getHaltManager } from '../core/halt-manager.js';

// Conversation history backfill — extract facts from old conversations that were never processed.
// Manually triggered via 'memory/backfill.start' event (from trigger_backfill tool or Inngest dashboard).
export const conversationBackfillFunction = inngest.createFunction(
  {
    id: 'conversation-backfill',
    name: 'Conversation History Backfill',
    concurrency: { limit: 1 },
    retries: 1,
  },
  { event: 'memory/backfill.start' },
  async ({ step }) => {
    if (getHaltManager().isTargetHalted('inngest')) {
      return { success: false, error: 'System halted' };
    }

    const batchSize = 10;
    let totalProcessed = 0;
    let totalFactsExtracted = 0;
    let batchIndex = 0;

    // Send start notification
    await step.run('notify-start', async () => {
      try {
        await notifyTelegram('Conversation backfill started — extracting facts from unprocessed history.');
      } catch (error) {
        logger.error('Failed to send backfill start notification', { error });
      }
    });

    // Process batches until no conversations remain
    while (true) {
      const batchResult = await step.run(`backfill-batch-${batchIndex}`, async () => {
        const { getOrchestrator } = await import('../core/orchestrator.js');
        const orchestrator = await getOrchestrator();
        const toolRouter = orchestrator.getToolRouter();
        const result = await toolRouter.routeToolCall('memory_backfill_extract_facts', {
          agent_id: 'thinker',
          batch_size: batchSize,
        });

        if (!result.success) {
          throw new Error(result.error || 'Backfill batch failed');
        }

        // Parse the MCP response
        const content = result.content as { content?: Array<{ type: string; text?: string }> };
        const text = content?.content?.[0]?.text;
        if (!text) return { processed: 0, facts_extracted: 0, remaining: 0 };

        try {
          const parsed = JSON.parse(text);
          const data = parsed.data || parsed;
          return {
            processed: data.processed || 0,
            facts_extracted: data.facts_extracted || 0,
            remaining: data.remaining || 0,
          };
        } catch {
          return { processed: 0, facts_extracted: 0, remaining: 0 };
        }
      });

      totalProcessed += batchResult.processed;
      totalFactsExtracted += batchResult.facts_extracted;

      if (batchResult.remaining === 0 || batchResult.processed === 0) {
        break;
      }

      batchIndex++;

      // Rate limit: 3-second pause between batches to respect Groq limits (~20 req/min)
      await step.sleep(`batch-delay-${batchIndex}`, '3s');

      // Re-check halt manager between batches
      const halted = await step.run(`halt-check-${batchIndex}`, async () => {
        return getHaltManager().isTargetHalted('inngest');
      });
      if (halted) {
        break;
      }
    }

    // Send completion notification
    await step.run('notify-complete', async () => {
      try {
        await notifyTelegram(
          `Conversation backfill complete.\n` +
          `Conversations processed: ${totalProcessed}\n` +
          `Facts extracted: ${totalFactsExtracted}`,
        );
      } catch (error) {
        logger.error('Failed to send backfill completion notification', { error });
      }
    });

    return {
      success: true,
      total_processed: totalProcessed,
      total_facts_extracted: totalFactsExtracted,
    };
  },
);
