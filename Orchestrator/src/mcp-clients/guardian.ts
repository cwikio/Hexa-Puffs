import { z } from 'zod';
import { BaseMCPClient, type ToolCallResult } from './base.js';
import { type MCPServerConfig, type SecurityConfig } from '../config/index.js';

export interface ScanResult {
  allowed: boolean;
  risk: 'none' | 'low' | 'medium' | 'high';
  reason?: string;
  threats?: string[];
}

/**
 * Schema matching Guardian's actual output (post-refactoring).
 * Guardian returns: { safe, confidence, threats: [{path, type, snippet}], explanation, scan_id }
 */
const GuardianScanDataSchema = z.object({
  safe: z.boolean(),
  confidence: z.number(),
  threats: z.array(z.object({
    path: z.string().optional(),
    type: z.string(),
    snippet: z.string().optional(),
  })),
  explanation: z.string(),
  scan_id: z.string(),
});

/**
 * Guardian responses are wrapped in StandardResponse: { success: true, data: { ... } }
 */
const StandardResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

/**
 * Derive risk level from Guardian's confidence and threat data.
 */
function deriveRisk(safe: boolean, confidence: number, threatCount: number): ScanResult['risk'] {
  if (safe && threatCount === 0) return 'none';
  if (!safe && confidence > 0.8) return 'high';
  if (!safe && confidence > 0.5) return 'medium';
  if (!safe) return 'low';
  // safe but with low confidence
  if (confidence < 0.5) return 'low';
  return 'none';
}

/**
 * Parse a Guardian scan response (StandardResponse-wrapped) into a ScanResult.
 * Shared between GuardianMCPClient (HTTP) and StdioGuardianClient.
 */
export function parseGuardianResponse(parsed: unknown): ScanResult | null {
  // First, unwrap StandardResponse envelope
  const stdResponse = StandardResponseSchema.safeParse(parsed);
  if (!stdResponse.success) {
    return null;
  }

  if (!stdResponse.data.success || !stdResponse.data.data) {
    return null;
  }

  // Validate the inner scan data
  const scanData = GuardianScanDataSchema.safeParse(stdResponse.data.data);
  if (!scanData.success) {
    return null;
  }

  const data = scanData.data;
  return {
    allowed: data.safe,
    risk: deriveRisk(data.safe, data.confidence, data.threats.length),
    reason: data.explanation,
    threats: data.threats.map(t => t.type),
  };
}

/**
 * Create a failure ScanResult based on fail mode.
 */
export function createFailureScanResult(
  failMode: 'open' | 'closed',
  context: string,
  error?: string
): ScanResult {
  if (failMode === 'closed') {
    return {
      allowed: false,
      risk: 'high',
      reason: `${context} - blocking in fail-closed mode`,
    };
  }
  return {
    allowed: true,
    risk: 'none',
    reason: `${context} - allowing in fail-open mode`,
  };
}

export class GuardianMCPClient extends BaseMCPClient {
  private failMode: 'open' | 'closed';

  constructor(config: MCPServerConfig, securityConfig: SecurityConfig) {
    super('guardian', config);
    this.failMode = securityConfig.failMode;
  }

  async scanContent(content: string): Promise<ScanResult> {
    const result = await this.callTool({
      name: 'scan_content',
      arguments: { content },
    });

    if (!result.success) {
      return this.handleFailure('Security scan failed', result.error);
    }

    return this.parseScanResult(result);
  }

  private handleFailure(context: string, error?: string): ScanResult {
    this.logger.warn(`${context}`, { error, failMode: this.failMode });
    return createFailureScanResult(this.failMode, context, error);
  }

  private parseScanResult(result: ToolCallResult): ScanResult {
    const parsed = this.parseTextResponse(result);
    if (parsed === null) {
      return this.handleFailure('Failed to parse scan result');
    }

    const scanResult = parseGuardianResponse(parsed);
    if (!scanResult) {
      this.logger.warn('Scan result validation failed', { parsed });
      return this.handleFailure('Invalid scan result format');
    }

    return scanResult;
  }

  async getScanLog(limit: number = 10): Promise<unknown> {
    const result = await this.callTool({
      name: 'get_scan_log',
      arguments: { limit },
    });

    return result.content;
  }
}
