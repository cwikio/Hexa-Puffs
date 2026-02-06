/**
 * check_grant tool - Check if path is accessible
 */

import { z } from "zod";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { findGrantForPath } from "../db/grants.js";
import { expandHome } from "../utils/config.js";
import { isForbiddenPath } from "../utils/paths.js";

export const checkGrantSchema = z.object({
  path: z.string().describe("Absolute path to check access for"),
});

export type CheckGrantInput = z.infer<typeof checkGrantSchema>;

export interface CheckGrantData {
  has_access: boolean;
  permission?: "read" | "read-write" | "write";
  grant_id?: string;
  granted_path?: string;
  reason?: string;
}

export type CheckGrantResult = StandardResponse<CheckGrantData>;

export async function handleCheckGrant(
  input: CheckGrantInput
): Promise<CheckGrantData> {
  const absolutePath = expandHome(input.path);

  // Check forbidden paths
  if (isForbiddenPath(absolutePath)) {
    return {
      has_access: false,
      reason: "This path is forbidden for security reasons",
    };
  }

  const grant = await findGrantForPath(absolutePath);

  if (!grant) {
    return {
      has_access: false,
      reason: "No grant found for this path. Configure grants in fileops-mcp.yaml",
    };
  }

  return {
    has_access: true,
    permission: grant.permission,
    grant_id: grant.id,
    granted_path: grant.path,
  };
}
