/**
 * Orchestrator Integration Tests
 *
 * Tests the Orchestrator's coordination of all MCP servers
 * Prerequisites: All MCPs must be running (via launch-all.sh)
 *
 * This includes the Lifecycle Test that verifies end-to-end functionality
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  createTelegramClient,
  createFilerClient,
  createMemoryClient,
  log,
  logSection,
  MCPTestClient,
  MCP_URLS,
} from '../helpers/mcp-client.js'

describe('Orchestrator', () => {
  let telegramClient: MCPTestClient
  let filerClient: MCPTestClient
  let memoryClient: MCPTestClient

  beforeAll(() => {
    telegramClient = createTelegramClient()
    filerClient = createFilerClient()
    memoryClient = createMemoryClient()
    logSection('Orchestrator Integration Tests')
  })

  describe('Step 1: All MCPs Connected', () => {
    it('should have all MCPs healthy', async () => {
      log('Verifying all MCP connections...', 'info')

      const results = await Promise.all([
        telegramClient.healthCheck(),
        filerClient.healthCheck(),
        memoryClient.healthCheck(),
      ])

      const [telegram, filer, memory] = results

      log(`Telegram: ${telegram.healthy ? 'healthy' : 'unhealthy'} (${telegram.duration}ms)`, telegram.healthy ? 'success' : 'error')
      log(`Filer: ${filer.healthy ? 'healthy' : 'unhealthy'} (${filer.duration}ms)`, filer.healthy ? 'success' : 'error')
      log(`Memory: ${memory.healthy ? 'healthy' : 'unhealthy'} (${memory.duration}ms)`, memory.healthy ? 'success' : 'error')

      const allHealthy = telegram.healthy && filer.healthy && memory.healthy
      if (allHealthy) {
        log('All MCPs are connected and healthy', 'success')
      } else {
        log('Some MCPs are not healthy - check that launch-all.sh is running', 'error')
      }

      expect(telegram.healthy).toBe(true)
      expect(filer.healthy).toBe(true)
      expect(memory.healthy).toBe(true)
    })
  })

  describe('Step 2: System Status', () => {
    it('should report status from all MCPs', async () => {
      log('Checking system status via individual MCPs...', 'info')

      // Get stats/info from each MCP
      const [telegramChats, filerInfo, memoryStats] = await Promise.all([
        telegramClient.callTool('list_chats', {}),
        filerClient.callTool('get_workspace_info', {}),
        memoryClient.callTool('get_memory_stats', {}),
      ])

      log(`Telegram list_chats: ${telegramChats.success ? 'success' : 'failed'} (${telegramChats.duration}ms)`, telegramChats.success ? 'success' : 'error')
      log(`Filer workspace_info: ${filerInfo.success ? 'success' : 'failed'} (${filerInfo.duration}ms)`, filerInfo.success ? 'success' : 'error')
      log(`Memory stats: ${memoryStats.success ? 'success' : 'failed'} (${memoryStats.duration}ms)`, memoryStats.success ? 'success' : 'error')

      expect(telegramChats.success).toBe(true)
      expect(filerInfo.success).toBe(true)
      expect(memoryStats.success).toBe(true)
    })
  })

  describe('Step 3: Tool Routing - Telegram', () => {
    it('should route messages through Telegram MCP', async () => {
      log('Testing Telegram tool routing...', 'info')

      // Just verify we can call Telegram tools via subscribe_chat with action: list
      const result = await telegramClient.callTool('subscribe_chat', { action: 'list' })

      if (result.success) {
        log(`Telegram routing verified (${result.duration}ms)`, 'success')
      } else {
        log(`Telegram routing failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  describe('Step 4: Tool Routing - Memory', () => {
    it('should store and retrieve via Memory MCP', async () => {
      const testFact = `Lifecycle test fact at ${new Date().toISOString()}`
      log('Testing Memory store → retrieve cycle...', 'info')

      // Store a fact (use valid category: preference, background, pattern, project, contact, decision)
      const storeResult = await memoryClient.callTool('store_fact', {
        fact: testFact,
        category: 'preference',
      })

      if (storeResult.success) {
        log(`Fact stored successfully (${storeResult.duration}ms)`, 'success')
      } else {
        log(`Fact store failed: ${storeResult.error}`, 'error')
        expect(storeResult.success).toBe(true)
        return
      }

      // Retrieve facts
      const listResult = await memoryClient.callTool('list_facts', {
        category: 'preference',
      })

      if (listResult.success) {
        log(`Facts retrieved successfully (${listResult.duration}ms)`, 'success')
        log('Memory store → retrieve cycle verified', 'success')
      } else {
        log(`Fact retrieval failed: ${listResult.error}`, 'error')
      }

      expect(storeResult.success).toBe(true)
      expect(listResult.success).toBe(true)
    })
  })

  describe('Step 5: Tool Routing - Filer', () => {
    it('should create and read via Filer MCP', async () => {
      // Use relative workspace path (Filer MCP only allows workspace paths)
      const testPath = `lifecycle-test-${Date.now()}.txt`
      const testContent = `Lifecycle test content at ${new Date().toISOString()}`
      log('Testing Filer create → read cycle...', 'info')

      // Create file
      const createResult = await filerClient.callTool('create_file', {
        path: testPath,
        content: testContent,
      })

      if (createResult.success) {
        log(`File created successfully (${createResult.duration}ms)`, 'success')
      } else {
        log(`File create failed: ${createResult.error}`, 'error')
        expect(createResult.success).toBe(true)
        return
      }

      // Read file
      const readResult = await filerClient.callTool('read_file', {
        path: testPath,
      })

      if (readResult.success) {
        log(`File read successfully (${readResult.duration}ms)`, 'success')
        log('Filer create → read cycle verified', 'success')
      } else {
        log(`File read failed: ${readResult.error}`, 'error')
      }

      // Cleanup
      await filerClient.callTool('delete_file', { path: testPath })

      expect(createResult.success).toBe(true)
      expect(readResult.success).toBe(true)
    })
  })

  describe('Step 6: Rapid Tool Calls', () => {
    it('should handle multiple rapid tool calls', async () => {
      const callCount = 20 // Reduced from 50 for faster tests
      log(`Making ${callCount} rapid tool calls...`, 'info')

      const startTime = Date.now()
      const calls: Promise<{ success: boolean; duration: number }>[] = []

      for (let i = 0; i < callCount; i++) {
        calls.push(memoryClient.callTool('get_memory_stats', {}))
      }

      const results = await Promise.all(calls)
      const totalDuration = Date.now() - startTime

      const successCount = results.filter((r) => r.success).length
      const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length

      log(`Completed ${successCount}/${callCount} calls in ${totalDuration}ms`, successCount === callCount ? 'success' : 'warn')
      log(`Average call duration: ${avgDuration.toFixed(0)}ms`, 'debug')

      expect(successCount).toBe(callCount)
    })
  })

  describe('Step 7: Error Handling', () => {
    it('should handle invalid tool arguments gracefully', async () => {
      log('Testing error handling with invalid arguments...', 'info')

      // Try to read a non-existent file
      const result = await filerClient.callTool('read_file', {
        path: '/nonexistent/path/that/does/not/exist/12345.txt',
      })

      log(`Invalid path response (${result.duration}ms): success=${result.success}`, 'debug')

      // The response should be graceful (not crash)
      // Either returns error or success=false
      expect(result.duration).toBeLessThan(10000)
      log('Error handling verified - no crash on invalid input', 'success')
    })

    it('should handle empty arguments gracefully', async () => {
      log('Testing error handling with missing arguments...', 'info')

      // Try to store a fact without required fields
      const result = await memoryClient.callTool('store_fact', {})

      log(`Missing args response (${result.duration}ms): success=${result.success}`, 'debug')

      // Should not crash
      expect(result.duration).toBeLessThan(10000)
      log('Empty argument handling verified', 'success')
    })
  })

  describe('Lifecycle Summary', () => {
    it('should complete full lifecycle test', async () => {
      logSection('LIFECYCLE TEST SUMMARY')

      const checks = [
        { name: 'All MCPs healthy', check: async () => {
          const results = await Promise.all([
            telegramClient.healthCheck(),
            filerClient.healthCheck(),
            memoryClient.healthCheck(),
          ])
          return results.every(r => r.healthy)
        }},
        { name: 'Telegram routing', check: async () => {
          const result = await telegramClient.callTool('list_chats', {})
          return result.success
        }},
        { name: 'Memory routing', check: async () => {
          const result = await memoryClient.callTool('get_memory_stats', {})
          return result.success
        }},
        { name: 'Filer routing', check: async () => {
          const result = await filerClient.callTool('get_workspace_info', {})
          return result.success
        }},
      ]

      const results: { name: string; passed: boolean }[] = []

      for (const { name, check } of checks) {
        try {
          const passed = await check()
          results.push({ name, passed })
          log(`${name}: ${passed ? 'PASS' : 'FAIL'}`, passed ? 'success' : 'error')
        } catch (error) {
          results.push({ name, passed: false })
          log(`${name}: FAIL (${error})`, 'error')
        }
      }

      const passedCount = results.filter(r => r.passed).length
      const totalCount = results.length

      console.log('')
      log(`━━━ Results: ${passedCount}/${totalCount} passed ━━━`, passedCount === totalCount ? 'success' : 'error')
      console.log('')

      expect(passedCount).toBe(totalCount)
    })
  })
})
