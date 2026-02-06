/**
 * Guardian MCP Server
 * Provides security scanning tools for prompt injection detection
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import { createSuccess } from "@mcp/shared/Types/StandardResponse.js";
import {
  scanContentSchema,
  handleScanContent,
  type ScanContentInput,
  getScanLogSchema,
  handleGetScanLog,
  type GetScanLogInput,
} from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "guardian",
    version: "1.0.0",
  });

  registerTool(server, {
    name: "scan_content",
    description:
      "Scans content for prompt injection attacks using Granite Guardian. Accepts strings, objects, or arrays - recursively scans all text fields.",
    inputSchema: scanContentSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    // SDK validates params against scanContentSchema before calling this handler
    handler: async (params) => {
      const scanResult = await handleScanContent(params as ScanContentInput);
      return createSuccess(scanResult);
    },
  });

  registerTool(server, {
    name: "get_scan_log",
    description:
      "Retrieve audit log of past security scans. Can filter by scan ID or show only threats.",
    inputSchema: getScanLogSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    // SDK validates params against getScanLogSchema before calling this handler
    handler: async (params) => {
      const logResult = await handleGetScanLog(params as GetScanLogInput);
      return createSuccess(logResult);
    },
  });

  return server;
}
