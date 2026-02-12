/**
 * Unit tests for StdioGuardianClient adapter and shared Guardian parsing logic.
 * Verifies correct parsing of Guardian's actual response format (StandardResponse-wrapped).
 */

import { describe, it, expect } from 'vitest';
import {
  parseGuardianResponse,
  createFailureScanResult,
} from '../../src/mcp-clients/guardian-types.js';

describe('parseGuardianResponse', () => {
  it('should parse a safe scan result', () => {
    const response = {
      success: true,
      data: {
        safe: true,
        confidence: 0.95,
        threats: [],
        explanation: 'Scanned 1 text field(s) - no threats detected',
        scan_id: 'scan_abc123',
      },
    };

    const result = parseGuardianResponse(response);

    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(true);
    expect(result!.risk).toBe('none');
    expect(result!.reason).toBe('Scanned 1 text field(s) - no threats detected');
    expect(result!.threats).toEqual([]);
  });

  it('should parse an unsafe scan result with threats', () => {
    const response = {
      success: true,
      data: {
        safe: false,
        confidence: 0.9,
        threats: [
          { path: 'root', type: 'prompt_injection', snippet: 'Ignore all...' },
          { path: 'root', type: 'jailbreak', snippet: 'You are now...' },
        ],
        explanation: '[root]: Prompt injection detected',
        scan_id: 'scan_xyz789',
      },
    };

    const result = parseGuardianResponse(response);

    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(false);
    expect(result!.risk).toBe('high');
    expect(result!.reason).toBe('[root]: Prompt injection detected');
    expect(result!.threats).toEqual(['prompt_injection', 'jailbreak']);
  });

  it('should handle unsafe result with low confidence as medium risk', () => {
    const response = {
      success: true,
      data: {
        safe: false,
        confidence: 0.6,
        threats: [{ type: 'suspicious_content' }],
        explanation: 'Possibly suspicious',
        scan_id: 'scan_med',
      },
    };

    const result = parseGuardianResponse(response);

    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(false);
    expect(result!.risk).toBe('medium');
  });

  it('should handle unsafe result with very low confidence as low risk', () => {
    const response = {
      success: true,
      data: {
        safe: false,
        confidence: 0.3,
        threats: [{ type: 'uncertain' }],
        explanation: 'Low confidence detection',
        scan_id: 'scan_low',
      },
    };

    const result = parseGuardianResponse(response);

    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(false);
    expect(result!.risk).toBe('low');
  });

  it('should return null for non-StandardResponse format', () => {
    const result = parseGuardianResponse({ blocked: true, risk_level: 'high' });
    expect(result).toBeNull();
  });

  it('should return null for failed StandardResponse', () => {
    const result = parseGuardianResponse({ success: false, error: 'Scanner error' });
    expect(result).toBeNull();
  });

  it('should return null for missing data field', () => {
    const result = parseGuardianResponse({ success: true });
    expect(result).toBeNull();
  });

  it('should return null for invalid inner scan data', () => {
    const result = parseGuardianResponse({
      success: true,
      data: { invalid: 'structure' },
    });
    expect(result).toBeNull();
  });

  it('should return null for null input', () => {
    const result = parseGuardianResponse(null);
    expect(result).toBeNull();
  });

  it('should return null for string input', () => {
    const result = parseGuardianResponse('not an object');
    expect(result).toBeNull();
  });
});

describe('createFailureScanResult', () => {
  it('should block in fail-closed mode', () => {
    const result = createFailureScanResult('closed', 'Guardian unavailable');

    expect(result.allowed).toBe(false);
    expect(result.risk).toBe('high');
    expect(result.reason).toContain('fail-closed');
  });

  it('should allow in fail-open mode', () => {
    const result = createFailureScanResult('open', 'Guardian unavailable');

    expect(result.allowed).toBe(true);
    expect(result.risk).toBe('none');
    expect(result.reason).toContain('fail-open');
  });

  it('should include context in reason', () => {
    const result = createFailureScanResult('closed', 'Security scan failed');

    expect(result.reason).toContain('Security scan failed');
  });
});
