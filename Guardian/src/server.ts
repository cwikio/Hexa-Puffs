/**
 * Guardian MCP Server
 * Provides security scanning tools for prompt injection detection
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

  // scan_content - Main scanning tool
  server.tool(
    "scan_content",
    "Scans content for prompt injection attacks using Granite Guardian. Accepts strings, objects, or arrays - recursively scans all text fields.",
    scanContentSchema.shape,
    async (params) => {
      const result = scanContentSchema.safeParse(params);
      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Invalid parameters: ${result.error.message}`,
              }),
            },
          ],
        };
      }

      try {
        const scanResult = await handleScanContent(result.data);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(scanResult, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error:
                  error instanceof Error ? error.message : "Unknown error",
                safe: false,
              }),
            },
          ],
        };
      }
    }
  );

  // get_scan_log - Audit log retrieval
  server.tool(
    "get_scan_log",
    "Retrieve audit log of past security scans. Can filter by scan ID or show only threats.",
    getScanLogSchema.shape,
    async (params) => {
      const result = getScanLogSchema.safeParse(params);
      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Invalid parameters: ${result.error.message}`,
              }),
            },
          ],
        };
      }

      try {
        const logResult = await handleGetScanLog(result.data);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(logResult, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error:
                  error instanceof Error ? error.message : "Unknown error",
              }),
            },
          ],
        };
      }
    }
  );

  return server;
}
