/**
 * CostMonitor — Sliding-window anomaly detector for LLM token consumption.
 *
 * Maintains a 60-bucket ring buffer (one bucket per minute, covering 1 hour).
 * After each LLM call, tokens are recorded and two checks run:
 *
 *   1. Spike detection — compares the short-window rate (last N minutes)
 *      against the baseline rate (remaining history). A spike is declared
 *      when short > baseline × spikeMultiplier AND the baseline has enough
 *      data (minimumBaselineTokens) to be meaningful.
 *
 *   2. Hard cap — total tokens in the full 60-minute window must not
 *      exceed hardCapTokensPerHour.
 *
 * When either threshold triggers, the monitor enters a "paused" state.
 * The owning Agent checks this flag and stops processing new messages.
 */

import type { CostControlConfig, CostStatus, TokenBucket } from './types.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:cost');

const TOTAL_BUCKETS = 60; // 60 minutes = 1 hour of history

function floorToMinute(epochMs: number): number {
  return Math.floor(epochMs / 60_000) * 60_000;
}

function emptyBucket(minuteTimestamp: number): TokenBucket {
  return { minuteTimestamp, promptTokens: 0, completionTokens: 0, callCount: 0 };
}

export class CostMonitor {
  private buckets: TokenBucket[];
  private config: CostControlConfig;

  private _paused = false;
  private _pauseReason: string | null = null;
  private _pausedAt: number | null = null;

  constructor(config: CostControlConfig) {
    this.config = config;

    // Initialize with empty buckets
    const now = floorToMinute(Date.now());
    this.buckets = Array.from({ length: TOTAL_BUCKETS }, (_, i) =>
      emptyBucket(now - (TOTAL_BUCKETS - 1 - i) * 60_000)
    );
  }

  // ─── Public API ─────────────────────────────────────────────────

  /**
   * Record token usage from a single generateText() call.
   * Advances the window if the minute has changed, then checks thresholds.
   */
  recordUsage(promptTokens: number, completionTokens: number): void {
    if (!this.config.enabled) return;

    this.advanceWindow();

    const current = this.buckets[TOTAL_BUCKETS - 1];
    current.promptTokens += promptTokens;
    current.completionTokens += completionTokens;
    current.callCount += 1;

    // Don't re-check if already paused
    if (this._paused) return;

    const result = this.checkThresholds();
    if (result) {
      this._paused = true;
      this._pauseReason = result.reason;
      this._pausedAt = Date.now();
      logger.warn(`PAUSED — ${result.reason}`);
    }
  }

  get paused(): boolean {
    return this._paused;
  }

  get pauseReason(): string | null {
    return this._pauseReason;
  }

  /**
   * Resume processing. Optionally resets the entire window
   * (useful if the spike was caused by a one-off event and you
   * don't want the old data to immediately re-trigger).
   */
  resume(resetWindow = false): void {
    this._paused = false;
    this._pauseReason = null;
    this._pausedAt = null;

    if (resetWindow) {
      const now = floorToMinute(Date.now());
      this.buckets = Array.from({ length: TOTAL_BUCKETS }, (_, i) =>
        emptyBucket(now - (TOTAL_BUCKETS - 1 - i) * 60_000)
      );
    }
  }

  /**
   * Snapshot of current state for the /cost-status HTTP endpoint.
   */
  getStatus(): CostStatus {
    this.advanceWindow();

    const totalTokens = this.totalTokensInWindow();
    const { shortRate, baselineRate } = this.computeRates();

    return {
      enabled: this.config.enabled,
      paused: this._paused,
      pauseReason: this._pauseReason,
      pausedAt: this._pausedAt ? new Date(this._pausedAt).toISOString() : null,
      currentHourTokens: totalTokens,
      shortWindowTokensPerMinute: Math.round(shortRate),
      baselineTokensPerMinute: Math.round(baselineRate),
      hardCapTokensPerHour: this.config.hardCapTokensPerHour,
      spikeMultiplier: this.config.spikeMultiplier,
      shortWindowMinutes: this.config.shortWindowMinutes,
      activeBuckets: this.countActiveBuckets(),
    };
  }

  // ─── Internal ───────────────────────────────────────────────────

