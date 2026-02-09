import 'dotenv/config';
import express, { Request, Response } from 'express';
import type { AddressInfo } from 'net';
import { loadConfig, validateProviderConfig, Config } from './config.js';
import { Agent } from './agent/index.js';
import { getProviderDisplayName } from './llm/providers.js';

// Override console methods to include ISO timestamps
const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);
const originalWarn = console.warn.bind(console);

console.log = (...args: unknown[]) => originalLog(`[${new Date().toISOString()}]`, ...args);
console.error = (...args: unknown[]) => originalError(`[${new Date().toISOString()}] ERROR:`, ...args);
console.warn = (...args: unknown[]) => originalWarn(`[${new Date().toISOString()}] WARN:`, ...args);

/**
 * Health check response type
 */
interface HealthResponse {
  status: 'ok' | 'error';
  service: string;
  version: string;
  uptime: number;
  config: {
    enabled: boolean;
    llmProvider: string;
    model: string;
    orchestratorUrl: string;
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
  app.get('/health', (_req: Request, res: Response) => {
    if (!agentRef) {
      res.status(503).json({ status: 'initializing', service: 'thinker' });
      return;
    }
    const response: HealthResponse = {
      status: 'ok',
      service: 'thinker',
      version: '0.1.0',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      config: {
        enabled: config.thinkerEnabled,
        llmProvider: config.llmProvider,
        model: config.llmProvider === 'groq' ? config.groqModel :
               config.llmProvider === 'lmstudio' ? (config.lmstudioModel || 'local-model') :
               config.ollamaModel,
        orchestratorUrl: config.orchestratorUrl,
      },
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

    console.log(`Received message dispatch: chat=${chatId}, agent=${agentId || 'default'}`);

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
      console.error('Error processing dispatched message:', error);
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

    const { skillId, instructions, maxSteps, notifyOnCompletion, noTools } = req.body;

    if (!instructions) {
      res.status(400).json({ success: false, error: 'instructions is required' });
      return;
    }

    console.log(`Received skill execution request: skillId=${skillId}, maxSteps=${maxSteps}`);

    try {
      const notifyChatId = notifyOnCompletion
        ? (config.defaultNotifyChatId || undefined)
        : undefined;

      const result = await agentRef.processProactiveTask(
        instructions,
        maxSteps || 10,
        notifyChatId,
        noTools,
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
      console.error('Error executing skill:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        summary: 'Skill execution failed',
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
  console.log('Starting Thinker MCP...');
  console.log('='.repeat(50));

  // Load and validate configuration
  let config: Config;
  try {
    config = loadConfig();
    const providerName = getProviderDisplayName(config.llmProvider);
    console.log(`Configuration loaded:`);
    console.log(`  - LLM Provider: ${providerName}`);
    console.log(`  - Port: ${config.thinkerPort}`);
    console.log(`  - Orchestrator: ${config.orchestratorUrl}`);
  } catch (error) {
    console.error('Failed to load configuration:', error);
    process.exit(1);
  }

  // Check if Thinker is enabled
  if (!config.thinkerEnabled) {
    console.log('Thinker is disabled (THINKER_ENABLED=false). Exiting.');
    process.exit(0);
  }

  // Validate provider-specific configuration
  try {
    validateProviderConfig(config);
  } catch (error) {
    console.error('Provider configuration error:', error);
    process.exit(1);
  }

  // Create and start HTTP server
  const app = createServer(config, startTime);

  const server = app.listen(config.thinkerPort, () => {
    const actualPort = (server.address() as AddressInfo).port;
    // Machine-parseable line for AgentManager to detect actual port (dynamic port allocation)
    console.log(`LISTENING_PORT=${actualPort}`);
    console.log(`HTTP server running on port ${actualPort}`);
    console.log(`Health check: http://localhost:${actualPort}/health`);
  });

  // Initialize agent and make it available to routes
  const agent = new Agent(config);

  try {
    await agent.initialize();
    console.log('Agent initialized successfully');
  } catch (error) {
    console.error('Failed to initialize agent:', error);
    console.log('Continuing with limited functionality...');
  }

  // Make agent available to all routes registered in createServer()
  agentRef = agent;

  // Thinker is now a passive agent runtime — Orchestrator dispatches messages via HTTP
  console.log('='.repeat(50));
  console.log('Waiting for dispatched messages from Orchestrator');

  // Periodic cleanup of old conversation states and session files
  setInterval(async () => {
    agent.cleanupOldConversations();
    try {
      await agent.cleanupOldSessions();
    } catch (error) {
      console.warn('Session cleanup error (non-fatal):', error);
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down Thinker...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down Thinker...');
    process.exit(0);
  });
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
