import { z } from 'zod';
import { JobStorage } from '../jobs/storage.js';
import { inngest } from '../jobs/inngest-client.js';
import { TaskDefinition } from '../jobs/types.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import type { StandardResponse } from '@mcp/shared/Types/StandardResponse.js';

const storage = new JobStorage();

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

const QueueTaskSchema = z.object({
  name: z.string().min(1),
  action: JobActionSchema,
});

// Tool: queue_task
export const queueTaskToolDefinition = {
  name: 'queue_task',
  description: `Queue a task to run in the background immediately. Returns a task ID for tracking progress.

Use get_job_status with the returned taskId to check completion.

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
      id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
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

export const jobToolDefinitions = [
  queueTaskToolDefinition,
  getJobStatusToolDefinition,
  triggerBackfillToolDefinition,
];
