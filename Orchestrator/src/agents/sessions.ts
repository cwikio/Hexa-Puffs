import { randomUUID } from 'crypto';
import { logger, Logger } from '@mcp/shared/Utils/logger.js';

export interface SessionTurn {
  userMessage: string;
  assistantResponse: string;
  toolsUsed: string[];
  timestamp: Date;
}

export interface Session {
  id: string;
  agentId: string;
  createdAt: Date;
  lastActivityAt: Date;
  history: SessionTurn[];
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private logger: Logger;
  private maxHistory: number;
  private timeoutMs: number;

  constructor(maxHistory: number = 20, timeoutMinutes: number = 30) {
    this.maxHistory = maxHistory;
    this.timeoutMs = timeoutMinutes * 60 * 1000;
    this.logger = logger.child('sessions');
  }

  /**
   * Build the compound key for session storage: agentId:sessionId
   */
  private buildKey(agentId: string, sessionId: string): string {
    return `${agentId}:${sessionId}`;
  }

  getOrCreate(sessionId?: string, agentId: string = 'main'): Session {
    // Clean up expired sessions
    this.cleanupExpired();

    const resolvedSessionId = sessionId || `sess_${randomUUID().replace(/-/g, '').substring(0, 12)}`;
    const key = this.buildKey(agentId, resolvedSessionId);

    if (this.sessions.has(key)) {
      const session = this.sessions.get(key)!;
      session.lastActivityAt = new Date();
      this.logger.debug('Resumed existing session', { sessionId: resolvedSessionId, agentId });
      return session;
    }

    const newSession: Session = {
      id: resolvedSessionId,
      agentId,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      history: [],
    };

    this.sessions.set(key, newSession);
    this.logger.debug('Created new session', { sessionId: newSession.id, agentId });
    return newSession;
  }

  addTurn(sessionId: string, turn: Omit<SessionTurn, 'timestamp'>, agentId: string = 'main'): void {
    const key = this.buildKey(agentId, sessionId);
    const session = this.sessions.get(key);
    if (!session) {
      this.logger.warn('Session not found for addTurn', { sessionId, agentId });
      return;
    }

    session.history.push({
      ...turn,
      timestamp: new Date(),
    });

    // Keep only last N turns
    if (session.history.length > this.maxHistory) {
      session.history = session.history.slice(-this.maxHistory);
    }

    session.lastActivityAt = new Date();
  }

  getSession(sessionId: string, agentId: string = 'main'): Session | undefined {
    return this.sessions.get(this.buildKey(agentId, sessionId));
  }

  deleteSession(sessionId: string, agentId: string = 'main'): boolean {
    const key = this.buildKey(agentId, sessionId);
    const deleted = this.sessions.delete(key);
    if (deleted) {
      this.logger.debug('Deleted session', { sessionId, agentId });
    }
    return deleted;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivityAt.getTime() > this.timeoutMs) {
        this.sessions.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug('Cleaned up expired sessions', { count: cleaned });
    }
  }

  getActiveSessionCount(): number {
    this.cleanupExpired();
    return this.sessions.size;
  }

  getStats(): { activeSessions: number; totalTurns: number } {
    this.cleanupExpired();
    let totalTurns = 0;
    for (const session of this.sessions.values()) {
      totalTurns += session.history.length;
    }
    return {
      activeSessions: this.sessions.size,
      totalTurns,
    };
  }
}
