import { inngest } from './inngest-client.js';
import { JobStorage } from './storage.js';
import { executeAction } from './executor.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { JobDefinition, TaskDefinition } from './types.js';
import { getConfig } from '../config/index.js';
import { Cron } from 'croner';

const storage = new JobStorage();

// Background job executor
export const backgroundJobFunction = inngest.createFunction(
  {
    id: 'background-job-executor',
    name: 'Execute Background Job',
    concurrency: {
      limit: 10,
    },
    retries: 3,
  },
  { event: 'job/background.execute' },
  async ({ event, step }) => {
    const { taskId, action } = event.data;

    logger.info('Background job started', { taskId });

    // Load task
    const task = await storage.loadTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Update status to running
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    await storage.saveTask(task);

    const startTime = Date.now();

    try {
      // Execute action
      const result = await step.run('execute-action', async () => {
        return await executeAction(action);
      });

      // Update task with success
      const duration = Date.now() - startTime;
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.result = result;
      task.duration = duration;
      await storage.saveTask(task);

      logger.info('Background job completed', { taskId, duration });

      // Send notification via Telegram
      await step.run('notify-success', async () => {
        try {
          const { handleTelegram } = await import('../tools/telegram.js');
          await handleTelegram({
            message: `✅ Task "${task.name}" completed successfully in ${duration}ms`,
          });
        } catch (error) {
          logger.error('Failed to send success notification', { error });
        }
      });

      return { success: true, result };
    } catch (error) {
      // Update task with failure
      const duration = Date.now() - startTime;
      task.status = 'failed';
      task.completedAt = new Date().toISOString();
      task.error = error instanceof Error ? error.message : String(error);
      task.duration = duration;
      await storage.saveTask(task);

      logger.error('Background job failed', { taskId, error });

      // Send failure notification via Telegram
      await step.run('notify-failure', async () => {
        try {
          const { handleTelegram } = await import('../tools/telegram.js');
          await handleTelegram({
            message: `❌ Task "${task.name}" failed after ${duration}ms: ${task.error}`,
          });
        } catch (notifyError) {
          logger.error('Failed to send failure notification', { error: notifyError });
        }
      });

      // Store error in Memory MCP
      await step.run('log-error', async () => {
        try {
          const { handleStoreFact } = await import('../tools/memory.js');
          await handleStoreFact({
            fact: `Task "${task.name}" (${taskId}) failed: ${task.error}`,
            category: 'error',
            agentId: 'orchestrator',
          });
        } catch (memoryError) {
          logger.error('Failed to log error to memory', { error: memoryError });
        }
      });

      throw error;
    }
  }
);

