export interface JobDefinition {
  id: string;
  name: string;
  type: 'cron' | 'scheduled' | 'recurring';

  // Cron-specific
  cronExpression?: string;
  timezone?: string;

  // Scheduled-specific (one-time)
  scheduledAt?: string;

  // Execution
  action: JobAction;

  // Metadata
  enabled: boolean;
  createdAt: string;
  createdBy: string;
  lastRunAt?: string;
  nextRunAt?: string;

  // Auto-expiration
  runCount?: number;    // how many times the job has executed (auto-incremented by poller)
  maxRuns?: number;     // stop after this many executions (omit = unlimited)
  expiresAt?: string;   // ISO date — auto-disable after this date (omit = never expires)

  // Options
  retryConfig?: RetryConfig;
  concurrency?: ConcurrencyConfig;
}

export interface JobAction {
  type: 'tool_call' | 'workflow';
  toolName?: string;
  parameters?: Record<string, unknown>;
  workflowSteps?: WorkflowStep[];
}

export interface WorkflowStep {
  id: string;
  name: string;
  toolName: string;
  parameters: Record<string, unknown>;
  dependsOn?: string[];
}

export interface RetryConfig {
  maxAttempts: number;
  backoff: 'exponential' | 'linear';
}

export interface ConcurrencyConfig {
  limit: number;
  key?: string;
}

export interface TaskDefinition {
  id: string;
  name: string;
  action: JobAction;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
  duration?: number;
}
