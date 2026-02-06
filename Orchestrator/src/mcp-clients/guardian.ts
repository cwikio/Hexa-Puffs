import { z } from 'zod';
import { BaseMCPClient, type ToolCallResult } from './base.js';
import { type MCPServerConfig, type SecurityConfig } from '../config/index.js';

export interface ScanResult {
  allowed: boolean;
  risk: 'none' | 'low' | 'medium' | 'high';
  reason?: string;
  threats?: string[];
}

const GuardianResponseSchema = z.object({
  blocked: z.boolean(),
  risk_level: z.enum(['none', 'low', 'medium', 'high']).optional(),
  reason: z.string().optional(),
  detected_threats: z.array(z.string()).optional(),
});

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
    if (this.failMode === 'closed') {
      this.logger.warn(`${context}, blocking request (fail-closed mode)`, { error });
      return {
        allowed: false,
        risk: 'high',
        reason: `${context} - blocking in fail-closed mode`,
      };
    }
    this.logger.warn(`${context}, allowing request (fail-open mode)`, { error });
    return {
      allowed: true,
      risk: 'none',
      reason: `${context} - allowing in fail-open mode`,
    };
  }

  private parseScanResult(result: ToolCallResult): ScanResult {
    const parsed = this.parseTextResponse(result);
    if (parsed === null) {
      return this.handleFailure('Failed to parse scan result');
    }

    const validated = GuardianResponseSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('Scan result validation failed', { errors: validated.error.flatten() });
      return this.handleFailure('Invalid scan result format');
    }

    const data = validated.data;
    return {
      allowed: !data.blocked,
      risk: data.risk_level ?? 'none',
      reason: data.reason,
      threats: data.detected_threats,
    };
  }

  async getScanLog(limit: number = 10): Promise<unknown> {
    const result = await this.callTool({
      name: 'get_scan_log',
      arguments: { limit },
    });

    return result.content;
  }
}
