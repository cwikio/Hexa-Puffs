/**
 * search_files tool - Search for files by name or content
 */

import { z } from "zod";
import { readdir, stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { getWorkspaceRoot, resolvePath } from "../utils/paths.js";
import { listGrants } from "../db/grants.js";
import { writeAuditEntry, createAuditEntry } from "../logging/audit.js";

export const searchFilesSchema = z.object({
  query: z.string().describe("Search query (filename pattern or content text)"),
  search_in: z
    .enum(["workspace", "granted", "all"])
    .default("workspace")
    .describe("Where to search"),
  search_type: z
    .enum(["filename", "content"])
    .default("filename")
    .describe("Search in filename or file content"),
  file_types: z
    .array(z.string())
    .optional()
    .describe("Filter by file extensions (e.g., ['.md', '.txt'])"),
});

export type SearchFilesInput = z.infer<typeof searchFilesSchema>;

export interface SearchResult {
  path: string;
  match_type: "filename" | "content";
  modified_at: string;
  snippet?: string;
}

export interface SearchFilesData {
  results: SearchResult[];
  total_count: number;
  searched_locations: string[];
}

export type SearchFilesResult = StandardResponse<SearchFilesData>;

async function searchDirectory(
  dir: string,
  query: string,
  searchType: "filename" | "content",
  fileTypes: string[] | undefined,
  results: SearchResult[],
  maxResults: number = 100
): Promise<void> {
  if (results.length >= maxResults) return;
  if (!existsSync(dir)) return;

  const entries = await readdir(dir, { withFileTypes: true });
  const queryLower = query.toLowerCase();

  for (const entry of entries) {
    if (results.length >= maxResults) break;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip hidden directories
      if (!entry.name.startsWith(".")) {
        await searchDirectory(
          fullPath,
          query,
          searchType,
          fileTypes,
          results,
          maxResults
        );
      }
    } else if (entry.isFile()) {
      // Check file type filter
      if (fileTypes && fileTypes.length > 0) {
        const ext = "." + entry.name.split(".").pop();
        if (!fileTypes.includes(ext)) continue;
      }

      const stats = await stat(fullPath);

      if (searchType === "filename") {
        // Filename search
        if (entry.name.toLowerCase().includes(queryLower)) {
          results.push({
            path: fullPath,
            match_type: "filename",
            modified_at: stats.mtime.toISOString(),
          });
        }
      } else {
        // Content search (only for text files under 1MB)
        if (stats.size < 1024 * 1024) {
          try {
            const content = await readFile(fullPath, "utf-8");
            const contentLower = content.toLowerCase();
            if (contentLower.includes(queryLower)) {
              // Extract snippet around match
              const matchIndex = contentLower.indexOf(queryLower);
              const start = Math.max(0, matchIndex - 50);
              const end = Math.min(content.length, matchIndex + query.length + 50);
              const snippet = content.slice(start, end).replace(/\n/g, " ");

              results.push({
                path: fullPath,
                match_type: "content",
                modified_at: stats.mtime.toISOString(),
                snippet: (start > 0 ? "..." : "") + snippet + (end < content.length ? "..." : ""),
              });
            }
          } catch {
            // Skip binary or unreadable files
          }
        }
      }
    }
  }
}

export async function handleSearchFiles(
  input: SearchFilesInput
): Promise<SearchFilesData> {
  const results: SearchResult[] = [];
  const searchedLocations: string[] = [];

  // Search workspace
  if (input.search_in === "workspace" || input.search_in === "all") {
    const workspaceRoot = getWorkspaceRoot();
    searchedLocations.push(workspaceRoot);
    await searchDirectory(
      workspaceRoot,
      input.query,
      input.search_type,
      input.file_types,
      results
    );
  }

  // Search granted paths
  if (input.search_in === "granted" || input.search_in === "all") {
    const grants = await listGrants();
    for (const grant of grants) {
      if (grant.permission !== "write") {
        // Need read permission
        searchedLocations.push(grant.path);
        await searchDirectory(
          grant.path,
          input.query,
          input.search_type,
          input.file_types,
          results
        );
      }
    }
  }

  // Audit log
  await writeAuditEntry(
    createAuditEntry("search_files", input.query, "workspace", true)
  );

  return {
    results,
    total_count: results.length,
    searched_locations: searchedLocations,
  };
}
