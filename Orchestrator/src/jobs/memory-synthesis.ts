import { inngest } from './inngest-client.js';
import { notifyTelegram } from './helpers.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { getHaltManager } from '../core/halt-manager.js';

// Weekly memory synthesis — consolidate facts: merge duplicates, resolve contradictions, flag stale entries.
// Runs every Sunday at 3 AM.
export const memorySynthesisFunction = inngest.createFunction(
  {
    id: 'memory-synthesis',
    name: 'Weekly Memory Synthesis',
    concurrency: { limit: 1 },
    retries: 1,
  },
  { cron: '0 3 * * 0' },
  async ({ step }) => {
    if (getHaltManager().isTargetHalted('inngest')) {
      return { success: false, halted: true };
    }

    const result = await step.run('synthesize-facts', async () => {
      const { getOrchestrator } = await import('../core/orchestrator.js');
      const orchestrator = await getOrchestrator();
      const toolRouter = orchestrator.getToolRouter();
      const callResult = await toolRouter.routeToolCall('memory_synthesize_facts', {
        agent_id: 'thinker',
        max_facts_per_category: 100,
      });

      if (!callResult.success) {
        throw new Error(callResult.error || 'Synthesis failed');
      }

      // Parse the MCP response
      const content = callResult.content as { content?: Array<{ type: string; text?: string }> };
      const text = content?.content?.[0]?.text;
      if (!text) return { merges: 0, deletions: 0, updates: 0, summaries: {} };

      try {
        const parsed = JSON.parse(text);
        return parsed.data || parsed;
      } catch {
        return { merges: 0, deletions: 0, updates: 0, summaries: {} };
      }
    });

    // Send summary via Telegram
    await step.run('notify-synthesis', async () => {
      try {
        const summaryLines = Object.entries(result.summaries || {})
          .map(([cat, summary]) => `  ${cat}: ${summary}`)
          .join('\n');

        await notifyTelegram(
          `Weekly memory synthesis complete.\n` +
          `Merges: ${result.merges || 0}, Deletions: ${result.deletions || 0}, Updates: ${result.updates || 0}\n` +
          (summaryLines ? `\nPer category:\n${summaryLines}` : ''),
        );
      } catch (error) {
        logger.error('Failed to send synthesis notification', { error });
      }
    });

    return { success: true, ...result };
  },
);
