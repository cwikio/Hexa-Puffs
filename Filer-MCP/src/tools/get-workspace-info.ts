/**
 * get_workspace_info tool - Get workspace location and statistics
 */

import { z } from "zod";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { getWorkspaceStats } from "../utils/workspace.js";

export const getWorkspaceInfoSchema = z.object({});

export type GetWorkspaceInfoInput = z.infer<typeof getWorkspaceInfoSchema>;

export interface GetWorkspaceInfoData {
  workspace_path: string;
  total_files: number;
  total_size_mb: number;
  temp_files: number;
}

export type GetWorkspaceInfoResult = StandardResponse<GetWorkspaceInfoData>;

export async function handleGetWorkspaceInfo(
  _input: GetWorkspaceInfoInput
): Promise<GetWorkspaceInfoData> {
  const stats = await getWorkspaceStats();

  return {
    workspace_path: stats.workspace_path,
    total_files: stats.total_files,
    total_size_mb: Math.round((stats.total_size_bytes / (1024 * 1024)) * 100) / 100,
    temp_files: stats.temp_files,
  };
}
