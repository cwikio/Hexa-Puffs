/**
 * SessionStore — JSONL-based session persistence for Thinker conversations
 *
 * Each conversation (chatId) gets its own JSONL file at:
 *   ~/.annabelle/sessions/<agentId>/<chatId>.jsonl
 *
 * Files are append-only during normal operation. Compaction rewrites the file
 * atomically (write to temp + rename) when the conversation exceeds the
 * configured token threshold.
 */

import { appendFile, readFile, writeFile, rename, readdir, stat, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { generateText, type LanguageModelV1, type CoreMessage } from 'ai';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:session');
import type {
  SessionConfig,
  SessionEntry,
  SessionHeader,
  SessionTurn,
  SessionCompaction,
  LoadedSession,
} from './types.js';

const COMPACTION_PROMPT = `Summarize the following conversation between a user and an AI assistant.
Preserve ALL of the following:
- Key facts about the user (preferences, background, contacts, projects)
- Decisions made during the conversation
- Pending tasks or follow-ups
- Important context that would be needed to continue the conversation naturally

Be concise but comprehensive. Write in third person ("The user...").`;

/**
 * Resolve ~ in paths to home directory
 */
function resolvePath(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export class SessionStore {
  private sessionsDir: string;
  private agentId: string;
  private config: SessionConfig;
  private dirEnsured = false;

  /** Track estimated character count per chatId (for shouldCompact checks) */
  private charCounts: Map<string, number> = new Map();

  /** Track turn counts per chatId */
  private turnCounts: Map<string, number> = new Map();

  /** Track last compaction time per chatId */
  private lastCompactionTimes: Map<string, number> = new Map();

  constructor(sessionsDir: string, agentId: string, config: SessionConfig) {
    this.sessionsDir = resolvePath(sessionsDir);
    this.agentId = agentId;
    this.config = config;
  }

  /**
   * Get the file path for a session
   */
  private getSessionPath(chatId: string): string {
    return join(this.sessionsDir, this.agentId, `${chatId}.jsonl`);
  }

  /**
   * Ensure the sessions directory exists
   */
  private async ensureDir(): Promise<void> {
    if (this.dirEnsured) return;
    const dir = join(this.sessionsDir, this.agentId);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    this.dirEnsured = true;
  }

  /**
   * Append a single JSONL line to a session file
   */
  private async appendEntry(chatId: string, entry: SessionEntry): Promise<void> {
    await this.ensureDir();
    const line = JSON.stringify(entry) + '\n';
    await appendFile(this.getSessionPath(chatId), line, 'utf-8');
  }

  /**
   * Load a session from disk. Returns null if no file exists.
   */
  async loadSession(chatId: string, stickyLookback = 3): Promise<LoadedSession | null> {
    const filePath = this.getSessionPath(chatId);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      const messages: CoreMessage[] = [];
      let compactionSummary: string | undefined;
      let turnCount = 0;
      let totalChars = 0;
      const turnToolHistory: Array<{ turnIndex: number; tools: string[] }> = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as SessionEntry;

          if (entry.type === 'compaction') {
            compactionSummary = entry.summary;
          } else if (entry.type === 'turn') {
            // Use structured messages when available (preserves tool-call/result chain),
            // fall back to flat user/assistant text for older sessions
            if (entry.messages && entry.messages.length > 0) {
              messages.push(...entry.messages);
            } else {
              messages.push({ role: 'user', content: entry.user });
              messages.push({ role: 'assistant', content: entry.assistant });
            }
            turnCount++;
            totalChars += entry.user.length + entry.assistant.length;

            // Track tools used per turn for sticky tool injection
            if (entry.toolsUsed.length > 0) {
              turnToolHistory.push({ turnIndex: turnCount, tools: entry.toolsUsed });
            }
          }
          // Skip header entries — they're metadata only
        } catch {
          // Skip corrupted lines
          logger.warn(`Skipping corrupted session line in ${chatId}: ${line.substring(0, 100)}`);
        }
      }

      // Update tracking maps
      this.charCounts.set(chatId, totalChars);
      this.turnCounts.set(chatId, turnCount);

      if (messages.length === 0 && !compactionSummary) {
        return null;
      }

      // Keep only the last N turns with tools for sticky injection
      const recentToolsByTurn = turnToolHistory.slice(-stickyLookback);

      return { messages, compactionSummary, turnCount, recentToolsByTurn };
    } catch (error) {
      logger.error(`Failed to load session ${chatId}`, error);
      return null;
    }
  }

  /**
   * Save a conversation turn to the session JSONL file.
   * Creates the file with a header if it doesn't exist.
   */
  async saveTurn(
    chatId: string,
    userText: string,
    assistantText: string,
    toolsUsed: string[],
    tokens: { prompt: number; completion: number },
    structuredMessages?: CoreMessage[]
  ): Promise<void> {
    const filePath = this.getSessionPath(chatId);

    // Write header if file doesn't exist
    if (!existsSync(filePath)) {
      const header: SessionHeader = {
        type: 'header',
        chatId,
        agentId: this.agentId,
        createdAt: new Date().toISOString(),
        version: 1,
      };
      await this.appendEntry(chatId, header);
    }

    // Append the turn
    const turn: SessionTurn = {
      type: 'turn',
      user: userText,
      assistant: assistantText,
      timestamp: new Date().toISOString(),
      toolsUsed,
      tokens,
      ...(structuredMessages && structuredMessages.length > 0
        ? { messages: structuredMessages }
        : {}),
    };
    await this.appendEntry(chatId, turn);

    // Update tracking
    const prevChars = this.charCounts.get(chatId) || 0;
    this.charCounts.set(chatId, prevChars + userText.length + assistantText.length);

    const prevTurns = this.turnCounts.get(chatId) || 0;
    this.turnCounts.set(chatId, prevTurns + 1);
  }

  /**
   * Check if a session needs compaction based on estimated token count,
   * minimum turn count, and cooldown period.
   */
  shouldCompact(chatId: string): boolean {
    if (!this.config.compactionEnabled) return false;

    const totalChars = this.charCounts.get(chatId) || 0;
    const turnCount = this.turnCounts.get(chatId) || 0;
    const lastCompaction = this.lastCompactionTimes.get(chatId) || 0;

    // Not enough turns to bother compacting
    if (turnCount < this.config.compactionMinTurns) return false;

    // Cooldown hasn't elapsed
    if (Date.now() - lastCompaction < this.config.compactionCooldownMs) return false;

    // Check character threshold
    return totalChars > this.config.compactionThresholdChars;
  }

  /**
   * Compact a session by summarizing older turns and rewriting the JSONL file.
   *
   * Keeps the most recent K turns intact, sends older turns to the LLM for
   * summarization, and rewrites the file atomically (temp + rename).
   */
  async compact(
    chatId: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    compactionModel: LanguageModelV1
  ): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: string }>; summary: string }> {
    const keepMessages = this.config.compactionKeepRecentTurns * 2; // turns × 2 messages per turn

    if (messages.length <= keepMessages) {
      // Not enough messages to compact — nothing to do
      return { messages, summary: '' };
    }

    // Split: old messages to summarize, recent messages to keep
    const oldMessages = messages.slice(0, messages.length - keepMessages);
    const recentMessages = messages.slice(messages.length - keepMessages);

    // Format old messages for the summarization prompt
    const conversationText = oldMessages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    logger.info(`Compacting session ${chatId}: ${oldMessages.length} messages → summary, keeping ${recentMessages.length} recent`);

    try {
      // Summarize using the cheap compaction model
      const result = await generateText({
        model: compactionModel,
        system: COMPACTION_PROMPT,
        messages: [{ role: 'user', content: conversationText }],
        abortSignal: AbortSignal.timeout(30_000),
      });

      const summary = result.text || 'Previous conversation context was compacted but summary generation failed.';

      // Rewrite the JSONL file atomically
      const filePath = this.getSessionPath(chatId);
      const tempPath = filePath + '.tmp';

      const header: SessionHeader = {
        type: 'header',
        chatId,
        agentId: this.agentId,
        createdAt: new Date().toISOString(),
        version: 1,
      };

      const compaction: SessionCompaction = {
        type: 'compaction',
        summary,
        compactedTurns: oldMessages.length / 2,
        timestamp: new Date().toISOString(),
      };

      // Build new file content: header + compaction + recent turns
      const lines: string[] = [
        JSON.stringify(header),
        JSON.stringify(compaction),
      ];

      // Re-serialize recent turns
      for (let i = 0; i < recentMessages.length; i += 2) {
        const user = recentMessages[i];
        const assistant = recentMessages[i + 1];
        if (user && assistant) {
          const turn: SessionTurn = {
            type: 'turn',
            user: user.content,
            assistant: assistant.content,
            timestamp: new Date().toISOString(),
            toolsUsed: [], // metadata lost during compaction — acceptable
            tokens: { prompt: 0, completion: 0 },
          };
          lines.push(JSON.stringify(turn));
        }
      }

      await writeFile(tempPath, lines.join('\n') + '\n', 'utf-8');
      await rename(tempPath, filePath);

      // Update tracking maps
      const recentChars = recentMessages.reduce((sum, m) => sum + m.content.length, 0);
      this.charCounts.set(chatId, recentChars);
      this.turnCounts.set(chatId, recentMessages.length / 2);
      this.lastCompactionTimes.set(chatId, Date.now());

      logger.info(`Session ${chatId} compacted successfully (summary: ${summary.length} chars)`);

      return { messages: recentMessages, summary };
    } catch (error) {
      logger.error(`Failed to compact session ${chatId}`, error);
      // Return original messages unchanged — compaction is best-effort
      return { messages, summary: '' };
    }
  }

  /**
   * Clear a session entirely — deletes the JSONL file and resets tracking maps.
   * The session file will be recreated on the next message.
   */
  async clearSession(chatId: string): Promise<void> {
    const filePath = this.getSessionPath(chatId);

    if (existsSync(filePath)) {
      await unlink(filePath);
      logger.info(`Deleted session file for ${chatId}`);
    }

    this.charCounts.delete(chatId);
    this.turnCounts.delete(chatId);
    this.lastCompactionTimes.delete(chatId);
  }

  /**
   * Delete session files older than maxAgeDays.
   * Returns the number of sessions cleaned up.
   */
  async cleanupOldSessions(maxAgeDays?: number): Promise<number> {
    const days = maxAgeDays ?? this.config.maxAgeDays;
    const maxAgeMs = days * 24 * 60 * 60 * 1000;
    const agentDir = join(this.sessionsDir, this.agentId);

    if (!existsSync(agentDir)) return 0;

    let cleaned = 0;
    try {
      const files = await readdir(agentDir);
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;

        const filePath = join(agentDir, file);
        try {
          const fileStat = await stat(filePath);
          if (now - fileStat.mtimeMs > maxAgeMs) {
            await unlink(filePath);
            cleaned++;

            // Clean up tracking maps
            const chatId = file.replace('.jsonl', '');
            this.charCounts.delete(chatId);
            this.turnCounts.delete(chatId);
            this.lastCompactionTimes.delete(chatId);
          }
        } catch (fileError) {
          logger.warn(`Failed to check/clean session file ${file}`, fileError);
        }
      }

      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} old session file(s)`);
      }
    } catch (error) {
      logger.error('Failed to cleanup old sessions', error);
    }

    return cleaned;
  }
}
