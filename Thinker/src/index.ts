import 'dotenv/config';
import express, { Request, Response } from 'express';
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
    pollIntervalMs: number;
  };
}

/**
 * Create and configure the Express HTTP server
 */
function createServer(config: Config, startTime: number) {
  const app = express();

  app.use(express.json());

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
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
        pollIntervalMs: config.telegramPollIntervalMs,
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
    console.log(`  - Polling: ${config.pollingEnabled ? `enabled (${config.telegramPollIntervalMs}ms)` : 'disabled'}`);
    console.log(`  - Send responses directly: ${config.sendResponseDirectly}`);
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

  app.listen(config.thinkerPort, () => {
    console.log(`HTTP server running on port ${config.thinkerPort}`);
    console.log(`Health check: http://localhost:${config.thinkerPort}/health`);
  });

  // Initialize agent
  const agent = new Agent(config);

  try {
    await agent.initialize();
    console.log('Agent initialized successfully');
  } catch (error) {
    console.error('Failed to initialize agent:', error);
    console.log('Continuing with limited functionality...');
  }

  // Register /process-message endpoint for Orchestrator-dispatched messages
  app.post('/process-message', async (req: Request, res: Response) => {
    const { id, chatId, senderId, text, date, agentId } = req.body;

    if (!chatId || !text) {
      res.status(400).json({ success: false, error: 'chatId and text are required' });
      return;
    }

    console.log(`Received message dispatch: chat=${chatId}, agent=${agentId || 'default'}`);

    try {
      const result = await agent.processMessage({
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

  // Register /execute-skill endpoint for proactive task execution
  app.post('/execute-skill', async (req: Request, res: Response) => {
    const { skillId, instructions, maxSteps, notifyOnCompletion } = req.body;

    if (!instructions) {
      res.status(400).json({ success: false, error: 'instructions is required' });
      return;
    }

    console.log(`Received skill execution request: skillId=${skillId}, maxSteps=${maxSteps}`);

    try {
      // Use defaultNotifyChatId from config if notification is requested
      const notifyChatId = notifyOnCompletion
        ? (config.defaultNotifyChatId || undefined)
        : undefined;

      const result = await agent.processProactiveTask(
        instructions,
        maxSteps || 10,
        notifyChatId,
      );

      res.json({
        success: result.success,
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

  // Start message polling (skip if Orchestrator handles polling)
  console.log('='.repeat(50));
  if (config.pollingEnabled) {
    agent.startPolling();
  } else {
    console.log('Polling disabled (THINKER_POLLING_ENABLED=false) — waiting for dispatched messages');
  }

  // Periodic cleanup of old conversation states
  setInterval(() => {
    agent.cleanupOldConversations();
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
