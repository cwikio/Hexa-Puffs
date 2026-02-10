/**
 * Temp file cleanup service
 * Deletes files in the temp/ directory older than configured days
 */

import { readdir, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "../utils/config.js";
import { writeAuditEntry, createAuditEntry } from "../logging/audit.js";
import { Logger } from "@mcp/shared/Utils/logger.js";

const logger = new Logger('filer:cleanup');

export interface CleanupResult {
  deleted: number;
  errors: number;
  skipped: number;
}

/**
 * Clean up old files in the temp directory
 * Deletes files older than the configured number of days
 */
export async function cleanupTempFiles(): Promise<CleanupResult> {
  const config = getConfig();
  const tempDir = join(config.workspace.path, "temp");
  const maxAgeDays = config.cleanup.tempDays;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const result: CleanupResult = {
    deleted: 0,
    errors: 0,
    skipped: 0,
  };

  if (!existsSync(tempDir)) {
    return result;
  }

  let entries: string[];
  try {
    entries = await readdir(tempDir);
  } catch (error) {
    logger.error("Failed to read temp directory", error);
    return result;
  }

  for (const entry of entries) {
    const filePath = join(tempDir, entry);

    try {
      const stats = await stat(filePath);

      // Skip directories
      if (stats.isDirectory()) {
        result.skipped++;
        continue;
      }

      const fileAge = now - stats.mtimeMs;

      if (fileAge > maxAgeMs) {
        await unlink(filePath);
        result.deleted++;

        // Log the cleanup to audit trail
        await writeAuditEntry(
          createAuditEntry("auto_cleanup", filePath, "workspace", true, {
            size_bytes: stats.size,
          })
        );
      } else {
        result.skipped++;
      }
    } catch (error) {
      result.errors++;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`Failed to process ${filePath}: ${errorMessage}`);

      // Log the failure
      await writeAuditEntry(
        createAuditEntry("auto_cleanup", filePath, "workspace", false, {
          error: errorMessage,
        })
      );
    }
  }

  return result;
}
