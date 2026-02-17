/**
 * Audit logging for file operations
 * Logs to JSONL format
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { getConfig } from "../utils/config.js";

export interface AuditEntry {
  timestamp: string;
  operation: string;
  path: string;
  domain: "workspace" | "granted";
  grant_id: string | null;
  agent_id: string;
  session_id: string;
  success: boolean;
  size_bytes?: number;
  error?: string;
}

let auditLogPath: string | null = null;

function getAuditLogPath(): string {
  if (!auditLogPath) {
    auditLogPath = getConfig().audit.path;
  }
  return auditLogPath;
}

async function ensureLogDir(): Promise<void> {
  const logPath = getAuditLogPath();
  const dir = dirname(logPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Write an audit entry to the log
 */
export async function writeAuditEntry(entry: AuditEntry): Promise<void> {
  await ensureLogDir();
  const line = JSON.stringify(entry) + "\n";
  await appendFile(getAuditLogPath(), line, "utf-8");
}

/**
 * Create an audit entry helper
 */
export function createAuditEntry(
  operation: string,
  path: string,
  domain: "workspace" | "granted",
  success: boolean,
  options: {
    grant_id?: string;
    size_bytes?: number;
    error?: string;
  } = {}
): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    operation,
    path,
    domain,
    grant_id: options.grant_id ?? null,
    agent_id: process.env.AGENT_ID || "main",
    session_id: process.env.SESSION_ID || "unknown",
    success,
    size_bytes: options.size_bytes,
    error: options.error,
  };
}

/**
 * Read audit log entries with optional filters
 */
export async function readAuditLog(query: {
  path_filter?: string;
  operation_filter?: string;
  date_from?: string;
  limit?: number;
}): Promise<AuditEntry[]> {
  await ensureLogDir();
  const logPath = getAuditLogPath();

  if (!existsSync(logPath)) {
    return [];
  }

  const content = await readFile(logPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  let entries: AuditEntry[] = lines
    .map((line) => {
      try {
        return JSON.parse(line) as AuditEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is AuditEntry => e !== null);

  // Apply filters
  if (query.path_filter) {
    entries = entries.filter((e) => e.path.startsWith(query.path_filter!));
  }

  if (query.operation_filter) {
    entries = entries.filter((e) => e.operation === query.operation_filter);
  }

  if (query.date_from) {
    const fromDate = new Date(query.date_from);
    entries = entries.filter((e) => new Date(e.timestamp) >= fromDate);
  }

  // Sort by timestamp descending (most recent first)
  entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Apply limit
  const limit = query.limit ?? 100;
  return entries.slice(0, limit);
}
