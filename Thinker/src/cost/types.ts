/**
 * Types for the LLM cost control system.
 *
 * The cost monitor tracks token usage in a sliding window and detects
 * abnormal consumption spikes to prevent runaway agents.
 */

/**
 * Configuration for cost controls, passed via environment variables
 * from the Orchestrator's agents.json → buildAgentEnv().
 */
export interface CostControlConfig {
  /** Whether cost controls are active */
  enabled: boolean;

  /** Size of the "recent" window for spike detection (minutes) */
  shortWindowMinutes: number;

  /** Spike threshold: short-window rate must exceed baseline × this multiplier */
  spikeMultiplier: number;

  /** Absolute safety cap: total tokens in the last 60 minutes */
  hardCapTokensPerHour: number;

  /**
   * Minimum total tokens in the baseline window before spike detection activates.
   * Prevents false positives during cold start when baseline is near zero.
   */
  minimumBaselineTokens: number;
}

/**
 * A single minute-level bucket in the sliding window.
 */
export interface TokenBucket {
  /** Start of the minute (epoch ms, floored to minute boundary) */
  minuteTimestamp: number;

  /** Sum of prompt (input) tokens recorded in this minute */
  promptTokens: number;

  /** Sum of completion (output) tokens recorded in this minute */
  completionTokens: number;

  /** Number of LLM calls recorded in this minute */
  callCount: number;
}

/**
 * Snapshot of the cost monitor's state, returned by the /cost-status endpoint.
 */
export interface CostStatus {
  enabled: boolean;
  paused: boolean;
  pauseReason: string | null;
  pausedAt: string | null;
  currentHourTokens: number;
  shortWindowTokensPerMinute: number;
  baselineTokensPerMinute: number;
  hardCapTokensPerHour: number;
  spikeMultiplier: number;
  shortWindowMinutes: number;
  activeBuckets: number;
}
