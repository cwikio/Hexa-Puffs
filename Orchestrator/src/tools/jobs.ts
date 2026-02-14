import { z } from 'zod';
import { Cron } from 'croner';
import { JobStorage } from '../jobs/storage.js';
import { inngest } from '../jobs/inngest-client.js';
import { JobDefinition, TaskDefinition } from '../jobs/types.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import type { StandardResponse } from '@mcp/shared/Types/StandardResponse.js';

const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function isValidCronExpression(expression: string): boolean {
  try {
    new Cron(expression);
    return true;
  } catch {
    return false;
  }
}

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const storage = new JobStorage();

// Validation schemas
const JobActionSchema = z.object({
  type: z.enum(['tool_call', 'workflow']),
  toolName: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
  workflowSteps: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        toolName: z.string(),
        parameters: z.record(z.unknown()),
        dependsOn: z.array(z.string()).optional(),
      })
    )
    .optional(),
});

const CreateJobSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['cron', 'scheduled', 'recurring']),
  cronExpression: z.string().optional(),
  timezone: z.string().default(SYSTEM_TIMEZONE),
  scheduledAt: z.string().optional(),
  action: JobActionSchema,
  enabled: z.boolean().default(true),
  maxRuns: z.number().int().positive().optional(),
  expiresAt: z.string().optional(),
});

const QueueTaskSchema = z.object({
  name: z.string().min(1),
  action: JobActionSchema,
});

// Available tools for background execution (used in descriptions)
const AVAILABLE_TOOLS_DESCRIPTION = `
Available tools: telegram_send_message, telegram_list_chats, telegram_get_messages, onepassword_get_item, memory_store_fact, memory_list_facts, memory_delete_fact, memory_store_conversation, memory_search_conversations, memory_get_profile, memory_update_profile, memory_retrieve_memories, memory_get_memory_stats, memory_export_memory, memory_import_memory, filer_create_file, filer_read_file, filer_list_files, filer_update_file, filer_delete_file, filer_move_file, filer_copy_file, filer_search_files, filer_check_grant, filer_request_grant, filer_list_grants, filer_get_workspace_info, filer_get_audit_log`;

// Tool: create_job
export const createJobToolDefinition = {
  name: 'create_job',
  description: `Schedule a recurring cron job or one-time scheduled task.

Cron expression examples:
- "0 9 * * *" = daily at 9am
- "*/5 * * * *" = every 5 minutes
- "0 0 * * 1" = every Monday at midnight
- "0 */2 * * *" = every 2 hours

Auto-expiration:
- maxRuns: stop after N executions (e.g., 5 = run 5 times then auto-disable)
- expiresAt: ISO date to auto-disable (e.g., "2026-02-15T00:00:00Z")
- Omit both for permanent jobs. Set either or both for temporary jobs.
${AVAILABLE_TOOLS_DESCRIPTION}`,
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Human-readable name for the job (e.g., "Daily backup reminder")',
      },
      type: {
        type: 'string',
        enum: ['cron', 'scheduled'],
        description: 'Job type: "cron" for recurring jobs, "scheduled" for one-time jobs',
      },
      cronExpression: {
        type: 'string',
        description: 'Cron expression (required for type=cron). Format: "minute hour day month weekday"',
      },
      timezone: {
        type: 'string',
        description: 'Timezone for cron jobs (default: UTC). Examples: "America/New_York", "Europe/Warsaw", "UTC"',
      },
      scheduledAt: {
        type: 'string',
        description: 'ISO timestamp for scheduled jobs (required for type=scheduled). Example: "2024-12-25T09:00:00Z"',
      },
      action: {
        type: 'object',
        description: 'Action to execute when the job runs',
        properties: {
          type: {
            type: 'string',
            enum: ['tool_call', 'workflow'],
            description: 'Action type: "tool_call" for single tool, "workflow" for multiple steps',
          },
          toolName: {
            type: 'string',
            description: 'Exact tool name (e.g., "telegram_send_message", "memory_store_fact"). Required for type=tool_call',
          },
          parameters: {
            type: 'object',
            description: 'Parameters to pass to the tool',
          },
        },
        required: ['type'],
      },
      maxRuns: {
        type: 'number',
        description: 'Max number of executions before auto-disabling. Omit for unlimited.',
      },
      expiresAt: {
        type: 'string',
        description: 'ISO date after which the job auto-disables. Omit for no expiry. Example: "2026-02-15T00:00:00Z"',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether the job is enabled (default: true)',
      },
    },
    required: ['name', 'type', 'action'],
  },
};

