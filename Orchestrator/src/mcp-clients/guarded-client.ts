/**
 * GuardedMCPClient - Decorator that wraps any IMCPClient with Guardian scanning.
 *
 * This is the "plugin box" — place it between the Orchestrator and any downstream
 * MCP to transparently scan inputs and/or outputs via Guardian.
 *
 * The ToolRouter sees a GuardedMCPClient as any normal IMCPClient.
 */

import type {
  IMCPClient,
  MCPToolCall,
  MCPToolDefinition,
  ToolCallResult,
} from './types.js';
import type { StdioGuardianClient } from './stdio-guardian.js';
import { SecurityError } from '../utils/errors.js';
import { logger, Logger } from '@mcp/shared/Utils/logger.js';

export interface GuardedClientOptions {
  scanInput: boolean;
  scanOutput: boolean;
  failMode: 'open' | 'closed';
}

export class GuardedMCPClient implements IMCPClient {
  private logger: Logger;

  constructor(
    private inner: IMCPClient,
    private guardian: StdioGuardianClient,
    private options: GuardedClientOptions
  ) {
    this.logger = logger.child(`guarded:${inner.name}`);
  }

  // Delegate all IMCPClient properties to inner
  get name(): string { return this.inner.name; }
  get isAvailable(): boolean { return this.inner.isAvailable; }
  get isRequired(): boolean { return this.inner.isRequired; }
  get isSensitive(): boolean { return this.inner.isSensitive; }

  async initialize(): Promise<void> {
    return this.inner.initialize();
  }

  async listTools(): Promise<MCPToolDefinition[]> {
    return this.inner.listTools();
  }

  async callTool(toolCall: MCPToolCall): Promise<ToolCallResult> {
    // Input scan: check arguments before they reach the downstream MCP
    if (this.options.scanInput) {
      await this.scanInputArgs(toolCall);
    }

    // Delegate to inner MCP
    const result = await this.inner.callTool(toolCall);

    // Output scan: check response before returning to caller
    if (this.options.scanOutput && result.success && result.content) {
      await this.scanOutputContent(toolCall.name, result);
    }

    return result;
  }

  private async scanInputArgs(toolCall: MCPToolCall): Promise<void> {
    const content = JSON.stringify(toolCall.arguments);
    this.logger.debug('Scanning input', { tool: toolCall.name });

    const scanResult = await this.guardian.scanContent(content, this.inner.name);

    if (!scanResult.allowed) {
      this.logger.warn('Input blocked by Guardian', {
        tool: toolCall.name,
        risk: scanResult.risk,
        reason: scanResult.reason,
        threats: scanResult.threats,
      });
      throw new SecurityError(
        `Input blocked by Guardian: ${scanResult.reason ?? 'Security threat detected'}`,
        {
          tool: toolCall.name,
          mcp: this.inner.name,
          risk: scanResult.risk,
          threats: scanResult.threats,
        }
      );
    }

    this.logger.debug('Input scan passed', { tool: toolCall.name, risk: scanResult.risk });
  }

  private async scanOutputContent(toolName: string, result: ToolCallResult): Promise<void> {
    const content = JSON.stringify(result.content);
    this.logger.debug('Scanning output', { tool: toolName });

    const scanResult = await this.guardian.scanContent(content, this.inner.name);

    if (!scanResult.allowed) {
      this.logger.warn('Output blocked by Guardian', {
        tool: toolName,
        risk: scanResult.risk,
        reason: scanResult.reason,
        threats: scanResult.threats,
      });
      throw new SecurityError(
        `Output blocked by Guardian: ${scanResult.reason ?? 'Security threat detected in response'}`,
        {
          tool: toolName,
          mcp: this.inner.name,
          risk: scanResult.risk,
          threats: scanResult.threats,
        }
      );
    }

    this.logger.debug('Output scan passed', { tool: toolName, risk: scanResult.risk });
  }
}
