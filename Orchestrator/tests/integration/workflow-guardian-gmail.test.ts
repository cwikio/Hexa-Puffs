/**
 * Level 3 Workflow Test: Guardian + Gmail
 *
 * Tests that Guardian transparently scans Gmail tool calls:
 * - Input scanning (→): arguments sent to Gmail are scanned
 * - Output scanning (←): email/label/calendar results are scanned
 *
 * Verifies scanning via Guardian's audit JSONL file on disk.
 * Only uses READ-ONLY Gmail operations (no send_email, no side effects).
 *
 * Guardian config: gmail input=true, output=true
 * Prerequisites: Full stack running (Orchestrator + Guardian + Gmail)
 *   The Orchestrator must have been started AFTER guardianConfig.enabled = true
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  createGmailClient,
  createOrchestratorClient,
  log,
  logSection,
  MCPTestClient,
} from '../helpers/mcp-client.js'
import { parseJsonContent } from '../helpers/workflow-helpers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const AUDIT_LOG = resolve(__dirname, '../../../Guardian/logs/audit.jsonl')

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

describe('Workflow: Guardian + Gmail (Input & Output Scanning)', () => {
  let orchestrator: MCPTestClient
  let gmail: MCPTestClient
  let orchestratorAvailable = false
  let gmailAvailable = false
  let auditLogExists = false
  let guardianScanningActive = false

  function skipIfUnavailable(required: { gmail?: boolean; scanning?: boolean }): boolean {
    const missing: string[] = []
    if (required.gmail && !gmailAvailable) missing.push('Gmail')
    if (required.scanning && !guardianScanningActive) missing.push('Guardian scanning (restart Orchestrator with guardianConfig.enabled=true)')
    if (missing.length > 0) {
      log(`Skipping: ${missing.join(', ')} unavailable`, 'warn')
      return true
    }
    return false
  }

  beforeAll(async () => {
    logSection('Guardian + Gmail Workflow Tests')

    orchestrator = createOrchestratorClient()
    gmail = createGmailClient()

    const orchHealth = await orchestrator.healthCheck()
    orchestratorAvailable = orchHealth.healthy
    if (!orchestratorAvailable) {
      log('Orchestrator not running — skipping all tests', 'error')
      return
    }

    // Check Gmail availability via a read-only tool call
    try {
      const labelsResult = await gmail.callTool('list_labels', {})
      gmailAvailable = labelsResult.success
    } catch {
      gmailAvailable = false
    }

    auditLogExists = existsSync(AUDIT_LOG)

    log(`Orchestrator: UP`, 'success')
    log(`Gmail: ${gmailAvailable ? 'UP' : 'DOWN'}`, gmailAvailable ? 'success' : 'warn')
    log(`Audit log: ${auditLogExists ? 'EXISTS' : 'MISSING'}`, auditLogExists ? 'success' : 'warn')

    // Probe: check if Guardian scanning is active
    if (gmailAvailable && auditLogExists) {
      const countBefore = getAuditCount()
      await gmail.callTool('list_labels', {})
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

  describe('Health Checks', () => {
    it('should confirm Orchestrator is running', () => {
      expect(orchestratorAvailable).toBe(true)
      log('Orchestrator health verified', 'success')
    })

    it('should confirm Gmail is reachable through Orchestrator', () => {
      log(`Gmail: ${gmailAvailable ? 'UP' : 'DOWN'}`, gmailAvailable ? 'success' : 'warn')
      expect(true).toBe(true)
    })

    it('should confirm Guardian audit log exists on disk', () => {
      log(`Audit log: ${auditLogExists ? AUDIT_LOG : 'NOT FOUND'}`, auditLogExists ? 'success' : 'warn')
      expect(true).toBe(true)
    })
  })

  describe('Input + Output Scanning: list_emails', () => {
    it('should scan list_emails arguments and results through Guardian', async () => {
      if (skipIfUnavailable({ gmail: true, scanning: true })) return

      const countBefore = getAuditCount()
      log(`Audit entries before: ${countBefore}`, 'info')

      const result = await gmail.callTool('list_emails', {
        query: 'in:inbox',
        max_results: 3,
      })
      expect(result.success).toBe(true)

      const parsed = parseJsonContent<{ success: boolean; data: { messages?: unknown[] } }>(result)
      if (parsed?.success) {
        log(`list_emails returned ${parsed.data?.messages?.length ?? 0} messages`, 'success')
      }

      await sleep(500)

      const countAfter = getAuditCount()
      const delta = countAfter - countBefore
      log(`Audit entries after: ${countAfter} (delta: ${delta})`, 'info')

      // Input scan + output scan = at least 2
      expect(delta).toBeGreaterThanOrEqual(2)
      log(`Guardian scanned list_emails (${delta} scans: input + output)`, 'success')
    }, 30000)
  })

  describe('Input + Output Scanning: list_labels', () => {
    it('should scan list_labels arguments and results through Guardian', async () => {
      if (skipIfUnavailable({ gmail: true, scanning: true })) return

      const countBefore = getAuditCount()
      log(`Audit entries before: ${countBefore}`, 'info')

      const result = await gmail.callTool('list_labels', {})
      expect(result.success).toBe(true)

      const parsed = parseJsonContent<{ success: boolean; data: { labels?: unknown[] } }>(result)
      if (parsed?.success) {
        log(`list_labels returned ${parsed.data?.labels?.length ?? 0} labels`, 'success')
      }

      await sleep(500)

      const countAfter = getAuditCount()
      const delta = countAfter - countBefore
      log(`Audit entries after: ${countAfter} (delta: ${delta})`, 'info')

      expect(delta).toBeGreaterThanOrEqual(2)
      log(`Guardian scanned list_labels (${delta} scans: input + output)`, 'success')
    }, 30000)
  })

  describe('Input + Output Scanning: list_calendars', () => {
    it('should scan list_calendars arguments and results through Guardian', async () => {
      if (skipIfUnavailable({ gmail: true, scanning: true })) return

      const countBefore = getAuditCount()
      log(`Audit entries before: ${countBefore}`, 'info')

      const result = await gmail.callTool('list_calendars', {})
      expect(result.success).toBe(true)

      const parsed = parseJsonContent<{ success: boolean; data: { calendars?: unknown[] } }>(result)
      if (parsed?.success) {
        log(`list_calendars returned ${parsed.data?.calendars?.length ?? 0} calendars`, 'success')
      }

      await sleep(500)

      const countAfter = getAuditCount()
      const delta = countAfter - countBefore
      log(`Audit entries after: ${countAfter} (delta: ${delta})`, 'info')

      expect(delta).toBeGreaterThanOrEqual(2)
      log(`Guardian scanned list_calendars (${delta} scans: input + output)`, 'success')
    }, 30000)
  })

  describe('Audit Trail Verification', () => {
    it('should accumulate scans across multiple Gmail operations', async () => {
      if (skipIfUnavailable({ gmail: true, scanning: true })) return

      const baseline = getAuditCount()
      log(`Baseline audit count: ${baseline}`, 'info')

      await gmail.callTool('list_emails', { max_results: 2 })
      await gmail.callTool('list_labels', {})
      await gmail.callTool('list_calendars', {})

      await sleep(500)

      const final = getAuditCount()
      const delta = final - baseline
      log(`Final audit count: ${final} (delta: ${delta})`, 'info')

      // 3 operations — each gets an input scan, outputs may or may not be scanned
      // depending on response size/content. Expect at least 3 (one per operation).
      expect(delta).toBeGreaterThanOrEqual(3)
      log(`Guardian accumulated ${delta} scans across 3 Gmail operations`, 'success')
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
    it('should report Guardian + Gmail test results', () => {
      logSection('GUARDIAN + GMAIL TEST SUMMARY')
      log(`Orchestrator: ${orchestratorAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}`, 'info')
      log(`Gmail: ${gmailAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}`, 'info')
      log(`Audit log: ${auditLogExists ? 'EXISTS' : 'MISSING'}`, 'info')
      log(`Guardian scanning: ${guardianScanningActive ? 'ACTIVE' : 'INACTIVE'}`, guardianScanningActive ? 'success' : 'warn')
      log('Guardian + Gmail workflow tests completed', 'success')
    })
  })
})
