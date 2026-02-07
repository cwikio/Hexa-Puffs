import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { getOrchestrator } from './core/orchestrator.js';
import { ToolRouter } from './core/tool-router.js';
import { SecurityError } from './utils/errors.js';
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
} from './tools/index.js';

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
 * If the response isn't valid JSON, appends hints as a text footer.
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

export function createServerWithRouter(toolRouter: ToolRouter): Server {
  const server = new Server(
    {
      name: 'annabelle-orchestrator',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools - combine passthrough + custom tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug('Listing tools');

    // Get passthrough tools from MCPs
    const passthroughTools = toolRouter.getToolDefinitions();

    // Combine with custom tools
    const allTools = [...passthroughTools, ...customToolDefinitions];

    logger.info(`Exposing ${allTools.length} tools (${passthroughTools.length} passthrough, ${customToolDefinitions.length} custom)`);

    return {
      tools: allTools,
    };
  });

  // Handle tool calls - try passthrough first, then custom handlers
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info('Tool called', { name });

    try {
      let result: StandardResponse;

      // Check if it's a passthrough tool
      if (toolRouter.hasRoute(name)) {
        const routeInfo = toolRouter.getRouteInfo(name);
        logger.debug(`Routing to ${routeInfo?.mcpName}.${routeInfo?.originalName}`);

        const callResult = await toolRouter.routeToolCall(
          name,
          (args as Record<string, unknown>) || {}
        );

        if (callResult.success) {
          // Child MCP returns { content: [{ type: "text", text: "..." }] }
          // Pass through the inner text directly to avoid double-wrapping
          const mcpResponse = callResult.content as {
            content?: Array<{ type: string; text?: string }>;
          };
          const innerText = mcpResponse?.content?.[0]?.text;
          if (innerText) {
            const enriched = enrichWithHints(innerText, toolRouter, name);
            return {
              content: [{ type: 'text' as const, text: enriched }],
            };
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
        logger.warn('Unknown tool called', { name });
        const availableTools = [
          ...toolRouter.getToolDefinitions().map((t) => t.name),
          ...customToolDefinitions.map((t) => t.name),
        ];
        result = {
          success: false,
          error: `Unknown tool: ${name}. Available tools: ${availableTools.join(', ')}`,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      // Guardian security blocks
      if (error instanceof SecurityError) {
        logger.warn('Request blocked by Guardian', { name, reason: error.message });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                blocked: true,
                error: error.message,
              }),
            },
          ],
          isError: true,
        };
      }

      logger.error('Tool call failed', { name, error });
      return {
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
      };
    }
  });

  return server;
}

export async function initializeServer(): Promise<Server> {
  // Initialize the orchestrator first
  const orchestrator = await getOrchestrator();

  // Get the tool router
  const toolRouter = orchestrator.getToolRouter();

  // Log discovered routes
  const routes = toolRouter.getAllRoutes();
  logger.info(`Tool router initialized with ${routes.length} routes:`);
  for (const route of routes) {
    logger.info(`  ${route.exposedName} → ${route.mcpName}.${route.originalName}`);
  }

  // Create and return the server with the router
  return createServerWithRouter(toolRouter);
}
