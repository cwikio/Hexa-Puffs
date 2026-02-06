/**
 * delete_file tool - Delete a file (workspace only)
 */

import { z } from "zod";
import { unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { resolvePath } from "../utils/paths.js";
import { writeAuditEntry, createAuditEntry } from "../logging/audit.js";

export const deleteFileSchema = z.object({
  path: z.string().describe("Relative path within workspace"),
});

export type DeleteFileInput = z.infer<typeof deleteFileSchema>;

export interface DeleteFileData {
  deleted_path: string;
}

export type DeleteFileResult = StandardResponse<DeleteFileData>;

export async function handleDeleteFile(
  input: DeleteFileInput
): Promise<DeleteFileData> {
  // Validate it's a relative path (workspace only for delete)
  if (input.path.startsWith("/") || input.path.startsWith("~")) {
    throw new Error(
      "delete_file only works with workspace paths. Cannot delete files outside workspace."
    );
  }

  const resolved = resolvePath(input.path);

  if (resolved.domain !== "workspace") {
    throw new Error("delete_file only works with workspace paths");
  }

  // Check if file exists
  if (!existsSync(resolved.fullPath)) {
    throw new Error(`File not found: ${resolved.fullPath}`);
  }

  // Check it's a file, not a directory
  const stats = await stat(resolved.fullPath);
  if (stats.isDirectory()) {
    throw new Error(
      `Cannot delete directories with delete_file. Path is a directory: ${resolved.fullPath}`
    );
  }

  // Delete the file
  await unlink(resolved.fullPath);

  // Audit log
  await writeAuditEntry(
    createAuditEntry("delete_file", resolved.fullPath, "workspace", true)
  );

  return {
    deleted_path: resolved.fullPath,
  };
}
