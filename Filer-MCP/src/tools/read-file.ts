/**
 * read_file tool - Read a file (workspace or granted path)
 */

import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { resolvePath } from "../utils/paths.js";
import { checkPermission } from "../db/grants.js";
import { writeAuditEntry, createAuditEntry } from "../logging/audit.js";

export const readFileSchema = z.object({
  path: z
    .string()
    .describe("Relative workspace path or absolute granted path"),
});

export type ReadFileInput = z.infer<typeof readFileSchema>;

export interface ReadFileData {
  content: string;
  path: string;
  size_bytes: number;
  modified_at: string;
}

export type ReadFileResult = StandardResponse<ReadFileData>;

export async function handleReadFile(
  input: ReadFileInput
): Promise<ReadFileData> {
  const resolved = resolvePath(input.path);

  // For external paths, check grant
  if (resolved.domain === "external") {
    const permission = await checkPermission(resolved.fullPath, "read");
    if (!permission.allowed) {
      await writeAuditEntry(
        createAuditEntry("read_file", resolved.fullPath, "granted", false, {
          error: permission.reason,
        })
      );
      throw new Error(permission.reason);
    }
  }

  // Check if file exists
  if (!existsSync(resolved.fullPath)) {
    throw new Error(`File not found: ${resolved.fullPath}`);
  }

  // Get file stats
  const stats = await stat(resolved.fullPath);

  if (stats.isDirectory()) {
    throw new Error(
      `Path is a directory, not a file: ${resolved.fullPath}. Use list_files instead.`
    );
  }

  // Check file size (limit to 10MB for binary, 50MB for text)
  const maxSize = 50 * 1024 * 1024; // 50MB
  if (stats.size > maxSize) {
    throw new Error(
      `File too large: ${stats.size} bytes. Maximum is ${maxSize} bytes.`
    );
  }

  // Read the file
  const content = await readFile(resolved.fullPath, "utf-8");

  // Audit log
  await writeAuditEntry(
    createAuditEntry(
      "read_file",
      resolved.fullPath,
      resolved.domain === "workspace" ? "workspace" : "granted",
      true,
      { size_bytes: stats.size }
    )
  );

  return {
    content,
    path: resolved.fullPath,
    size_bytes: stats.size,
    modified_at: stats.mtime.toISOString(),
  };
}
