/**
 * PlaybookCache - In-memory cache of playbooks from two sources:
 * 1. Database playbooks from Memorizer (refreshed periodically)
 * 2. File-based skills from ~/.annabelle/skills/ (loaded at startup)
 */

import type { OrchestratorClient } from '../orchestrator/client.js';
import type { TraceContext } from '../tracing/types.js';
import { type CachedPlaybook, parseSkillToPlaybook } from './playbook-classifier.js';
import { SkillLoader } from './skill-loader.js';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class PlaybookCache {
  private playbooks: CachedPlaybook[] = [];
  private fileSkills: CachedPlaybook[] = [];
  private lastRefresh = 0;
  private orchestrator: OrchestratorClient;
  private agentId: string;
  private skillLoader: SkillLoader | null = null;

  constructor(orchestrator: OrchestratorClient, agentId: string, skillsDir?: string) {
    this.orchestrator = orchestrator;
    this.agentId = agentId;
    if (skillsDir) {
      this.skillLoader = new SkillLoader(skillsDir);
    }
  }

  /**
   * Load file-based skills and database playbooks.
   */
  async initialize(trace?: TraceContext): Promise<void> {
    // Load file-based skills once at startup
    if (this.skillLoader) {
      try {
        this.fileSkills = await this.skillLoader.scan();
        if (this.fileSkills.length > 0) {
          console.log(`Loaded ${this.fileSkills.length} file-based skill(s) from disk`);
        }
      } catch (error) {
        console.warn('Failed to load file-based skills (non-fatal):', error);
      }
    }

    // Load database playbooks
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
   * Get the current cached playbooks (database + file-based merged).
   */
  getPlaybooks(): CachedPlaybook[] {
    return this.playbooks;
  }

  /**
   * Get file-based skills that have no keywords (description-only).
   * These are injected as an <available_skills> block for progressive disclosure.
   */
  getDescriptionOnlySkills(): CachedPlaybook[] {
    return this.fileSkills.filter((s) => s.keywords.length === 0);
  }

  private async refresh(trace?: TraceContext): Promise<void> {
    try {
      const { skills } = await this.orchestrator.listSkills(
        this.agentId,
        'event',
        true,
        trace
      );

      const dbPlaybooks: CachedPlaybook[] = [];
      for (const skill of skills) {
        const pb = parseSkillToPlaybook(skill);
        if (pb) dbPlaybooks.push(pb);
      }

      // Merge: database playbooks + file-based skills
      this.playbooks = [...dbPlaybooks, ...this.fileSkills];
      this.lastRefresh = Date.now();
    } catch (error) {
      // Keep stale cache on failure — better than no playbooks
      console.error('Failed to refresh playbook cache:', error);
    }
  }
}
