import { beforeAll, afterAll } from 'vitest';
import { connect, disconnect } from './mcp-client.js';

// Global test setup — spawns Memorizer MCP as a stdio subprocess
beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnect();
});
