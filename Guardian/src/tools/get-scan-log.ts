/**
 * get_scan_log tool - Retrieve audit log of past scans
 */

import { z } from "zod";
import { readAuditLogs, type AuditEntry } from "../logging/audit.js";

export const getScanLogSchema = z.object({
  scan_id: z
    .string()
    .optional()
    .describe("Get a specific scan by its ID"),
  limit: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe("Maximum number of scans to return (default: 50, max: 1000)"),
  threats_only: z
    .boolean()
    .optional()
    .describe("Only return scans where threats were detected"),
});

export type GetScanLogInput = z.infer<typeof getScanLogSchema>;

export interface ScanLogEntry {
  scan_id: string;
  timestamp: string;
  source: string;
  safe: boolean;
  threats: string[];
  content_hash: string;
}

export interface GetScanLogResult {
  scans: ScanLogEntry[];
  total: number;
}

/**
 * Transform audit entry to simplified log entry
 */
function toLogEntry(entry: AuditEntry): ScanLogEntry {
  return {
    scan_id: entry.scan_id,
    timestamp: entry.timestamp,
    source: entry.source,
    safe: entry.safe,
    threats: entry.threats.map((t) => t.type),
    content_hash: entry.content_hash,
  };
}

/**
 * Handle get_scan_log tool
 */
export async function handleGetScanLog(
  input: GetScanLogInput
): Promise<GetScanLogResult> {
  const entries = await readAuditLogs({
    scan_id: input.scan_id,
    limit: input.limit,
    threats_only: input.threats_only,
  });

  return {
    scans: entries.map(toLogEntry),
    total: entries.length,
  };
}
