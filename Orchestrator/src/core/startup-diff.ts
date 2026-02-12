import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '@mcp/shared/Utils/logger.js';

export interface MCPSnapshotEntry {
  name: string;
  type: 'internal' | 'external';
}

export interface MCPSnapshot {
  timestamp: string;
  mcps: MCPSnapshotEntry[];
}

export interface MCPDiff {
  added: string[];
  removed: string[];
}

export function loadSnapshot(path: string): MCPSnapshot | null {
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as MCPSnapshot;
    if (!parsed.mcps || !Array.isArray(parsed.mcps)) return null;
    return parsed;
  } catch {
    logger.warn('Failed to load MCP snapshot', { path });
    return null;
  }
}

export function saveSnapshot(path: string, snapshot: MCPSnapshot): void {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf-8');
  } catch (error) {
    logger.warn('Failed to save MCP snapshot', { path, error });
  }
}

export function computeDiff(previous: MCPSnapshot | null, current: MCPSnapshot): MCPDiff {
  if (!previous) {
    return { added: [], removed: [] };
  }

  const prevNames = new Set(previous.mcps.map((m) => m.name));
  const currNames = new Set(current.mcps.map((m) => m.name));

  const added = current.mcps
    .filter((m) => !prevNames.has(m.name))
    .map((m) => m.name);

  const removed = previous.mcps
    .filter((m) => !currNames.has(m.name))
    .map((m) => m.name);

  return { added, removed };
}
