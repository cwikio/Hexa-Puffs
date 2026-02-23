import { watch, type FSWatcher } from 'node:fs';
import { loadExternalMCPs, type ExternalMCPEntry } from '@mcp/shared/Discovery/external-loader.js';
import { logger } from '@mcp/shared/Utils/logger.js';

export class ExternalMCPWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentExternals: Map<string, ExternalMCPEntry>;
  private log = logger.child('external-watcher');

  constructor(
    private configPath: string,
    private onChanged: (
      added: Map<string, ExternalMCPEntry>,
      removed: string[],
    ) => Promise<void>,
    initialExternals: Record<string, ExternalMCPEntry>,
    private onValidationErrors?: (
      fileError: string | undefined,
      entryErrors: Array<{ name: string; message: string }>,
    ) => void,
  ) {
    this.currentExternals = new Map(Object.entries(initialExternals));
  }

  start(): void {
    try {
      this.watcher = watch(this.configPath, () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.handleChange().catch((err) =>
            this.log.error('Error handling external MCP config change', { error: err }),
          );
        }, 500);
      });
      this.log.info('Watching external-mcps.json for changes');
    } catch (error) {
      this.log.warn('Failed to watch external-mcps.json', { error });
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private async handleChange(): Promise<void> {
    const loadResult = loadExternalMCPs(this.configPath);

    // Report validation errors
    if (loadResult.fileError || loadResult.errors.length > 0) {
      this.onValidationErrors?.(loadResult.fileError, loadResult.errors);
    }

    const freshEntries = loadResult.entries;
    const freshNames = new Set(Object.keys(freshEntries));
    const currentNames = new Set(this.currentExternals.keys());

    const added = new Map<string, ExternalMCPEntry>();
    const removed: string[] = [];

    for (const [name, entry] of Object.entries(freshEntries)) {
      if (!currentNames.has(name)) {
        added.set(name, entry);
      }
    }

    for (const name of currentNames) {
      if (!freshNames.has(name)) {
        removed.push(name);
      }
    }

    if (added.size === 0 && removed.length === 0) return;

    this.log.info('External MCPs changed', {
      added: [...added.keys()],
      removed,
    });

    // Update internal state before calling handler
    for (const name of removed) this.currentExternals.delete(name);
    for (const [name, entry] of added) this.currentExternals.set(name, entry);

    await this.onChanged(added, removed);
  }
}
