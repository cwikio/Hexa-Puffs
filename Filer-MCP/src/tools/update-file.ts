/**
 * update_file tool - Update an existing file
 */

import { z } from "zod";
import { writeFile, readFile, stat, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { resolvePath, ensureTempDir, generateBackupPath } from "../utils/paths.js";
import { checkPermission } from "../db/grants.js";
import { writeAuditEntry, createAuditEntry } from "../logging/audit.js";

export const updateFileSchema = z.object({
  path: z
    .string()
    .describe("Relative workspace path or absolute granted path"),
  content: z.string().describe("New file content"),
  create_backup: z
    .boolean()
    .default(true)
    .describe("Whether to create a backup (.bak) before updating"),
});

export type UpdateFileInput = z.infer<typeof updateFileSchema>;

export interface UpdateFileData {
  path: string;
  backup_path?: string;
  updated_at: string;
  size_bytes: number;
}

export type UpdateFileResult = StandardResponse<UpdateFileData>;

export async function handleUpdateFile(
  input: UpdateFileInput
): Promise<UpdateFileData> {
  const resolved = resolvePath(input.path);

  // For external paths, check grant (need write permission)
  if (resolved.domain === "external") {
    const permission = await checkPermission(resolved.fullPath, "write");
    if (!permission.allowed) {
      await writeAuditEntry(
        createAuditEntry("update_file", resolved.fullPath, "granted", false, {
          error: permission.reason,
        })
      );
      throw new Error(permission.reason);
    }
  }

  // Check if file exists
  if (!existsSync(resolved.fullPath)) {
    throw new Error(
      `File not found: ${resolved.fullPath}. Use create_file to create a new file.`
    );
  }

  let backupPath: string | undefined;

  // Create backup if requested
  if (input.create_backup) {
    await ensureTempDir();
    backupPath = generateBackupPath(resolved.fullPath);
    await copyFile(resolved.fullPath, backupPath);
  }

  // Write the new content
  await writeFile(resolved.fullPath, input.content, "utf-8");

  // Get file stats
  const stats = await stat(resolved.fullPath);

  // Audit log
  await writeAuditEntry(
    createAuditEntry(
      "update_file",
      resolved.fullPath,
      resolved.domain === "workspace" ? "workspace" : "granted",
      true,
      { size_bytes: stats.size }
    )
  );

  return {
    path: resolved.fullPath,
    backup_path: backupPath,
    updated_at: new Date().toISOString(),
    size_bytes: stats.size,
  };
}
