/**
 * copy_file tool - Copy a file (can copy from granted paths to workspace)
 */

import { z } from "zod";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { resolvePath, isWorkspacePath } from "../utils/paths.js";
import { checkPermission } from "../db/grants.js";
import { writeAuditEntry, createAuditEntry } from "../logging/audit.js";

export const copyFileSchema = z.object({
  source: z
    .string()
    .describe("Source path (workspace or granted absolute path)"),
  destination: z
    .string()
    .describe("Destination path (must be relative workspace path)"),
});

export type CopyFileInput = z.infer<typeof copyFileSchema>;

export interface CopyFileData {
  source_path: string;
  destination_path: string;
  size_bytes: number;
}

export type CopyFileResult = StandardResponse<CopyFileData>;

export async function handleCopyFile(
  input: CopyFileInput
): Promise<CopyFileData> {
  // Destination must be workspace path
  if (input.destination.startsWith("/") || input.destination.startsWith("~")) {
    throw new Error(
      "Destination must be a relative workspace path. Cannot copy to external locations."
    );
  }

  const sourceResolved = resolvePath(input.source);
  const destResolved = resolvePath(input.destination);

  if (destResolved.domain !== "workspace") {
    throw new Error("Destination must be within workspace");
  }

  // For external source paths, check grant
  if (sourceResolved.domain === "external") {
    const permission = await checkPermission(sourceResolved.fullPath, "read");
    if (!permission.allowed) {
      await writeAuditEntry(
        createAuditEntry("copy_file", sourceResolved.fullPath, "granted", false, {
          error: permission.reason,
        })
      );
      throw new Error(permission.reason);
    }
  }

  // Check if source exists
  if (!existsSync(sourceResolved.fullPath)) {
    throw new Error(`Source file not found: ${sourceResolved.fullPath}`);
  }

  // Check source is a file
  const stats = await stat(sourceResolved.fullPath);
  if (stats.isDirectory()) {
    throw new Error(
      `Cannot copy directories. Source is a directory: ${sourceResolved.fullPath}`
    );
  }

  // Check destination doesn't exist
  if (existsSync(destResolved.fullPath)) {
    throw new Error(
      `Destination already exists: ${destResolved.fullPath}. Delete it first or choose a different name.`
    );
  }

  // Ensure destination directory exists
  const destDir = dirname(destResolved.fullPath);
  if (!existsSync(destDir)) {
    await mkdir(destDir, { recursive: true });
  }

  // Copy the file
  await copyFile(sourceResolved.fullPath, destResolved.fullPath);

  // Audit log
  await writeAuditEntry(
    createAuditEntry(
      "copy_file",
      `${sourceResolved.fullPath} -> ${destResolved.fullPath}`,
      sourceResolved.domain === "workspace" ? "workspace" : "granted",
      true,
      { size_bytes: stats.size }
    )
  );

  return {
    source_path: sourceResolved.fullPath,
    destination_path: destResolved.fullPath,
    size_bytes: stats.size,
  };
}
