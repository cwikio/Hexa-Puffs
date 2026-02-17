/**
 * Memory MCP Integration Tests
 *
 * Tests the Memory (Memorizer) MCP server at http://localhost:8005
 * Prerequisites: Memorizer MCP must be running (via launch-all.sh)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createMemoryClient, log, logSection, MCPTestClient } from '../helpers/mcp-client.js'

describe('Memory MCP', () => {
  let client: MCPTestClient
  // Use a valid category from FACT_CATEGORIES: preference, background, pattern, project, contact, decision
  const testCategory = 'preference'
  let storedFactId: number | null = null // Track the stored fact ID for cleanup

  beforeAll(() => {
    client = createMemoryClient()
    logSection(`Memory MCP Tests (${client.getBaseUrl()})`)
  })

  afterAll(async () => {
    // Cleanup: try to delete test facts if we stored one
    if (storedFactId !== null) {
      log(`Cleaning up test fact (id: ${storedFactId})`, 'info')
      await client.callTool('delete_fact', { fact_id: storedFactId })
    }
  })

  describe('Health', () => {
    it('should respond to health check', async () => {
      log(`Checking health at ${client.getBaseUrl()}/health`, 'info')
      const result = await client.healthCheck()

      if (result.healthy) {
        log(`Health check passed (${result.duration}ms)`, 'success')
      } else {
        log(`Health check failed: ${result.error}`, 'error')
      }

      expect(result.healthy).toBe(true)
      expect(result.duration).toBeLessThan(5000)
    })
  })

  describe('Memory Stats', () => {
    it('should get memory stats', async () => {
      log('Getting memory stats', 'info')
      const result = await client.callTool('get_memory_stats', {})

      if (result.success) {
        log(`Memory stats retrieved (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 300)}`, 'debug')
      } else {
        log(`get_memory_stats failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  describe('Facts CRUD', () => {
    it('should store a fact', async () => {
      const factContent = `Test fact created at ${new Date().toISOString()}`
      log(`Storing fact: "${factContent.slice(0, 50)}..."`, 'info')

      const result = await client.callTool('store_fact', {
        fact: factContent,
        category: testCategory,
      })

      if (result.success) {
        log(`Fact stored successfully (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 200)}`, 'debug')
        // Extract and store the fact_id for cleanup
        const data = result.data as { content?: Array<{ text?: string }> }
        if (data?.content?.[0]?.text) {
          try {
            const parsed = JSON.parse(data.content[0].text)
            if (parsed.data?.fact_id) {
              storedFactId = parsed.data.fact_id
              log(`Stored fact ID for cleanup: ${storedFactId}`, 'debug')
            }
          } catch {
            // Ignore parse errors
          }
        }
      } else {
        log(`store_fact failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should list facts', async () => {
      log('Listing facts', 'info')
      const result = await client.callTool('list_facts', {})

      if (result.success) {
        log(`Facts listed successfully (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 300)}`, 'debug')
      } else {
        log(`list_facts failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should list facts by category', async () => {
      log(`Listing facts in category: ${testCategory}`, 'info')
      const result = await client.callTool('list_facts', {
        category: testCategory,
      })

      if (result.success) {
        log(`Category facts listed successfully (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 300)}`, 'debug')
      } else {
        log(`list_facts (by category) failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  describe('Profile', () => {
    it('should get user profile', async () => {
      log('Getting user profile', 'info')
      const result = await client.callTool('get_profile', {})

      if (result.success) {
        log(`Profile retrieved successfully (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 300)}`, 'debug')
      } else {
        log(`get_profile failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should update user profile', async () => {
      const updateKey = 'test_preference'
      const updateValue = `test-value-${Date.now()}`
      log(`Updating profile: ${updateKey}=${updateValue}`, 'info')

      const result = await client.callTool('update_profile', {
        updates: { [updateKey]: updateValue },
      })

      if (result.success) {
        log(`Profile updated successfully (${result.duration}ms)`, 'success')
      } else {
        log(`update_profile failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  describe('Memory Retrieval', () => {
    it('should retrieve relevant memories', async () => {
      const query = 'integration test'
      log(`Retrieving memories for query: "${query}"`, 'info')

      const result = await client.callTool('retrieve_memories', {
        query,
      })

      if (result.success) {
        log(`Memories retrieved successfully (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 300)}`, 'debug')
      } else {
        log(`retrieve_memories failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  describe('Conversations', () => {
    it('should store a conversation', async () => {
      const userMessage = 'Test message from integration test'
      const agentResponse = 'Test response from integration test'
      log('Storing test conversation', 'info')

      const result = await client.callTool('store_conversation', {
        user_message: userMessage,
        agent_response: agentResponse,
      })

      if (result.success) {
        log(`Conversation stored successfully (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 200)}`, 'debug')
      } else {
        log(`store_conversation failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should search conversations', async () => {
      const query = 'integration test'
      log(`Searching conversations for: "${query}"`, 'info')

      const result = await client.callTool('search_conversations', {
        query,
      })

      if (result.success) {
        log(`Conversations searched successfully (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 300)}`, 'debug')
      } else {
        log(`search_conversations failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  describe('Export/Import', () => {
    it('should export memory', async () => {
      log('Exporting memory', 'info')
      const result = await client.callTool('export_memory', {})

      if (result.success) {
        log(`Memory exported successfully (${result.duration}ms)`, 'success')
        const dataStr = JSON.stringify(result.data)
        log(`Export size: ${dataStr.length} bytes`, 'debug')
      } else {
        log(`export_memory failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })
})
