import { appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import type { TraceContext, TraceEntry, TraceEvent } from './types.js';

/**
 * Resolve path with home directory expansion
 */
function resolvePath(path: string): string {
  if (path.startsWith('~')) {
    return path.replace('~', homedir());
  }
  return path;
}

/**
 * Trace logger for centralized request tracing
 */
export class TraceLogger {
  private logPath: string;
  private initialized: boolean = false;

  constructor(logPath: string = '~/.annabelle/logs/traces.jsonl') {
    this.logPath = resolvePath(logPath);
  }

  /**
   * Ensure the log directory exists
   */
  private async ensureDir(): Promise<void> {
    if (this.initialized) return;

    const dir = dirname(this.logPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    this.initialized = true;
  }

  /**
   * Log a trace event
   */
  async log(
    ctx: TraceContext,
    event: TraceEvent | string,
    data: Record<string, unknown> = {}
  ): Promise<void> {
    await this.ensureDir();

    const entry: TraceEntry = {
      trace_id: ctx.traceId,
      ts: new Date().toISOString(),
      mcp: ctx.mcp,
      event,
      data,
    };

    const line = JSON.stringify(entry) + '\n';
    await appendFile(this.logPath, line, 'utf-8');
  }

  /**
   * Log message received event
   */
  async logMessageReceived(
    ctx: TraceContext,
    chatId: string,
    text: string
  ): Promise<void> {
    await this.log(ctx, 'message_received', {
      chat_id: chatId,
      text: text.substring(0, 100), // Truncate for privacy
    });
  }

  /**
   * Log context loaded event
   */
  async logContextLoaded(
    ctx: TraceContext,
    factsCount: number,
    hasProfile: boolean
  ): Promise<void> {
    await this.log(ctx, 'context_loaded', {
      facts: factsCount,
      profile: hasProfile,
    });
  }

  /**
   * Log LLM call start
   */
  async logLLMCallStart(
    ctx: TraceContext,
    provider: string,
    model: string
  ): Promise<void> {
    await this.log(ctx, 'llm_call_start', {
      provider,
      model,
    });
  }

  /**
   * Log LLM call complete
   */
  async logLLMCallComplete(
    ctx: TraceContext,
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    durationMs: number
  ): Promise<void> {
    await this.log(ctx, 'llm_call_complete', {
      provider,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      duration_ms: durationMs,
    });
  }

  /**
   * Log tool call start
   */
  async logToolCallStart(
    ctx: TraceContext,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<void> {
    await this.log(ctx, 'tool_call_start', {
      tool: toolName,
      args,
    });
  }

  /**
   * Log tool call complete
   */
  async logToolCallComplete(
    ctx: TraceContext,
    toolName: string,
    success: boolean,
    durationMs: number
  ): Promise<void> {
    await this.log(ctx, 'tool_call_complete', {
      tool: toolName,
      success,
      duration_ms: durationMs,
    });
  }

  /**
   * Log tool call error
   */
  async logToolCallError(
    ctx: TraceContext,
    toolName: string,
    error: string
  ): Promise<void> {
    await this.log(ctx, 'tool_call_error', {
      tool: toolName,
      error,
    });
  }

  /**
   * Log response sent
   */
  async logResponseSent(
    ctx: TraceContext,
    chatId: string,
    responseLength: number
  ): Promise<void> {
    await this.log(ctx, 'response_sent', {
      chat_id: chatId,
      response_length: responseLength,
    });
  }

  /**
   * Log error
   */
  async logError(
    ctx: TraceContext,
    error: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.log(ctx, 'error', {
      error,
      ...details,
    });
  }

  /**
   * Log trace complete
   */
  async logComplete(
    ctx: TraceContext,
    toolsUsed: string[],
    totalSteps: number
  ): Promise<void> {
    const durationMs = Date.now() - ctx.startedAt;
    await this.log(ctx, 'complete', {
      duration_ms: durationMs,
      tools_used: toolsUsed,
      total_steps: totalSteps,
    });
  }

  /**
   * Get the log file path
   */
  getPath(): string {
    return this.logPath;
  }
}

// Singleton instance
let traceLogger: TraceLogger | null = null;

/**
 * Get or create the trace logger singleton
 */
export function getTraceLogger(logPath?: string): TraceLogger {
  if (!traceLogger) {
    traceLogger = new TraceLogger(logPath);
  }
  return traceLogger;
}
