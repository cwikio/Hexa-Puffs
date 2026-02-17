/**
 * Session persistence types for JSONL-based conversation storage
 */

import type { CoreMessage } from 'ai';

/**
 * First line of every session JSONL file — identifies the session
 */
export interface SessionHeader {
  type: 'header';
  chatId: string;
  agentId: string;
  createdAt: string;
  version: number;
}

/**
 * One conversation turn (user message + assistant response + metadata)
 */
export interface SessionTurn {
  type: 'turn';
  user: string;
  assistant: string;
  timestamp: string;
  toolsUsed: string[];
  tokens: { prompt: number; completion: number };
  /** Full structured messages for this turn (user + assistant tool-call/result chain).
   *  Present when tools were used. Older sessions without this field fall back to flat user/assistant text. */
  messages?: CoreMessage[];
}

/**
 * Compaction entry — replaces older turns with an LLM-generated summary
 */
export interface SessionCompaction {
  type: 'compaction';
  summary: string;
  compactedTurns: number;
  timestamp: string;
}

/**
 * Union of all session entry types
 */
export type SessionEntry = SessionHeader | SessionTurn | SessionCompaction;

/**
 * Configuration for session persistence
 */
export interface SessionConfig {
  enabled: boolean;
  compactionEnabled: boolean;
  compactionThresholdChars: number;
  compactionKeepRecentTurns: number;
  compactionCooldownMs: number;
  compactionMinTurns: number;
  maxAgeDays: number;
}

/**
 * Result of loading a session from disk
 */
export interface LoadedSession {
  messages: CoreMessage[];
  compactionSummary?: string;
  turnCount: number;
  /** Tools used in recent turns — for sticky tool injection across turns */
  recentToolsByTurn: Array<{ turnIndex: number; tools: string[] }>;
}
