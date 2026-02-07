/**
 * Shared logger for MCP services
 * Uses console.error for ALL log levels to keep stdout clean for MCP JSON-RPC protocol
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const VALID_LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function isValidLogLevel(value: string | undefined): value is LogLevel {
  return value !== undefined && VALID_LOG_LEVELS.includes(value as LogLevel);
}

/**
 * JSON replacer that serializes Error objects (whose properties are non-enumerable).
 */
function errorReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    const obj: Record<string, unknown> = { message: value.message, name: value.name };
    if (value.stack) obj.stack = value.stack;
    if ('code' in value) obj.code = (value as NodeJS.ErrnoException).code;
    return obj;
  }
  return value;
}

export class Logger {
  private level: LogLevel;
  private context: string;

  constructor(context: string = 'mcp') {
    this.context = context;
    const envLevel = process.env.LOG_LEVEL;
    this.level = isValidLogLevel(envLevel) ? envLevel : 'info';
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const base = `[${timestamp}] [${level.toUpperCase()}] [${this.context}] ${message}`;
    if (data !== undefined) {
      return `${base} ${JSON.stringify(data, errorReplacer)}`;
    }
    return base;
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) {
      console.error(this.formatMessage('debug', message, data));
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) {
      console.error(this.formatMessage('info', message, data));
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) {
      console.error(this.formatMessage('warn', message, data));
    }
  }

  error(message: string, data?: unknown): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, data));
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(context: string): Logger {
    const child = new Logger(`${this.context}:${context}`);
    child.level = this.level;
    return child;
  }

  /**
   * Set the context prefix (e.g. service name) for this logger and future children.
   * Call early at startup so child loggers inherit the correct prefix.
   */
  setContext(context: string): void {
    this.context = context;
  }

  /**
   * Set the log level dynamically
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get the current log level
   */
  getLevel(): LogLevel {
    return this.level;
  }
}

/** Default logger instance */
export const logger = new Logger();
