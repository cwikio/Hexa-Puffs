import { BaseMCPClient } from './base.js';
import { type MCPServerConfig } from '../config/index.js';

/**
 * HTTP client for Searcher MCP (Brave Search).
 * Searcher runs as an independent HTTP service and exposes web_search and news_search tools.
 * Tool discovery and routing is handled by the ToolRouter via listTools().
 */
export class SearcherMCPClient extends BaseMCPClient {
  constructor(config: MCPServerConfig) {
    super('searcher', config);
  }
}
