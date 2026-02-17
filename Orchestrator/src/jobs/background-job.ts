import { inngest } from './inngest-client.js';
import { storage, storeErrorFact } from './helpers.js';
import { executeAction } from './executor.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { getHaltManager } from '../core/halt-manager.js';

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
