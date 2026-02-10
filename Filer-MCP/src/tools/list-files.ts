/**
 * list_files tool - List files in a directory
 */

import { z } from "zod";
import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { resolvePath } from "../utils/paths.js";
import { checkPermission } from "../db/grants.js";
import { writeAuditEntry, createAuditEntry } from "../logging/audit.js";

export const listFilesSchema = z.object({
  path: z
    .string()
    .default(".")
    .describe("Relative workspace path or absolute granted path (defaults to workspace root)"),
  recursive: z
    .boolean()
    .default(false)
    .describe("Whether to list files recursively"),
});

export type ListFilesInput = z.infer<typeof listFilesSchema>;

export interface FileInfo {
  name: string;
  type: "file" | "directory";
  size_bytes?: number;
  modified_at?: string;
}

export interface ListFilesData {
  path: string;
  files: FileInfo[];
}

export type ListFilesResult = StandardResponse<ListFilesData>;

async function listDirectory(
  dirPath: string,
  recursive: boolean,
  prefix: string = ""
): Promise<FileInfo[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: FileInfo[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    const displayName = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push({
        name: displayName + "/",
        type: "directory",
      });

      if (recursive) {
        const subFiles = await listDirectory(fullPath, true, displayName);
        files.push(...subFiles);
      }
    } else if (entry.isFile()) {
      const stats = await stat(fullPath);
      files.push({
        name: displayName,
        type: "file",
        size_bytes: stats.size,
        modified_at: stats.mtime.toISOString(),
      });
    }
  }

  return files;
}

export async function handleListFiles(
  input: ListFilesInput
): Promise<ListFilesData> {
  const resolved = resolvePath(input.path);

  // For external paths, check grant
  if (resolved.domain === "external") {
    const permission = await checkPermission(resolved.fullPath, "read");
    if (!permission.allowed) {
      await writeAuditEntry(
        createAuditEntry("list_files", resolved.fullPath, "granted", false, {
          error: permission.reason,
        })
      );
      throw new Error(permission.reason);
    }
  }

  // Check if directory exists
  if (!existsSync(resolved.fullPath)) {
    throw new Error(`Directory not found: ${resolved.fullPath}`);
  }

  const stats = await stat(resolved.fullPath);
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved.fullPath}`);
  }

  const files = await listDirectory(resolved.fullPath, input.recursive);

  // Audit log
  await writeAuditEntry(
    createAuditEntry(
      "list_files",
      resolved.fullPath,
      resolved.domain === "workspace" ? "workspace" : "granted",
      true
    )
  );

  return {
    path: resolved.fullPath,
    files,
  };
}
