/**
 * Execution ID generator using Node's built-in crypto.
 */

import { randomUUID } from 'node:crypto';

export function generateExecutionId(): string {
  return `exec_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
