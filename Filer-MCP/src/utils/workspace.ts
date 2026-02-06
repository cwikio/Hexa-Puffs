/**
 * Workspace initialization and management
 */

import { mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "./config.js";

/**
 * Initialize the workspace directory structure
 */
export async function initializeWorkspace(): Promise<void> {
  const config = getConfig();
  const workspacePath = config.workspace.path;

  // Create workspace root if it doesn't exist
  if (!existsSync(workspacePath)) {
    await mkdir(workspacePath, { recursive: true });
  }

  // Create all directories in the structure
  for (const dir of config.workspace.structure) {
    const fullPath = join(workspacePath, dir);
    if (!existsSync(fullPath)) {
      await mkdir(fullPath, { recursive: true });
    }
  }
}

/**
 * Get workspace statistics
 */
export async function getWorkspaceStats(): Promise<{
  workspace_path: string;
  total_files: number;
  total_size_bytes: number;
  temp_files: number;
}> {
  const config = getConfig();
  const workspacePath = config.workspace.path;

  let totalFiles = 0;
  let totalSize = 0;
  let tempFiles = 0;

  async function countFiles(dir: string, isTemp: boolean = false): Promise<void> {
    if (!existsSync(dir)) return;

    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const isTempDir = isTemp || entry.name === "temp";
        await countFiles(fullPath, isTempDir);
      } else if (entry.isFile()) {
        totalFiles++;
        const stats = await stat(fullPath);
        totalSize += stats.size;
        if (isTemp) {
          tempFiles++;
        }
      }
    }
  }

  await countFiles(workspacePath);

  return {
    workspace_path: workspacePath,
    total_files: totalFiles,
    total_size_bytes: totalSize,
    temp_files: tempFiles,
  };
}
