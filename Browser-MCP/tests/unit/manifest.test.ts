/**
 * Smoke tests for Browser MCP package.json manifest.
 * Validates the annabelle auto-discovery fields are correct.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

describe('package.json manifest', () => {
  it('has annabelle field', () => {
    expect(pkg.annabelle).toBeDefined();
    expect(typeof pkg.annabelle).toBe('object');
  });

  it('has mcpName set to "web"', () => {
    expect(pkg.annabelle.mcpName).toBe('web');
  });

  it('is marked as sensitive', () => {
    expect(pkg.annabelle.sensitive).toBe(true);
  });

  it('has 60s timeout for browser operations', () => {
    expect(pkg.annabelle.timeout).toBe(60000);
  });

  it('defaults to stdio transport (no transport field)', () => {
    expect(pkg.annabelle.transport).toBeUndefined();
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
