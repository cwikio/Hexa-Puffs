import { inngest } from './inngest-client.js';
import { storage, notifyTelegram, storeErrorFact } from './helpers.js';
import { executeAction } from './executor.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { getHaltManager } from '../core/halt-manager.js';

// Cron job executor
export const cronJobFunction = inngest.createFunction(
  {
    id: 'cron-job-executor',
    name: 'Execute Cron Job',
    retries: 3,
  },
  { event: 'job/cron.execute' },
  async ({ event, step }) => {
    if (getHaltManager().isTargetHalted('inngest')) {
      logger.info('Cron job skipped — system halted');
      return { success: false, error: 'System halted — use /resume inngest to restart' };
    }

    const { jobId, action } = event.data;

    logger.info('Cron job triggered', { jobId });

    // Load job
    const job = await storage.loadJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (!job.enabled) {
      logger.info('Job is disabled, skipping', { jobId });
      return { success: true, skipped: true };
    }

    const startTime = Date.now();

    try {
      // Execute action
      const result = await step.run('execute-action', async () => {
        return await executeAction(action);
      });

      // Update job metadata
      await step.run('update-metadata', async () => {
        job.lastRunAt = new Date().toISOString();
        await storage.saveJob(job);
      });

      const duration = Date.now() - startTime;
      logger.info('Cron job completed', { jobId, duration });

      return { success: true, result };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Cron job failed', { jobId, error });

      // Send failure notification via Telegram (after retries exhausted)
      await step.run('notify-failure', async () => {
        try {
          await notifyTelegram(`❌ Cron job "${job.name}" failed after ${duration}ms: ${error instanceof Error ? error.message : String(error)}`);
        } catch (notifyError) {
          logger.error('Failed to send failure notification', { error: notifyError });
        }
      });

      // Store error in Memory MCP
      await step.run('log-error', async () => {
        try {
          await storeErrorFact(`Cron job "${job.name}" (${jobId}) failed: ${error instanceof Error ? error.message : String(error)}`);
        } catch (memoryError) {
          logger.error('Failed to log error to memory', { error: memoryError });
        }
      });

      throw error;
    }
  }
);
