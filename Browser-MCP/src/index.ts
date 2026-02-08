import { createConnection } from '@playwright/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildConfig, resolveProxy } from './config.js';

const { useProxy, warning } = resolveProxy(process.env);

if (warning) {
  console.error(warning);
}

async function main() {
  const config = buildConfig(process.env);
  const server = await createConnection(config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Browser MCP running on stdio (proxy: ${useProxy ? process.env.BROWSER_PROXY_SERVER : 'disabled'})`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
