/**
 * request_grant tool - Request access to a path
 *
 * Note: In MVP, grants are configured via config file.
 * This tool returns an error explaining how to configure grants.
 */

import { z } from "zod";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { expandHome } from "../utils/config.js";
import { isForbiddenPath } from "../utils/paths.js";
import { findGrantForPath } from "../db/grants.js";

export const requestGrantSchema = z.object({
  path: z.string().describe("Absolute path to request access for"),
  permission: z
    .enum(["read", "read-write"])
    .describe("Type of access needed"),
  reason: z
    .string()
    .describe("Why AI needs access (would be shown to user for approval)"),
});

export type RequestGrantInput = z.infer<typeof requestGrantSchema>;

export interface RequestGrantData {
  status: "pending" | "granted" | "denied" | "configure_required";
  grant_id?: string;
  message: string;
}

export type RequestGrantResult = StandardResponse<RequestGrantData>;

export async function handleRequestGrant(
  input: RequestGrantInput
): Promise<RequestGrantData> {
  const absolutePath = expandHome(input.path);

  // Check if path is forbidden
  if (isForbiddenPath(absolutePath)) {
    return {
      status: "denied",
      message: "This path is forbidden for security reasons",
    };
  }

  // Check if grant already exists
  const existingGrant = await findGrantForPath(absolutePath);
  if (existingGrant) {
    return {
      status: "granted",
      grant_id: existingGrant.id,
      message: `Access already granted via existing grant for: ${existingGrant.path}`,
    };
  }

  // MVP: Interactive grant approval is not implemented
  // Grants must be configured via fileops-mcp.yaml
  return {
    status: "configure_required",
    message: `Interactive grant approval is not yet implemented.
To grant access to ${absolutePath}, add it to fileops-mcp.yaml:

grants:
  - path: ${absolutePath}
    permission: ${input.permission}

Then restart the Filer MCP server.`,
  };
}
