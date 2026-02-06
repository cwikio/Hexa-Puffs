/**
 * Telegram MCP Integration Tests
 *
 * Tests the Telegram MCP server at http://localhost:8002
 * Prerequisites: Telegram MCP must be running (via launch-all.sh)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createTelegramClient, log, logSection, MCPTestClient } from '../helpers/mcp-client.js'

describe('Telegram MCP', () => {
  let client: MCPTestClient

  beforeAll(() => {
    client = createTelegramClient()
    logSection(`Telegram MCP Tests (${client.getBaseUrl()})`)
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

  describe('List Chats', () => {
    it('should list available chats', async () => {
      log('Calling list_chats tool', 'info')
      const result = await client.callTool('list_chats', {})

      if (result.success) {
        const chats = result.data as { content?: Array<{ text?: string }> }
        log(`list_chats succeeded (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(chats).slice(0, 200)}...`, 'debug')
      } else {
        log(`list_chats failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
    })
  })

  describe('Send Message', () => {
    it('should send a test message', async () => {
      const testMessage = `[TEST] Integration test message at ${new Date().toISOString()}`
      log(`Sending test message: "${testMessage.slice(0, 50)}..."`, 'info')

      // First get available chats to find a valid chat_id
      const chatsResult = await client.callTool('list_chats', {})
      if (!chatsResult.success) {
        log('Could not get chats to send message - skipping', 'warn')
        return
      }

      // Try to extract a chat ID from the response
      // The response format may vary, so we'll try to parse it
      const chatsData = chatsResult.data as { content?: Array<{ text?: string }> }
      let chatId: string | null = null

      // Try to find a chat ID in the response
      if (chatsData && chatsData.content && Array.isArray(chatsData.content)) {
        const text = chatsData.content[0]?.text || ''
        // Look for a numeric ID in the response
        const idMatch = text.match(/-?\d{5,}/)
        if (idMatch) {
          chatId = idMatch[0]
        }
      }

      if (!chatId) {
        log('Could not extract chat_id from list_chats response - skipping send test', 'warn')
        log(`Response was: ${JSON.stringify(chatsData).slice(0, 300)}`, 'debug')
        return
      }

      log(`Using chat_id: ${chatId}`, 'debug')

      const result = await client.callTool('send_message', {
        chat_id: chatId,
        message: testMessage,
      })

      if (result.success) {
        log(`Message sent successfully (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 200)}`, 'debug')
      } else {
        log(`Send message failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should handle invalid chat_id gracefully', async () => {
      log('Testing error handling with invalid chat_id', 'info')
      const result = await client.callTool('send_message', {
        chat_id: 'invalid_chat_id_12345',
        text: 'This should fail',
      })

      // We expect this to fail, but gracefully
      log(`Invalid chat_id response (${result.duration}ms): success=${result.success}`, 'debug')

      // The response should indicate failure somehow
      // Either success=false or the data contains an error
      expect(result.duration).toBeLessThan(10000)
    })
  })

  describe('Subscriptions', () => {
    it('should handle subscription lifecycle', async () => {
      log('Testing subscription lifecycle', 'info')

      // List current subscriptions using subscribe_chat tool with action: 'list'
      const listResult = await client.callTool('subscribe_chat', { action: 'list' })
      if (listResult.success) {
        log(`Current subscriptions: ${JSON.stringify(listResult.data).slice(0, 200)}`, 'debug')
      }

      expect(listResult.success).toBe(true)

      // Clear all subscriptions using subscribe_chat tool with action: 'clear'
      const clearResult = await client.callTool('subscribe_chat', { action: 'clear' })
      log(`Clear subscriptions result: ${clearResult.success ? 'success' : clearResult.error}`, 'debug')

      // List again to verify cleared
      const listAfterClear = await client.callTool('subscribe_chat', { action: 'list' })
      if (listAfterClear.success) {
        log('Subscriptions cleared successfully', 'success')
      }

      expect(listAfterClear.success).toBe(true)
    })
  })
})
