import { loadEnvSafely } from '@mcp/shared/Utils/env.js';
loadEnvSafely(import.meta.url);

import express, { Request, Response } from 'express';
import type { AddressInfo } from 'net';
import { loadConfig, validateProviderConfig, Config } from './config.js';
import { Agent } from './agent/index.js';
import { getProviderDisplayName } from './llm/providers.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker');

/**
 * Health check response type
 */
interface HealthResponse {
  status: 'ok' | 'error';
  service: string;
  version: string;
  uptime: number;
  orchestratorConnected?: boolean;
  config: {
    enabled: boolean;
    llmProvider: string;
    model: string;
    orchestratorUrl: string;
  };
  embeddingSelector?: {
    enabled: boolean;
    initialized: boolean;
    toolCount: number;
    lastSelection: { method: string; selectedCount: number; totalTools: number; topScore: number } | null;
  };
}

/**
 * Holder for the Agent instance. Routes are registered at server creation
 * but the agent is set later after initialization completes.
 */
let agentRef: Agent | null = null;

/**
 * Create and configure the Express HTTP server.
 * All routes are registered upfront so they're available as soon as
 * the server starts listening (avoids 404 race on /process-message).
 */
function createServer(config: Config, startTime: number) {
  const app = express();

  app.use(express.json());

  // Health check endpoint — only returns 200 once agentRef is set (fully initialized)
  // Deep health: verifies Orchestrator connectivity (non-blocking for speed)
  let lastOrchestratorCheck = false;
  let lastOrchestratorCheckAt = 0;
  const ORCHESTRATOR_CHECK_INTERVAL = 30_000; // Cache result for 30s

  app.get('/health', async (_req: Request, res: Response) => {
    if (!agentRef) {
      res.status(503).json({ status: 'initializing', service: 'thinker' });
      return;
    }

    // Periodically verify Orchestrator connectivity (cached to avoid latency on every health poll)
    if (Date.now() - lastOrchestratorCheckAt > ORCHESTRATOR_CHECK_INTERVAL) {
      lastOrchestratorCheck = await agentRef.checkOrchestratorHealth();
      lastOrchestratorCheckAt = Date.now();
    }

    const response: HealthResponse = {
      status: 'ok',
      service: 'thinker',
      version: '0.1.0',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      orchestratorConnected: lastOrchestratorCheck,
      config: {
        enabled: config.thinkerEnabled,
        llmProvider: config.llmProvider,
        model: config.llmProvider === 'groq' ? config.groqModel :
               config.llmProvider === 'lmstudio' ? (config.lmstudioModel || 'local-model') :
               config.ollamaModel,
        orchestratorUrl: config.orchestratorUrl,
      },
      embeddingSelector: agentRef.getEmbeddingSelectorStatus(),
    };
    res.json(response);
  });

  // Root endpoint
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      service: 'Thinker MCP',
      description: 'AI reasoning engine for Annabelle MCP ecosystem',
      endpoints: {
        health: '/health',
        processMessage: '/process-message',
        executeSkill: '/execute-skill',
      },
    });
  });

  // Process message endpoint (dispatched by Orchestrator)
  app.post('/process-message', async (req: Request, res: Response) => {
    if (!agentRef) {
      res.status(503).json({ success: false, error: 'Agent is still initializing' });
      return;
    }

    const { id, chatId, senderId, text, date, agentId } = req.body;

    if (!chatId || !text) {
      res.status(400).json({ success: false, error: 'chatId and text are required' });
      return;
    }

    logger.info(`Received message dispatch: chat=${chatId}, agent=${agentId || 'default'}`);

    try {
      const result = await agentRef.processMessage({
        id: id || `ext_${Date.now()}`,
        chatId,
        senderId: senderId || 'unknown',
        text,
        date: date || new Date().toISOString(),
      });

      res.json({
        success: result.success,
        response: result.response,
        toolsUsed: result.toolsUsed,
        totalSteps: result.totalSteps,
        error: result.error,
        ...(result.paused ? { paused: true } : {}),
      });
    } catch (error) {
      logger.error('Error processing dispatched message:', error);
      res.status(500).json({
        success: false,
        toolsUsed: [],
        totalSteps: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Execute skill endpoint (proactive task execution via Inngest/cron)
  app.post('/execute-skill', async (req: Request, res: Response) => {
    if (!agentRef) {
      res.status(503).json({ success: false, error: 'Agent is still initializing' });
      return;
    }

    const { skillId, skillName, instructions, maxSteps, noTools, requiredTools, chatId } = req.body;

    if (!instructions) {
      res.status(400).json({ success: false, error: 'instructions is required' });
      return;
    }

    logger.info(`Received skill execution request: skillId=${skillId}, maxSteps=${maxSteps}, chatId=${chatId || 'none'}`);

    try {
      const result = await agentRef.processProactiveTask(
        instructions,
        maxSteps || 10,
        noTools,
        requiredTools,
        skillName,
        chatId,
      );

      res.json({
        success: result.success,
        response: result.summary,
        summary: result.summary,
        toolsUsed: result.toolsUsed,
        totalSteps: result.totalSteps,
        error: result.error,
      });
    } catch (error) {
      logger.error('Error executing skill:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        summary: 'Skill execution failed',
      });
    }
  });

  // Clear session endpoint — wipe conversation history for a chat
  app.post('/clear-session', async (req: Request, res: Response) => {
    if (!agentRef) {
      res.status(503).json({ success: false, error: 'Agent is still initializing' });
      return;
    }

    const { chatId } = req.body;
    if (!chatId) {
      res.status(400).json({ success: false, error: 'chatId is required' });
      return;
    }

    try {
      await agentRef.clearSession(chatId);
      res.json({ success: true, message: `Session cleared for chat ${chatId}` });
    } catch (error) {
      logger.error('Error clearing session:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Cost control endpoints
  app.get('/cost-status', (_req: Request, res: Response) => {
    if (!agentRef) {
      res.json({ enabled: false });
      return;
    }
    const status = agentRef.getCostStatus();
    if (!status) {
      res.json({ enabled: false });
      return;
    }
    res.json(status);
  });

  app.post('/cost-resume', (req: Request, res: Response) => {
    if (!agentRef) {
      res.status(503).json({ success: false, error: 'Agent is still initializing' });
      return;
    }
    const resetWindow = req.body?.resetWindow === true;
    const result = agentRef.resumeFromCostPause(resetWindow);
    res.json(result);
  });

  return app;
}

/**
 * Main entry point
 */
async function main() {
  const startTime = Date.now();
  logger.info('Starting Thinker MCP...');
  logger.info('='.repeat(50));

  // Load and validate configuration
  let config: Config;
  try {
    config = loadConfig();
    const providerName = getProviderDisplayName(config.llmProvider);
    logger.info(`Configuration loaded:`);
    logger.info(`  - LLM Provider: ${providerName}`);
    logger.info(`  - Port: ${config.thinkerPort}`);
    logger.info(`  - Orchestrator: ${config.orchestratorUrl}`);
  } catch (error) {
    logger.error('Failed to load configuration:', error);
    process.exit(1);
  }

  // Check if Thinker is enabled
  if (!config.thinkerEnabled) {
    logger.info('Thinker is disabled (THINKER_ENABLED=false). Exiting.');
    process.exit(0);
  }

  // Validate provider-specific configuration
  try {
    validateProviderConfig(config);
  } catch (error) {
    logger.error('Provider configuration error:', error);
    process.exit(1);
  }

  // Create and start HTTP server
  const app = createServer(config, startTime);

  const server = app.listen(config.thinkerPort, '127.0.0.1', () => {
    const actualPort = (server.address() as AddressInfo).port;
    // Machine-parseable line for AgentManager — MUST stay on stdout
    process.stdout.write(`LISTENING_PORT=${actualPort}\n`);
    logger.info(`HTTP server running on port ${actualPort}`);
    logger.info(`Health check: http://localhost:${actualPort}/health`);
  });

  // Initialize agent and make it available to routes
  const agent = new Agent(config);

  try {
    await agent.initialize();
    logger.info('Agent initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize agent:', error);
    logger.info('Continuing with limited functionality...');
  }

  // Make agent available to all routes registered in createServer()
  agentRef = agent;

  // Thinker is now a passive agent runtime — Orchestrator dispatches messages via HTTP
  logger.info('='.repeat(50));
  logger.info('Waiting for dispatched messages from Orchestrator');

  // Periodic cleanup of old conversation states and session files
  setInterval(async () => {
    agent.cleanupOldConversations();
    try {
      await agent.cleanupOldSessions();
    } catch (error) {
      logger.warn('Session cleanup error (non-fatal):', error);
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  // Handle graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down Thinker — flushing conversation states...');
    agent.cleanupOldConversations(0); // Clear all timers
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    // Force exit after 5 seconds if server doesn't close
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run main
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
