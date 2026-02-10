/**
 * list_grants tool - List all active grants
 */

import { z } from "zod";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { listGrants, type Grant } from "../db/grants.js";

export const listGrantsSchema = z.object({});

export type ListGrantsInput = z.infer<typeof listGrantsSchema>;

export interface ListGrantsData {
  grants: Array<{
    id: string;
    path: string;
    permission: string;
    scope: string;
    granted_at: string;
    granted_by: string;
    access_count: number;
    last_accessed: string | null;
  }>;
  total: number;
}

export type ListGrantsResult = StandardResponse<ListGrantsData>;

export async function handleListGrants(
  _input: ListGrantsInput
): Promise<ListGrantsData> {
  const grants = await listGrants();

  return {
    grants: grants.map((g) => ({
      id: g.id,
      path: g.path,
      permission: g.permission,
      scope: g.scope,
      granted_at: g.granted_at,
      granted_by: g.granted_by,
      access_count: g.access_count,
      last_accessed: g.last_accessed,
    })),
    total: grants.length,
  };
}