export async function handleCreateJob(args: unknown): Promise<StandardResponse> {
  try {
    const parsed = CreateJobSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        error: `Validation error: ${parsed.error.message}`,
      };
    }

    const data = parsed.data;

    // Dedup: if a job with the same name was created in the last 60s, return it instead
    // This prevents Groq/Llama retry loops from creating duplicate jobs
    const existingJobs = await storage.listJobs();
    const recentDuplicate = existingJobs.find((j) => {
      if (j.name !== data.name || !j.enabled) return false;
      const createdAt = new Date(j.createdAt).getTime();
      return Date.now() - createdAt < 60_000;
    });
    if (recentDuplicate) {
      logger.info('Job dedup: returning existing job', { jobId: recentDuplicate.id, name: recentDuplicate.name });
      return {
        success: true,
        data: {
          jobId: recentDuplicate.id,
          name: recentDuplicate.name,
          type: recentDuplicate.type,
          enabled: recentDuplicate.enabled,
          maxRuns: recentDuplicate.maxRuns,
          expiresAt: recentDuplicate.expiresAt,
          nextRunAt: recentDuplicate.type === 'scheduled' ? recentDuplicate.scheduledAt : 'Based on cron expression',
          message: 'Job already exists (created within last 60s)',
        },
      };
    }

    // Validate cron expression if type is cron
    if (data.type === 'cron' && !data.cronExpression) {
      return {
        success: false,
        error: 'cronExpression is required for cron jobs',
      };
    }

    if (data.type === 'cron' && data.cronExpression && !isValidCronExpression(data.cronExpression)) {
      return {
        success: false,
        error: `Invalid cron expression: "${data.cronExpression}". Use standard format: "minute hour day month weekday" (e.g., "0 9 * * *" for daily at 9am)`,
      };
    }

    // Validate timezone
    if (data.timezone && !isValidTimezone(data.timezone)) {
      return {
        success: false,
        error: `Invalid timezone: "${data.timezone}". Use IANA format (e.g., "America/New_York", "Europe/Warsaw", "UTC")`,
      };
    }

    // Validate scheduledAt if type is scheduled
    if (data.type === 'scheduled' && !data.scheduledAt) {
      return {
        success: false,
        error: 'scheduledAt is required for scheduled jobs',
      };
    }

    const job: JobDefinition = {
      id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: data.name,
      type: data.type,
      cronExpression: data.cronExpression,
      timezone: data.timezone,
      scheduledAt: data.scheduledAt,
      action: data.action,
      enabled: data.enabled,
      createdAt: new Date().toISOString(),
      createdBy: 'user',
      runCount: 0,
      maxRuns: data.maxRuns,
      expiresAt: data.expiresAt,
    };

    // Save to file system
    await storage.saveJob(job);
    logger.info('Job created', { jobId: job.id, name: job.name });

    // Register with Inngest (only for scheduled one-time jobs)
    // Cron jobs are handled by the cronJobPollerFunction which runs every minute
    if (job.type === 'cron' && job.cronExpression) {
      // Compute next run time for informational purposes
      try {
        const cron = new Cron(job.cronExpression, { timezone: job.timezone || SYSTEM_TIMEZONE });
        const nextRun = cron.nextRun();
        if (nextRun) {
          job.nextRunAt = nextRun.toISOString();
          await storage.saveJob(job);
        }
      } catch {
        // nextRunAt is optional, don't fail job creation
      }
      logger.info('Cron job saved, will be picked up by poller', { jobId: job.id });
    } else if (job.type === 'scheduled' && job.scheduledAt) {
      const scheduledTime = new Date(job.scheduledAt).getTime();
      const now = Date.now();
      const delay = scheduledTime - now;

      if (delay < 0) {
        return {
          success: false,
          error: 'scheduledAt must be in the future',
        };
      }

      await inngest.send({
        name: 'job/cron.execute',
        data: {
          jobId: job.id,
          action: job.action,
        },
        ts: scheduledTime,
      });
      logger.info('Scheduled job registered with Inngest', { jobId: job.id, scheduledAt: job.scheduledAt });
    }

    return {
      success: true,
      data: {
        jobId: job.id,
        name: job.name,
        type: job.type,
        enabled: job.enabled,
        maxRuns: job.maxRuns,
        expiresAt: job.expiresAt,
        nextRunAt: job.type === 'scheduled' ? job.scheduledAt : 'Based on cron expression',
      },
    };
  } catch (error) {
    logger.error('Failed to create job', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Tool: queue_task
export const queueTaskToolDefinition = {
  name: 'queue_task',
  description: `Queue a task to run in the background immediately. Returns a task ID for tracking progress.

Use get_job_status with the returned taskId to check completion.
${AVAILABLE_TOOLS_DESCRIPTION}

Example: To send a Telegram message in background:
{
  "name": "Send greeting",
  "action": {
    "type": "tool_call",
    "toolName": "telegram_send_message",
    "parameters": { "message": "Hello!", "chat_id": "123456789" }
  }
}`,
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Human-readable name for the task (e.g., "Send notification")',
      },
      action: {
        type: 'object',
        description: 'Action to execute in the background',
        properties: {
          type: {
            type: 'string',
            enum: ['tool_call', 'workflow'],
            description: 'Action type: "tool_call" for single tool, "workflow" for multiple steps',
          },
          toolName: {
            type: 'string',
            description: 'Exact tool name to call (e.g., "telegram_send_message"). Required for type=tool_call',
          },
          parameters: {
            type: 'object',
            description: 'Parameters to pass to the tool',
          },
        },
        required: ['type'],
      },
    },
    required: ['name', 'action'],
  },
};

