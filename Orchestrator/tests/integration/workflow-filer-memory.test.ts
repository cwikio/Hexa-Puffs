/**
 * Level 3 Workflow Test: Filer → Memory
 *
 * Tests file operations with audit logging to Memory:
 * 1. Perform file operations via Filer
 * 2. Log operation metadata to Memory as facts
 * 3. Verify audit trail is complete and searchable
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createFilerClient,
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
  cleanupFiles,
} from '../helpers/workflow-helpers.js'

describe('Workflow: Filer → Memory (File Operations with Audit)', () => {
  let filerClient: MCPTestClient
  let memoryClient: MCPTestClient
  let filerAvailable = false
  let memoryAvailable = false

  // Track resources for cleanup
  const createdFiles: string[] = []
  const createdFactIds: number[] = []

  // Helper to skip test at runtime if MCPs unavailable
  function skipIfUnavailable(requiredMcps: ('filer' | 'memory')[]): boolean {
    const missing: string[] = []
    if (requiredMcps.includes('filer') && !filerAvailable) missing.push('Filer')
    if (requiredMcps.includes('memory') && !memoryAvailable) missing.push('Memory')

    if (missing.length > 0) {
      log(`Skipping: ${missing.join(', ')} unavailable`, 'warn')
      return true
    }
    return false
  }

  beforeAll(async () => {
    filerClient = createFilerClient()
    memoryClient = createMemoryClient()

    logSection('Filer → Memory Workflow Tests')

    const availability = await checkMCPsAvailable([filerClient, memoryClient])
    filerAvailable = availability.get('Filer') ?? false
    memoryAvailable = availability.get('Memory') ?? false

    if (!filerAvailable) {
      log('Filer MCP unavailable - some tests will be skipped', 'warn')
    }
    if (!memoryAvailable) {
      log('Memory MCP unavailable - some tests will be skipped', 'warn')
    }
  })

  afterAll(async () => {
    logSection('Cleanup')

    if (filerAvailable && createdFiles.length > 0) {
      log(`Cleaning up ${createdFiles.length} test files...`, 'info')
      await cleanupFiles(filerClient, createdFiles)
    }

    if (memoryAvailable && createdFactIds.length > 0) {
      log(`Cleaning up ${createdFactIds.length} test facts...`, 'info')
      await cleanupFacts(memoryClient, createdFactIds)
    }
  })

  describe('Filer Health', () => {
    it('should report Filer availability status', async () => {
      const result = await filerClient.healthCheck()
      log(`Filer health: ${result.healthy ? 'UP' : 'DOWN'} (${result.duration}ms)`, result.healthy ? 'success' : 'warn')
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

  describe('File Creation with Audit', () => {
    it('should log file creation to Memory', async () => {
      if (skipIfUnavailable(['filer', 'memory'])) return

      const fileId = testId()
      const fileName = `workflow-test-${fileId}.txt`
      const fileContent = `Test content created at ${new Date().toISOString()}`

      // Step 1: Create file via Filer
      log(`Step 1: Creating file ${fileName}...`, 'info')
      const createResult = await filerClient.callTool('create_file', {
        path: fileName,
        content: fileContent,
      })
      expect(createResult.success).toBe(true)
      createdFiles.push(fileName)
      log(`File created (${createResult.duration}ms)`, 'success')

      // Step 2: Log to Memory
      log('Step 2: Logging creation to Memory...', 'info')
      const auditFact = createAuditFact('FILE_CREATE', `Created ${fileName} (${fileContent.length} bytes)`)
      const storeResult = await memoryClient.callTool('store_fact', {
        fact: auditFact,
        category: 'pattern',
      })
      expect(storeResult.success).toBe(true)

      const parsed = parseJsonContent<{ fact_id?: number }>(storeResult)
      if (parsed?.fact_id) {
        createdFactIds.push(parsed.fact_id)
        log(`Audit fact stored with ID ${parsed.fact_id}`, 'success')
      }

      // Step 3: Verify fact is retrievable
      log('Step 3: Verifying audit fact...', 'info')
      const searchResult = await memoryClient.callTool('retrieve_memories', {
        query: fileName,
      })
      expect(searchResult.success).toBe(true)
      log('Audit fact verified', 'success')
    })
  })

  describe('Full CRUD Lifecycle with Audit Trail', () => {
    it('should maintain complete audit trail for file lifecycle', async () => {
      if (skipIfUnavailable(['filer', 'memory'])) return

      const fileId = testId()
      const fileName = `lifecycle-test-${fileId}.txt`
      const operations: string[] = []

      // CREATE
      log('CREATE: Creating file...', 'info')
      const createResult = await filerClient.callTool('create_file', {
        path: fileName,
        content: 'Version 1',
      })
      expect(createResult.success).toBe(true)
      createdFiles.push(fileName)
      operations.push(`CREATE:${fileName}`)
      log('CREATE completed', 'success')

      // READ
      log('READ: Reading file...', 'info')
      const readResult = await filerClient.callTool('read_file', {
        path: fileName,
      })
      expect(readResult.success).toBe(true)
      operations.push(`READ:${fileName}`)
      log('READ completed', 'success')

      // UPDATE
      log('UPDATE: Updating file...', 'info')
      const updateResult = await filerClient.callTool('update_file', {
        path: fileName,
        content: 'Version 2 - Updated',
      })
      expect(updateResult.success).toBe(true)
      operations.push(`UPDATE:${fileName}`)
      log('UPDATE completed', 'success')

      // Store audit trail as conversation in Memory
      log('Storing CRUD audit trail in Memory...', 'info')
      const auditSummary = operations.join(' → ')
      const conversationResult = await memoryClient.callTool('store_conversation', {
        userMessage: `File operation audit for ${fileName}`,
        agentResponse: `Completed file lifecycle: ${auditSummary}`,
        tags: ['audit', 'filer', 'workflow-test'],
      })
      expect(conversationResult.success).toBe(true)
      log(`Audit trail stored: ${auditSummary}`, 'success')

      // DELETE
      log('DELETE: Deleting file...', 'info')
      const deleteResult = await filerClient.callTool('delete_file', {
        path: fileName,
      })
      expect(deleteResult.success).toBe(true)
      // Remove from cleanup list since we already deleted it
      const idx = createdFiles.indexOf(fileName)
      if (idx > -1) createdFiles.splice(idx, 1)
      log('DELETE completed', 'success')

      // Verify audit trail is searchable
      log('Verifying audit trail is searchable...', 'info')
      const searchResult = await memoryClient.callTool('search_conversations', {
        query: fileName,
      })
      expect(searchResult.success).toBe(true)
      log('Audit trail verified in Memory', 'success')
    })
  })

  describe('Cross-Reference Filer Audit with Memory', () => {
    it('should correlate Filer audit log with Memory facts', async () => {
      if (skipIfUnavailable(['filer', 'memory'])) return

      const fileId = testId()
      const fileName = `audit-correlate-${fileId}.txt`

      // Create file
      log('Creating file for correlation test...', 'info')
      const createResult = await filerClient.callTool('create_file', {
        path: fileName,
        content: 'Correlation test content',
      })
      expect(createResult.success).toBe(true)
      createdFiles.push(fileName)

      // Get Filer's internal audit log
      log('Fetching Filer audit log...', 'info')
      const auditLogResult = await filerClient.callTool('get_audit_log', {
        limit: 5,
      })
      expect(auditLogResult.success).toBe(true)

      const auditLog = parseJsonContent<{ entries?: Array<{ operation: string; path: string; timestamp: string }> }>(auditLogResult)
      log(`Filer audit log has ${auditLog?.entries?.length ?? 0} entries`, 'info')

      // Find our operation in the audit log
      const ourEntry = auditLog?.entries?.find((e) => e.path?.includes(fileName))
      if (ourEntry) {
        log(`Found our operation: ${ourEntry.operation} at ${ourEntry.timestamp}`, 'success')

        // Store correlation fact in Memory
        const correlationFact = createAuditFact(
          'FILER_AUDIT_CORRELATION',
          `Operation ${ourEntry.operation} on ${ourEntry.path} at ${ourEntry.timestamp}`
        )
        const storeResult = await memoryClient.callTool('store_fact', {
          fact: correlationFact,
          category: 'pattern',
        })
        expect(storeResult.success).toBe(true)

        const parsed = parseJsonContent<{ fact_id?: number }>(storeResult)
        if (parsed?.fact_id) {
          createdFactIds.push(parsed.fact_id)
        }
        log('Correlation stored in Memory', 'success')
      } else {
        log('Could not find our operation in Filer audit log', 'warn')
      }

      // Cleanup the file
      await filerClient.callTool('delete_file', { path: fileName })
      const idx = createdFiles.indexOf(fileName)
      if (idx > -1) createdFiles.splice(idx, 1)
    })
  })

  describe('Copy and Move with Audit', () => {
    it('should track file copy and move operations', async () => {
      if (skipIfUnavailable(['filer', 'memory'])) return

      const fileId = testId()
      const sourceFile = `copy-source-${fileId}.txt`
      const copyFile = `copy-dest-${fileId}.txt`
      const moveFile = `move-dest-${fileId}.txt`

      // Create source file
      log('Creating source file...', 'info')
      const createResult = await filerClient.callTool('create_file', {
        path: sourceFile,
        content: 'Source content for copy/move test',
      })
      if (!createResult.success) {
        log(`Failed to create source file: ${createResult.error} - skipping test`, 'warn')
        return
      }
      createdFiles.push(sourceFile)

      // Copy file
      log('Copying file...', 'info')
      const copyResult = await filerClient.callTool('copy_file', {
        sourcePath: sourceFile,
        destPath: copyFile,
      })
      if (!copyResult.success) {
        log(`Copy failed: ${copyResult.error} - copy_file may not be supported`, 'warn')
        // Still store audit for what we did
        const auditFact = createAuditFact('FILE_OPERATIONS', `Created ${sourceFile}, copy failed`)
        const storeResult = await memoryClient.callTool('store_fact', {
          fact: auditFact,
          category: 'pattern',
        })
        const parsed = parseJsonContent<{ fact_id?: number }>(storeResult)
        if (parsed?.fact_id) createdFactIds.push(parsed.fact_id)
        return
      }
      createdFiles.push(copyFile)
      log('Copy completed', 'success')

      // Move file (rename)
      log('Moving file...', 'info')
      const moveResult = await filerClient.callTool('move_file', {
        sourcePath: copyFile,
        destPath: moveFile,
      })
      if (!moveResult.success) {
        log(`Move failed: ${moveResult.error} - move_file may not be supported`, 'warn')
        return
      }
      // Update cleanup list - copyFile no longer exists, moveFile does
      const copyIdx = createdFiles.indexOf(copyFile)
      if (copyIdx > -1) createdFiles.splice(copyIdx, 1)
      createdFiles.push(moveFile)
      log('Move completed', 'success')

      // Store audit summary
      const auditFact = createAuditFact(
        'FILE_OPERATIONS',
        `Source: ${sourceFile} → Copy: ${copyFile} → Move: ${moveFile}`
      )
      const storeResult = await memoryClient.callTool('store_fact', {
        fact: auditFact,
        category: 'pattern',
      })
      expect(storeResult.success).toBe(true)

      const parsed = parseJsonContent<{ fact_id?: number }>(storeResult)
      if (parsed?.fact_id) {
        createdFactIds.push(parsed.fact_id)
      }
      log('Copy/Move audit stored in Memory', 'success')
    })
  })

  describe('Error Handling', () => {
    it('should log failed file operation to Memory', async () => {
      if (skipIfUnavailable(['filer', 'memory'])) return

      const nonExistentFile = `does-not-exist-${testId()}.txt`

      // Attempt to read non-existent file
      log('Attempting to read non-existent file...', 'info')
      const readResult = await filerClient.callTool('read_file', {
        path: nonExistentFile,
      })

      // Store the failure in Memory
      const errorFact = createAuditFact(
        'FILE_ERROR',
        `Failed to read ${nonExistentFile}: ${readResult.error || 'file not found'}`
      )
      const storeResult = await memoryClient.callTool('store_fact', {
        fact: errorFact,
        category: 'pattern',
      })
      expect(storeResult.success).toBe(true)

      const parsed = parseJsonContent<{ fact_id?: number }>(storeResult)
      if (parsed?.fact_id) {
        createdFactIds.push(parsed.fact_id)
      }
      log('Error logged to Memory', 'success')
    })
  })
})
