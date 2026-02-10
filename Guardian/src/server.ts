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
  getScanLogSchema,
  handleGetScanLog,
} from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "guardian",
    version: "1.0.0",
  });

  registerTool(server, {
    name: "scan_content",
    description:
      "Scan content for prompt injection attacks using Granite Guardian. Accepts strings, objects, or arrays — recursively scans all text fields.\n\nArgs:\n  - content (string | object | array): The content to scan\n  - source (string, optional): Origin label for audit log (e.g., 'telegram', 'email')\n  - context (string, optional): Additional context about the content's origin\n\nReturns: { safe: boolean, confidence: number, threats: string[], explanation: string, scan_id: string }",
    inputSchema: scanContentSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    // SDK validates params against scanContentSchema before calling this handler
    handler: async (params) => {
      const scanResult = await handleScanContent(params);
      return createSuccess(scanResult);
    },
  });

  registerTool(server, {
    name: "get_scan_log",
    description:
      "Retrieve the audit log of past security scans. Returns results in reverse chronological order.\n\nArgs:\n  - scan_id (string, optional): Get a specific scan by ID\n  - limit (number, optional): Max entries to return (default: 50)\n  - threats_only (boolean, optional): Only return scans that detected threats\n\nReturns: { scans: ScanLogEntry[], total: number }",
    inputSchema: getScanLogSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    // SDK validates params against getScanLogSchema before calling this handler
    handler: async (params) => {
      const logResult = await handleGetScanLog(params);
      return createSuccess(logResult);
    },
  });

  return server;
}
