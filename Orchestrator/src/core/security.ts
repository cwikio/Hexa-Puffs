import { GuardianMCPClient, type ScanResult } from '../mcp-clients/guardian.js';
import { SecurityError } from '../utils/errors.js';
import { logger, Logger } from '../../../Shared/Utils/logger.js';

export interface SecurityEvent {
  timestamp: Date;
  type: 'input_scan' | 'output_scan' | 'blocked';
  content: string;
  result: ScanResult;
}

export class SecurityCoordinator {
  private guardian: GuardianMCPClient;
  private logger: Logger;
  private events: SecurityEvent[] = [];
  private scanInputs: boolean;
  private failMode: 'open' | 'closed';

  constructor(guardian: GuardianMCPClient, scanInputs: boolean = true, failMode: 'open' | 'closed' = 'closed') {
    this.guardian = guardian;
    this.scanInputs = scanInputs;
    this.failMode = failMode;
    this.logger = logger.child('security');
  }

  private getUnavailableResult(context: string): ScanResult {
    if (this.failMode === 'closed') {
      this.logger.warn(`Guardian unavailable, blocking ${context} (fail-closed mode)`);
      return {
        allowed: false,
        risk: 'high',
        reason: 'Security scanner unavailable - blocking in fail-closed mode',
      };
    }
    this.logger.warn(`Guardian unavailable, allowing ${context} (fail-open mode)`);
    return {
      allowed: true,
      risk: 'none',
      reason: 'Security scanner unavailable - allowing in fail-open mode',
    };
  }

  async scanInput(content: string): Promise<ScanResult> {
    if (!this.scanInputs) {
      return { allowed: true, risk: 'none' };
    }

    if (!this.guardian.isAvailable) {
      return this.getUnavailableResult('input scan');
    }

    this.logger.debug('Scanning input content');
    const result = await this.guardian.scanContent(content);

    this.logEvent('input_scan', content, result);

    if (!result.allowed) {
      this.logger.warn('Input blocked by security scan', {
        risk: result.risk,
        reason: result.reason,
        threats: result.threats,
      });
      this.logEvent('blocked', content, result);
    }

    return result;
  }

  async scanOutput(content: string, toolName: string): Promise<ScanResult> {
    if (!this.guardian.isAvailable) {
      return this.getUnavailableResult('output scan');
    }

    this.logger.debug('Scanning output content', { tool: toolName });
    const result = await this.guardian.scanContent(content);

    this.logEvent('output_scan', content, result);

    if (!result.allowed) {
      this.logger.warn('Output blocked by security scan', {
        tool: toolName,
        risk: result.risk,
        reason: result.reason,
      });
      this.logEvent('blocked', content, result);
    }

    return result;
  }

  assertAllowed(result: ScanResult, context: string): void {
    if (!result.allowed) {
      throw new SecurityError(
        `Request blocked by security: ${result.reason || 'Unknown reason'}`,
        { context, risk: result.risk, threats: result.threats }
      );
    }
  }

  private logEvent(type: SecurityEvent['type'], content: string, result: ScanResult): void {
    const event: SecurityEvent = {
      timestamp: new Date(),
      type,
      content: content.substring(0, 200), // Truncate for logging
      result,
    };
    this.events.push(event);

    // Keep only last 100 events
    if (this.events.length > 100) {
      this.events = this.events.slice(-100);
    }
  }

  getRecentEvents(limit: number = 10): SecurityEvent[] {
    return this.events.slice(-limit);
  }

  getBlockedCount(): number {
    return this.events.filter((e) => e.type === 'blocked').length;
  }
}
