/**
 * MCP Test Client - HTTP helper for calling MCP servers during tests.
 * Re-exports from @mcp/shared and adds Orchestrator-specific factory functions.
 */

export {
  MCPTestClient,
  checkMCPsAvailable,
  type MCPToolCallResult,
  type MCPHealthResult,
} from '@mcp/shared/Testing/mcp-test-client.js';

export {
  log,
  logSection,
  logResult,
  testId,
  wait,
  extractData,
} from '@mcp/shared/Testing/test-utils.js';

import { MCPTestClient, resolveToken } from '@mcp/shared/Testing/mcp-test-client.js';

/**
 * Authenticated fetch — wraps native fetch with the Annabelle auth token header.
 * Use this for raw HTTP calls that bypass MCPTestClient (e.g. /tools/list, /status).
 */
export function authFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const token = resolveToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('X-Annabelle-Token', token);
  return fetch(url, { ...init, headers });
}

// URL configuration
export const MCP_URLS = {
  // Orchestrator (stdio mode — routes to all downstream MCPs)
  orchestrator: process.env.ORCHESTRATOR_URL || 'http://localhost:8010',
  // Standalone HTTP MCPs (still running their own servers)
  telegram: process.env.TELEGRAM_URL || 'http://localhost:8002',
  searcher: process.env.SEARCHER_URL || 'http://localhost:8007',
  // Thinker (connects to Orchestrator via HTTP)
  thinker: process.env.THINKER_URL || 'http://localhost:8006',
}

// Primary factory functions — route through Orchestrator with prefixed tool names.
// All stdio MCPs (Telegram, Memory, Filer, Guardian, 1Password, Searcher, Gmail)
// are accessed via the Orchestrator on port 8010.

export function createTelegramClient(): MCPTestClient {
  return new MCPTestClient('Telegram', MCP_URLS.orchestrator, { toolPrefix: 'telegram_' })
}

export function createFilerClient(): MCPTestClient {
  return new MCPTestClient('Filer', MCP_URLS.orchestrator, { toolPrefix: 'filer_' })
}

export function createMemoryClient(): MCPTestClient {
  return new MCPTestClient('Memory', MCP_URLS.orchestrator, { toolPrefix: 'memory_' })
}

export function createGuardianClient(): MCPTestClient {
  return new MCPTestClient('Guardian', MCP_URLS.orchestrator, { toolPrefix: 'guardian_' })
}

export function createOnePasswordClient(): MCPTestClient {
  return new MCPTestClient('1Password', MCP_URLS.orchestrator, { toolPrefix: 'onepassword_' })
}

export function createSearcherClient(): MCPTestClient {
  return new MCPTestClient('Searcher', MCP_URLS.orchestrator, { toolPrefix: 'searcher_' })
}

export function createGmailClient(): MCPTestClient {
  return new MCPTestClient('Gmail', MCP_URLS.orchestrator, { toolPrefix: 'gmail_' })
}

export function createOrchestratorClient(): MCPTestClient {
  return new MCPTestClient('Orchestrator', MCP_URLS.orchestrator, { timeout: 15000 })
}

export function createThinkerClient(): MCPTestClient {
  return new MCPTestClient('Thinker', MCP_URLS.thinker)
}
