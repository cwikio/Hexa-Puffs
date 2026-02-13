import { inngest } from './inngest-client.js';
import { JobStorage } from './storage.js';
import { executeAction } from './executor.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { getHaltManager } from '../core/halt-manager.js';
import { Cron } from 'croner';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Send a Telegram notification via the tool router. */
async function notifyTelegram(message: string): Promise<void> {
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
async function storeErrorFact(fact: string): Promise<void> {
  const { getOrchestrator } = await import('../core/orchestrator.js');
  const orchestrator = await getOrchestrator();
  await orchestrator.getToolRouter().routeToolCall('memory_store_fact', {
    fact,
    category: 'error',
    agent_id: 'orchestrator',
  });
}

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
          await notifyTelegram(`✅ Task "${task.name}" completed successfully in ${duration}ms`);
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
          await notifyTelegram(`❌ Task "${task.name}" failed after ${duration}ms: ${task.error}`);
        } catch (notifyError) {
          logger.error('Failed to send failure notification', { error: notifyError });
        }
      });

      // Store error in Memory MCP
      await step.run('log-error', async () => {
        try {
          await storeErrorFact(`Task "${task.name}" (${taskId}) failed: ${task.error}`);
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

    // 0.5. Rate-limited Ollama health check — notify via Telegram if down
    await step.run('check-ollama', async () => {
      const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
          // Ollama is up — clear any previous alert state
          const stateDir = join(homedir(), '.annabelle', 'data');
          const statePath = join(stateDir, 'ollama-alert-state.json');
          try {
            const state = JSON.parse(await readFile(statePath, 'utf-8'));
            if (state.down) {
              await writeFile(statePath, JSON.stringify({ down: false, lastNotified: null }));
              await notifyTelegram('✅ Ollama is back online — vector search restored.');
            }
          } catch {
            // No state file — Ollama was never flagged as down, nothing to do
          }
          return;
        }
      } catch {
        // Ollama unreachable — fall through to notify
      }

      // Notify only once — skip if already flagged as down
      const stateDir = join(homedir(), '.annabelle', 'data');
      const statePath = join(stateDir, 'ollama-alert-state.json');

      let alreadyNotified = false;
      try {
        const state = JSON.parse(await readFile(statePath, 'utf-8'));
        if (state.down) {
          alreadyNotified = true;
        }
      } catch {
        // No state file — first time detecting Ollama down
      }

      if (!alreadyNotified) {
        try {
          await mkdir(stateDir, { recursive: true });
          await writeFile(statePath, JSON.stringify({ down: true, since: new Date().toISOString() }));
          await notifyTelegram(
            `⚠️ Ollama is unreachable at ${ollamaUrl}\n\nMemorizer vector search has degraded to text-only mode. Start Ollama or check OLLAMA_URL.`,
          );
          logger.warn('Ollama unreachable — Telegram notification sent');
        } catch (notifyErr) {
          logger.error('Failed to send Ollama alert', { error: notifyErr });
        }
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

      // Pre-flight: skip meeting-related skills when calendar is empty
      const requiredToolsRaw = typeof skill.required_tools === 'string'
        ? (() => { try { return JSON.parse(skill.required_tools); } catch { return []; } })()
        : Array.isArray(skill.required_tools) ? skill.required_tools : [];
      const isMeetingSkill = requiredToolsRaw.includes('gmail_list_events')
        && /meeting|prep/i.test(skill.name);

      if (isMeetingSkill) {
        const shouldSkip = await step.run(`preflight-calendar-${skill.id}`, async () => {
          try {
            const { getOrchestrator } = await import('../core/orchestrator.js');
            const orchestrator = await getOrchestrator();
            const toolRouter = orchestrator.getToolRouter();

            const now = new Date();
            const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

            const result = await toolRouter.routeToolCall('gmail_list_events', {
              time_min: now.toISOString(),
              time_max: endOfDay.toISOString(),
            });

            if (!result.success) return false; // Don't skip on error — let the skill run

            const mcpResponse = result.content as { content?: Array<{ type: string; text?: string }> };
            const rawText = mcpResponse?.content?.[0]?.text;
            if (!rawText) return true; // No text = no events

            const data = JSON.parse(rawText);
            const events = data?.data?.events || data?.events || [];
            return events.length === 0;
          } catch (error) {
            logger.warn('Calendar pre-check failed, letting skill run', { error });
            return false; // Don't skip on error
          }
        });

        if (shouldSkip) {
          logger.info('Skipping skill — no upcoming calendar events', {
            skillId: skill.id,
            name: skill.name,
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
            skill.id,
            skill.name,
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

          // Notify if cost monitor tripped (during or before this skill)
          if (result.paused) {
            try {
              const agentDef = orchestrator.getAgentDefinition('annabelle');
              const chatId = agentDef?.costControls?.notifyChatId || process.env.NOTIFY_CHAT_ID;
              if (chatId) {
                const agentManager = orchestrator.getAgentManager();
                agentManager?.markPaused(
                  agentManager.getDefaultAgentId() || 'annabelle',
                  'Cost limit exceeded during skill execution',
                );

                const toolRouter = orchestrator.getToolRouter();
                await toolRouter.routeToolCall('telegram_send_message', {
                  chat_id: chatId,
                  message: `Agent paused due to unusual token consumption (during skill "${skill.name}").\n\nThe agent will not process messages until resumed.`,
                });
              }
            } catch (pauseNotifyError) {
              logger.error('Failed to send cost-pause notification', { error: pauseNotifyError });
            }
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

// Proactive Health Report — runs diagnostic checks every 6 hours,
// updates error baseline, and sends Telegram alert if anything degraded.
export const healthReportFunction = inngest.createFunction(
  {
    id: 'proactive-health-report',
    name: 'Proactive Health Report',
    concurrency: { limit: 1 },
    retries: 1,
  },
  { cron: '0 */6 * * *' }, // Every 6 hours
  async ({ step }) => {
    if (getHaltManager().isTargetHalted('inngest')) {
      return { success: false, halted: true };
    }

    // 1. Run diagnostic checks
    const findings = await step.run('run-diagnostics', async () => {
      const { getOrchestrator } = await import('../core/orchestrator.js');
      const orchestrator = await getOrchestrator();
      const { runDiagnosticChecks } = await import('../commands/diagnostic-checks.js');

      const status = orchestrator.getStatus();
      const ctx = {
        orchestrator,
        toolRouter: orchestrator.getToolRouter(),
        status,
      };

      const result = await runDiagnosticChecks(ctx);
      return result.findings.map((f) => ({
        id: f.id,
        severity: f.severity,
        category: f.category,
        summary: f.summary,
        recommendation: f.recommendation,
      }));
    });

    // 2. Update error baseline
    await step.run('update-baseline', async () => {
      const { updateBaseline } = await import('../commands/error-baseline.js');
      await updateBaseline();
    });

    // 3. Load previous report and compare
    const comparison = await step.run('compare-reports', async () => {
      const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');

      const reportPath = join(homedir(), '.annabelle', 'data', 'last-health-report.json');

      interface HealthReportFinding {
        id: string;
        severity: string;
        category: string;
        summary: string;
        recommendation: string;
      }

      interface PreviousReport {
        timestamp: string;
        findings: HealthReportFinding[];
      }

      let previous: PreviousReport | null = null;
      if (existsSync(reportPath)) {
        try {
          previous = JSON.parse(readFileSync(reportPath, 'utf-8')) as PreviousReport;
        } catch {
          previous = null;
        }
      }

      // Compute diff
      const previousIds = new Set(previous?.findings.map((f) => f.id) ?? []);
      const currentIds = new Set(findings.map((f) => f.id));

      const newIssues = findings.filter((f) => !previousIds.has(f.id));
      const resolved = (previous?.findings ?? []).filter((f) => !currentIds.has(f.id));

      // Save current report
      const report: PreviousReport = {
        timestamp: new Date().toISOString(),
        findings,
      };

      const dir = join(homedir(), '.annabelle', 'data');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

      return {
        newIssues: newIssues.map((f) => ({ id: f.id, severity: f.severity, category: f.category, summary: f.summary })),
        resolved: resolved.map((f) => ({ id: f.id, category: f.category, summary: f.summary })),
        totalFindings: findings.length,
      };
    });

    // 4. Send Telegram alert if anything changed
    if (comparison.newIssues.length > 0 || comparison.resolved.length > 0) {
      await step.run('notify-changes', async () => {
        try {
          const lines: string[] = ['Health Report (6h check)'];

          if (comparison.newIssues.length > 0) {
            lines.push('');
            lines.push('New issues:');
            for (const issue of comparison.newIssues) {
              const icon = issue.severity === 'critical' ? '[!!]' : '[!]';
              lines.push(`${icon} ${issue.category}: ${issue.summary}`);
            }
          }

          if (comparison.resolved.length > 0) {
            lines.push('');
            lines.push('Resolved:');
            for (const resolved of comparison.resolved) {
              lines.push(`[ok] ${resolved.category}: ${resolved.summary}`);
            }
          }

          lines.push('');
          lines.push(
            `${comparison.newIssues.length} new issue${comparison.newIssues.length !== 1 ? 's' : ''}, ` +
            `${comparison.resolved.length} resolved. Run /diagnose for details.`,
          );

          await notifyTelegram(lines.join('\n'));
        } catch (error) {
          logger.error('Failed to send health report notification', { error });
        }
      });
    }

    return {
      success: true,
      findings: comparison.totalFindings,
      newIssues: comparison.newIssues.length,
      resolved: comparison.resolved.length,
    };
  },
);

export const jobFunctions = [
  backgroundJobFunction,
  cronJobFunction,
  cronJobPollerFunction,
  skillSchedulerFunction,
  conversationBackfillFunction,
  memorySynthesisFunction,
  healthReportFunction,
];
