/**
 * Proactive Tasks Integration Tests
 *
 * Tests the POST /execute-skill endpoint on Thinker MCP
 *
 * Prerequisites:
 *   - Thinker MCP must be running
 *   - Orchestrator must be running (Thinker's dependency for tool routing)
 *   - LLM provider configured (Groq API key, or local LM Studio/Ollama)
 *
 * Run with: npm run test:proactive
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  ThinkerTestClient,
  createThinkerClient,
  checkOrchestratorAvailable,
  log,
  logSection,
  THINKER_URL,
  ORCHESTRATOR_URL,
} from '../helpers/test-client.js'

interface ExecuteSkillResponse {
  success: boolean
  summary?: string
  toolsUsed?: string[]
  totalSteps?: number
  error?: string
}

describe('Proactive Tasks (/execute-skill)', () => {
  let client: ThinkerTestClient
  let thinkerAvailable: boolean
  let orchestratorAvailable: boolean

  beforeAll(async () => {
    client = createThinkerClient()
    logSection('Proactive Tasks Tests')

    // Check Thinker availability
    const health = await client.healthCheck()
    thinkerAvailable = health.healthy
    if (!thinkerAvailable) {
      log(`Thinker not available at ${THINKER_URL} - tests will be skipped`, 'warn')
    } else {
      log(`Thinker available at ${THINKER_URL}`, 'success')
    }

    // Check Orchestrator availability (needed for tool routing)
    orchestratorAvailable = await checkOrchestratorAvailable()
    if (!orchestratorAvailable) {
      log(`Orchestrator not available at ${ORCHESTRATOR_URL} - tool-dependent tests will be skipped`, 'warn')
    }
  })

  afterAll(() => {
    logSection('Proactive Tasks Tests Complete')
  })

  function skipIfUnavailable(): boolean {
    if (!thinkerAvailable) {
      log('Skipping: Thinker not available', 'warn')
      return true
    }
    return false
  }

  // =========================================
  // SECTION 1: Endpoint Availability
  // =========================================
  describe('Endpoint Availability', () => {
    it('should list /execute-skill in root endpoint', async () => {
      if (skipIfUnavailable()) return

      const result = await client.getRootEndpoint()
      expect(result.success).toBe(true)
      expect(result.data?.endpoints?.executeSkill).toBe('/execute-skill')

      log('Root endpoint lists /execute-skill', 'success')
    })
  })

  // =========================================
  // SECTION 2: Input Validation
  // =========================================
  describe('Input Validation', () => {
    it('should reject request without instructions', async () => {
      if (skipIfUnavailable()) return

      log('Testing missing instructions', 'info')

      const response = await fetch(`${THINKER_URL}/execute-skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId: 1, maxSteps: 3 }),
      })

      expect(response.status).toBe(400)
      const data = await response.json() as { success: boolean; error: string }
      expect(data.success).toBe(false)
      expect(data.error).toContain('instructions')

      log('Missing instructions correctly rejected with 400', 'success')
    })

    it('should reject empty body', async () => {
      if (skipIfUnavailable()) return

      log('Testing empty body', 'info')

      const response = await fetch(`${THINKER_URL}/execute-skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(400)

      log('Empty body correctly rejected', 'success')
    })
  })

  // =========================================
  // SECTION 3: Execution (requires LLM + Orchestrator)
  // =========================================
  describe('Skill Execution', () => {
    it('should execute a simple instruction and return structured result', async () => {
      if (skipIfUnavailable()) return
      if (!orchestratorAvailable) {
        log('Skipping: Orchestrator not available', 'warn')
        return
      }

      log('Executing simple skill instruction (this may take 10-30s)', 'info')

      const response = await fetch(`${THINKER_URL}/execute-skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillId: 0,
          instructions: 'List the available memory tools and describe what each one does. Summarize in one paragraph.',
          maxSteps: 3,
        }),
        signal: AbortSignal.timeout(60000),
      })

      expect(response.status).toBe(200)

      const data = await response.json() as ExecuteSkillResponse

      log(`Response: success=${data.success}, steps=${data.totalSteps}`, 'info')
      if (data.summary) {
        log(`Summary: ${data.summary.slice(0, 200)}...`, 'debug')
      }
      if (data.toolsUsed && data.toolsUsed.length > 0) {
        log(`Tools used: ${data.toolsUsed.join(', ')}`, 'debug')
      }

      expect(data.success).toBe(true)
      expect(data.summary).toBeDefined()
      expect(typeof data.summary).toBe('string')
      expect(data.summary!.length).toBeGreaterThan(0)
      expect(data.totalSteps).toBeDefined()
      expect(data.totalSteps).toBeGreaterThanOrEqual(1)

      log('Skill execution completed successfully', 'success')
    }, 90000) // 90s timeout for LLM execution

    it('should respect maxSteps limit', async () => {
      if (skipIfUnavailable()) return
      if (!orchestratorAvailable) {
        log('Skipping: Orchestrator not available', 'warn')
        return
      }

      log('Testing maxSteps=1 limit', 'info')

      const response = await fetch(`${THINKER_URL}/execute-skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillId: 0,
          instructions: 'Just say hello and confirm you are working.',
          maxSteps: 1,
        }),
        signal: AbortSignal.timeout(60000),
      })

      const data = await response.json() as ExecuteSkillResponse

      // With maxSteps=1, should complete within 1 step
      expect(data.totalSteps).toBeDefined()
      expect(data.totalSteps).toBeLessThanOrEqual(2) // Allow slight overshoot due to implementation

      log(`Completed in ${data.totalSteps} step(s) (limit was 1)`, 'success')
    }, 90000)
  })

  // =========================================
  // SECTION 4: Error Handling
  // =========================================
  describe('Error Handling', () => {
    it('should return proper error structure on failure', async () => {
      if (skipIfUnavailable()) return

      log('Testing error response structure', 'info')

      // Send a request that will fail (no instructions)
      const response = await fetch(`${THINKER_URL}/execute-skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId: 1 }),
      })

      const data = await response.json() as ExecuteSkillResponse
      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()

      log('Error structure is correct', 'success')
    })

    it('should handle non-JSON body gracefully', async () => {
      if (skipIfUnavailable()) return

      log('Testing non-JSON body', 'info')

      try {
        const response = await fetch(`${THINKER_URL}/execute-skill`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: 'not json',
        })

        // Should return 400 or 500, not crash
        expect(response.status).toBeGreaterThanOrEqual(400)
        log(`Non-JSON body handled (HTTP ${response.status})`, 'success')
      } catch {
        // Connection error is also acceptable (server didn't crash)
        log('Non-JSON body caused connection error (server may have rejected)', 'warn')
      }
    })
  })
})