export async function handleQueueTask(args: unknown): Promise<StandardResponse> {
  try {
    const parsed = QueueTaskSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        error: `Validation error: ${parsed.error.message}`,
      };
    }

    const data = parsed.data;

    const task: TaskDefinition = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: data.name,
      action: data.action,
      status: 'queued',
      createdAt: new Date().toISOString(),
    };

    // Save to file system
    await storage.saveTask(task);
    logger.info('Task queued', { taskId: task.id, name: task.name });

    // Send to Inngest for background execution
    await inngest.send({
      name: 'job/background.execute',
      data: {
        taskId: task.id,
        action: task.action,
      },
    });

    return {
      success: true,
      data: {
        taskId: task.id,
        name: task.name,
        status: 'queued',
        message: 'Task queued for background execution. Use get_job_status to check progress.',
      },
    };
  } catch (error) {
    logger.error('Failed to queue task', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Tool: list_jobs
export const listJobsToolDefinition = {
  name: 'list_jobs',
  description: 'List all scheduled jobs (cron and one-time scheduled). Returns job IDs, names, types, cron expressions, and last/next run times.',
  inputSchema: {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        description: 'Filter by enabled status. Omit to show all jobs.',
      },
    },
  },
};

export async function handleListJobs(args: unknown): Promise<StandardResponse> {
  try {
    const argsTyped = args as { enabled?: boolean };
    const jobs = await storage.listJobs();

    const filtered =
      argsTyped.enabled !== undefined ? jobs.filter((j) => j.enabled === argsTyped.enabled) : jobs;

    return {
      success: true,
      data: {
        jobs: filtered.map((j) => ({
          id: j.id,
          name: j.name,
          type: j.type,
          enabled: j.enabled,
          cronExpression: j.cronExpression,
          runCount: j.runCount,
          maxRuns: j.maxRuns,
          expiresAt: j.expiresAt,
          lastRunAt: j.lastRunAt,
          nextRunAt: j.nextRunAt,
          createdAt: j.createdAt,
        })),
        count: filtered.length,
      },
    };
  } catch (error) {
    logger.error('Failed to list jobs', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Tool: get_job_status
export const getJobStatusToolDefinition = {
  name: 'get_job_status',
  description: 'Get the status of a background task queued via queue_task. Returns status (queued/running/completed/failed), timestamps, duration, result or error message.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Task ID returned by queue_task (e.g., "task_1234567890_abc123")',
      },
    },
    required: ['taskId'],
  },
};

export async function handleGetJobStatus(args: unknown): Promise<StandardResponse> {
  try {
    const argsTyped = args as { taskId: string };
    const task = await storage.loadTask(argsTyped.taskId);

    if (!task) {
      return {
        success: false,
        error: `Task not found: ${argsTyped.taskId}`,
      };
    }

    return {
      success: true,
      data: {
        taskId: task.id,
        name: task.name,
        status: task.status,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        duration: task.duration,
        result: task.result,
        error: task.error,
      },
    };
  } catch (error) {
    logger.error('Failed to get job status', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Tool: delete_job
export const deleteJobToolDefinition = {
  name: 'delete_job',
  description: 'Delete a scheduled cron or one-time job. This stops the job from running in the future. Use list_jobs to find job IDs.',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: {
        type: 'string',
        description: 'Job ID to delete (e.g., "job_1234567890_abc123"). Get IDs from list_jobs.',
      },
    },
    required: ['jobId'],
  },
};

export async function handleDeleteJob(args: unknown): Promise<StandardResponse> {
  try {
    const argsTyped = args as { jobId: string };

    // Check if job exists
    const job = await storage.loadJob(argsTyped.jobId);
    if (!job) {
      return {
        success: false,
        error: `Job not found: ${argsTyped.jobId}`,
      };
    }

    // Disable the job first so the poller won't pick it up
    job.enabled = false;
    await storage.saveJob(job);

    // Delete from storage
    await storage.deleteJob(argsTyped.jobId);
    logger.info('Job deleted', { jobId: argsTyped.jobId, type: job.type });

    return {
      success: true,
      data: {
        jobId: argsTyped.jobId,
        message: `Job "${job.name}" deleted successfully`,
      },
    };
  } catch (error) {
    logger.error('Failed to delete job', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Tool: trigger_backfill
export const triggerBackfillToolDefinition = {
  name: 'trigger_backfill',
  description:
    'Trigger a one-time conversation history backfill. Processes old conversations that were never ' +
    'mined for facts, extracting user information in batches. Progress and completion are reported via Telegram. ' +
    'Safe to call multiple times — it only processes conversations not yet extracted.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export async function handleTriggerBackfill(_args: unknown): Promise<StandardResponse> {
  try {
    await inngest.send({
      name: 'memory/backfill.start',
      data: {},
    });

    logger.info('Conversation backfill triggered');

    return {
      success: true,
      data: {
        message: 'Backfill started. Progress will be reported via Telegram.',
      },
    };
  } catch (error) {
    logger.error('Failed to trigger backfill', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Export all job tool definitions
export const jobToolDefinitions = [
  queueTaskToolDefinition,
  triggerBackfillToolDefinition,
];
