/**
 * Smoke tests for Browser MCP package.json manifest.
 * Validates the hexa-puffs auto-discovery fields are correct.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

describe('package.json manifest', () => {
  it('has hexa-puffs field', () => {
    expect(pkg.hexa-puffs).toBeDefined();
    expect(typeof pkg.hexa-puffs).toBe('object');
  });

  it('has mcpName set to "web"', () => {
    expect(pkg.hexa-puffs.mcpName).toBe('web');
  });

  it('is marked as sensitive', () => {
    expect(pkg.hexa-puffs.sensitive).toBe(true);
  });

  it('has 60s timeout for browser operations', () => {
    expect(pkg.hexa-puffs.timeout).toBe(60000);
  });

  it('defaults to stdio transport (no transport field)', () => {
    expect(pkg.hexa-puffs.transport).toBeUndefined();
  });

  it('has main field pointing to dist/index.js', () => {
    expect(pkg.main).toBe('dist/index.js');
  });

  it('is an ES module', () => {
    expect(pkg.type).toBe('module');
  });

  it('has build script', () => {
    expect(pkg.scripts.build).toBe('tsc');
  });
});
