import { createConnection } from '@playwright/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildConfig, resolveProxy } from './config.js';

// Logger writes to stderr — safe for stdio MCPs
const log = (msg: string) => process.stderr.write(`[browser] ${msg}\n`);

const { useProxy, warning } = resolveProxy(process.env);

if (warning) {
  log(warning);
}

async function main() {
  const config = buildConfig(process.env);
  const server = await createConnection(config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`Browser MCP running on stdio (proxy: ${useProxy ? process.env.BROWSER_PROXY_SERVER : 'disabled'})`);
}

main().catch((error) => {
  log(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
