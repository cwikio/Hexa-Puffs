import { createConnection } from '@playwright/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Proxy is OFF by default. Set BROWSER_PROXY_ENABLED=true to enable.
const proxyEnabled = process.env.BROWSER_PROXY_ENABLED === 'true';
const proxyServer = process.env.BROWSER_PROXY_SERVER;

if (proxyEnabled && !proxyServer) {
  console.error('BROWSER_PROXY_ENABLED=true but BROWSER_PROXY_SERVER is not set. Starting without proxy.');
}

const useProxy = proxyEnabled && !!proxyServer;

async function main() {
  const server = await createConnection({
    browser: {
      launchOptions: {
        headless: true,
        proxy: useProxy
          ? {
              server: proxyServer!,
              username: process.env.BROWSER_PROXY_USERNAME,
              password: process.env.BROWSER_PROXY_PASSWORD,
              bypass: process.env.BROWSER_PROXY_BYPASS ?? 'localhost,127.0.0.1',
            }
          : undefined,
      },
    },
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Browser MCP running on stdio (proxy: ${useProxy ? proxyServer : 'disabled'})`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
