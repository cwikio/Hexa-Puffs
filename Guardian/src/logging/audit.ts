/**
 * Audit logging for Guardian scans
 * Logs to JSONL format for easy parsing and analysis
 */

import { createHash } from "node:crypto";
import { appendFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, "../../logs");
const AUDIT_FILE = join(LOGS_DIR, "audit.jsonl");

export interface ThreatInfo {
  path: string;
  type: string;
  snippet: string;
}

export interface AuditEntry {
  scan_id: string;
  timestamp: string;
  source: string;
  content_hash: string;
  content_length: number;
  safe: boolean;
  confidence: number;
  threats: ThreatInfo[];
  model: string;
  latency_ms: number;
}

export interface AuditLogQuery {
  scan_id?: string;
  limit?: number;
  threats_only?: boolean;
}

/**
 * Generate a UUID v4
 */
export function generateScanId(): string {
  return crypto.randomUUID();
}

/**
 * Hash content for privacy-preserving logging
 */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Ensure logs directory exists
 */
async function ensureLogsDir(): Promise<void> {
  if (!existsSync(LOGS_DIR)) {
    await mkdir(LOGS_DIR, { recursive: true });
  }
}

/**
 * Write an audit entry to the log file
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  await ensureLogsDir();
  const line = JSON.stringify(entry) + "\n";
  await appendFile(AUDIT_FILE, line, "utf-8");
}

/**
 * Read audit logs with optional filtering
 */
export async function readAuditLogs(
  query: AuditLogQuery = {}
): Promise<AuditEntry[]> {
  await ensureLogsDir();

  if (!existsSync(AUDIT_FILE)) {
    return [];
  }

  const content = await readFile(AUDIT_FILE, "utf-8");
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

  // Filter by scan_id if provided
  if (query.scan_id) {
    entries = entries.filter((e) => e.scan_id === query.scan_id);
  }

  // Filter to threats only if requested
  if (query.threats_only) {
    entries = entries.filter((e) => !e.safe);
  }

  // Sort by timestamp descending (most recent first)
  entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Apply limit
  const limit = query.limit ?? 50;
  return entries.slice(0, limit);
}

/**
 * Create an audit entry from scan results
 */
export function createAuditEntry(
  scanId: string,
  source: string,
  contentForHash: string,
  contentLength: number,
  safe: boolean,
  confidence: number,
  threats: ThreatInfo[],
  model: string,
  latencyMs: number
): AuditEntry {
  return {
    scan_id: scanId,
    timestamp: new Date().toISOString(),
    source,
    content_hash: hashContent(contentForHash),
    content_length: contentLength,
    safe,
    confidence,
    threats,
    model,
    latency_ms: latencyMs,
  };
}