  /**
   * Slide the window forward so the last bucket corresponds to the current minute.
   * Any buckets that have fallen out of the 60-minute window are zeroed and recycled.
   */
  private advanceWindow(): void {
    const nowMinute = floorToMinute(Date.now());
    const lastBucketMinute = this.buckets[TOTAL_BUCKETS - 1].minuteTimestamp;
    const gap = Math.floor((nowMinute - lastBucketMinute) / 60_000);

    if (gap <= 0) return; // still in the same minute

    if (gap >= TOTAL_BUCKETS) {
      // Entire window has expired — reset all buckets
      for (let i = 0; i < TOTAL_BUCKETS; i++) {
        this.buckets[i] = emptyBucket(nowMinute - (TOTAL_BUCKETS - 1 - i) * 60_000);
      }
      return;
    }

    // Shift buckets left by `gap` positions, fill new ones at the end
    for (let i = 0; i < TOTAL_BUCKETS - gap; i++) {
      this.buckets[i] = this.buckets[i + gap];
    }
    for (let i = TOTAL_BUCKETS - gap; i < TOTAL_BUCKETS; i++) {
      this.buckets[i] = emptyBucket(nowMinute - (TOTAL_BUCKETS - 1 - i) * 60_000);
    }
  }

  /**
   * Compute the short-window and baseline rates (tokens per minute).
   *
   * Baseline rate is computed over *active* buckets only (those with at least
   * one LLM call). This prevents empty buckets from diluting the rate and
   * causing false spikes during ramp-up or idle periods.
   */
  private computeRates(): { shortRate: number; baselineRate: number; baselineTokens: number } {
    const shortMinutes = this.config.shortWindowMinutes;

    // Short window = last N buckets
    let shortTokens = 0;
    for (let i = TOTAL_BUCKETS - shortMinutes; i < TOTAL_BUCKETS; i++) {
      if (i >= 0) {
        shortTokens += this.buckets[i].promptTokens + this.buckets[i].completionTokens;
      }
    }
    const shortRate = shortTokens / shortMinutes;

    // Baseline = everything except the short window, averaged over *active* buckets
    let baselineTokens = 0;
    let activeBaselineBuckets = 0;
    for (let i = 0; i < TOTAL_BUCKETS - shortMinutes; i++) {
      const bucket = this.buckets[i];
      const tokens = bucket.promptTokens + bucket.completionTokens;
      baselineTokens += tokens;
      if (bucket.callCount > 0) activeBaselineBuckets++;
    }
    const baselineRate = activeBaselineBuckets > 0 ? baselineTokens / activeBaselineBuckets : 0;

    return { shortRate, baselineRate, baselineTokens };
  }

  /**
   * Check both spike detection and hard cap.
   */
  private checkThresholds(): { reason: string } | null {
    // Hard cap check (always active)
    const totalTokens = this.totalTokensInWindow();
    if (totalTokens >= this.config.hardCapTokensPerHour) {
      return {
        reason: `Hard cap exceeded: ${totalTokens.toLocaleString()} tokens in the last hour (cap: ${this.config.hardCapTokensPerHour.toLocaleString()})`,
      };
    }

    // Spike detection (only when baseline has enough data)
    const { shortRate, baselineRate, baselineTokens } = this.computeRates();

    if (baselineTokens < this.config.minimumBaselineTokens) {
      // Not enough history — skip spike detection, rely on hard cap only
      return null;
    }

    if (baselineRate > 0 && shortRate > baselineRate * this.config.spikeMultiplier) {
      return {
        reason: `Token spike detected: ${Math.round(shortRate).toLocaleString()} tokens/min in the last ${this.config.shortWindowMinutes} min vs ${Math.round(baselineRate).toLocaleString()} tokens/min baseline (${this.config.spikeMultiplier}x threshold)`,
      };
    }

    return null;
  }

  private totalTokensInWindow(): number {
    let total = 0;
    for (const bucket of this.buckets) {
      total += bucket.promptTokens + bucket.completionTokens;
    }
    return total;
  }

  private countActiveBuckets(): number {
    let count = 0;
    for (const bucket of this.buckets) {
      if (bucket.callCount > 0) count++;
    }
    return count;
  }
}
