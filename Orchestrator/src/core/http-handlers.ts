import type { ToolRouter } from './tool-router.js';
import type { IncomingMessage, ServerResponse } from 'http';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  statusToolDefinition,
  handleStatus,
  jobToolDefinitions,
  handleCreateJob,
  handleQueueTask,
  handleListJobs,
  handleGetJobStatus,
  handleDeleteJob,
  type StandardResponse,
} from '../tools/index.js';

// Custom tools that are not passthrough (orchestrator-specific)
const customToolDefinitions = [statusToolDefinition, ...jobToolDefinitions];

// Custom tool handlers
const customToolHandlers: Record<
  string,
  (args: unknown) => Promise<StandardResponse>
> = {
  get_status: handleStatus,
  create_job: handleCreateJob,
  queue_task: handleQueueTask,
  list_jobs: handleListJobs,
  get_job_status: handleGetJobStatus,
  delete_job: handleDeleteJob,
};

/**
 * Inject workflow hints into a successful MCP response JSON string.
 */
function enrichWithHints(innerText: string, toolRouter: ToolRouter, toolName: string): string {
  const hints = toolRouter.getResponseHints(toolName);
  if (!hints) return innerText;

  try {
    const parsed: unknown = JSON.parse(innerText);
    if (parsed && typeof parsed === 'object') {
      (parsed as Record<string, unknown>)._hints = hints;
      return JSON.stringify(parsed);
    }
  } catch {
    // Not JSON — append as text footer
  }
  const footer = hints.tip
    ? `\n[Hints: suggest=${hints.suggest.join(', ')} — ${hints.tip}]`
    : `\n[Hints: suggest=${hints.suggest.join(', ')}]`;
  return innerText + footer;
}

/**
 * Handle GET /tools/list - List all available tools
 */
export async function handleListTools(
  toolRouter: ToolRouter,
  res: ServerResponse
): Promise<void> {
  try {
    const passthroughTools = toolRouter.getToolDefinitions();
    const allTools = [...passthroughTools, ...customToolDefinitions];

    logger.debug(`HTTP /tools/list - returning ${allTools.length} tools`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tools: allTools }));
  } catch (error) {
    logger.error('Failed to list tools via HTTP', { error });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to list tools' }));
  }
}

/**
 * Handle POST /tools/call - Execute a tool
 */
export async function handleCallTool(
  toolRouter: ToolRouter,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let body = '';

  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', async () => {
    try {
      const { name, arguments: args } = JSON.parse(body) as {
        name: string;
        arguments: Record<string, unknown>;
      };

      logger.debug(`HTTP /tools/call - executing ${name}`);

      let result: StandardResponse;

      // Check if it's a passthrough tool
      if (toolRouter.hasRoute(name)) {
        const routeInfo = toolRouter.getRouteInfo(name);
        logger.debug(`Routing to ${routeInfo?.mcpName}.${routeInfo?.originalName}`);

        const callResult = await toolRouter.routeToolCall(name, args || {});

        if (callResult.success) {
          // Child MCP returns { content: [{ type: "text", text: "..." }] }
          // Pass through the inner text directly to avoid double-wrapping
          const mcpResponse = callResult.content as {
            content?: Array<{ type: string; text?: string }>;
          };
          const innerText = mcpResponse?.content?.[0]?.text;
          if (innerText) {
            const enriched = enrichWithHints(innerText, toolRouter, name);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                content: [{ type: 'text', text: enriched }],
              })
            );
            return;
          }
          // Fallback for non-standard responses
          result = {
            success: true,
            data: callResult.content,
          };
        } else {
          result = {
            success: false,
            error: callResult.error || 'Tool call failed',
          };
        }
      }
      // Check if it's a custom tool
      else if (customToolHandlers[name]) {
        result = await customToolHandlers[name](args);
      }
      // Unknown tool
      else {
        logger.warn('Unknown tool called via HTTP', { name });
        const availableTools = [
          ...toolRouter.getToolDefinitions().map((t) => t.name),
          ...customToolDefinitions.map((t) => t.name),
        ];
        result = {
          success: false,
          error: `Unknown tool: ${name}. Available tools: ${availableTools.join(', ')}`,
        };
      }

      // Return in MCP-compatible format
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        })
      );
    } catch (error) {
      logger.error('Tool call failed via HTTP', { error });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        })
      );
    }
  });
}
