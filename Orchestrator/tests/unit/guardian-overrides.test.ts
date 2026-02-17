/**
 * Unit tests for per-agent Guardian override resolution.
 * Verifies that getEffectiveScanFlags() correctly merges agent-specific
 * overrides on top of global defaults.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  guardianConfig,
  getEffectiveScanFlags,
} from '../../src/config/guardian.js';

describe('getEffectiveScanFlags', () => {
  beforeEach(() => {
    // Reset agent overrides before each test
    guardianConfig.agentOverrides = {};
  });

  it('should return global defaults when no agentId is provided', () => {
    const flags = getEffectiveScanFlags();

    expect(flags.input).toEqual(guardianConfig.input);
    expect(flags.output).toEqual(guardianConfig.output);
  });

  it('should return global defaults for an agent with no overrides', () => {
    const flags = getEffectiveScanFlags('unknown-agent');

    expect(flags.input).toEqual(guardianConfig.input);
    expect(flags.output).toEqual(guardianConfig.output);
  });

  it('should merge input overrides on top of global defaults', () => {
    guardianConfig.agentOverrides = {
      'work-assistant': {
        input: { memory: false, telegram: false },
      },
    };

    const flags = getEffectiveScanFlags('work-assistant');

    // Overridden values
    expect(flags.input.memory).toBe(false);
    expect(flags.input.telegram).toBe(false);
    // Non-overridden values remain at global defaults
    expect(flags.input.gmail).toBe(guardianConfig.input.gmail);
    expect(flags.input.filer).toBe(guardianConfig.input.filer);
    // Output should be unchanged
    expect(flags.output).toEqual(guardianConfig.output);
  });

  it('should merge output overrides on top of global defaults', () => {
    guardianConfig.agentOverrides = {
      'code-reviewer': {
        output: { telegram: true, memory: true },
      },
    };

    const flags = getEffectiveScanFlags('code-reviewer');

    // Overridden values
    expect(flags.output.telegram).toBe(true);
    expect(flags.output.memory).toBe(true);
    // Non-overridden values remain at global defaults
    expect(flags.output.gmail).toBe(guardianConfig.output.gmail);
    // Input should be unchanged
    expect(flags.input).toEqual(guardianConfig.input);
  });

  it('should merge both input and output overrides', () => {
    guardianConfig.agentOverrides = {
      'strict-agent': {
        input: { memory: false },
        output: { telegram: true },
      },
    };

    const flags = getEffectiveScanFlags('strict-agent');

    expect(flags.input.memory).toBe(false);
    expect(flags.output.telegram).toBe(true);
    // Everything else at global defaults
    expect(flags.input.telegram).toBe(guardianConfig.input.telegram);
    expect(flags.output.gmail).toBe(guardianConfig.output.gmail);
  });

  it('should not mutate global defaults when merging', () => {
    const originalInput = { ...guardianConfig.input };
    const originalOutput = { ...guardianConfig.output };

    guardianConfig.agentOverrides = {
      'mutator-agent': {
        input: { telegram: false },
        output: { gmail: false },
      },
    };

    getEffectiveScanFlags('mutator-agent');

    // Global defaults should remain unchanged
    expect(guardianConfig.input).toEqual(originalInput);
    expect(guardianConfig.output).toEqual(originalOutput);
  });

  it('should support different overrides for different agents', () => {
    guardianConfig.agentOverrides = {
      'agent-a': { input: { telegram: false } },
      'agent-b': { output: { telegram: true } },
    };

    const flagsA = getEffectiveScanFlags('agent-a');
    const flagsB = getEffectiveScanFlags('agent-b');

    expect(flagsA.input.telegram).toBe(false);
    expect(flagsA.output.telegram).toBe(guardianConfig.output.telegram);

    expect(flagsB.input.telegram).toBe(guardianConfig.input.telegram);
    expect(flagsB.output.telegram).toBe(true);
  });
});
