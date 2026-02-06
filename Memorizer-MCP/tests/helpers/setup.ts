import { beforeAll, afterAll } from 'vitest';
import { McpClient } from './mcp-client.js';

// Global test setup
beforeAll(async () => {
  const client = new McpClient();

  // Wait for server to be ready (3 retries, fast fail)
  let retries = 3;
  while (retries > 0) {
    try {
      await client.healthCheck();
      console.log('Memorizer MCP server is ready');
      return;
    } catch {
      retries--;
      if (retries === 0) {
        throw new Error(
          'Memorizer MCP server is not responding on port 8005.\n' +
          '  These tests require Memory MCP running as a standalone HTTP server.\n' +
          '  Start it with: cd Memorizer-MCP && TRANSPORT=http PORT=8005 node dist/Memorizer-MCP/src/index.js\n' +
          '  Or test skills via Orchestrator instead: cd Orchestrator && npm run test:skills'
        );
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
});

afterAll(async () => {
  console.log('Test suite completed');
});
