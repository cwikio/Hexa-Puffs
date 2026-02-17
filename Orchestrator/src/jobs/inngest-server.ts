import { serve } from 'inngest/express';
import express from 'express';
import { createServer as createHttpServer } from 'http';
import { inngest } from './inngest-client.js';
import { backgroundJobFunction } from './background-job.js';
import { skillSchedulerFunction } from './skill-scheduler.js';
import { conversationBackfillFunction } from './backfill.js';
import { memorySynthesisFunction } from './memory-synthesis.js';
import { healthReportFunction } from './health-report.js';
import { logger } from '@mcp/shared/Utils/logger.js';

const jobFunctions = [
  backgroundJobFunction,
  skillSchedulerFunction,
  conversationBackfillFunction,
  memorySynthesisFunction,
  healthReportFunction,
];

export function startInngestServer(port: number = 3000): void {
  const app = express();

  // Body parsing middleware required for Inngest
  // Increased limit: browser tool results (full page snapshots) can exceed the default 100KB
  app.use(express.json({ limit: '10mb' }));

  // Inngest endpoint
  app.use(
    '/api/inngest',
    serve({
      client: inngest,
      functions: jobFunctions,
    })
  );

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'inngest-server' });
  });

  const httpServer = createHttpServer(app);

  // Handle port already in use - another Orchestrator instance is handling Inngest
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      const devServerUrl = process.env.INNGEST_DEV_SERVER_URL || 'http://localhost:8288';
      logger.info(`Inngest HTTP endpoint port ${port} already in use - another instance is handling jobs`);
      logger.info(`Inngest dev server dashboard: ${devServerUrl}`);
      // Don't crash - just skip starting this server
    } else {
      logger.error('Inngest server error', { error: err });
    }
  });

  httpServer.listen(port, '127.0.0.1', () => {
    const devServerUrl = process.env.INNGEST_DEV_SERVER_URL || 'http://localhost:8288';
    logger.info(`Inngest HTTP endpoint listening on port ${port}`);
    logger.info(`Inngest dev server dashboard: ${devServerUrl}`);
    logger.info('Endpoints:');
    logger.info(`  POST http://localhost:${port}/api/inngest - Inngest function endpoint`);
    logger.info(`  GET  http://localhost:${port}/health      - Health check`);
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down Inngest server...');
    httpServer.close(() => {
      logger.info('Inngest server closed');
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
