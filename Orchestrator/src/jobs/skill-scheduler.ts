import { inngest } from './inngest-client.js';
import { notifyTelegram, SYSTEM_TIMEZONE } from './helpers.js';
import { PREFLIGHT_CALENDAR_WINDOW_MS, PREFLIGHT_EMAIL_ENABLED, SKILL_SCHEDULER_CRON } from '../const/general.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { getHaltManager } from '../core/halt-manager.js';
import { Cron } from 'croner';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  getBackoffMinutes,
  getConsecutiveFailures,
  recordFailure,
  recordSuccess,
  MAX_CONSECUTIVE_FAILURES,
} from '../utils/skill-normalizer.js';


interface SkillRecord {
  id: number;
  name: string;
  trigger_config: string | Record<string, unknown>;
  instructions: string;
  execution_plan?: string | null;
  max_steps?: number;
  notify_on_completion?: boolean;
  notify_interval_minutes?: number;
  last_run_at?: string | null;
  last_run_status?: string | null;
  last_notified_at?: string | null;
  required_tools?: string[] | string;
}

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
    const failures = getConsecutiveFailures(skill.id);
    const backoff = getBackoffMinutes(skill.id);
    const remaining = MAX_CONSECUTIVE_FAILURES - failures;

    const toolRouter = orchestrator.getToolRouter();
    await toolRouter.routeToolCall('telegram_send_message', {
      chat_id: chatId,
      message: [
        `Skill "${skill.name}" (id: ${skill.id}) failed`,
        `Time: ${time}`,
        `Trigger: ${trigger}`,
        `Error: ${errorMessage}`,
        `Consecutive failures: ${failures}`,
        remaining > 0
          ? `Next retry in ${backoff} minutes — auto-disable in ${remaining} more failure(s)`
          : `Skill auto-disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`,
        '',
        `Say "show skill ${skill.id}" for details or "delete skill ${skill.id}" to remove it.`,
      ].join('\n'),
    });
  } catch (notifyError) {
    logger.error('Failed to send skill failure notification', { error: notifyError });
  }
}

