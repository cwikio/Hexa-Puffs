/**
 * Session tool schemas and handlers.
 *
 * start_session, send_to_session, close_session, list_sessions
 */

import { z } from 'zod';
import type { SessionManager } from '../sessions/manager.js';

// ── start_session ───────────────────────────────────────────────────────────

export const startSessionSchema = z.object({
  language: z
    .enum(['python', 'node'])
    .describe('Language for the REPL session'),
  name: z.string().optional().describe('Optional human-readable session name'),
  working_dir: z
    .string()
    .optional()
    .describe('Working directory (default: sandbox temp dir)'),
});

export type StartSessionInput = z.infer<typeof startSessionSchema>;

export function handleStartSession(manager: SessionManager) {
  return async (input: StartSessionInput) => {
    return manager.startSession({
      language: input.language,
      name: input.name,
      working_dir: input.working_dir,
    });
  };
}

// ── send_to_session ─────────────────────────────────────────────────────────

export const sendToSessionSchema = z.object({
  session_id: z
    .string()
    .min(1)
    .describe('Session ID returned by start_session'),
  code: z.string().min(1).describe('Code to execute in the session'),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Per-execution timeout in ms (default: 30000)'),
});

export type SendToSessionInput = z.infer<typeof sendToSessionSchema>;

export function handleSendToSession(manager: SessionManager) {
  return async (input: SendToSessionInput) => {
    return manager.sendToSession(
      input.session_id,
      input.code,
      input.timeout_ms,
    );
  };
}

// ── close_session ───────────────────────────────────────────────────────────

export const closeSessionSchema = z.object({
  session_id: z.string().min(1).describe('Session ID to close'),
});

export type CloseSessionInput = z.infer<typeof closeSessionSchema>;

export function handleCloseSession(manager: SessionManager) {
  return async (input: CloseSessionInput) => {
    return manager.closeSession(input.session_id, 'manual');
  };
}

// ── list_sessions ───────────────────────────────────────────────────────────

export const listSessionsSchema = z.object({});

export type ListSessionsInput = z.infer<typeof listSessionsSchema>;

export function handleListSessions(manager: SessionManager) {
  return async (_input: ListSessionsInput) => {
    return { sessions: await manager.listSessions() };
  };
}
