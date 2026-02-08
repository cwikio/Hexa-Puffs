/**
 * HaltManager — manages global halt state for the kill switch.
 * Persists to disk so halt survives Orchestrator restarts.
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger as rootLogger } from '@mcp/shared/Utils/logger.js';

const DATA_DIR = join(homedir(), '.annabelle', 'data');
const HALT_FILE = join(DATA_DIR, 'halt.json');

interface HaltState {
  halted: boolean;
  reason: string;
  timestamp: string;
  targets: string[]; // which services were killed: 'thinker', 'telegram', 'inngest'
}

export class HaltManager {
  private state: HaltState;
  private logger = rootLogger.child('halt-manager');

  constructor() {
    this.state = this.loadFromDisk();
    if (this.state.halted) {
      this.logger.warn(`System is halted (persisted): ${this.state.reason}`, {
        targets: this.state.targets,
        since: this.state.timestamp,
      });
    }
  }

  isHalted(): boolean {
    return this.state.halted;
  }

  isTargetHalted(target: string): boolean {
    return this.state.targets.includes(target);
  }

  getState(): Readonly<HaltState> {
    return this.state;
  }

  halt(reason: string, targets: string[]): void {
    this.state = {
      halted: true,
      reason,
      timestamp: new Date().toISOString(),
      targets,
    };
    this.persistToDisk();
    this.logger.warn(`System halted: ${reason}`, { targets });
  }

  addTarget(target: string, reason: string): void {
    if (!this.state.targets.includes(target)) {
      this.state.targets.push(target);
    }
    this.state.halted = true;
    this.state.reason = reason;
    this.state.timestamp = new Date().toISOString();
    this.persistToDisk();
    this.logger.warn(`Target halted: ${target}`, { reason });
  }

  removeTarget(target: string): void {
    this.state.targets = this.state.targets.filter((t) => t !== target);
    if (this.state.targets.length === 0) {
      this.state.halted = false;
      this.state.reason = '';
      this.removeDiskFile();
    } else {
      this.persistToDisk();
    }
    this.logger.info(`Target resumed: ${target}`, { remainingTargets: this.state.targets });
  }

  resumeAll(): void {
    this.state = { halted: false, reason: '', timestamp: '', targets: [] };
    this.removeDiskFile();
    this.logger.info('System fully resumed');
  }

  private loadFromDisk(): HaltState {
    try {
      if (existsSync(HALT_FILE)) {
        const raw = readFileSync(HALT_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.halted === 'boolean') {
          return parsed;
        }
      }
    } catch {
      // Corrupt file — treat as not halted
    }
    return { halted: false, reason: '', timestamp: '', targets: [] };
  }

  private persistToDisk(): void {
    try {
      if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
      }
      writeFileSync(HALT_FILE, JSON.stringify(this.state, null, 2));
    } catch (error) {
      this.logger.error('Failed to persist halt state', { error });
    }
  }

  private removeDiskFile(): void {
    try {
      if (existsSync(HALT_FILE)) {
        unlinkSync(HALT_FILE);
      }
    } catch {
      // Best-effort cleanup
    }
  }
}

// Singleton
let haltManagerInstance: HaltManager | null = null;

export function getHaltManager(): HaltManager {
  if (!haltManagerInstance) {
    haltManagerInstance = new HaltManager();
  }
  return haltManagerInstance;
}
