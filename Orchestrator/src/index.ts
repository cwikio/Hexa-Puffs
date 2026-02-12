#!/usr/bin/env node

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer as createHttpServer } from 'http';
import { initializeServer } from './server.js';
import { getConfig } from './config/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { startInngestServer } from './jobs/inngest-server.js';
import { getOrchestrator } from './core/orchestrator.js';
import { handleListTools, handleCallTool } from './core/http-handlers.js';

// Read system version from root VERSION file
const __dirname = dirname(fileURLToPath(import.meta.url));
let systemVersion = 'unknown';
try {
  systemVersion = readFileSync(resolve(__dirname, '../../../VERSION'), 'utf-8').trim();
} catch {
  // VERSION file not found — running from non-standard location
}

const ANNABELLE_TOKEN = process.env.ANNABELLE_TOKEN;

async function main(): Promise<void> {
  const config = getConfig();

  if (config.transport !== 'stdio' && !ANNABELLE_TOKEN) {
    logger.warn('ANNABELLE_TOKEN is not set — HTTP endpoints are unauthenticated. Run via start-all.sh for automatic token generation.');
  }

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
        // CORS: restrict to localhost origins
        const origin = req.headers.origin;
        if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Annabelle-Token');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        // Health check endpoint (always open — no token required)
        if (req.url === '/health' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', version: systemVersion }));
          return;
        }

        // Token auth: reject non-/health requests without valid token
        if (ANNABELLE_TOKEN && req.headers['x-annabelle-token'] !== ANNABELLE_TOKEN) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        // Structured status endpoint
        if (req.url === '/status' && req.method === 'GET') {
          const status = orchestrator.getStatus();
          const haltState = orchestrator.getHaltManager().getState();
          const toolCount = orchestrator.getAvailableTools().length;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            version: systemVersion,
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
        httpServer.listen(config.port, '127.0.0.1', () => {
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
      const shutdown = () => {
        logger.info('Shutting down...');
        orchestrator.stopExternalMCPWatcher();
        orchestrator.stopHealthMonitoring();
        orchestrator.stopChannelPolling();
        httpServer.close(() => {
          logger.info('Server closed');
          process.exit(0);
        });
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
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
