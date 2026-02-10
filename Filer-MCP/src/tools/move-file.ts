/**
 * move_file tool - Move or rename a file within workspace
 */

import { z } from "zod";
import { rename, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { resolvePath } from "../utils/paths.js";
import { writeAuditEntry, createAuditEntry } from "../logging/audit.js";

export const moveFileSchema = z.object({
  source: z.string().describe("Source path (relative within workspace)"),
  destination: z
    .string()
    .describe("Destination path (relative within workspace)"),
});

export type MoveFileInput = z.infer<typeof moveFileSchema>;

export interface MoveFileData {
  old_path: string;
  new_path: string;
}

export type MoveFileResult = StandardResponse<MoveFileData>;

export async function handleMoveFile(
  input: MoveFileInput
): Promise<MoveFileData> {
  // Validate both paths are relative (workspace only)
  if (
    input.source.startsWith("/") ||
    input.source.startsWith("~") ||
    input.destination.startsWith("/") ||
    input.destination.startsWith("~")
  ) {
    throw new Error(
      "move_file only works with workspace paths. Use relative paths."
    );
  }

  const sourceResolved = resolvePath(input.source);
  const destResolved = resolvePath(input.destination);

  if (
    sourceResolved.domain !== "workspace" ||
    destResolved.domain !== "workspace"
  ) {
    throw new Error("move_file only works with workspace paths");
  }

  // Check if source exists
  if (!existsSync(sourceResolved.fullPath)) {
    throw new Error(`Source file not found: ${sourceResolved.fullPath}`);
  }

  // Check source is a file
  const stats = await stat(sourceResolved.fullPath);
  if (stats.isDirectory()) {
    throw new Error(
      `Cannot move directories. Source is a directory: ${sourceResolved.fullPath}`
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

  // Move the file
  await rename(sourceResolved.fullPath, destResolved.fullPath);

  // Audit log
  await writeAuditEntry(
    createAuditEntry(
      "move_file",
      `${sourceResolved.fullPath} -> ${destResolved.fullPath}`,
      "workspace",
      true
    )
  );

  return {
    old_path: sourceResolved.fullPath,
    new_path: destResolved.fullPath,
  };
}
