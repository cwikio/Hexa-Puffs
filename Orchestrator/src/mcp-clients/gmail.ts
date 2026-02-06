import { BaseMCPClient } from './base.js';
import { type MCPServerConfig } from '../config/index.js';

/**
 * HTTP client for Gmail MCP.
 * Gmail runs as an independent HTTP service and exposes email tools.
 * Tool discovery and routing is handled by the ToolRouter via listTools().
 */
export class GmailMCPClient extends BaseMCPClient {
  constructor(config: MCPServerConfig) {
    super('gmail', config);
  }
}
