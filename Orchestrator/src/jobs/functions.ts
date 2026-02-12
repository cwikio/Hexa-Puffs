import { inngest } from './inngest-client.js';
import { JobStorage } from './storage.js';
import { executeAction } from './executor.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { JobDefinition, TaskDefinition } from './types.js';
import { getConfig } from '../config/index.js';
import { getHaltManager } from '../core/halt-manager.js';
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
    if (getHaltManager().isTargetHalted('inngest')) {
      logger.info('Background job skipped — system halted');
      return { success: false, error: 'System halted — use /resume inngest to restart' };
    }

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
    if (getHaltManager().isTargetHalted('inngest')) {
      return { checked: 0, executed: 0, halted: true };
    }

    // 0. Auto-enable disabled cron skills whose required_tools are now available
    await step.run('auto-enable-skills', async () => {
      try {
        const { getOrchestrator } = await import('../core/orchestrator.js');
        const orchestrator = await getOrchestrator();
        const toolRouter = orchestrator.getToolRouter();

        // List disabled cron skills
        const disabledResult = await toolRouter.routeToolCall('memory_list_skills', {
          agent_id: 'thinker',
          enabled: false,
          trigger_type: 'cron',
        });

        if (!disabledResult.success) return;

        const mcpResponse = disabledResult.content as { content?: Array<{ type: string; text?: string }> };
        const rawText = mcpResponse?.content?.[0]?.text;
        if (!rawText) return;
        const data = JSON.parse(rawText);
        const disabledSkills = (data?.data?.skills || data?.skills || []) as unknown[];

        for (const rawSkill of disabledSkills) {
          const skill = rawSkill as { id: number; name: string; required_tools?: string[] | string };
          let requiredTools: string[] = [];

          if (typeof skill.required_tools === 'string') {
            try { requiredTools = JSON.parse(skill.required_tools); } catch { /* ignore */ }
          } else if (Array.isArray(skill.required_tools)) {
            requiredTools = skill.required_tools;
          }

          // Skip skills with no required tools — they can be enabled manually
          if (requiredTools.length === 0) continue;

          // Check if ALL required tools are available in the ToolRouter
          const allAvailable = requiredTools.every(tool => toolRouter.hasRoute(tool));

          if (allAvailable) {
            await toolRouter.routeToolCall('memory_update_skill', {
              skill_id: skill.id,
              enabled: true,
            });
            logger.info('Auto-enabled skill — all required tools available', {
              skillId: skill.id,
              name: skill.name,
              requiredTools,
            });
          }
        }
      } catch (error) {
        // Non-fatal — just log and continue with the normal scheduler
        logger.warn('Auto-enable check failed', { error });
      }
    });

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
        // Parse the response — unwrap MCP content[0].text
        const mcpResponse = result.content as { content?: Array<{ type: string; text?: string }> };
        const rawText = mcpResponse?.content?.[0]?.text;
        if (!rawText) return { skills: [] };
        const data = JSON.parse(rawText);
        return { skills: data?.data?.skills || data?.skills || [] };
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
      last_run_status?: string | null;
      required_tools?: string[] | string;
    }

    const FAILURE_COOLDOWN_MINUTES = 5;

    async function notifySkillFailure(
      skill: SkillRecord,
      errorMessage: string,
      triggerConfig: Record<string, unknown> | null,
    ): Promise<void> {
      try {
        const { getOrchestrator } = await import('../core/orchestrator.js');
        const orchestrator = await getOrchestrator();
        const agentDef = orchestrator.getAgentDefinition('annabelle');
        const chatId = agentDef?.costControls?.notifyChatId || process.env.NOTIFY_CHAT_ID;
        if (!chatId) return;

        const trigger = triggerConfig?.schedule
          ? `cron: ${triggerConfig.schedule}`
          : `interval: ${triggerConfig?.interval_minutes || 1440}min`;
        const time = new Date().toISOString();

        const toolRouter = orchestrator.getToolRouter();
        await toolRouter.routeToolCall('telegram_send_message', {
          chat_id: chatId,
          message: [
            `Skill "${skill.name}" (id: ${skill.id}) failed`,
            `Time: ${time}`,
            `Trigger: ${trigger}`,
            `Error: ${errorMessage}`,
            `Next retry in ${FAILURE_COOLDOWN_MINUTES} minutes (cooldown active)`,
          ].join('\n'),
        });
      } catch (notifyError) {
        logger.error('Failed to send skill failure notification', { error: notifyError });
      }
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

      // Back-off: skip skills that recently failed (cooldown prevents hammering)
      if (skill.last_run_status === 'error' && skill.last_run_at) {
        const minutesSinceFailure = (now.getTime() - new Date(skill.last_run_at).getTime()) / 60000;
        if (minutesSinceFailure < FAILURE_COOLDOWN_MINUTES) {
          logger.info('Skipping skill due to recent failure (cooldown)', {
            skillId: skill.id,
            name: skill.name,
            minutesSinceFailure: Math.round(minutesSinceFailure),
            cooldownMinutes: FAILURE_COOLDOWN_MINUTES,
          });
          continue;
        }
      }

      // Execute the skill via Thinker (discovered through AgentManager)
      await step.run(`execute-skill-${skill.id}`, async () => {
        try {
          logger.info('Executing skill via Thinker', { skillId: skill.id, name: skill.name });

          const { getOrchestrator } = await import('../core/orchestrator.js');
          const orchestrator = await getOrchestrator();
          const agentManager = orchestrator.getAgentManager();
          if (!agentManager) {
            throw new Error('AgentManager not initialized');
          }

          // Discover and ensure agent is running
          const agentId = agentManager.getDefaultAgentId();
          if (!agentId) {
            throw new Error('No agent registered in AgentManager');
          }

          const isRunning = await agentManager.ensureRunning(agentId);
          if (!isRunning) {
            throw new Error(`Agent "${agentId}" failed to start`);
          }

          const client = agentManager.getClient(agentId);
          if (!client) {
            throw new Error(`Agent "${agentId}" client not available after ensureRunning`);
          }

          // Auto-detect notification chat from channel manager
          let notifyChatId: string | undefined;
          if (skill.notify_on_completion) {
            const channelManager = orchestrator.getChannelManager();
            const telegramAdapter = channelManager?.getAdapter('telegram');
            const chatIds = telegramAdapter?.getMonitoredChatIds() ?? [];
            if (chatIds.length > 0) {
              notifyChatId = chatIds[0];
            }
          }

          // Parse required_tools (can be JSON string or array from DB)
          let parsedRequiredTools: string[] | undefined;
          if (typeof skill.required_tools === 'string') {
            try { parsedRequiredTools = JSON.parse(skill.required_tools); } catch { /* ignore */ }
          } else if (Array.isArray(skill.required_tools)) {
            parsedRequiredTools = skill.required_tools;
          }

          const result = await client.executeSkill(
            skill.instructions,
            skill.max_steps || 10,
            skill.notify_on_completion ?? false,
            false,
            notifyChatId,
            parsedRequiredTools,
          );

          // Update skill's last_run fields via Memory MCP
          try {
            const toolRouter = orchestrator.getToolRouter();
            await toolRouter.routeToolCall('memory_update_skill', {
              skill_id: skill.id,
              last_run_at: new Date().toISOString(),
              last_run_status: result.success ? 'success' : 'error',
              last_run_summary: result.response || result.error || 'No summary',
            });
          } catch (updateError) {
            logger.error('Failed to update skill status', { skillId: skill.id, error: updateError });
          }

          // Notify on failure
          if (!result.success) {
            await notifySkillFailure(skill, result.error || 'Unknown error', triggerConfig);
          }

          return result;
        } catch (error) {
          logger.error('Failed to execute skill via Thinker', { skillId: skill.id, error });

          const errorMessage = error instanceof Error ? error.message : 'Failed to reach Thinker';

          // Still update the skill as failed
          try {
            const { getOrchestrator } = await import('../core/orchestrator.js');
            const orchestrator = await getOrchestrator();
            const toolRouter = orchestrator.getToolRouter();
            await toolRouter.routeToolCall('memory_update_skill', {
              skill_id: skill.id,
              last_run_at: new Date().toISOString(),
              last_run_status: 'error',
              last_run_summary: errorMessage,
            });
          } catch (updateError) {
            logger.error('Failed to update skill error status', { skillId: skill.id, error: updateError });
          }

          // Notify on failure
          await notifySkillFailure(skill, errorMessage, triggerConfig);

          return { success: false, error: errorMessage };
        }
      });

      executed++;
    }

    return { checked: skills.length, executed };
  }
);

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
        const { handleTelegram } = await import('../tools/telegram.js');
        await handleTelegram({
          message: 'Conversation backfill started — extracting facts from unprocessed history.',
        });
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
        const { handleTelegram } = await import('../tools/telegram.js');
        await handleTelegram({
          message:
            `Conversation backfill complete.\n` +
            `Conversations processed: ${totalProcessed}\n` +
            `Facts extracted: ${totalFactsExtracted}`,
        });
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

        const { handleTelegram } = await import('../tools/telegram.js');
        await handleTelegram({
          message:
            `Weekly memory synthesis complete.\n` +
            `Merges: ${result.merges || 0}, Deletions: ${result.deletions || 0}, Updates: ${result.updates || 0}\n` +
            (summaryLines ? `\nPer category:\n${summaryLines}` : ''),
        });
      } catch (error) {
        logger.error('Failed to send synthesis notification', { error });
      }
    });

    return { success: true, ...result };
  },
);

export const jobFunctions = [
  backgroundJobFunction,
  cronJobFunction,
  cronJobPollerFunction,
  skillSchedulerFunction,
  conversationBackfillFunction,
  memorySynthesisFunction,
];
