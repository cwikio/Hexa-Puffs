/**
 * Working directory before/after diff for artifact detection.
 *
 * Shallow snapshot — only top-level files in the directory.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface FileInfo {
  size: number;
  mtimeMs: number;
}

export type DirSnapshot = Map<string, FileInfo>;

/**
 * Take a shallow snapshot of a directory (filenames + size + mtime).
 * Returns empty map if directory doesn't exist or is empty.
 */
export async function snapshotDir(dirPath: string): Promise<DirSnapshot> {
  const snapshot: DirSnapshot = new Map();

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return snapshot;
  }

  for (const entry of entries) {
    try {
      const s = await stat(join(dirPath, entry));
      if (s.isFile()) {
        snapshot.set(entry, { size: s.size, mtimeMs: s.mtimeMs });
      }
    } catch {
      // Skip files we can't stat
    }
  }

  return snapshot;
}

export interface ArtifactDiff {
  created: string[];
  modified: string[];
  deleted: string[];
}

/**
 * Diff two snapshots to find created, modified, and deleted files.
 */
export function diffSnapshots(
  before: DirSnapshot,
  after: DirSnapshot,
): ArtifactDiff {
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  // Files in after but not in before → created
  // Files in both but changed → modified
  for (const [name, afterInfo] of after) {
    const beforeInfo = before.get(name);
    if (!beforeInfo) {
      created.push(name);
    } else if (
      beforeInfo.size !== afterInfo.size ||
      beforeInfo.mtimeMs !== afterInfo.mtimeMs
    ) {
      modified.push(name);
    }
  }

  // Files in before but not in after → deleted
  for (const name of before.keys()) {
    if (!after.has(name)) {
      deleted.push(name);
    }
  }

  return { created, modified, deleted };
}
