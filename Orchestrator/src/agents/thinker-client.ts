/**
 * ThinkerClient - HTTP client for communicating with a Thinker agent instance.
 *
 * Used by the Orchestrator to dispatch messages to Thinker processes
 * and receive processing results.
 */

import { logger, Logger } from '@mcp/shared/Utils/logger.js';
import type { IncomingAgentMessage, ProcessingResponse } from './agent-types.js';

export class ThinkerClient {
  private baseUrl: string;
  private logger: Logger;
  private timeout: number;

  constructor(baseUrl: string, timeout: number = 120_000) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
    this.logger = logger.child('thinker-client');
  }

  /**
   * Send a message to the Thinker for processing.
   * Returns the processing result (response text, tools used, etc.)
   */
  async processMessage(message: IncomingAgentMessage): Promise<ProcessingResponse> {
    const url = `${this.baseUrl}/process-message`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Thinker returned ${response.status}: ${errorText}`);
        return {
          success: false,
          toolsUsed: [],
          totalSteps: 0,
          error: `Thinker HTTP error: ${response.status}`,
        };
      }

      const result = (await response.json()) as ProcessingResponse;
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to reach Thinker at ${url}: ${msg}`);
      return {
        success: false,
        toolsUsed: [],
        totalSteps: 0,
        error: `Thinker unreachable: ${msg}`,
      };
    }
  }

  /**
   * Trigger a proactive skill execution on the Thinker.
   */
  async executeSkill(
    instructions: string,
    maxSteps: number = 10,
    noTools: boolean = false,
    requiredTools?: string[],
    skillId?: number,
    skillName?: string,
    chatId?: string,
  ): Promise<ProcessingResponse> {
    const url = `${this.baseUrl}/execute-skill`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId, skillName, instructions, maxSteps, noTools, requiredTools, chatId }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          toolsUsed: [],
          totalSteps: 0,
          error: `Skill execution failed: ${response.status} - ${errorText}`,
        };
      }

      return (await response.json()) as ProcessingResponse;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        toolsUsed: [],
        totalSteps: 0,
        error: `Skill execution unreachable: ${msg}`,
      };
    }
  }

  /**
   * Check if the Thinker process is healthy.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { status: string };
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  // ─── Cost Control Endpoints ─────────────────────────────────────

  /**
   * Get cost monitor status from a Thinker instance.
   */
  async getCostStatus(): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(`${this.baseUrl}/cost-status`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Resume a Thinker instance that was paused by cost controls.
   */
  async resumeCostPause(resetWindow = false): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/cost-resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetWindow }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { success: boolean };
      return data.success;
    } catch {
      return false;
    }
  }
}
