#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer as createHttpServer } from 'http';
import { initializeServer } from './server.js';
import { getConfig } from './config/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { startInngestServer } from './jobs/inngest-server.js';
import { getOrchestrator } from './core/orchestrator.js';
import { handleListTools, handleCallTool } from './core/http-handlers.js';

async function main(): Promise<void> {
  const config = getConfig();

  logger.info('Starting Annabelle Orchestrator', {
    transport: config.transport,
    port: config.port,
  });

  try {
    const server = await initializeServer();

    // Start Inngest server if jobs are enabled
    if (config.jobs?.enabled !== false) {
      const jobsPort = config.jobs?.port || 3000;
      const inngestDevUrl = process.env.INNGEST_DEV_SERVER_URL || 'http://localhost:8288';
      logger.info('Starting Inngest HTTP endpoint', { port: jobsPort, devServer: inngestDevUrl });
      startInngestServer(jobsPort);
    }

    if (config.transport === 'stdio') {
      // Standard MCP transport via stdio
      const transport = new StdioServerTransport();
      await server.connect(transport);
      logger.info('Orchestrator running on stdio transport');
    } else {
      // HTTP/SSE transport for testing
      // Get orchestrator for HTTP handlers
      const orchestrator = await getOrchestrator();
      const toolRouter = orchestrator.getToolRouter();

      const httpServer = createHttpServer(async (req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        // Health check endpoint
        if (req.url === '/health' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        // Structured status endpoint
        if (req.url === '/status' && req.method === 'GET') {
          const status = orchestrator.getStatus();
          const haltState = orchestrator.getHaltManager().getState();
          const toolCount = orchestrator.getAvailableTools().length;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: status.ready ? 'ready' : 'initializing',
            uptime: status.uptime,
            mcpServers: status.mcpServers,
            agents: status.agents,
            toolCount,
            sessions: status.sessions,
            security: status.security,
            halt: haltState,
          }));
          return;
        }

        // REST API: List tools
        if (req.url === '/tools/list' && req.method === 'GET') {
          await handleListTools(toolRouter, res);
          return;
        }

        // REST API: Call tool
        if (req.url === '/tools/call' && req.method === 'POST') {
          await handleCallTool(toolRouter, req, res);
          return;
        }

        // REST API: Resume a cost-paused agent
        const resumeMatch = req.url?.match(/^\/agents\/([^/]+)\/resume$/);
        if (resumeMatch && req.method === 'POST') {
          const agentId = resumeMatch[1];
          const agentManager = orchestrator.getAgentManager();
          if (!agentManager) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Agent manager not available (single-agent mode)' }));
            return;
          }
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk; });
          req.on('end', async () => {
            const resetWindow = body ? JSON.parse(body)?.resetWindow === true : false;
            const result = await agentManager.resumeAgent(agentId, resetWindow);
            res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          });
          return;
        }

        // REST API: Kill switch
        if (req.url === '/kill' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk; });
          req.on('end', async () => {
            const target = body ? JSON.parse(body)?.target : undefined;
            if (!target) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: 'Missing target (all | thinker | telegram | inngest)' }));
              return;
            }
            const haltManager = orchestrator.getHaltManager();
            const agentManager = orchestrator.getAgentManager();

            if (target === 'all') {
              if (agentManager) {
                for (const agent of agentManager.getStatus()) {
                  if (!agent.paused) agentManager.markPaused(agent.agentId, 'manual kill');
                }
              }
              orchestrator.stopChannelPolling();
              haltManager.halt('manual kill', ['thinker', 'telegram', 'inngest']);
            } else if (target === 'thinker') {
              if (agentManager) {
                for (const agent of agentManager.getStatus()) {
                  if (!agent.paused) agentManager.markPaused(agent.agentId, 'manual kill');
                }
              }
              haltManager.addTarget('thinker', 'manual kill');
            } else if (target === 'telegram') {
              orchestrator.stopChannelPolling();
              haltManager.addTarget('telegram', 'manual kill');
            } else if (target === 'inngest') {
              haltManager.addTarget('inngest', 'manual kill');
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: `Unknown target: ${target}` }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: `${target} killed`, halted: haltManager.getState() }));
          });
          return;
        }

        // REST API: Resume
        if (req.url === '/resume' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk; });
          req.on('end', async () => {
            const target = body ? JSON.parse(body)?.target : undefined;
            if (!target) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: 'Missing target (all | thinker | telegram | inngest)' }));
              return;
            }
            const haltManager = orchestrator.getHaltManager();
            const agentManager = orchestrator.getAgentManager();

            if (target === 'all') {
              if (agentManager) {
                for (const agent of agentManager.getStatus()) {
                  if (agent.paused) await agentManager.resumeAgent(agent.agentId, true);
                }
              }
              await orchestrator.restartChannelPolling();
              haltManager.resumeAll();
            } else if (target === 'thinker') {
              if (agentManager) {
                for (const agent of agentManager.getStatus()) {
                  if (agent.paused) await agentManager.resumeAgent(agent.agentId, true);
                }
              }
              haltManager.removeTarget('thinker');
            } else if (target === 'telegram') {
              await orchestrator.restartChannelPolling();
              haltManager.removeTarget('telegram');
            } else if (target === 'inngest') {
              haltManager.removeTarget('inngest');
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: `Unknown target: ${target}` }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: `${target} resumed`, halted: haltManager.getState() }));
          });
          return;
        }

        // SSE endpoint
        if (req.url === '/sse' && req.method === 'GET') {
          logger.debug('SSE connection established');
          const transport = new SSEServerTransport('/message', res);
          await server.connect(transport);
          return;
        }

        // Message endpoint for SSE (handled internally by SSEServerTransport)
        if (req.url === '/message' && req.method === 'POST') {
          res.writeHead(200);
          res.end();
          return;
        }

        // Not found
        res.writeHead(404);
        res.end('Not found');
      });

      await new Promise<void>((resolve) => {
        httpServer.listen(config.port, () => {
          logger.info(`Orchestrator running on http://localhost:${config.port}`);
          logger.info('Endpoints:');
          logger.info(`  GET  /health      - Health check`);
          logger.info(`  GET  /status      - Structured system status`);
          logger.info(`  GET  /tools/list  - List available tools (REST API)`);
          logger.info(`  POST /tools/call  - Execute a tool (REST API)`);
          logger.info(`  POST /agents/:id/resume - Resume a cost-paused agent`);
          logger.info(`  POST /kill        - Kill switch (target: all | thinker | telegram | inngest)`);
          logger.info(`  POST /resume      - Resume (target: all | thinker | telegram | inngest)`);
          logger.info(`  GET  /sse         - SSE connection`);
          logger.info(`  POST /message     - SSE messages`);
          resolve();
        });
      });

      // Start agents AFTER HTTP server is listening so Thinker can connect back
      await orchestrator.startAgents();

      // Graceful shutdown
      process.on('SIGINT', () => {
        logger.info('Shutting down...');
        httpServer.close(() => {
          logger.info('Server closed');
          process.exit(0);
        });
      });

      process.on('SIGTERM', () => {
        logger.info('Shutting down...');
        httpServer.close(() => {
          logger.info('Server closed');
          process.exit(0);
        });
      });
    }
  } catch (error) {
    logger.error('Failed to start orchestrator', { error });
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Unhandled error', { error });
  process.exit(1);
});