// Skill scheduler - checks for due skills and dispatches to Thinker
export const skillSchedulerFunction = inngest.createFunction(
  {
    id: 'skill-scheduler',
    name: 'Skill Scheduler',
    concurrency: { limit: 1 },
    retries: 1,
  },
  { cron: SKILL_SCHEDULER_CRON },
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
          const skill = rawSkill as { id: number; name: string; required_tools?: string[] | string; trigger_config?: string };

          // Skip one-shot skills — they were disabled intentionally after firing
          if (skill.trigger_config) {
            try {
              const tc = typeof skill.trigger_config === 'string'
                ? JSON.parse(skill.trigger_config) : skill.trigger_config;
              if ((tc as Record<string, unknown>)?.at) continue;
            } catch { /* ignore parse errors */ }
          }

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

    for (const rawSkill of skills) {
      const skill = rawSkill as SkillRecord;
      const triggerConfig = typeof skill.trigger_config === 'string'
        ? JSON.parse(skill.trigger_config)
        : skill.trigger_config;

      // Determine if skill is due. Three scheduling modes:
      // 1. Cron expression: { "schedule": "0 9 * * *", "timezone": "Europe/Warsaw" }
      // 2. Interval: { "interval_minutes": 60 }
      // 3. One-shot: { "at": "2026-02-14T09:00:00" } — fires once, auto-deletes
      let isDue = false;
      let isOneShot = false;
      const now = new Date();

      if (triggerConfig?.at) {
        // One-shot mode — fire if current time >= scheduled time
        const atTime = new Date(triggerConfig.at as string);
        if (!isNaN(atTime.getTime()) && now >= atTime) {
          isDue = true;
          isOneShot = true;

          // Prevent double execution — only skip if last run was AFTER the scheduled `at` time
          // (allows re-firing when `at` is updated to a new future time)
          if (skill.last_run_at) {
            const lastRun = new Date(skill.last_run_at).getTime();
            if (lastRun >= atTime.getTime()) {
              isDue = false;
            }
          }
        }
      } else if (triggerConfig?.schedule) {
        // Cron expression mode — use croner to check if the schedule fires this minute
        try {
          const cron = new Cron(triggerConfig.schedule, {
            timezone: triggerConfig.timezone || SYSTEM_TIMEZONE,
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

      // Graduated back-off: skip skills that recently failed (prevents hammering)
      if (skill.last_run_status === 'error' && skill.last_run_at) {
        const minutesSinceFailure = (now.getTime() - new Date(skill.last_run_at).getTime()) / 60000;
        const backoff = getBackoffMinutes(skill.id);
        if (minutesSinceFailure < backoff) {
          logger.info('Skipping skill due to recent failure (graduated backoff)', {
            skillId: skill.id,
            name: skill.name,
            minutesSinceFailure: Math.round(minutesSinceFailure),
            backoffMinutes: backoff,
            consecutiveFailures: getConsecutiveFailures(skill.id),
          });
          continue;
        }
      }

      // Pre-flight: calendar-aware scheduling for meeting-related skills
      // - First check of the day with no events → send "no events today" once
      // - Subsequent checks with no events → skip silently
      // - Events found → let the skill run (full Thinker prep)
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
            const windowEnd = new Date(now.getTime() + PREFLIGHT_CALENDAR_WINDOW_MS);

            // Step 1: List all calendars to get their IDs
            let calendarIds = ['primary'];
            const calResult = await toolRouter.routeToolCall('gmail_list_calendars', {});
            if (calResult.success) {
              const calResponse = calResult.content as { content?: Array<{ type: string; text?: string }> };
              const calText = calResponse?.content?.[0]?.text;
              if (calText) {
                const calData = JSON.parse(calText);
                const calendars = calData?.data || calData || [];
                if (Array.isArray(calendars) && calendars.length > 0) {
                  calendarIds = calendars.map((c: { id: string }) => c.id);
                }
              }
            }

            // Step 2: Use free/busy to check ALL calendars in one call
            const fbResult = await toolRouter.routeToolCall('gmail_find_free_time', {
              time_min: now.toISOString(),
              time_max: windowEnd.toISOString(),
              calendar_ids: calendarIds,
            });

            let hasEvents = false;
            if (fbResult.success) {
              const fbResponse = fbResult.content as { content?: Array<{ type: string; text?: string }> };
              const fbText = fbResponse?.content?.[0]?.text;
              if (fbText) {
                const fbData = JSON.parse(fbText);
                const calendars = fbData?.data?.calendars || fbData?.calendars || {};
                // Any calendar with at least one busy slot = there are meetings
                for (const cal of Object.values(calendars) as Array<{ busy?: unknown[] }>) {
                  if (cal.busy && cal.busy.length > 0) {
                    hasEvents = true;
                    break;
                  }
                }
              }
            } else {
              return false; // Don't skip on error — let the skill run
            }

            if (hasEvents) return false; // Meeting within window — run the full skill

            // No meetings in the next window — skip silently (zero LLM cost)
            logger.info('Pre-flight: no meetings in next window, skipping skill', { skillId: skill.id, windowMs: PREFLIGHT_CALENDAR_WINDOW_MS });
            return true;
          } catch (error) {
            logger.warn('Calendar pre-check failed, letting skill run', { error });
            return false; // Don't skip on error
          }
        });

        if (shouldSkip) {
          // Update last_run_at so the interval timer resets (prevents checking every minute)
          try {
            const { getOrchestrator } = await import('../core/orchestrator.js');
            const orchestrator = await getOrchestrator();
            await orchestrator.getToolRouter().routeToolCall('memory_update_skill', {
              skill_id: skill.id,
              last_run_at: new Date().toISOString(),
              last_run_status: 'success',
              last_run_summary: 'No upcoming events — skipped',
            });
          } catch { /* non-fatal */ }
          continue;
        }
      }

      // Pre-flight: email-aware scheduling for email skills
      // If no new emails exist, skip the skill entirely (zero LLM cost)
      const isEmailSkill = requiredToolsRaw.includes('gmail_get_new_emails')
        && /email/i.test(skill.name);

      if (isEmailSkill && PREFLIGHT_EMAIL_ENABLED) {
        const shouldSkipEmail = await step.run(`preflight-email-${skill.id}`, async () => {
          try {
            const { getOrchestrator } = await import('../core/orchestrator.js');
            const orchestrator = await getOrchestrator();
            const toolRouter = orchestrator.getToolRouter();

            const result = await toolRouter.routeToolCall('gmail_get_new_emails', {});
            if (!result.success) return false; // Don't skip on error

            const response = result.content as { content?: Array<{ type: string; text?: string }> };
            const text = response?.content?.[0]?.text;
            if (!text) return false;

            const data = JSON.parse(text);
            const emails = data?.data?.emails || data?.emails || [];
            if (emails.length === 0) {
              logger.info('Pre-flight: no new emails, skipping skill', { skillId: skill.id });
              return true;
            }
            return false;
          } catch (error) {
            logger.warn('Email pre-check failed, letting skill run', { error });
            return false;
          }
        });

        if (shouldSkipEmail) {
          try {
            const { getOrchestrator } = await import('../core/orchestrator.js');
            const orchestrator = await getOrchestrator();
            await orchestrator.getToolRouter().routeToolCall('memory_update_skill', {
              skill_id: skill.id,
              last_run_at: new Date().toISOString(),
              last_run_status: 'success',
              last_run_summary: 'No new emails — skipped',
            });
          } catch { /* non-fatal */ }
          continue;
        }
      }

      // ── Tier Router: Direct vs Agent execution ──
      // execution_plan may be a JSON string (raw DB) or already-parsed array (from formatSkill)
      const executionPlan = (() => {
        const ep = skill.execution_plan;
        if (!ep) return null;
        if (Array.isArray(ep)) return ep;
        if (typeof ep === 'string') {
          try { return JSON.parse(ep); } catch { return null; }
        }
        return null;
      })();

      if (Array.isArray(executionPlan) && executionPlan.length > 0) {
        // DIRECT TIER — execute via ToolRouter, zero LLM cost
        await step.run(`direct-skill-${skill.id}`, async () => {
          try {
            logger.info('Executing skill via Direct tier', { skillId: skill.id, name: skill.name, steps: executionPlan.length });

            const { executeWorkflow } = await import('./executor.js');
            const results = await executeWorkflow(executionPlan);

            const allSuccess = Object.values(results).every(r => r.success);
            const summary = allSuccess
              ? `Direct execution: ${executionPlan.length} step(s) completed`
              : `Direct execution: some steps failed — ${Object.entries(results).filter(([, r]) => !r.success).map(([id, r]) => `${id}: ${r.error}`).join('; ')}`;

            const { getOrchestrator } = await import('../core/orchestrator.js');
            const orchestrator = await getOrchestrator();
            const toolRouter = orchestrator.getToolRouter();

            if (allSuccess) {
              recordSuccess(skill.id);
              await toolRouter.routeToolCall('memory_update_skill', {
                skill_id: skill.id,
                last_run_at: new Date().toISOString(),
                last_run_status: 'success',
                last_run_summary: summary,
              });
            } else {
              const { count, shouldDisable } = recordFailure(skill.id);
              await toolRouter.routeToolCall('memory_update_skill', {
                skill_id: skill.id,
                last_run_at: new Date().toISOString(),
                last_run_status: 'error',
                last_run_summary: summary,
                ...(shouldDisable ? { enabled: false } : {}),
              });
              if (shouldDisable) {
                logger.warn('Direct skill auto-disabled after consecutive failures', {
                  skillId: skill.id, name: skill.name, consecutiveFailures: count,
                });
              }
              await notifySkillFailure(skill, summary, triggerConfig);
            }

            return { success: allSuccess, summary };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Direct execution failed';
            const { count, shouldDisable } = recordFailure(skill.id);

            try {
              const { getOrchestrator } = await import('../core/orchestrator.js');
              const orchestrator = await getOrchestrator();
              const toolRouter = orchestrator.getToolRouter();
              await toolRouter.routeToolCall('memory_update_skill', {
                skill_id: skill.id,
                last_run_at: new Date().toISOString(),
                last_run_status: 'error',
                last_run_summary: errorMessage,
                ...(shouldDisable ? { enabled: false } : {}),
              });
            } catch (updateError) {
              logger.error('Failed to update direct skill error status', { skillId: skill.id, error: updateError });
            }

            if (shouldDisable) {
              logger.warn('Direct skill auto-disabled after consecutive failures', {
                skillId: skill.id, name: skill.name, consecutiveFailures: count,
              });
            }

            await notifySkillFailure(skill, errorMessage, triggerConfig);
            return { success: false, error: errorMessage };
          }
        });

        executed++;

        // One-shot cleanup for Direct tier (the `continue` below skips the shared cleanup)
        if (isOneShot) {
          await step.run(`oneshot-cleanup-${skill.id}`, async () => {
            try {
              const { getOrchestrator } = await import('../core/orchestrator.js');
              const orchestrator = await getOrchestrator();
              const toolRouter = orchestrator.getToolRouter();
              await toolRouter.routeToolCall('memory_update_skill', {
                skill_id: skill.id,
                enabled: false,
                last_run_summary: `One-shot fired at ${new Date().toISOString()}`,
              });
              logger.info('One-shot skill auto-disabled after fire (Direct tier)', { skillId: skill.id, name: skill.name });
            } catch (cleanupError) {
              logger.error('Failed to auto-disable one-shot skill', { skillId: skill.id, error: cleanupError });
            }
          });
        }

        continue; // Skip the Agent tier below
      }

      // AGENT TIER — Execute the skill via Thinker (discovered through AgentManager)
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

          // Resolve primary chat_id from channel manager so the LLM knows which chat to target
          const channelManager = orchestrator.getChannelManager();
          const telegramAdapter = channelManager?.getAdapter('telegram');
          const primaryChatId = telegramAdapter?.getMonitoredChatIds()?.[0];

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
            false,
            parsedRequiredTools,
            skill.id,
            skill.name,
            primaryChatId,
          );

          // Update skill's last_run fields via Memory MCP
          const toolRouter = orchestrator.getToolRouter();
          if (result.success) {
            recordSuccess(skill.id);
            try {
              await toolRouter.routeToolCall('memory_update_skill', {
                skill_id: skill.id,
                last_run_at: new Date().toISOString(),
                last_run_status: 'success',
                last_run_summary: result.response || 'No summary',
              });
            } catch (updateError) {
              logger.error('Failed to update skill status', { skillId: skill.id, error: updateError });
            }
          } else {
            const { count, shouldDisable } = recordFailure(skill.id);
            try {
              await toolRouter.routeToolCall('memory_update_skill', {
                skill_id: skill.id,
                last_run_at: new Date().toISOString(),
                last_run_status: 'error',
                last_run_summary: result.error || 'No summary',
                ...(shouldDisable ? { enabled: false } : {}),
              });
            } catch (updateError) {
              logger.error('Failed to update skill status', { skillId: skill.id, error: updateError });
            }
            if (shouldDisable) {
              logger.warn('Skill auto-disabled after consecutive failures', {
                skillId: skill.id,
                name: skill.name,
                consecutiveFailures: count,
              });
            }
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
          const { count, shouldDisable } = recordFailure(skill.id);

          // Still update the skill as failed (+ auto-disable if threshold hit)
          try {
            const { getOrchestrator } = await import('../core/orchestrator.js');
            const orchestrator = await getOrchestrator();
            const toolRouter = orchestrator.getToolRouter();
            await toolRouter.routeToolCall('memory_update_skill', {
              skill_id: skill.id,
              last_run_at: new Date().toISOString(),
              last_run_status: 'error',
              last_run_summary: errorMessage,
              ...(shouldDisable ? { enabled: false } : {}),
            });
          } catch (updateError) {
            logger.error('Failed to update skill error status', { skillId: skill.id, error: updateError });
          }

          if (shouldDisable) {
            logger.warn('Skill auto-disabled after consecutive failures', {
              skillId: skill.id,
              name: skill.name,
              consecutiveFailures: count,
            });
          }

          // Notify on failure
          await notifySkillFailure(skill, errorMessage, triggerConfig);

          return { success: false, error: errorMessage };
        }
      });

      executed++;

      // One-shot cleanup: auto-disable after successful fire
      if (isOneShot) {
        await step.run(`oneshot-cleanup-${skill.id}`, async () => {
          try {
            const { getOrchestrator } = await import('../core/orchestrator.js');
            const orchestrator = await getOrchestrator();
            const toolRouter = orchestrator.getToolRouter();
            await toolRouter.routeToolCall('memory_update_skill', {
              skill_id: skill.id,
              enabled: false,
              last_run_summary: `One-shot fired at ${new Date().toISOString()}`,
            });
            logger.info('One-shot skill auto-disabled after fire', { skillId: skill.id, name: skill.name });
          } catch (cleanupError) {
            logger.error('Failed to auto-disable one-shot skill', { skillId: skill.id, error: cleanupError });
          }
        });
      }
    }

    return { checked: skills.length, executed };
  }
);
