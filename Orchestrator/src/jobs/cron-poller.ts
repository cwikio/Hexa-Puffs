import { inngest } from './inngest-client.js';
import { storage, notifyTelegram, SYSTEM_TIMEZONE } from './helpers.js';
import { executeAction } from './executor.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { getHaltManager } from '../core/halt-manager.js';
import { Cron } from 'croner';

// Cron job poller - checks all saved cron jobs and executes those that are due
export const cronJobPollerFunction = inngest.createFunction(
  {
    id: 'cron-job-poller',
    name: 'Poll and Execute Due Cron Jobs',
    concurrency: { limit: 1 },
    retries: 1,
  },
  { cron: '* * * * *' }, // Every minute
  async ({ step }) => {
    if (getHaltManager().isTargetHalted('inngest')) {
      return { checked: 0, executed: 0, halted: true };
    }

    const jobs = await step.run('load-cron-jobs', async () => {
      const allJobs = await storage.listJobs();
      return allJobs.filter(
        (j) => j.type === 'cron' && j.enabled && j.cronExpression
      );
    });

    if (jobs.length === 0) {
      return { checked: 0, executed: 0 };
    }

    let executed = 0;
    const now = new Date();

    for (const job of jobs) {
      // Check if this cron expression is due for the current minute.
      // Strategy: compute nextRun from the start of the previous minute.
      // If that falls within the current minute, the job is due.
      let isDue = false;
      try {
        const cron = new Cron(job.cronExpression!, { timezone: job.timezone || SYSTEM_TIMEZONE });
        const minuteStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);
        const prevMinuteStart = new Date(minuteStart.getTime() - 60000);
        const nextFromPrev = cron.nextRun(prevMinuteStart);

        if (!nextFromPrev) continue;

        isDue = nextFromPrev >= minuteStart && nextFromPrev < new Date(minuteStart.getTime() + 60000);

        // Skip if already run within the current minute (prevent double execution)
        if (isDue && job.lastRunAt) {
          const lastRun = new Date(job.lastRunAt).getTime();
          if (lastRun >= minuteStart.getTime()) {
            isDue = false;
          }
        }
      } catch (error) {
        logger.error('Invalid cron expression', { jobId: job.id, cronExpression: job.cronExpression, error });
        continue;
      }

      // Check expiration limits before executing
      if (isDue && job.expiresAt) {
        if (now.getTime() >= new Date(job.expiresAt).getTime()) {
          job.enabled = false;
          await storage.saveJob(job);
          logger.info('Cron job expired (past expiresAt)', { jobId: job.id, expiresAt: job.expiresAt });
          isDue = false;
        }
      }

      if (isDue && job.maxRuns !== undefined) {
        const currentCount = job.runCount ?? 0;
        if (currentCount >= job.maxRuns) {
          job.enabled = false;
          await storage.saveJob(job);
          logger.info('Cron job expired (maxRuns reached)', { jobId: job.id, runCount: currentCount, maxRuns: job.maxRuns });
          isDue = false;
        }
      }

      if (!isDue) continue;

      await step.run(`execute-cron-${job.id}`, async () => {
        const startTime = Date.now();
        try {
          logger.info('Cron poller executing job', { jobId: job.id, name: job.name });
          const result = await executeAction(job.action);

          job.lastRunAt = new Date().toISOString();
          job.runCount = (job.runCount ?? 0) + 1;

          // Auto-disable if maxRuns reached
          if (job.maxRuns !== undefined && job.runCount >= job.maxRuns) {
            job.enabled = false;
            logger.info('Cron job auto-disabled after maxRuns', { jobId: job.id, runCount: job.runCount });
          }

          await storage.saveJob(job);

          const duration = Date.now() - startTime;
          logger.info('Cron job completed', { jobId: job.id, duration });
          return { success: true, result };
        } catch (error) {
          const duration = Date.now() - startTime;
          logger.error('Cron job failed', { jobId: job.id, error });

          // Update lastRunAt and runCount even on failure to prevent retry storm
          job.lastRunAt = new Date().toISOString();
          job.runCount = (job.runCount ?? 0) + 1;

          if (job.maxRuns !== undefined && job.runCount >= job.maxRuns) {
            job.enabled = false;
            logger.info('Cron job auto-disabled after maxRuns (failed run)', { jobId: job.id, runCount: job.runCount });
          }

          await storage.saveJob(job);

          // Send failure notification via Telegram
          try {
            await notifyTelegram(`❌ Cron job "${job.name}" failed after ${duration}ms: ${error instanceof Error ? error.message : String(error)}`);
          } catch (notifyError) {
            logger.error('Failed to send failure notification', { error: notifyError });
          }

          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      });

      executed++;
    }

    return { checked: jobs.length, executed };
  }
);
