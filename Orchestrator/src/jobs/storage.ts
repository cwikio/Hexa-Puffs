import fs from 'fs/promises';
import path from 'path';
import { JobDefinition, TaskDefinition } from './types.js';
import { logger } from '@mcp/shared/Utils/logger.js';

const JOBS_DIR = path.join(
  process.env.HOME || '~',
  '.annabelle/data/jobs'
);

const TASKS_DIR = path.join(
  process.env.HOME || '~',
  '.annabelle/data/tasks'
);

export class JobStorage {
  private jobsDir: string;
  private tasksDir: string;

  constructor(jobsDir?: string, tasksDir?: string) {
    this.jobsDir = jobsDir || JOBS_DIR;
    this.tasksDir = tasksDir || TASKS_DIR;
  }

  async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.jobsDir, { recursive: true });
    await fs.mkdir(this.tasksDir, { recursive: true });
  }

  // Job operations
  async saveJob(job: JobDefinition): Promise<void> {
    await this.ensureDirectories();
    const filePath = path.join(this.jobsDir, `${job.id}.json`);
    await fs.writeFile(
      filePath,
      JSON.stringify(job, null, 2),
      'utf-8'
    );
    logger.debug('Job saved', { jobId: job.id, path: filePath });
  }

  async loadJob(jobId: string): Promise<JobDefinition | null> {
    const filePath = path.join(this.jobsDir, `${jobId}.json`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async listJobs(): Promise<JobDefinition[]> {
    await this.ensureDirectories();
    try {
      const files = await fs.readdir(this.jobsDir);
      const jobs = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(f => this.loadJob(f.replace('.json', '')))
      );
      return jobs.filter((job): job is JobDefinition => job !== null);
    } catch (error) {
      logger.error('Failed to list jobs', { error });
      return [];
    }
  }

  async deleteJob(jobId: string): Promise<void> {
    const filePath = path.join(this.jobsDir, `${jobId}.json`);
    try {
      await fs.unlink(filePath);
      logger.debug('Job deleted', { jobId, path: filePath });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  // Task operations
  async saveTask(task: TaskDefinition): Promise<void> {
    await this.ensureDirectories();
    const filePath = path.join(this.tasksDir, `${task.id}.json`);
    await fs.writeFile(
      filePath,
      JSON.stringify(task, null, 2),
      'utf-8'
    );
    logger.debug('Task saved', { taskId: task.id, path: filePath });
  }

  async loadTask(taskId: string): Promise<TaskDefinition | null> {
    const filePath = path.join(this.tasksDir, `${taskId}.json`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async listTasks(): Promise<TaskDefinition[]> {
    await this.ensureDirectories();
    try {
      const files = await fs.readdir(this.tasksDir);
      const tasks = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(f => this.loadTask(f.replace('.json', '')))
      );
      return tasks.filter((task): task is TaskDefinition => task !== null);
    } catch (error) {
      logger.error('Failed to list tasks', { error });
      return [];
    }
  }

  async deleteTask(taskId: string): Promise<void> {
    const filePath = path.join(this.tasksDir, `${taskId}.json`);
    try {
      await fs.unlink(filePath);
      logger.debug('Task deleted', { taskId, path: filePath });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
