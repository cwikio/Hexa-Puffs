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
  name: z.string().nullish().describe('Optional human-readable session name'),
  working_dir: z
    .string()
    .nullish()
    .describe('Working directory (default: sandbox temp dir)'),
});

export type StartSessionInput = z.infer<typeof startSessionSchema>;

export function handleStartSession(manager: SessionManager) {
  return async (input: StartSessionInput) => {
    return manager.startSession({
      language: input.language,
      name: input.name ?? undefined,
      working_dir: input.working_dir ?? undefined,
    });
  };
}

// ── send_to_session ─────────────────────────────────────────────────────────

export const sendToSessionSchema = z.object({
  session_id: z
    .string()
    .nullish()
    .describe(
      'Session ID from a previous start_session call. If omitted, a new session is created automatically (requires language).',
    ),
  language: z
    .enum(['python', 'node'])
    .nullish()
    .describe(
      'Language for auto-created session. Required when session_id is omitted. Ignored when session_id is provided.',
    ),
  code: z.string().min(1).describe('Code to execute in the session'),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .nullish()
    .describe('Per-execution timeout in ms (default: 30000)'),
});

export type SendToSessionInput = z.infer<typeof sendToSessionSchema>;

export function handleSendToSession(manager: SessionManager) {
  return async (input: SendToSessionInput) => {
    return manager.sendToSession({
      sessionId: input.session_id ?? undefined,
      language: input.language ?? undefined,
      code: input.code,
      timeoutMs: input.timeout_ms ?? undefined,
    });
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
