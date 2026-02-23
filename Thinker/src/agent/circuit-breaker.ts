/**
 * CircuitBreaker — three-state (closed/open/half-open) circuit breaker for the Agent.
 *
 * - Closed: normal operation. Consecutive errors increment a counter.
 * - Open: threshold exceeded. All requests rejected until cooldown expires.
 * - Half-open: cooldown expired. A single request is allowed through.
 *   - Success → Closed (counter reset)
 *   - Failure → Open (counter stays, timer resets)
 */

import { Logger } from '@mcp/shared/Utils/logger.js';

export type CircuitState = 'closed' | 'open' | 'half-open';

const logger = new Logger('thinker:circuit-breaker');

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveErrors = 0;
  private trippedAt: number | null = null;

  constructor(
    private readonly maxErrors: number = 5,
    private readonly cooldownMs: number = 60_000,
  ) {}

  /**
   * Check if a request should be allowed through.
   *
   * In the open state, automatically transitions to half-open once the cooldown has elapsed.
   */
  canProcess(): boolean {
    if (this.state === 'closed') return true;

    if (this.state === 'open' && this.trippedAt !== null) {
      const elapsed = Date.now() - this.trippedAt;
      if (elapsed >= this.cooldownMs) {
        this.state = 'half-open';
        logger.info(
          `Circuit breaker transitioning to half-open after ${Math.round(elapsed / 1000)}s cooldown`,
        );
        return true;
      }
      return false;
    }

    // half-open: allow exactly one request
    return this.state === 'half-open';
  }

  /** Record a successful call. Resets errors and closes the circuit. */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      logger.info('Circuit breaker closing — half-open request succeeded');
    }
    this.consecutiveErrors = 0;
    this.state = 'closed';
    this.trippedAt = null;
  }

  /** Record a failed call. Trips if threshold reached. Re-opens if half-open. */
  recordFailure(): void {
    this.consecutiveErrors++;

    if (this.state === 'half-open') {
      // Half-open test failed — reopen
      this.state = 'open';
      this.trippedAt = Date.now();
      logger.error(
        `Circuit breaker re-opened — half-open test failed (${this.consecutiveErrors} consecutive errors)`,
      );
      return;
    }

    if (this.consecutiveErrors >= this.maxErrors) {
      this.state = 'open';
      this.trippedAt = Date.now();
      logger.error(
        `CIRCUIT BREAKER TRIPPED: ${this.consecutiveErrors} consecutive errors — entering open state (cooldown: ${this.cooldownMs / 1000}s)`,
      );
    }
  }

  getState(): { state: CircuitState; consecutiveErrors: number; trippedAt: number | null } {
    return {
      state: this.state,
      consecutiveErrors: this.consecutiveErrors,
      trippedAt: this.trippedAt,
    };
  }
}
