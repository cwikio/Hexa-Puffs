/**
 * Common test utilities shared across MCP packages.
 */

/** Generate a unique test identifier */
export function testId(prefix = 'TEST'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Wait for a specified number of milliseconds */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Logging ──────────────────────────────────────────────────────

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function timestamp(): string {
  return new Date().toISOString().split('T')[1].slice(0, 12);
}

type LogLevel = 'info' | 'success' | 'error' | 'warn' | 'debug';

const LOG_COLORS: Record<LogLevel, string> = {
  info: COLORS.blue,
  success: COLORS.green,
  error: COLORS.red,
  warn: COLORS.yellow,
  debug: COLORS.dim,
};

const LOG_ICONS: Record<LogLevel, string> = {
  info: 'ℹ',
  success: '✓',
  error: '✗',
  warn: '⚠',
  debug: '→',
};

/** Color-coded log line with timestamp */
export function log(message: string, level: LogLevel = 'info'): void {
  const ts = timestamp();
  console.log(
    `${COLORS.dim}[${ts}]${COLORS.reset} ${LOG_COLORS[level]}${LOG_ICONS[level]} ${message}${COLORS.reset}`,
  );
}

/** Print a section header */
export function logSection(title: string): void {
  console.log(`\n${COLORS.bright}${COLORS.cyan}━━━ ${title} ━━━${COLORS.reset}\n`);
}

/** Print a test result line */
export function logResult(testName: string, passed: boolean, details?: string): void {
  const icon = passed ? `${COLORS.green}✓` : `${COLORS.red}✗`;
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`  ${icon} ${COLORS.bright}${testName}${COLORS.reset} [${status}]`);
  if (details) {
    console.log(`    ${COLORS.dim}${details}${COLORS.reset}`);
  }
}

/** Extract typed data from an MCPToolCallResult */
export function extractData<T>(result: { success: boolean; data?: unknown }): T | null {
  if (!result.success || !result.data) return null;
  return result.data as T;
}
