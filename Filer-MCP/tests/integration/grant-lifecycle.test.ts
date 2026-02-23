/**
 * Grant Lifecycle Integration Test
 * Tests the full grant journey: check → request → verify → use → permission boundary → audit
 */

import { describe, it, expect, afterAll } from 'vitest';
import {
  checkHealth,
  cleanup,
  tools,
  callTool,
  logSection,
  logInfo,
  logSuccess,
} from '../helpers/mcp-client.js';

// Use /tmp for external path testing (not in workspace, not forbidden)
const GRANT_TEST_DIR = `/tmp/filer-grant-test-${Date.now()}`;

describe('Grant Lifecycle', () => {
  let grantId: string | undefined;

  afterAll(async () => {
    // Clean up the test directory
    try {
      const { execSync } = await import('node:child_process');
      execSync(`rm -rf ${GRANT_TEST_DIR}`);
    } catch {
      // Best effort
    }
    await cleanup();
  });

  // Step 1: Baseline
  it('Step 1: Health check passes', async () => {
    logSection('Grant Lifecycle Test');
    const healthy = await checkHealth();
    expect(healthy).toBe(true);
  });

  it('Step 2: External path has no grant initially', async () => {
    const result = await tools.checkGrant(GRANT_TEST_DIR);
    expect(result.success).toBe(true);
    expect(result.data?.has_access).toBe(false);
    logInfo(`Grant check for ${GRANT_TEST_DIR}: no access (expected)`);
  });

  // Step 2: Request grant
  it('Step 3: Request read grant for external path', async () => {
    const result = await tools.requestGrant(GRANT_TEST_DIR, 'read', 'Grant lifecycle test');
    expect(result.success).toBe(true);
    expect(result.data?.grant_id).toBeTruthy();
    grantId = result.data?.grant_id;
    logInfo(`Grant created: ${grantId}`);
  });

  // Step 3: Verify grant in list
  it('Step 4: New grant appears in grant list', async () => {
    const result = await tools.listGrants();
    expect(result.success).toBe(true);

    const match = result.data?.grants.find(g => g.path === GRANT_TEST_DIR);
    expect(match).toBeDefined();
    expect(match?.permission).toBe('read');
    logSuccess('Grant found in list');
  });

  // Step 4: Verify grant check now passes
  it('Step 5: Grant check now returns has_access=true', async () => {
    const result = await tools.checkGrant(GRANT_TEST_DIR);
    expect(result.success).toBe(true);
    expect(result.data?.has_access).toBe(true);
    expect(result.data?.permission).toBe('read');
  });

  // Step 5: Try to write with read-only grant
  it('Step 6: Write denied with read-only grant', async () => {
    // Ensure test dir exists for the write attempt
    const { mkdirSync } = await import('node:fs');
    mkdirSync(GRANT_TEST_DIR, { recursive: true });

    const result = await tools.createFile(
      `${GRANT_TEST_DIR}/should-fail.txt`,
      'This should fail — read-only grant',
    );
    expect(result.success).toBe(false);
    logInfo('Write correctly denied with read-only grant');
  });

  // Step 6: Audit log captures grant activity
  it('Step 7: Audit log has entries for this test', async () => {
    const result = await tools.getAuditLog({ limit: 50 });
    expect(result.success).toBe(true);
    expect(result.data?.entries).toBeInstanceOf(Array);

    // Should have some entries (the grant check, grant request, etc.)
    const entries = result.data?.entries || [];
    expect(entries.length).toBeGreaterThan(0);
    logInfo(`Audit log has ${entries.length} recent entries`);
  });
});
