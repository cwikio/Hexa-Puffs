/**
 * get_audit_log tool - Get file operation audit log
 */

import { z } from "zod";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { readAuditLog, type AuditEntry } from "../logging/audit.js";

export const getAuditLogSchema = z.object({
  path_filter: z
    .string()
    .optional()
    .describe("Filter entries by path prefix"),
  operation_filter: z
    .string()
    .optional()
    .describe("Filter by operation type (e.g., read_file, create_file)"),
  date_from: z
    .string()
    .optional()
    .describe("Filter entries from this date (ISO format)"),
  limit: z
    .number()
    .default(100)
    .describe("Maximum number of entries to return"),
});

export type GetAuditLogInput = z.infer<typeof getAuditLogSchema>;

export interface GetAuditLogData {
  entries: AuditEntry[];
  total_returned: number;
}

export type GetAuditLogResult = StandardResponse<GetAuditLogData>;

export async function handleGetAuditLog(
  input: GetAuditLogInput
): Promise<GetAuditLogData> {
  const entries = await readAuditLog({
    path_filter: input.path_filter,
    operation_filter: input.operation_filter,
    date_from: input.date_from,
    limit: input.limit,
  });

  return {
    entries,
    total_returned: entries.length,
  };
}
