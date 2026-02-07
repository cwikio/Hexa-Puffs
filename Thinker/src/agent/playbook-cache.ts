/**
 * PlaybookCache - In-memory cache of event-type skills from Memorizer.
 * Refreshes periodically to pick up user edits.
 */

import type { OrchestratorClient } from '../orchestrator/client.js';
import type { TraceContext } from '../tracing/types.js';
import { type CachedPlaybook, parseSkillToPlaybook } from './playbook-classifier.js';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class PlaybookCache {
  private playbooks: CachedPlaybook[] = [];
  private lastRefresh = 0;
  private orchestrator: OrchestratorClient;
  private agentId: string;

  constructor(orchestrator: OrchestratorClient, agentId: string) {
    this.orchestrator = orchestrator;
    this.agentId = agentId;
  }

  /**
   * Load all event-type playbooks from Memorizer via Orchestrator.
   */
  async initialize(trace?: TraceContext): Promise<void> {
    await this.refresh(trace);
  }

  /**
   * Refresh the cache if it's stale (older than 5 minutes).
   */
  async refreshIfNeeded(trace?: TraceContext): Promise<void> {
    if (Date.now() - this.lastRefresh > REFRESH_INTERVAL_MS) {
      await this.refresh(trace);
    }
  }

  /**
   * Force the next `refreshIfNeeded` call to reload.
   */
  invalidate(): void {
    this.lastRefresh = 0;
  }

  /**
   * Get the current cached playbooks.
   */
  getPlaybooks(): CachedPlaybook[] {
    return this.playbooks;
  }

  private async refresh(trace?: TraceContext): Promise<void> {
    try {
      const { skills } = await this.orchestrator.listSkills(
        this.agentId,
        'event',
        true,
        trace
      );

      const parsed: CachedPlaybook[] = [];
      for (const skill of skills) {
        const pb = parseSkillToPlaybook(skill);
        if (pb) parsed.push(pb);
      }

      this.playbooks = parsed;
      this.lastRefresh = Date.now();
    } catch (error) {
      // Keep stale cache on failure — better than no playbooks
      console.error('Failed to refresh playbook cache:', error);
    }
  }
}
