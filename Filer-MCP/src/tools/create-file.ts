/**
 * create_file tool - Create a file in AI workspace
 */

import { z } from "zod";
import { writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { resolvePath, validateForCreation } from "../utils/paths.js";
import { writeAuditEntry, createAuditEntry } from "../logging/audit.js";

export const createFileSchema = z.object({
  path: z
    .string()
    .describe("Relative path within workspace (e.g., Documents/reports/analysis.md)"),
  content: z.string().describe("File content to write"),
  overwrite: z
    .boolean()
    .default(false)
    .describe("Whether to overwrite if file exists"),
});

export type CreateFileInput = z.infer<typeof createFileSchema>;

export interface CreateFileData {
  full_path: string;
  created_at: string;
  size_bytes: number;
}

export type CreateFileResult = StandardResponse<CreateFileData>;

export async function handleCreateFile(
  input: CreateFileInput
): Promise<CreateFileData> {
  // Validate it's a relative path (workspace only for create)
  if (input.path.startsWith("/") || input.path.startsWith("~")) {
    throw new Error(
      "create_file only works with workspace paths. Use relative paths."
    );
  }

  // Check for forbidden extensions
  validateForCreation(input.path);

  const { fullPath, domain } = resolvePath(input.path);

  if (domain !== "workspace") {
    throw new Error("create_file only works with workspace paths");
  }

  // Check if file exists and overwrite is false
  if (existsSync(fullPath) && !input.overwrite) {
    throw new Error(
      `File already exists: ${fullPath}. Set overwrite=true to replace.`
    );
  }

  // Ensure parent directory exists
  const parentDir = dirname(fullPath);
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true });
  }

  // Write the file
  await writeFile(fullPath, input.content, "utf-8");

  // Get file stats
  const stats = await stat(fullPath);
  const created_at = new Date().toISOString();

  // Audit log
  await writeAuditEntry(
    createAuditEntry("create_file", fullPath, "workspace", true, {
      size_bytes: stats.size,
    })
  );

  return {
    full_path: fullPath,
    created_at,
    size_bytes: stats.size,
  };
}