// Cron job executor
export const cronJobFunction = inngest.createFunction(
  {
    id: 'cron-job-executor',
    name: 'Execute Cron Job',
    retries: 3,
  },
  { event: 'job/cron.execute' },
  async ({ event, step }) => {
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
          const { handleTelegram } = await import('../tools/telegram.js');
          await handleTelegram({
            message: `❌ Cron job "${job.name}" failed after ${duration}ms: ${error instanceof Error ? error.message : String(error)}`,
          });
        } catch (notifyError) {
          logger.error('Failed to send failure notification', { error: notifyError });
        }
      });

      // Store error in Memory MCP
      await step.run('log-error', async () => {
        try {
          const { handleStoreFact } = await import('../tools/memory.js');
          await handleStoreFact({
            fact: `Cron job "${job.name}" (${jobId}) failed: ${error instanceof Error ? error.message : String(error)}`,
            category: 'error',
            agentId: 'orchestrator',
          });
        } catch (memoryError) {
          logger.error('Failed to log error to memory', { error: memoryError });
        }
      });

      throw error;
    }
  }
);

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
        const cron = new Cron(job.cronExpression!, { timezone: job.timezone || 'UTC' });
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

      if (!isDue) continue;

      await step.run(`execute-cron-${job.id}`, async () => {
        const startTime = Date.now();
        try {
          logger.info('Cron poller executing job', { jobId: job.id, name: job.name });
          const result = await executeAction(job.action);

          job.lastRunAt = new Date().toISOString();
          await storage.saveJob(job);

          const duration = Date.now() - startTime;
          logger.info('Cron job completed', { jobId: job.id, duration });
          return { success: true, result };
        } catch (error) {
          const duration = Date.now() - startTime;
          logger.error('Cron job failed', { jobId: job.id, error });

          // Update lastRunAt even on failure to prevent retry storm
          job.lastRunAt = new Date().toISOString();
          await storage.saveJob(job);

          // Send failure notification via Telegram
          try {
            const { handleTelegram } = await import('../tools/telegram.js');
            await handleTelegram({
              message: `❌ Cron job "${job.name}" failed after ${duration}ms: ${error instanceof Error ? error.message : String(error)}`,
            });
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

// Skill scheduler - checks for due skills and dispatches to Thinker
export const skillSchedulerFunction = inngest.createFunction(
  {
    id: 'skill-scheduler',
    name: 'Skill Scheduler',
    concurrency: { limit: 1 },
    retries: 1,
  },
  { cron: '* * * * *' }, // Every minute
  async ({ step }) => {
    const config = getConfig();
    const thinkerUrl = config.thinkerUrl;

    // 1. List enabled cron skills from Memory MCP
    const skillsResult = await step.run('list-skills', async (): Promise<{ skills: unknown[] }> => {
      try {
        const { getOrchestrator } = await import('../core/orchestrator.js');
        const orchestrator = await getOrchestrator();
        const toolRouter = orchestrator.getToolRouter();
        const result = await toolRouter.routeToolCall('memory_list_skills', {
          agent_id: 'thinker',
          enabled: true,
          trigger_type: 'cron',
        });
        if (!result.success) {
          logger.warn('Failed to list skills', { error: result.error });
          return { skills: [] };
        }
        // Parse the response - it comes as stringified JSON in content
        const content = result.content;
        const data = typeof content === 'string' ? JSON.parse(content) : content;
        const parsed = data as Record<string, unknown> | null;
        const inner = (parsed?.data || parsed || { skills: [] }) as { skills?: unknown[] };
        return { skills: inner.skills || [] };
      } catch (error) {
        logger.error('Failed to list skills from Memory MCP', { error });
        return { skills: [] };
      }
    });

    const skills = skillsResult.skills;
    if (skills.length === 0) {
      return { checked: 0, executed: 0 };
    }

    let executed = 0;

    interface SkillRecord {
      id: number;
      name: string;
      trigger_config: string | Record<string, unknown>;
      instructions: string;
      max_steps?: number;
      notify_on_completion?: boolean;
      last_run_at?: string | null;
    }

    for (const rawSkill of skills) {
      const skill = rawSkill as SkillRecord;
      const triggerConfig = typeof skill.trigger_config === 'string'
        ? JSON.parse(skill.trigger_config)
        : skill.trigger_config;

      // Determine if skill is due. Two scheduling modes:
      // 1. Cron expression: { "schedule": "0 9 * * *", "timezone": "Europe/Warsaw" }
      // 2. Interval: { "interval_minutes": 60 }
      let isDue = false;
      const now = new Date();

      if (triggerConfig?.schedule) {
        // Cron expression mode — use croner to check if the schedule fires this minute
        try {
          const cron = new Cron(triggerConfig.schedule, {
            timezone: triggerConfig.timezone || 'UTC',
          });
          const minuteStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);
          const prevMinuteStart = new Date(minuteStart.getTime() - 60000);
          const nextRun = cron.nextRun(prevMinuteStart);

          if (nextRun && nextRun >= minuteStart && nextRun < new Date(minuteStart.getTime() + 60000)) {
            isDue = true;
          }

          // Prevent double execution within the same minute
          if (isDue && skill.last_run_at) {
            const lastRun = new Date(skill.last_run_at).getTime();
            if (lastRun >= minuteStart.getTime()) {
              isDue = false;
            }
          }
        } catch (cronError) {
          logger.error('Invalid cron schedule in skill trigger_config', {
            skillId: skill.id,
            schedule: triggerConfig.schedule,
            error: cronError,
          });
        }
      } else {
        // Interval mode — check minutes since last run
        const intervalMinutes = triggerConfig?.interval_minutes || 1440; // Default: daily
        const lastRunAt = skill.last_run_at ? new Date(skill.last_run_at).getTime() : 0;
        const minutesSinceLastRun = (now.getTime() - lastRunAt) / 60000;
        isDue = minutesSinceLastRun >= intervalMinutes;
      }

      if (!isDue) {
        continue;
      }

      // Execute the skill via Thinker
      await step.run(`execute-skill-${skill.id}`, async () => {
        try {
          logger.info('Executing skill via Thinker', { skillId: skill.id, name: skill.name });

          const response = await fetch(`${thinkerUrl}/execute-skill`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              skillId: skill.id,
              instructions: skill.instructions,
              maxSteps: skill.max_steps || 10,
              notifyOnCompletion: skill.notify_on_completion,
            }),
          });

          const result = await response.json();

          // Update skill's last_run fields via Memory MCP
          try {
            const { getOrchestrator } = await import('../core/orchestrator.js');
            const orchestrator = await getOrchestrator();
            const toolRouter = orchestrator.getToolRouter();
            await toolRouter.routeToolCall('memory_update_skill', {
              skill_id: skill.id,
              last_run_at: new Date().toISOString(),
              last_run_status: result.success ? 'success' : 'error',
              last_run_summary: result.summary || result.error || 'No summary',
            });
          } catch (updateError) {
            logger.error('Failed to update skill status', { skillId: skill.id, error: updateError });
          }

          return result;
        } catch (error) {
          logger.error('Failed to execute skill via Thinker', { skillId: skill.id, error });

          // Still update the skill as failed
          try {
            const { getOrchestrator } = await import('../core/orchestrator.js');
            const orchestrator = await getOrchestrator();
            const toolRouter = orchestrator.getToolRouter();
            await toolRouter.routeToolCall('memory_update_skill', {
              skill_id: skill.id,
              last_run_at: new Date().toISOString(),
              last_run_status: 'error',
              last_run_summary: error instanceof Error ? error.message : 'Failed to reach Thinker',
            });
          } catch (updateError) {
            logger.error('Failed to update skill error status', { skillId: skill.id, error: updateError });
          }

          return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      });

      executed++;
    }

    return { checked: skills.length, executed };
  }
);

export const jobFunctions = [backgroundJobFunction, cronJobFunction, cronJobPollerFunction, skillSchedulerFunction];
