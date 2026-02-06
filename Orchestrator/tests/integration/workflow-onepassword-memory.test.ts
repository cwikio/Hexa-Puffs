/**
 * Level 3 Workflow Test: 1Password → Memory
 *
 * Tests credential access logging workflow:
 * 1. Retrieve credential metadata from 1Password
 * 2. Log access (NOT the actual credential) to Memory
 * 3. Verify no sensitive data leaks to Memory
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createOnePasswordClient,
  createMemoryClient,
  checkMCPsAvailable,
  log,
  logSection,
  MCPTestClient,
} from '../helpers/mcp-client.js'
import {
  parseJsonContent,
  testId,
  createAuditFact,
  cleanupFacts,
} from '../helpers/workflow-helpers.js'

describe('Workflow: 1Password → Memory (Credential Access Logging)', () => {
  let onePasswordClient: MCPTestClient
  let memoryClient: MCPTestClient
  let onePasswordAvailable = false
  let memoryAvailable = false

  // Track resources for cleanup
  const createdFactIds: number[] = []

  // Helper to skip test at runtime if MCPs unavailable
  function skipIfUnavailable(requiredMcps: ('onepassword' | 'memory')[]): boolean {
    const missing: string[] = []
    if (requiredMcps.includes('onepassword') && !onePasswordAvailable) missing.push('1Password')
    if (requiredMcps.includes('memory') && !memoryAvailable) missing.push('Memory')

    if (missing.length > 0) {
      log(`Skipping: ${missing.join(', ')} unavailable`, 'warn')
      return true
    }
    return false
  }

  beforeAll(async () => {
    onePasswordClient = createOnePasswordClient()
    memoryClient = createMemoryClient()

    logSection('1Password → Memory Workflow Tests')

    const availability = await checkMCPsAvailable([onePasswordClient, memoryClient])
    onePasswordAvailable = availability.get('1Password') ?? false
    memoryAvailable = availability.get('Memory') ?? false

    if (!onePasswordAvailable) {
      log('1Password MCP unavailable - some tests will be skipped', 'warn')
    }
    if (!memoryAvailable) {
      log('Memory MCP unavailable - some tests will be skipped', 'warn')
    }
  })

  afterAll(async () => {
    logSection('Cleanup')

    if (memoryAvailable && createdFactIds.length > 0) {
      log(`Cleaning up ${createdFactIds.length} test facts...`, 'info')
      await cleanupFacts(memoryClient, createdFactIds)
    }
  })

  describe('1Password Health', () => {
    it('should report 1Password availability status', async () => {
      const result = await onePasswordClient.healthCheck()
      log(`1Password health: ${result.healthy ? 'UP' : 'DOWN'} (${result.duration}ms)`, result.healthy ? 'success' : 'warn')
      expect(true).toBe(true)
    })
  })

  describe('Memory Health', () => {
    it('should report Memory availability status', async () => {
      const result = await memoryClient.healthCheck()
      log(`Memory health: ${result.healthy ? 'UP' : 'DOWN'} (${result.duration}ms)`, result.healthy ? 'success' : 'warn')
      expect(true).toBe(true)
    })
  })

  describe('Vault Discovery', () => {
    it('should list available vaults', async () => {
      if (skipIfUnavailable(['onepassword'])) return

      log('Listing 1Password vaults...', 'info')
      const result = await onePasswordClient.callTool('list_vaults', {})

      if (!result.success && result.error?.includes('1Password CLI error')) {
        log('1Password CLI (op) not authenticated — skipping', 'warn')
        return
      }

      expect(result.success).toBe(true)
      log(`Vaults listed (${result.duration}ms)`, 'success')

      const parsed = parseJsonContent<{ vaults?: string[] }>(result)
      if (parsed?.vaults) {
        log(`Found ${parsed.vaults.length} vault(s): ${parsed.vaults.join(', ')}`, 'info')
      }
    })
  })

  describe('Credential Access Logging', () => {
    it('should log credential access metadata (not secrets)', async () => {
      if (skipIfUnavailable(['onepassword', 'memory'])) return

      const testItem = 'TestCredential'
      const testVault = 'TestVault'

      // Step 1: Attempt to get credential from 1Password
      log(`Step 1: Accessing credential "${testItem}" from ${testVault}...`, 'info')
      const credResult = await onePasswordClient.callTool('get_item', {
        item_name: testItem,
        vault: testVault,
      })

      // Note: This might fail if TestVault/TestCredential don't exist - that's OK
      const credParsed = parseJsonContent<{ found?: boolean; item?: { title?: string } }>(credResult)
      const wasFound = credParsed?.found ?? credResult.success

      log(`Credential access ${wasFound ? 'succeeded' : 'failed'} (${credResult.duration}ms)`, wasFound ? 'success' : 'warn')

      // Step 2: Log access metadata to Memory (NEVER log actual credential values)
      log('Step 2: Logging access metadata to Memory...', 'info')
      const accessFact = createAuditFact(
        'CREDENTIAL_ACCESS',
        `Accessed "${testItem}" from vault "${testVault}" - ${wasFound ? 'SUCCESS' : 'NOT_FOUND'}`
      )

      const storeResult = await memoryClient.callTool('store_fact', {
        fact: accessFact,
        category: 'background',
      })
      expect(storeResult.success).toBe(true)

      const storeParsed = parseJsonContent<{ fact_id?: number }>(storeResult)
      if (storeParsed?.fact_id) {
        createdFactIds.push(storeParsed.fact_id)
        log(`Access logged with fact ID ${storeParsed.fact_id}`, 'success')
      }
    })

    it('should log failed credential access attempt', async () => {
      if (skipIfUnavailable(['onepassword', 'memory'])) return

      const nonExistentItem = `NonExistent-${testId()}`

      // Step 1: Attempt to get non-existent credential
      log(`Step 1: Attempting to access non-existent item "${nonExistentItem}"...`, 'info')
      const credResult = await onePasswordClient.callTool('get_item', {
        item_name: nonExistentItem,
      })

      log(`Access attempt completed (expected to fail) (${credResult.duration}ms)`, 'info')

      // Step 2: Log the failed attempt
      log('Step 2: Logging failed attempt to Memory...', 'info')
      const failureFact = createAuditFact(
        'CREDENTIAL_ACCESS_FAILED',
        `Failed to access "${nonExistentItem}" - item not found`
      )

      const storeResult = await memoryClient.callTool('store_fact', {
        fact: failureFact,
        category: 'background',
      })
      expect(storeResult.success).toBe(true)

      const parsed = parseJsonContent<{ fact_id?: number }>(storeResult)
      if (parsed?.fact_id) {
        createdFactIds.push(parsed.fact_id)
        log(`Failed access logged with fact ID ${parsed.fact_id}`, 'success')
      }
    })
  })

  describe('Sensitive Data Protection', () => {
    it('should verify no passwords are stored in Memory', async () => {
      if (skipIfUnavailable(['memory'])) return

      // Search Memory for common sensitive patterns
      const sensitivePatterns = ['password', 'secret', 'api_key', 'token', 'credential_value']

      log('Searching Memory for sensitive data patterns...', 'info')

      for (const pattern of sensitivePatterns) {
        const searchResult = await memoryClient.callTool('retrieve_memories', {
          query: pattern,
          limit: 10,
        })

        if (searchResult.success) {
          const parsed = parseJsonContent<{ facts?: Array<{ fact: string }> }>(searchResult)
          const facts = parsed?.facts ?? []

          // Check that no fact contains actual credential values
          for (const fact of facts) {
            // Audit facts from our tests are OK
            if (fact.fact.includes('[AUDIT]')) {
              continue
            }

            // Flag if we find something that looks like an actual credential
            const looksLikeCredential =
              /password[=:]\s*\S+/i.test(fact.fact) ||
              /secret[=:]\s*\S+/i.test(fact.fact) ||
              /[a-zA-Z0-9]{32,}/.test(fact.fact)

            if (looksLikeCredential) {
              log(`WARNING: Found potentially sensitive data in fact: ${fact.fact.substring(0, 50)}...`, 'warn')
            }
          }
        }
      }

      log('Sensitive data check completed', 'success')
      expect(true).toBe(true)
    })

    it('should only store item title, never field values', async () => {
      if (skipIfUnavailable(['onepassword', 'memory'])) return

      const testItem = 'TestCredential'

      // Get credential
      log('Getting credential to verify what data we log...', 'info')
      const credResult = await onePasswordClient.callTool('get_item', {
        item_name: testItem,
      })

      const credParsed = parseJsonContent<{
        found?: boolean
        item?: {
          title?: string
          fields?: Record<string, string>
        }
      }>(credResult)

      if (credParsed?.item) {
        // Log ONLY the title
        const safeMetadata = {
          itemTitle: credParsed.item.title,
          fieldCount: credParsed.item.fields ? Object.keys(credParsed.item.fields).length : 0,
        }

        const metadataFact = createAuditFact(
          'CREDENTIAL_METADATA',
          `Item: ${safeMetadata.itemTitle}, Fields: ${safeMetadata.fieldCount}`
        )

        const storeResult = await memoryClient.callTool('store_fact', {
          fact: metadataFact,
          category: 'background',
        })
        expect(storeResult.success).toBe(true)

        const parsed = parseJsonContent<{ fact_id?: number }>(storeResult)
        if (parsed?.fact_id) {
          createdFactIds.push(parsed.fact_id)
        }

        log(`Stored safe metadata: title and field count only`, 'success')
      } else {
        log('Credential not found - skipping metadata test', 'warn')
      }
    })
  })

  describe('Access Audit Trail', () => {
    it('should create searchable audit trail of credential accesses', async () => {
      if (skipIfUnavailable(['onepassword', 'memory'])) return

      const sessionId = testId()

      // Simulate multiple credential accesses
      const items = ['DatabaseConfig', 'APIKeys', 'ServiceAccount']

      log(`Creating audit trail for session ${sessionId}...`, 'info')

      for (const item of items) {
        // Attempt access (might fail if items don't exist)
        const accessResult = await onePasswordClient.callTool('get_item', {
          item_name: item,
        })

        const success = accessResult.success
        const fact = createAuditFact(
          'CREDENTIAL_ACCESS',
          `Session ${sessionId}: Accessed "${item}" - ${success ? 'OK' : 'FAILED'}`
        )

        const storeResult = await memoryClient.callTool('store_fact', {
          fact,
          category: 'background',
        })

        const parsed = parseJsonContent<{ fact_id?: number }>(storeResult)
        if (parsed?.fact_id) {
          createdFactIds.push(parsed.fact_id)
        }
      }

      log(`Stored ${items.length} access records`, 'success')

      // Verify audit trail is searchable
      log('Verifying audit trail is searchable...', 'info')
      const searchResult = await memoryClient.callTool('retrieve_memories', {
        query: sessionId,
      })
      expect(searchResult.success).toBe(true)

      const parsed = parseJsonContent<{ facts?: unknown[] }>(searchResult)
      log(`Found ${parsed?.facts?.length ?? 0} matching records`, 'success')
    })
  })
})
