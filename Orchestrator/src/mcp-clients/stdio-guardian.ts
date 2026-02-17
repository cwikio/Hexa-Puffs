/**
 * StdioGuardianClient - Adapter that wraps a StdioMCPClient to provide
 * Guardian scanning via the scan_content tool over stdio transport.
 *
 * Reuses the shared parsing logic from guardian-types.ts.
 */

import type { StdioMCPClient } from './stdio-client.js';
import {
  type ScanResult,
  parseGuardianResponse,
  createFailureScanResult,
} from './guardian-types.js';
import { logger, Logger } from '@mcp/shared/Utils/logger.js';

export class StdioGuardianClient {
  private logger: Logger;

  constructor(
    private client: StdioMCPClient,
    private failMode: 'open' | 'closed'
  ) {
    this.logger = logger.child('guardian-stdio');
  }

  get isAvailable(): boolean {
    return this.client.isAvailable;
  }

  /**
   * Scan content using Guardian's scan_content tool via stdio.
   */
  async scanContent(content: string, source?: string): Promise<ScanResult> {
    if (!this.client.isAvailable) {
      this.logger.warn('Guardian MCP unavailable for scanning', { failMode: this.failMode });
      return createFailureScanResult(this.failMode, 'Guardian MCP unavailable');
    }

    try {
      const args: Record<string, unknown> = { content };
      if (source) {
        args.source = source;
      }

      const result = await this.client.callTool({
        name: 'scan_content',
        arguments: args,
      });

      if (!result.success) {
        this.logger.warn('Guardian scan_content call failed', { error: result.error });
        return createFailureScanResult(this.failMode, 'Security scan failed', result.error);
      }

      return this.parseResult(result.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Guardian scan threw exception', { error: message });
      return createFailureScanResult(this.failMode, 'Security scan exception', message);
    }
  }

  /**
   * Parse the stdio tool call result.
   *
   * StdioMCPClient.callTool() returns:
   *   { success: true, content: { content: [{ type: "text", text: "<json>" }] } }
   *
   * The inner JSON is a StandardResponse: { success: true, data: { safe, confidence, ... } }
   */
  private parseResult(content: unknown): ScanResult {
    // Extract text from MCP content wrapper
    const mcpContent = content as { content?: Array<{ type: string; text?: string }> };
    const textItem = mcpContent?.content?.[0];

    if (!textItem || textItem.type !== 'text' || typeof textItem.text !== 'string') {
      this.logger.warn('Unexpected Guardian response format', { content });
      return createFailureScanResult(this.failMode, 'Failed to parse Guardian response');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textItem.text);
    } catch {
      this.logger.warn('Failed to parse Guardian response JSON');
      return createFailureScanResult(this.failMode, 'Invalid JSON in Guardian response');
    }

    const scanResult = parseGuardianResponse(parsed);
    if (!scanResult) {
      this.logger.warn('Guardian response validation failed', { parsed });
      return createFailureScanResult(this.failMode, 'Invalid scan result format');
    }

    return scanResult;
  }
}
