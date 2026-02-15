import type { ToolRouter } from '../routing/tool-router.js';
import type { IncomingMessage, ServerResponse } from 'http';
import { logger } from '@mcp/shared/Utils/logger.js';
import { SecurityError } from '../utils/errors.js';

// ─── Simple in-memory rate limiter (per-IP, sliding window) ──────
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 120;  // 120 requests per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isRateLimited(ip: string): boolean {
  // Loopback traffic is already protected by auth token — no rate limit
  if (LOOPBACK_IPS.has(ip)) return false;

  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

// Periodic cleanup of expired entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000).unref();
import {
  statusToolDefinition,
  handleStatus,
  jobToolDefinitions,
  handleQueueTask,
  handleGetJobStatus,
  handleTriggerBackfill,
  spawnSubagentToolDefinition,
  handleSpawnSubagent,
  getToolCatalogToolDefinition,
  handleGetToolCatalog,
  type StandardResponse,
} from '../tools/index.js';


// Custom tools that are not passthrough (orchestrator-specific)
const customToolDefinitions = [statusToolDefinition, ...jobToolDefinitions, spawnSubagentToolDefinition, getToolCatalogToolDefinition];

// Custom tool handlers (simple tools that don't need caller context)
const customToolHandlers: Record<
  string,
  (args: unknown) => Promise<StandardResponse>
> = {
  get_status: handleStatus,
  queue_task: handleQueueTask,
  get_job_status: handleGetJobStatus,
  trigger_backfill: handleTriggerBackfill,
  get_tool_catalog: handleGetToolCatalog,
};

// Context-aware tool handlers (need callerAgentId)
const contextAwareToolHandlers: Record<
  string,
  (args: unknown, callerAgentId?: string) => Promise<StandardResponse>
> = {
  spawn_subagent: handleSpawnSubagent,
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
    res.end(JSON.stringify({ tools: allTools, mcpMetadata: toolRouter.getMCPMetadata() }));
  } catch (error) {
    logger.error('Failed to list tools via HTTP', { error });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to list tools' }));
  }
}

/**
 * Handle POST /tools/call - Execute a tool
 */
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

export async function handleCallTool(
  toolRouter: ToolRouter,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Rate limit by remote IP
  const clientIp = req.socket.remoteAddress || 'unknown';
  if (isRateLimited(clientIp)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Too many requests' }));
    return;
  }

  let body = '';
  let bodySize = 0;

  req.on('data', (chunk) => {
    bodySize += chunk.length;
    if (bodySize > MAX_BODY_SIZE) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request body too large' }));
      req.destroy();
      return;
    }
    body += chunk;
  });

  req.on('end', async () => {
    if (bodySize > MAX_BODY_SIZE) return;
    try {
      const { name, arguments: args } = JSON.parse(body) as {
        name: string;
        arguments: Record<string, unknown>;
      };

      const callerAgentId = req.headers['x-agent-id'] as string | undefined;
      logger.debug(`HTTP /tools/call - executing ${name}`, { callerAgentId });

      let result: StandardResponse;

      // Check if it's a passthrough tool
      if (toolRouter.hasRoute(name)) {
        const routeInfo = toolRouter.getRouteInfo(name);
        logger.debug(`Routing to ${routeInfo?.mcpName}.${routeInfo?.originalName}`);

        // Normalization + cron validation now handled inside toolRouter.routeToolCall()

        const callResult = await toolRouter.routeToolCall(name, args || {});

        if (callResult.success) {
          // Child MCP returns { content: [{ type: "text", text: "..." }] }
          // Pass through the inner text directly to avoid double-wrapping
          const mcpResponse = callResult.content as {
            content?: Array<{ type: string; text?: string }>;
          };
          let innerText = mcpResponse?.content?.[0]?.text;

          // Validate required_tools and execution_plan when storing/updating a skill
          if (innerText && (name === 'memory_store_skill' || name === 'memory_update_skill')) {
            const reqTools = args?.required_tools;
            if (Array.isArray(reqTools) && reqTools.length > 0) {
              const unknown = reqTools.filter((t) => typeof t === 'string' && !toolRouter.hasRoute(t) && !customToolHandlers[t]);
              if (unknown.length > 0) {
                logger.warn('Skill created with unknown required_tools', { unknown });
                try {
                  const parsed = JSON.parse(innerText);
                  parsed.warning = `These required_tools were not found and the skill may fail: ${unknown.join(', ')}`;
                  innerText = JSON.stringify(parsed);
                } catch { /* non-JSON response, skip */ }
              }
            }

            // Validate execution_plan tool names exist in ToolRouter
            const plan = args?.execution_plan;
            if (Array.isArray(plan) && plan.length > 0) {
              const planTools = plan
                .filter((step): step is Record<string, unknown> => !!step && typeof step === 'object')
                .map(step => step.toolName)
                .filter((t): t is string => typeof t === 'string');
              const unknownPlanTools = planTools.filter(t => !toolRouter.hasRoute(t) && !customToolHandlers[t]);
              if (unknownPlanTools.length > 0) {
                logger.warn('Skill execution_plan references unknown tools', { unknownPlanTools });
                try {
                  const parsed = JSON.parse(innerText);
                  parsed.warning = (parsed.warning ? parsed.warning + '. ' : '') +
                    `execution_plan references unknown tools: ${unknownPlanTools.join(', ')}`;
                  innerText = JSON.stringify(parsed);
                } catch { /* non-JSON response, skip */ }
              }
            }
          }

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
      // Check if it's a context-aware custom tool (needs callerAgentId)
      else if (contextAwareToolHandlers[name]) {
        result = await contextAwareToolHandlers[name](args, callerAgentId);
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
      if (error instanceof SecurityError) {
        logger.warn('Request blocked by Guardian via HTTP', { error: error.message });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
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
          })
        );
        return;
      }

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
