import { BaseMCPClient } from './base.js';
import { type MCPServerConfig } from '../config/index.js';

/**
 * Generic HTTP MCP client for auto-discovered HTTP MCPs.
 * Uses BaseMCPClient which already implements listTools(), callTool(), healthCheck(), etc.
 */
export class HttpMCPClient extends BaseMCPClient {
  constructor(name: string, config: MCPServerConfig) {
    super(name, config);
  }
}
