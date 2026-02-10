/**
 * Path validation and security utilities
 */

import { resolve, normalize, isAbsolute, basename, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { getConfig, expandHome } from "./config.js";

// Forbidden paths that can NEVER be accessed (even with grants)
const FORBIDDEN_PATHS = [
  "~/.ssh/",
  "~/.gnupg/",
  "~/.aws/",
  "~/.config/",
  "/etc/",
  "/var/",
  "~/.annabelle/data/",
].map((p) => expandHome(p));

// Forbidden extensions for file creation
const FORBIDDEN_EXTENSIONS_CREATE = [".exe", ".bat", ".ps1"];

/**
 * Check if path is in forbidden list
 */
export function isForbiddenPath(absolutePath: string): boolean {
  const normalized = normalize(absolutePath);
  return FORBIDDEN_PATHS.some(
    (forbidden) =>
      normalized.startsWith(forbidden) ||
      normalized === forbidden.slice(0, -1)
  );
}

/**
 * Check for path traversal attempts
 */
export function hasPathTraversal(path: string): boolean {
  if (path.includes("..")) return true;
  try {
    if (decodeURIComponent(path).includes("..")) return true;
  } catch {
    // Malformed encoding is suspicious — block it
    return true;
  }
  return false;
}

/**
 * Check if extension is forbidden for creation
 */
export function isForbiddenExtension(path: string): boolean {
  const lower = path.toLowerCase();
  // .sh is allowed in Code/bash/ directory
  if (lower.endsWith(".sh")) {
    return !path.includes("Code/bash/");
  }
  return FORBIDDEN_EXTENSIONS_CREATE.some((ext) => lower.endsWith(ext));
}

/**
 * Get the workspace root path
 */
export function getWorkspaceRoot(): string {
  return getConfig().workspace.path;
}

export type PathDomain = "workspace" | "external";

export interface PathResolution {
  fullPath: string;
  domain: PathDomain;
  relativePath?: string; // For workspace paths, the relative path within workspace
}

/**
 * Resolve and validate a path for file operations
 * - Relative paths are resolved within workspace
 * - Absolute paths are checked against forbidden list (grant check is separate)
 */
export function resolvePath(path: string): PathResolution {
  // Check for path traversal
  if (hasPathTraversal(path)) {
    throw new Error("Path traversal (..) not allowed");
  }

  let workspaceRoot = getWorkspaceRoot();
  // Normalize workspace root by removing trailing slash for consistent comparison
  if (workspaceRoot.endsWith("/")) {
    workspaceRoot = workspaceRoot.slice(0, -1);
  }

  // Relative path = workspace operation
  if (!isAbsolute(path) && !path.startsWith("~")) {
    const fullPath = resolve(workspaceRoot, path);

    // Verify it stays within workspace (double-check after resolve)
    // Use startsWith check with both fullPath and fullPath + "/" for edge cases
    if (!fullPath.startsWith(workspaceRoot) && fullPath !== workspaceRoot) {
      throw new Error("Path escapes workspace boundary");
    }

    // Resolve symlinks and re-check workspace boundary
    if (existsSync(fullPath)) {
      const realPath = realpathSync(fullPath);
      if (!realPath.startsWith(workspaceRoot) && realPath !== workspaceRoot) {
        throw new Error("Path escapes workspace boundary via symlink");
      }
    }

    return {
      fullPath,
      domain: "workspace",
      relativePath: path,
    };
  }

  // Absolute path or ~ path
  const absolutePath = expandHome(path);
  const normalizedPath = normalize(absolutePath);

  // Check forbidden paths
  if (isForbiddenPath(normalizedPath)) {
    throw new Error("Access to this path is forbidden for security reasons");
  }

  // Resolve symlinks and re-check forbidden paths
  if (existsSync(normalizedPath)) {
    const realPath = realpathSync(normalizedPath);
    if (isForbiddenPath(realPath)) {
      throw new Error("Access to this path is forbidden for security reasons");
    }
  }

  return {
    fullPath: normalizedPath,
    domain: "external",
  };
}

/**
 * Check if a path is within the workspace
 */
export function isWorkspacePath(path: string): boolean {
  try {
    const resolved = resolvePath(path);
    return resolved.domain === "workspace";
  } catch {
    return false;
  }
}

/**
 * Validate path for creation (checks forbidden extensions)
 */
export function validateForCreation(path: string): void {
  if (isForbiddenExtension(path)) {
    throw new Error(
      `Cannot create files with this extension for security reasons`
    );
  }
}

/**
 * Ensure temp directory exists
 */
export async function ensureTempDir(): Promise<void> {
  const tempPath = join(getWorkspaceRoot(), "temp");
  if (!existsSync(tempPath)) {
    await mkdir(tempPath, { recursive: true });
  }
}

/**
 * Generate backup path in temp folder with timestamp
 */
export function generateBackupPath(originalPath: string): string {
  const tempPath = join(getWorkspaceRoot(), "temp");
  const filename = basename(originalPath);
  // ISO 8601 format without colons/dots: 20260201T143022Z
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, -5) + 'Z';
  return join(tempPath, `${filename}_${timestamp}.bak`);
}
