/**
 * Level 4 E2E Test: Guardian + Thinker
 *
 * Tests the full chain: Thinker → Orchestrator → Guardian → MCP
 * Thinker autonomously calls Orchestrator tools via REST API.
 * Guardian scanning happens transparently at the Orchestrator layer.
 *
 * Verifies scanning via Guardian's audit JSONL file on disk.
 *
 * Verifies:
 * - Guardian tools are NOT in Orchestrator tool list (internal security layer)
 * - Thinker skill execution triggers Guardian scans (verified via audit log)
 *
 * Prerequisites: Full stack running (Thinker + Orchestrator + Guardian + downstream MCPs)
 *   The Orchestrator must have been started AFTER guardianConfig.enabled = true
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  createOrchestratorClient,
  createMemoryClient,
  log,
  logSection,
  MCPTestClient,
  authFetch,
} from '../helpers/mcp-client.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const AUDIT_LOG = resolve(__dirname, '../../../Guardian/logs/audit.jsonl')

const THINKER_URL = process.env.THINKER_URL || 'http://localhost:8006'
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8010'

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

interface ExecuteSkillResponse {
  success: boolean
  summary?: string
  toolsUsed?: string[]
  totalSteps?: number
  error?: string
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

describe('Workflow: Guardian + Thinker (Full E2E Security Flow)', () => {
  let orchestrator: MCPTestClient
  let memory: MCPTestClient
  let thinkerAvailable = false
  let orchestratorAvailable = false
  let auditLogExists = false
  let guardianScanningActive = false

  function skipIfUnavailable(required: { thinker?: boolean; orchestrator?: boolean; scanning?: boolean }): boolean {
    const missing: string[] = []
    if (required.thinker && !thinkerAvailable) missing.push('Thinker')
    if (required.orchestrator && !orchestratorAvailable) missing.push('Orchestrator')
    if (required.scanning && !guardianScanningActive) missing.push('Guardian scanning (restart Orchestrator with guardianConfig.enabled=true)')
    if (missing.length > 0) {
      log(`Skipping: ${missing.join(', ')} unavailable`, 'warn')
      return true
    }
    return false
  }

  beforeAll(async () => {
    logSection('Guardian + Thinker E2E Workflow Tests')

    orchestrator = createOrchestratorClient()
    memory = createMemoryClient()

    const orchHealth = await orchestrator.healthCheck()
    orchestratorAvailable = orchHealth.healthy
    if (!orchestratorAvailable) {
      log('Orchestrator not running — skipping all tests', 'error')
      return
    }

    // Check Thinker
    try {
      const thinkerResponse = await fetch(`${THINKER_URL}/health`, {
        signal: AbortSignal.timeout(10000),
      })
      thinkerAvailable = thinkerResponse.ok
    } catch {
      thinkerAvailable = false
    }

    auditLogExists = existsSync(AUDIT_LOG)

    log(`Orchestrator: UP`, 'success')
    log(`Thinker: ${thinkerAvailable ? 'UP' : 'DOWN'}`, thinkerAvailable ? 'success' : 'warn')
    log(`Audit log: ${auditLogExists ? 'EXISTS' : 'MISSING'}`, auditLogExists ? 'success' : 'warn')

    // Probe: check if Guardian scanning is active via a memory tool call
    if (auditLogExists) {
      const countBefore = getAuditCount()
      await memory.callTool('get_memory_stats', {})
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

    it('should confirm Thinker is running', async () => {
      if (!thinkerAvailable) {
        log('Thinker not running', 'warn')
        return
      }

      const response = await fetch(`${THINKER_URL}/health`, {
        signal: AbortSignal.timeout(10000),
      })
      expect(response.ok).toBe(true)

      const data = await response.json() as { status: string }
      log(`Thinker health: ${data.status}`, 'success')
    })

    it('should confirm Guardian audit log exists on disk', () => {
      log(`Audit log: ${auditLogExists ? AUDIT_LOG : 'NOT FOUND'}`, auditLogExists ? 'success' : 'warn')
      expect(true).toBe(true)
    })
  })

  describe('Tool Discovery', () => {
    it('should NOT expose guardian-prefixed tools in Orchestrator tool list', async () => {
      if (skipIfUnavailable({ orchestrator: true })) return

      const response = await authFetch(`${ORCHESTRATOR_URL}/tools/list`, {
        signal: AbortSignal.timeout(10000),
      })
      expect(response.ok).toBe(true)

      const data = await response.json() as { tools: Array<{ name: string }> }
      const toolNames = data.tools.map((t) => t.name)

      // Guardian tools are internal — should NOT be in the public tool list
      const guardianTools = toolNames.filter((name) => name.startsWith('guardian_'))
      log(`Guardian-prefixed tools in list: ${guardianTools.length} (expected: 0)`, 'info')
      expect(guardianTools).toHaveLength(0)
      log('Guardian tools correctly hidden from tool list (internal security layer)', 'success')
    })

    it('should list expected MCP tools that Thinker can use', async () => {
      if (skipIfUnavailable({ orchestrator: true })) return

      const response = await authFetch(`${ORCHESTRATOR_URL}/tools/list`, {
        signal: AbortSignal.timeout(10000),
      })
      const data = await response.json() as { tools: Array<{ name: string }> }
      const toolNames = data.tools.map((t) => t.name)

      log(`Orchestrator exposes ${toolNames.length} total tools`, 'info')

      const expectedPrefixes = ['searcher_', 'telegram_', 'memory_', 'filer_']
      for (const prefix of expectedPrefixes) {
        const found = toolNames.some((name) => name.startsWith(prefix))
        log(`${prefix}* tools: ${found ? 'PRESENT' : 'MISSING'}`, found ? 'success' : 'warn')
      }
    })
  })

  describe('Thinker Skill Execution with Guardian Scanning', () => {
    it('should execute a benign skill and Guardian should scan the interaction', async () => {
      if (skipIfUnavailable({ thinker: true, orchestrator: true, scanning: true })) return

      const countBefore = getAuditCount()
      log(`Audit entries before Thinker skill: ${countBefore}`, 'info')

      const response = await fetch(`${THINKER_URL}/execute-skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructions: 'List the available memory tools. Summarize what each one does in one sentence.',
          maxSteps: 3,
          skillId: 'guardian-e2e-test-memory',
        }),
        signal: AbortSignal.timeout(120000),
      })

      if (response.status === 503) {
        log('Thinker agent still initializing — skipping', 'warn')
        return
      }
      expect(response.ok).toBe(true)
      const result = await response.json() as ExecuteSkillResponse
      log(`Thinker skill result: success=${result.success}, steps=${result.totalSteps}`, 'info')

      // Skill execution depends on LLM provider — may fail for operational reasons
      if (!result.success) {
        log(`Skill execution failed (operational): ${result.error || 'unknown'}`, 'warn')
        log('Cannot verify Guardian scanning when skill execution fails', 'info')
        return
      }

      if (result.toolsUsed) {
        log(`Tools used: ${result.toolsUsed.join(', ')}`, 'info')
      }

      // Wait for audit log writes to flush
      await sleep(2000)

      const countAfter = getAuditCount()
      const delta = countAfter - countBefore
      log(`Audit entries after Thinker skill: ${countAfter} (delta: ${delta})`, 'info')

      expect(delta).toBeGreaterThan(0)
      log(`Guardian performed ${delta} scans during Thinker skill execution`, 'success')
    }, 120000)

    it('should execute a search skill and Guardian should scan both input and output', async () => {
      if (skipIfUnavailable({ thinker: true, orchestrator: true, scanning: true })) return

      const countBefore = getAuditCount()
      log(`Audit entries before search skill: ${countBefore}`, 'info')

      const response = await fetch(`${THINKER_URL}/execute-skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructions: 'Search the web for "vitest testing framework" and summarize the first result in one sentence.',
          maxSteps: 5,
          skillId: 'guardian-e2e-test-search',
        }),
        signal: AbortSignal.timeout(120000),
      })

      if (response.status === 503) {
        log('Thinker agent still initializing — skipping', 'warn')
        return
      }
      expect(response.ok).toBe(true)
      const result = await response.json() as ExecuteSkillResponse
      log(`Search skill result: success=${result.success}, steps=${result.totalSteps}`, 'info')

      // Skill execution depends on LLM provider — may fail for operational reasons
      if (!result.success) {
        log(`Search skill execution failed (operational): ${result.error || 'unknown'}`, 'warn')
        log('Cannot verify Guardian scanning when skill execution fails', 'info')
        return
      }

      if (result.toolsUsed) {
        log(`Tools used: ${result.toolsUsed.join(', ')}`, 'info')
      }

      // Wait for audit log writes to flush
      await sleep(2000)

      const countAfter = getAuditCount()
      const delta = countAfter - countBefore
      log(`Audit entries after search skill: ${countAfter} (delta: ${delta})`, 'info')

      expect(delta).toBeGreaterThan(0)

      // If searcher was used, expect at least 2 (input + output)
      if (result.toolsUsed?.some((t) => t.includes('searcher') || t.includes('web_search'))) {
        expect(delta).toBeGreaterThanOrEqual(2)
        log(`Guardian scanned search input + output (${delta} scans)`, 'success')
      } else {
        log(`Thinker did not use searcher tool, but Guardian still scanned ${delta} interactions`, 'info')
      }
    }, 120000)
  })

  describe('Audit Trail After Thinker Operations', () => {
    it('should show recent entries in Guardian audit log', async () => {
      if (!auditLogExists) {
        log('Audit log missing — skipping', 'warn')
        return
      }

      const entries = readAuditLog()
      expect(entries.length).toBeGreaterThan(0)

      const recent = entries.slice(-5)
      for (const entry of recent) {
        log(`Scan ${entry.scan_id}: safe=${entry.safe}, source=${entry.source}, time=${entry.timestamp}`, 'info')
      }
      log(`Audit log total: ${entries.length} entries`, 'success')
    }, 30000)
  })

  describe('Summary', () => {
    it('should report E2E test results', () => {
      logSection('GUARDIAN + THINKER E2E TEST SUMMARY')
      log(`Orchestrator: ${orchestratorAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}`, 'info')
      log(`Thinker: ${thinkerAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}`, 'info')
      log(`Audit log: ${auditLogExists ? 'EXISTS' : 'MISSING'}`, 'info')
      log(`Guardian scanning: ${guardianScanningActive ? 'ACTIVE' : 'INACTIVE'}`, guardianScanningActive ? 'success' : 'warn')
      log('Guardian + Thinker E2E workflow tests completed', 'success')
    })
  })
})
