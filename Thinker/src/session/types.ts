/**
 * Session persistence types for JSONL-based conversation storage
 */

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
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  compactionSummary?: string;
  turnCount: number;
}
