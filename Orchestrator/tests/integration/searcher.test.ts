/**
 * Searcher MCP Integration Tests
 *
 * Tests the Searcher MCP server at http://localhost:8007
 * Prerequisites: Searcher MCP must be running (TRANSPORT=http npm start)
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createSearcherClient, log, logSection, MCPTestClient } from '../helpers/mcp-client.js'

// Delay between tests to avoid rate limiting (Brave API Free plan: 1 req/sec)
const RATE_LIMIT_DELAY = 1100
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('Searcher MCP', () => {
  let client: MCPTestClient

  beforeAll(() => {
    client = createSearcherClient()
    logSection(`Searcher MCP Tests (${client.getBaseUrl()})`)
  })

  // Add delay between tests to respect rate limits
  beforeEach(async () => {
    await sleep(RATE_LIMIT_DELAY)
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

  describe('Web Search', () => {
    it('should execute simple web search', async () => {
      log('Calling web_search tool with simple query', 'info')
      const result = await client.callTool('web_search', {
        query: 'typescript programming',
      })

      if (result.success) {
        log(`web_search succeeded (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 200)}...`, 'debug')
      } else {
        log(`web_search failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
    })

    it('should respect count parameter', async () => {
      log('Calling web_search with count=3', 'info')
      const result = await client.callTool('web_search', {
        query: 'nodejs best practices',
        count: 3,
      })

      if (result.success) {
        log(`web_search with count succeeded (${result.duration}ms)`, 'success')
        const data = result.data as { content?: Array<{ text?: string }> }
        if (data?.content?.[0]?.text) {
          try {
            const parsed = JSON.parse(data.content[0].text)
            log(`Returned ${parsed.data?.results?.length || 0} results`, 'debug')
          } catch {
            log(`Response preview: ${data.content[0].text.slice(0, 100)}`, 'debug')
          }
        }
      } else {
        log(`web_search failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should handle freshness parameter', async () => {
      log('Calling web_search with freshness=week', 'info')
      const result = await client.callTool('web_search', {
        query: 'technology news',
        freshness: 'week',
      })

      if (result.success) {
        log(`web_search with freshness succeeded (${result.duration}ms)`, 'success')
      } else {
        log(`web_search failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should handle safesearch parameter', async () => {
      log('Calling web_search with safesearch=strict', 'info')
      const result = await client.callTool('web_search', {
        query: 'programming tutorials',
        safesearch: 'strict',
      })

      if (result.success) {
        log(`web_search with safesearch succeeded (${result.duration}ms)`, 'success')
      } else {
        log(`web_search failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  describe('News Search', () => {
    it('should execute simple news search', async () => {
      log('Calling news_search tool', 'info')
      const result = await client.callTool('news_search', {
        query: 'artificial intelligence',
      })

      if (result.success) {
        log(`news_search succeeded (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 200)}...`, 'debug')
      } else {
        log(`news_search failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
    })

    it('should respect count parameter', async () => {
      log('Calling news_search with count=5', 'info')
      const result = await client.callTool('news_search', {
        query: 'technology',
        count: 5,
      })

      if (result.success) {
        log(`news_search with count succeeded (${result.duration}ms)`, 'success')
      } else {
        log(`news_search failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should handle freshness parameter', async () => {
      log('Calling news_search with freshness=24h', 'info')
      const result = await client.callTool('news_search', {
        query: 'breaking news',
        freshness: '24h',
      })

      if (result.success) {
        log(`news_search with freshness succeeded (${result.duration}ms)`, 'success')
      } else {
        log(`news_search failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should handle missing query gracefully', async () => {
      log('Testing error handling with missing query', 'info')
      const result = await client.callTool('web_search', {})

      log(`Missing query response (${result.duration}ms): success=${result.success}`, 'debug')
      if (result.error) {
        log(`Error (expected): ${result.error}`, 'debug')
      }

      // We expect this to fail with a validation error
      expect(result.success).toBe(false)
      expect(result.duration).toBeLessThan(10000)
    })

    it('should handle invalid count parameter', async () => {
      log('Testing error handling with invalid count (0)', 'info')
      const result = await client.callTool('web_search', {
        query: 'test',
        count: 0,
      })

      log(`Invalid count response (${result.duration}ms): success=${result.success}`, 'debug')

      expect(result.success).toBe(false)
    })

    it('should handle invalid freshness parameter', async () => {
      log('Testing error handling with invalid freshness', 'info')
      const result = await client.callTool('web_search', {
        query: 'test',
        freshness: 'invalid',
      })

      log(`Invalid freshness response (${result.duration}ms): success=${result.success}`, 'debug')

      expect(result.success).toBe(false)
    })
  })
})
