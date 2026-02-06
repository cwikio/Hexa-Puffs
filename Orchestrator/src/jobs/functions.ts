import { inngest } from './inngest-client.js';
import { JobStorage } from './storage.js';
import { executeAction } from './executor.js';
import { logger } from '../../../Shared/Utils/logger.js';
import { JobDefinition, TaskDefinition } from './types.js';
import { TelegramMCPClient } from '../mcp-clients/telegram.js';
import { getConfig } from '../config/index.js';

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

// Telegram message poller - checks for new real-time messages
export const telegramMessagePollerFunction = inngest.createFunction(
  {
    id: 'telegram-message-poller',
    name: 'Poll Telegram Messages',
    concurrency: { limit: 1 }, // Only one poller at a time
  },
  { cron: '* * * * *' }, // Every minute (Inngest doesn't support sub-minute cron)
  async ({ step }) => {
    const messages = await step.run('fetch-new-messages', async () => {
      try {
        const config = getConfig();
        if (!config.mcpServers) {
          throw new Error('HTTP MCP servers not configured');
        }
        const client = new TelegramMCPClient(config.mcpServers.telegram);
        return await client.getNewMessages();
      } catch (error) {
        logger.error('Failed to fetch new messages', { error });
        return { messages: [], count: 0 };
      }
    });

    if (messages.count === 0) {
      return { processed: 0 };
    }

    logger.info('Received new Telegram messages', { count: messages.count });

    // Process each message
    let processed = 0;
    for (const msg of messages.messages) {
      // Skip outgoing messages (our own)
      if (msg.isOutgoing) continue;

      await step.run(`process-message-${msg.id}`, async () => {
        // Log to memory
        try {
          const { handleStoreFact } = await import('../tools/memory.js');
          await handleStoreFact({
            fact: `Telegram message from ${msg.senderName || msg.senderId || 'unknown'}: "${msg.text.substring(0, 200)}"`,
            category: 'telegram_message',
            agentId: 'telegram-poller',
          });
        } catch (error) {
          logger.error('Failed to store message in memory', { error, messageId: msg.id });
        }

        logger.info('Processed Telegram message', {
          messageId: msg.id,
          chatId: msg.chatId,
          preview: msg.text.substring(0, 50),
        });
      });

      processed++;
    }

    return { processed };
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
      // Check if skill is due based on interval_minutes in trigger_config
      const triggerConfig = typeof skill.trigger_config === 'string'
        ? JSON.parse(skill.trigger_config)
        : skill.trigger_config;
      const intervalMinutes = triggerConfig?.interval_minutes || 1440; // Default: daily
      const lastRunAt = skill.last_run_at ? new Date(skill.last_run_at).getTime() : 0;
      const minutesSinceLastRun = (Date.now() - lastRunAt) / 60000;

      if (minutesSinceLastRun < intervalMinutes) {
        continue; // Not due yet
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

export const jobFunctions = [backgroundJobFunction, cronJobFunction, telegramMessagePollerFunction, skillSchedulerFunction];
