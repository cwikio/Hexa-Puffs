/**
 * ID generators using Node's built-in crypto.
 */

import { randomUUID } from 'node:crypto';

export function generateExecutionId(): string {
  return `exec_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function generateSessionId(): string {
  return `sess_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
