/**
 * Telegram MCP Integration Tests
 *
 * Tests the Telegram MCP server at http://localhost:8002
 * Prerequisites: Telegram MCP must be running with TRANSPORT=http
 *
 * Run with: npm test
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  createTelegramClient,
  log,
  logSection,
  MCPTestClient,
  extractData,
  testId,
  wait,
} from '../helpers/mcp-client.js'

// Types for Telegram MCP responses
interface ChatInfo {
  id: string
  type: string
  title: string
  username?: string
  unreadCount?: number
}

interface MessageInfo {
  id: number
  text?: string
  date: string
  senderId?: string
}

interface UserInfo {
  id: string
  username?: string
  firstName?: string
  lastName?: string
}

describe('Telegram MCP', () => {
  let client: MCPTestClient
  let testChatId: string | null = null

  beforeAll(async () => {
    client = createTelegramClient()
    logSection(`Telegram MCP Tests (${client.getBaseUrl()})`)

    // Try to get a test chat ID from list_chats
    const chatsResult = await client.callTool('list_chats', { limit: 10 })
    if (chatsResult.success) {
      const data = extractData<{ chats: ChatInfo[] }>(chatsResult)
      if (data?.chats?.length) {
        testChatId = data.chats[0].id
        log(`Using test chat: ${testChatId} (${data.chats[0].title})`, 'info')
      }
    }
  })

  // ============================================
  // 2.1 Health & Initialization
  // ============================================
  describe('2.1 Health & Initialization', () => {
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

    it('should get current user info', async () => {
      log('Calling get_me tool', 'info')
      const result = await client.callTool('get_me', {})

      if (result.success) {
        const data = extractData<{ user: UserInfo }>(result)
        log(`get_me succeeded (${result.duration}ms): ${data?.user?.username || 'unknown'}`, 'success')
      } else {
        log(`get_me failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
    })
  })

  // ============================================
  // 2.2 Chat Operations
  // ============================================
  describe('2.2 Chat Operations', () => {
    it('should list chats', async () => {
      log('Calling list_chats tool', 'info')
      const result = await client.callTool('list_chats', {})

      if (result.success) {
        const data = extractData<{ count: number; chats: ChatInfo[] }>(result)
        log(`list_chats succeeded (${result.duration}ms): ${data?.count} chats`, 'success')
      } else {
        log(`list_chats failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
    })

    it('should list chats with limit', async () => {
      log('Calling list_chats with limit=5', 'info')
      const result = await client.callTool('list_chats', { limit: 5 })

      if (result.success) {
        const data = extractData<{ count: number; chats: ChatInfo[] }>(result)
        log(`list_chats with limit succeeded (${result.duration}ms): ${data?.count} chats`, 'success')
        expect(data?.chats?.length).toBeLessThanOrEqual(5)
      } else {
        log(`list_chats with limit failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should get chat by ID', async () => {
      if (!testChatId) {
        log('No test chat ID available - skipping', 'warn')
        return
      }

      log(`Calling get_chat with chat_id=${testChatId}`, 'info')
      const result = await client.callTool('get_chat', { chat_id: testChatId })

      if (result.success) {
        const data = extractData<ChatInfo>(result)
        log(`get_chat succeeded (${result.duration}ms): ${data?.title}`, 'success')
      } else {
        log(`get_chat failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should handle invalid chat ID gracefully', async () => {
      log('Calling get_chat with invalid chat_id', 'info')
      const result = await client.callTool('get_chat', { chat_id: 'invalid_chat_12345' })

      // Should fail but not crash
      log(`get_chat invalid response (${result.duration}ms): success=${result.success}`, 'debug')
      expect(result.duration).toBeLessThan(10000)
    })
  })

  // ============================================
  // 2.3 Message Operations
  // ============================================
  describe('2.3 Message Operations', () => {
    it('should send a message', async () => {
      if (!testChatId) {
        log('No test chat ID available - skipping', 'warn')
        return
      }

      const testMessage = `[${testId()}] Integration test message`
      log(`Sending message to ${testChatId}`, 'info')

      const result = await client.callTool('send_message', {
        chat_id: testChatId,
        message: testMessage,
      })

      if (result.success) {
        log(`send_message succeeded (${result.duration}ms)`, 'success')
      } else {
        log(`send_message failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should get messages from chat', async () => {
      if (!testChatId) {
        log('No test chat ID available - skipping', 'warn')
        return
      }

      log(`Calling get_messages for chat ${testChatId}`, 'info')
      const result = await client.callTool('get_messages', {
        chat_id: testChatId,
        limit: 10,
      })

      if (result.success) {
        const data = extractData<{ count: number; messages: MessageInfo[] }>(result)
        log(`get_messages succeeded (${result.duration}ms): ${data?.count} messages`, 'success')
      } else {
        log(`get_messages failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should search messages in chat', async () => {
      if (!testChatId) {
        log('No test chat ID available - skipping', 'warn')
        return
      }

      log('Calling search_messages in chat', 'info')
      const result = await client.callTool('search_messages', {
        query: 'test',
        chat_id: testChatId,
        limit: 5,
      })

      if (result.success) {
        const data = extractData<{ count: number }>(result)
        log(`search_messages in chat succeeded (${result.duration}ms): ${data?.count} results`, 'success')
      } else {
        log(`search_messages failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should search messages globally', async () => {
      log('Calling search_messages globally', 'info')
      const result = await client.callTool('search_messages', {
        query: 'hello',
        limit: 5,
      })

      if (result.success) {
        const data = extractData<{ count: number }>(result)
        log(`search_messages globally succeeded (${result.duration}ms): ${data?.count} results`, 'success')
      } else {
        log(`search_messages globally failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should handle send to invalid chat gracefully', async () => {
      log('Testing error handling with invalid chat_id', 'info')
      const result = await client.callTool('send_message', {
        chat_id: 'invalid_chat_id_12345',
        message: 'This should fail',
      })

      log(`Invalid chat_id response (${result.duration}ms): success=${result.success}`, 'debug')
      expect(result.duration).toBeLessThan(10000)
    })
  })

  // ============================================
  // 2.4 Contact Operations
  // ============================================
  describe('2.4 Contact Operations', () => {
    it('should list contacts', async () => {
      log('Calling list_contacts tool', 'info')
      const result = await client.callTool('list_contacts', {})

      if (result.success) {
        const data = extractData<{ count: number }>(result)
        log(`list_contacts succeeded (${result.duration}ms): ${data?.count} contacts`, 'success')
      } else {
        log(`list_contacts failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should search users', async () => {
      log('Calling search_users tool', 'info')
      const result = await client.callTool('search_users', {
        query: 'test',
        limit: 5,
      })

      if (result.success) {
        const data = extractData<{ count: number }>(result)
        log(`search_users succeeded (${result.duration}ms): ${data?.count} users`, 'success')
      } else {
        log(`search_users failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  // ============================================
  // 2.5 Utility Operations
  // ============================================
  describe('2.5 Utility Operations', () => {
    it('should mark chat as read', async () => {
      if (!testChatId) {
        log('No test chat ID available - skipping', 'warn')
        return
      }

      log(`Calling mark_read for chat ${testChatId}`, 'info')
      const result = await client.callTool('mark_read', {
        chat_id: testChatId,
      })

      if (result.success) {
        log(`mark_read succeeded (${result.duration}ms)`, 'success')
      } else {
        log(`mark_read failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  // ============================================
  // 2.6 Real-time Subscriptions
  // ============================================
  describe('2.6 Real-time Subscriptions', () => {
    it('should list subscriptions', async () => {
      log('Calling subscribe_chat with action=list', 'info')
      const result = await client.callTool('subscribe_chat', { action: 'list' })

      if (result.success) {
        const data = extractData<{ subscriptions: string[]; count: number; mode: string }>(result)
        log(`list subscriptions succeeded (${result.duration}ms): ${data?.count} subscriptions, mode=${data?.mode}`, 'success')
      } else {
        log(`list subscriptions failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should subscribe to a chat', async () => {
      if (!testChatId) {
        log('No test chat ID available - skipping', 'warn')
        return
      }

      log(`Calling subscribe_chat with action=subscribe for ${testChatId}`, 'info')
      const result = await client.callTool('subscribe_chat', {
        action: 'subscribe',
        chat_id: testChatId,
      })

      if (result.success) {
        const data = extractData<{ success: boolean; subscribed: string; total: number }>(result)
        log(`subscribe succeeded (${result.duration}ms): total=${data?.total}`, 'success')
      } else {
        log(`subscribe failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should unsubscribe from a chat', async () => {
      if (!testChatId) {
        log('No test chat ID available - skipping', 'warn')
        return
      }

      log(`Calling subscribe_chat with action=unsubscribe for ${testChatId}`, 'info')
      const result = await client.callTool('subscribe_chat', {
        action: 'unsubscribe',
        chat_id: testChatId,
      })

      if (result.success) {
        log(`unsubscribe succeeded (${result.duration}ms)`, 'success')
      } else {
        log(`unsubscribe failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should clear all subscriptions', async () => {
      log('Calling subscribe_chat with action=clear', 'info')
      const result = await client.callTool('subscribe_chat', { action: 'clear' })

      if (result.success) {
        log(`clear subscriptions succeeded (${result.duration}ms)`, 'success')
      } else {
        log(`clear subscriptions failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should get new messages from queue', async () => {
      log('Calling get_new_messages', 'info')
      const result = await client.callTool('get_new_messages', {})

      if (result.success) {
        const data = extractData<{ count: number; cleared: boolean }>(result)
        log(`get_new_messages succeeded (${result.duration}ms): ${data?.count} messages`, 'success')
      } else {
        log(`get_new_messages failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should peek messages without clearing', async () => {
      log('Calling get_new_messages with peek=true', 'info')
      const result = await client.callTool('get_new_messages', { peek: true })

      if (result.success) {
        const data = extractData<{ count: number; queueSize: number }>(result)
        log(`peek messages succeeded (${result.duration}ms): queueSize=${data?.queueSize}`, 'success')
      } else {
        log(`peek messages failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  // ============================================
  // Lifecycle Tests
  // ============================================
  describe('Lifecycle: Message Flow', () => {
    let sentMessageId: number | null = null
    const uniqueText = `[LIFECYCLE_${testId()}] Test message for lifecycle`

    it('Step 1: Send a test message', async () => {
      if (!testChatId) {
        log('No test chat ID available - skipping lifecycle test', 'warn')
        return
      }

      log('Lifecycle Step 1: Sending test message', 'info')
      const result = await client.callTool('send_message', {
        chat_id: testChatId,
        message: uniqueText,
      })

      if (result.success) {
        const data = extractData<{ message: MessageInfo }>(result)
        sentMessageId = data?.message?.id || null
        log(`Message sent with ID: ${sentMessageId} (${result.duration}ms)`, 'success')
      } else {
        log(`Failed to send message: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
      expect(sentMessageId).toBeDefined()
    })

    it('Step 2: Retrieve the message', async () => {
      if (!testChatId || !sentMessageId) {
        log('Skipping - no message to retrieve', 'warn')
        return
      }

      log('Lifecycle Step 2: Retrieving messages', 'info')
      const result = await client.callTool('get_messages', {
        chat_id: testChatId,
        limit: 10,
      })

      if (result.success) {
        const data = extractData<{ messages: MessageInfo[] }>(result)
        const found = data?.messages?.find(m => m.id === sentMessageId)
        if (found) {
          log(`Message found in history (${result.duration}ms)`, 'success')
        } else {
          log(`Message not found in first 10 messages`, 'warn')
        }
      } else {
        log(`Failed to get messages: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('Step 3: Search for the message', async () => {
      if (!testChatId) {
        log('Skipping - no chat ID', 'warn')
        return
      }

      log('Lifecycle Step 3: Searching for message', 'info')
      const result = await client.callTool('search_messages', {
        query: 'LIFECYCLE',
        chat_id: testChatId,
        limit: 10,
      })

      if (result.success) {
        const data = extractData<{ count: number; messages: MessageInfo[] }>(result)
        log(`Search found ${data?.count} results (${result.duration}ms)`, 'success')
      } else {
        log(`Search failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('Step 4: Delete the message', async () => {
      if (!testChatId || !sentMessageId) {
        log('Skipping - no message to delete', 'warn')
        return
      }

      log(`Lifecycle Step 4: Deleting message ${sentMessageId}`, 'info')
      const result = await client.callTool('delete_messages', {
        chat_id: testChatId,
        message_ids: [sentMessageId],
      })

      if (result.success) {
        const data = extractData<{ deleted_count: number }>(result)
        log(`Message deleted (${result.duration}ms): deleted_count=${data?.deleted_count}`, 'success')
      } else {
        log(`Delete failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  describe('Lifecycle: Real-time Subscriptions', () => {
    it('Step 1: Clear subscriptions', async () => {
      log('Subscription Lifecycle Step 1: Clearing subscriptions', 'info')
      const result = await client.callTool('subscribe_chat', { action: 'clear' })

      expect(result.success).toBe(true)
      log(`Cleared subscriptions (${result.duration}ms)`, 'success')
    })

    it('Step 2: Subscribe to test chat', async () => {
      if (!testChatId) {
        log('No test chat ID - skipping', 'warn')
        return
      }

      log(`Subscription Lifecycle Step 2: Subscribing to ${testChatId}`, 'info')
      const result = await client.callTool('subscribe_chat', {
        action: 'subscribe',
        chat_id: testChatId,
      })

      expect(result.success).toBe(true)
      log(`Subscribed (${result.duration}ms)`, 'success')
    })

    it('Step 3: Verify subscription', async () => {
      log('Subscription Lifecycle Step 3: Listing subscriptions', 'info')
      const result = await client.callTool('subscribe_chat', { action: 'list' })

      if (result.success) {
        const data = extractData<{ mode: string; count: number }>(result)
        log(`Subscriptions: mode=${data?.mode}, count=${data?.count} (${result.duration}ms)`, 'success')
        if (testChatId) {
          expect(data?.mode).toBe('filtered')
        }
      }

      expect(result.success).toBe(true)
    })

    it('Step 4: Clear message queue', async () => {
      log('Subscription Lifecycle Step 4: Clearing message queue', 'info')
      const result = await client.callTool('get_new_messages', {})

      expect(result.success).toBe(true)
      log(`Queue cleared (${result.duration}ms)`, 'success')
    })

    it('Step 5: Send message to trigger event', async () => {
      if (!testChatId) {
        log('No test chat ID - skipping', 'warn')
        return
      }

      log('Subscription Lifecycle Step 5: Sending message', 'info')
      const result = await client.callTool('send_message', {
        chat_id: testChatId,
        message: `[REALTIME_${testId()}] Subscription lifecycle test`,
      })

      expect(result.success).toBe(true)
      log(`Message sent (${result.duration}ms)`, 'success')

      // Wait a bit for the event to be processed
      await wait(500)
    })

    it('Step 6: Check for new messages', async () => {
      log('Subscription Lifecycle Step 6: Checking new messages', 'info')
      const result = await client.callTool('get_new_messages', { peek: true })

      if (result.success) {
        const data = extractData<{ count: number; queueSize: number }>(result)
        log(`New messages: count=${data?.count}, queueSize=${data?.queueSize} (${result.duration}ms)`, 'success')
      }

      expect(result.success).toBe(true)
    })

    it('Step 7: Cleanup - clear subscriptions', async () => {
      log('Subscription Lifecycle Step 7: Final cleanup', 'info')
      const result = await client.callTool('subscribe_chat', { action: 'clear' })

      expect(result.success).toBe(true)
      log(`Cleanup complete (${result.duration}ms)`, 'success')
    })
  })
})
