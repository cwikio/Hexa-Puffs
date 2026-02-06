import { randomUUID } from 'crypto';
import { logger, Logger } from '../../../Shared/Utils/logger.js';

export interface SessionTurn {
  userMessage: string;
  assistantResponse: string;
  toolsUsed: string[];
  timestamp: Date;
}

export interface Session {
  id: string;
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

  getOrCreate(sessionId?: string): Session {
    // Clean up expired sessions
    this.cleanupExpired();

    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      session.lastActivityAt = new Date();
      this.logger.debug('Resumed existing session', { sessionId });
      return session;
    }

    const newSession: Session = {
      id: sessionId || `sess_${randomUUID().replace(/-/g, '').substring(0, 12)}`,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      history: [],
    };

    this.sessions.set(newSession.id, newSession);
    this.logger.debug('Created new session', { sessionId: newSession.id });
    return newSession;
  }

  addTurn(sessionId: string, turn: Omit<SessionTurn, 'timestamp'>): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn('Session not found for addTurn', { sessionId });
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

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  deleteSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      this.logger.debug('Deleted session', { sessionId });
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
