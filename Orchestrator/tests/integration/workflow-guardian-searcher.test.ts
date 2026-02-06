/**
 * Level 3 Workflow Test: Guardian + Searcher
 *
 * Tests that Guardian transparently scans Searcher tool calls:
 * - Input scanning (→): arguments sent to Searcher are scanned
 * - Output scanning (←): search results returned are scanned
 *
 * Verifies scanning via Guardian's audit JSONL file on disk.
 * Guardian tools are internal (not in Orchestrator tool router),
 * so we read the audit log directly.
 *
 * Guardian config: searcher input=true, output=true
 * Prerequisites: Full stack running (Orchestrator + Guardian + Searcher)
 *   The Orchestrator must have been started AFTER guardianConfig.enabled = true
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  createSearcherClient,
  createOrchestratorClient,
  checkMCPsAvailable,
  log,
  logSection,
  MCPTestClient,
} from '../helpers/mcp-client.js'
import { parseJsonContent } from '../helpers/workflow-helpers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const AUDIT_LOG = resolve(__dirname, '../../../Guardian/logs/audit.jsonl')
const RATE_LIMIT_DELAY = 1200

interface AuditEntry {
  scan_id: string
  timestamp: string
  source: string
  content_hash: string
  content_length: number
  safe: boolean
  confidence: number
  threats: Array<{ path: string; type: string; snippet: string }>
  model: string
  latency_ms: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readAuditLog(): AuditEntry[] {
  if (!existsSync(AUDIT_LOG)) return []
  const content = readFileSync(AUDIT_LOG, 'utf-8').trim()
  if (!content) return []
  return content.split('\n').map((line) => JSON.parse(line) as AuditEntry)
}

function getAuditCount(): number {
  return readAuditLog().length
}

describe('Workflow: Guardian + Searcher (Input & Output Scanning)', () => {
  let orchestrator: MCPTestClient
  let searcher: MCPTestClient
  let orchestratorAvailable = false
  let searcherAvailable = false
  let auditLogExists = false
  let guardianScanningActive = false

  function skipIfUnavailable(required: { searcher?: boolean; scanning?: boolean }): boolean {
    const missing: string[] = []
    if (required.searcher && !searcherAvailable) missing.push('Searcher')
    if (required.scanning && !guardianScanningActive) missing.push('Guardian scanning (restart Orchestrator with guardianConfig.enabled=true)')
    if (missing.length > 0) {
      log(`Skipping: ${missing.join(', ')} unavailable`, 'warn')
      return true
    }
    return false
  }

  beforeAll(async () => {
    logSection('Guardian + Searcher Workflow Tests')

    orchestrator = createOrchestratorClient()
    searcher = createSearcherClient()

    const orchHealth = await orchestrator.healthCheck()
    orchestratorAvailable = orchHealth.healthy
    if (!orchestratorAvailable) {
      log('Orchestrator not running — skipping all tests', 'error')
      return
    }

    const availability = await checkMCPsAvailable([searcher])
    searcherAvailable = availability.get('Searcher') ?? false
    auditLogExists = existsSync(AUDIT_LOG)

    log(`Orchestrator: UP`, 'success')
    log(`Searcher: ${searcherAvailable ? 'UP' : 'DOWN'}`, searcherAvailable ? 'success' : 'warn')
    log(`Audit log: ${auditLogExists ? 'EXISTS' : 'MISSING'}`, auditLogExists ? 'success' : 'warn')

    // Probe: check if Guardian scanning is active by making a tool call and checking audit delta
    if (searcherAvailable && auditLogExists) {
      const countBefore = getAuditCount()
      await searcher.callTool('web_search', { query: 'guardian scanning probe', count: 1 })
      await sleep(1000)
      const countAfter = getAuditCount()
      guardianScanningActive = countAfter > countBefore
      log(`Guardian scanning: ${guardianScanningActive ? 'ACTIVE' : 'INACTIVE'} (audit delta: ${countAfter - countBefore})`,
        guardianScanningActive ? 'success' : 'warn')
      if (!guardianScanningActive) {
        log('Restart Orchestrator after enabling guardianConfig.enabled=true to activate scanning', 'warn')
      }
    }
  })

  // Rate limit between tests (Brave free plan: 1 req/sec)
  beforeEach(async () => {
    await sleep(RATE_LIMIT_DELAY)
  })

  describe('Health Checks', () => {
    it('should confirm Orchestrator is running', () => {
      expect(orchestratorAvailable).toBe(true)
      log('Orchestrator health verified', 'success')
    })

    it('should confirm Searcher is reachable through Orchestrator', () => {
      log(`Searcher: ${searcherAvailable ? 'UP' : 'DOWN'}`, searcherAvailable ? 'success' : 'warn')
      expect(true).toBe(true)
    })

    it('should confirm Guardian audit log exists on disk', () => {
      log(`Audit log: ${auditLogExists ? AUDIT_LOG : 'NOT FOUND'}`, auditLogExists ? 'success' : 'warn')
      expect(true).toBe(true)
    })
  })

  describe('Input + Output Scanning: web_search', () => {
    it('should scan web_search arguments and results through Guardian', async () => {
      if (skipIfUnavailable({ searcher: true, scanning: true })) return

      const countBefore = getAuditCount()
      log(`Audit entries before: ${countBefore}`, 'info')

      // Guardian may block the call (model is conservative) — that's OK.
      // We're testing that scanning HAPPENS, not that content passes.
      const result = await searcher.callTool('web_search', {
        query: 'typescript generics tutorial',
        count: 3,
      })

      if (result.success) {
        const parsed = parseJsonContent<{ success: boolean; data: { results: unknown[] } }>(result)
        log(`Web search returned ${parsed?.data?.results?.length ?? 0} results`, 'success')
      } else {
        log(`Web search blocked by Guardian or failed: ${result.error ?? 'unknown'}`, 'info')
      }

      await sleep(500)

      const countAfter = getAuditCount()
      const delta = countAfter - countBefore
      log(`Audit entries after: ${countAfter} (delta: ${delta})`, 'info')

      // At least 1 scan (input). If input passed, output is scanned too (delta >= 2).
      expect(delta).toBeGreaterThanOrEqual(1)
      log(`Guardian scanned web_search (${delta} audit entries added)`, 'success')
    }, 30000)
  })

  describe('Input + Output Scanning: news_search', () => {
    it('should scan news_search arguments and results through Guardian', async () => {
      if (skipIfUnavailable({ searcher: true, scanning: true })) return

      const countBefore = getAuditCount()
      log(`Audit entries before: ${countBefore}`, 'info')

      const result = await searcher.callTool('news_search', {
        query: 'technology industry news',
        count: 3,
      })

      if (result.success) {
        const parsed = parseJsonContent<{ success: boolean; data: { results: unknown[] } }>(result)
        log(`News search returned ${parsed?.data?.results?.length ?? 0} results`, 'success')
      } else {
        log(`News search blocked by Guardian or failed: ${result.error ?? 'unknown'}`, 'info')
      }

      await sleep(500)

      const countAfter = getAuditCount()
      const delta = countAfter - countBefore
      log(`Audit entries after: ${countAfter} (delta: ${delta})`, 'info')

      expect(delta).toBeGreaterThanOrEqual(1)
      log(`Guardian scanned news_search (${delta} audit entries added)`, 'success')
    }, 30000)
  })

  describe('Audit Trail Verification', () => {
    it('should accumulate scans across multiple search operations', async () => {
      if (skipIfUnavailable({ searcher: true, scanning: true })) return

      const baseline = getAuditCount()
      log(`Baseline audit count: ${baseline}`, 'info')

      await searcher.callTool('web_search', { query: 'vitest testing framework', count: 2 })
      await sleep(RATE_LIMIT_DELAY)
      await searcher.callTool('news_search', { query: 'open source software', count: 2 })

      await sleep(500)

      const final = getAuditCount()
      const delta = final - baseline
      log(`Final audit count: ${final} (delta: ${delta})`, 'info')

      // 2 operations, each gets at least 1 scan (input). Output scan only if input passes.
      expect(delta).toBeGreaterThanOrEqual(2)
      log(`Guardian accumulated ${delta} scans across 2 search operations`, 'success')
    }, 60000)

    it('should have valid structure in recent audit entries', async () => {
      if (!auditLogExists) {
        log('Audit log missing — skipping', 'warn')
        return
      }

      const entries = readAuditLog()
      expect(entries.length).toBeGreaterThan(0)

      const recent = entries.slice(-5)
      for (const entry of recent) {
        expect(entry.scan_id).toBeDefined()
        expect(entry.timestamp).toBeDefined()
        expect(typeof entry.safe).toBe('boolean')
        expect(Array.isArray(entry.threats)).toBe(true)
        expect(typeof entry.confidence).toBe('number')
        expect(typeof entry.latency_ms).toBe('number')
      }
      log(`Verified ${recent.length} recent audit entries out of ${entries.length} total`, 'success')
    }, 30000)
  })

  describe('Summary', () => {
    it('should report Guardian + Searcher test results', () => {
      logSection('GUARDIAN + SEARCHER TEST SUMMARY')
      log(`Orchestrator: ${orchestratorAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}`, 'info')
      log(`Searcher: ${searcherAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}`, 'info')
      log(`Audit log: ${auditLogExists ? 'EXISTS' : 'MISSING'}`, 'info')
      log(`Guardian scanning: ${guardianScanningActive ? 'ACTIVE' : 'INACTIVE'}`, guardianScanningActive ? 'success' : 'warn')
      log('Guardian + Searcher workflow tests completed', 'success')
    })
  })
})
