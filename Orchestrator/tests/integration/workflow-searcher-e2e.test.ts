/**
 * E2E Workflow Tests: Searcher via Orchestrator
 *
 * Validates the full path: Orchestrator → Searcher → Brave API → response back.
 * Unlike the basic searcher.test.ts (which checks success/failure), these tests
 * verify response contracts — field presence, types, and structure.
 *
 * Prerequisites: Full stack running (./start-all.sh)
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  createSearcherClient,
  createOrchestratorClient,
  checkMCPsAvailable,
  log,
  logSection,
  MCPTestClient,
} from '../helpers/mcp-client.js'
import { parseJsonContent } from '../helpers/workflow-helpers.js'

const RATE_LIMIT_DELAY = 1200
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface WebSearchResponse {
  success: boolean
  data: {
    results: Array<{
      title: string
      url: string
      description: string
      age?: string
      extra_snippets?: string[]
    }>
    infobox?: Array<{
      title: string
      description: string
      long_desc?: string
    }>
    total_count: number
    query: string
  }
}

interface NewsSearchResponse {
  success: boolean
  data: {
    results: Array<{
      title: string
      url: string
      description: string
      age?: string
      source?: string
      thumbnail?: string
      breaking?: boolean
    }>
    total_count: number
    query: string
  }
}

interface ImageSearchResponse {
  success: boolean
  data: {
    results: Array<{
      title: string
      source_url: string
      image_url: string
      thumbnail_url?: string
      source?: string
    }>
    total_count: number
    query: string
  }
}

interface WebFetchResponse {
  success: boolean
  data: {
    url: string
    title: string
    content: string
    contentLength: number
    truncated: boolean
  }
}

describe('E2E: Searcher via Orchestrator', () => {
  let searcher: MCPTestClient
  let orchestrator: MCPTestClient
  let orchestratorAvailable = false
  let searcherAvailable = false

  function skipIfUnavailable(): boolean {
    if (!orchestratorAvailable) {
      log('Orchestrator not running — skipping', 'warn')
      return true
    }
    if (!searcherAvailable) {
      log('Searcher not reachable — skipping', 'warn')
      return true
    }
    return false
  }

  beforeAll(async () => {
    logSection('E2E: Searcher via Orchestrator')

    orchestrator = createOrchestratorClient()
    searcher = createSearcherClient()

    const orchHealth = await orchestrator.healthCheck()
    orchestratorAvailable = orchHealth.healthy
    if (!orchestratorAvailable) {
      log('Orchestrator not running — all tests will skip', 'error')
      return
    }

    const availability = await checkMCPsAvailable([searcher])
    searcherAvailable = availability.get('Searcher') ?? false

    log(`Orchestrator: ${orchestratorAvailable ? 'UP' : 'DOWN'}`, orchestratorAvailable ? 'success' : 'error')
    log(`Searcher: ${searcherAvailable ? 'UP' : 'DOWN'}`, searcherAvailable ? 'success' : 'warn')
  })

  beforeEach(async () => {
    await sleep(RATE_LIMIT_DELAY)
  })

  // --- Health & Discovery ---

  describe('Health & Discovery', () => {
    it('Searcher is available via Orchestrator', () => {
      expect(orchestratorAvailable).toBe(true)
      if (!searcherAvailable) {
        log('Searcher unavailable — downstream tests will skip', 'warn')
      }
    })
  })

  // --- web_search contract ---

  describe('web_search contract', () => {
    it('returns results with expected structure', async () => {
      if (skipIfUnavailable()) return

      const result = await searcher.callTool('web_search', {
        query: 'vitest testing framework',
        count: 3,
      })

      expect(result.success).toBe(true)

      const parsed = parseJsonContent<WebSearchResponse>(result)
      expect(parsed).not.toBeNull()
      expect(parsed!.data).toBeDefined()

      const { data } = parsed!
      expect(data.query).toBe('vitest testing framework')
      expect(typeof data.total_count).toBe('number')
      expect(Array.isArray(data.results)).toBe(true)

      if (data.results.length > 0) {
        const first = data.results[0]
        expect(typeof first.title).toBe('string')
        expect(typeof first.url).toBe('string')
        expect(typeof first.description).toBe('string')
        log(`web_search returned ${data.results.length} results, query="${data.query}"`, 'success')
      } else {
        log('web_search returned 0 results (Brave API may be rate-limited)', 'warn')
      }
    }, 30000)

    it('preserves query echo in response', async () => {
      if (skipIfUnavailable()) return

      const query = 'zod schema validation typescript'
      const result = await searcher.callTool('web_search', { query, count: 2 })

      expect(result.success).toBe(true)
      const parsed = parseJsonContent<WebSearchResponse>(result)
      expect(parsed!.data.query).toBe(query)
      log('Query echo verified', 'success')
    }, 30000)
  })

  // --- news_search contract ---

  describe('news_search contract', () => {
    it('returns news results with expected structure', async () => {
      if (skipIfUnavailable()) return

      const result = await searcher.callTool('news_search', {
        query: 'technology industry',
        count: 3,
      })

      expect(result.success).toBe(true)

      const parsed = parseJsonContent<NewsSearchResponse>(result)
      expect(parsed).not.toBeNull()
      expect(parsed!.data).toBeDefined()

      const { data } = parsed!
      expect(data.query).toBe('technology industry')
      expect(typeof data.total_count).toBe('number')
      expect(Array.isArray(data.results)).toBe(true)

      if (data.results.length > 0) {
        const first = data.results[0]
        expect(typeof first.title).toBe('string')
        expect(typeof first.url).toBe('string')
        expect(typeof first.description).toBe('string')
        // source is extracted from meta_url.hostname
        if (first.source) {
          expect(typeof first.source).toBe('string')
        }
        log(`news_search returned ${data.results.length} results`, 'success')
      } else {
        log('news_search returned 0 results', 'warn')
      }
    }, 30000)
  })

  // --- image_search contract ---

  describe('image_search contract', () => {
    it('returns image results with expected structure', async () => {
      if (skipIfUnavailable()) return

      const result = await searcher.callTool('image_search', {
        query: 'typescript logo',
        count: 3,
      })

      expect(result.success).toBe(true)

      const parsed = parseJsonContent<ImageSearchResponse>(result)
      expect(parsed).not.toBeNull()
      expect(parsed!.data).toBeDefined()

      const { data } = parsed!
      expect(data.query).toBe('typescript logo')
      expect(typeof data.total_count).toBe('number')
      expect(Array.isArray(data.results)).toBe(true)

      if (data.results.length > 0) {
        const first = data.results[0]
        expect(typeof first.title).toBe('string')
        expect(typeof first.source_url).toBe('string')
        expect(typeof first.image_url).toBe('string')
        log(`image_search returned ${data.results.length} results`, 'success')
      } else {
        log('image_search returned 0 results', 'warn')
      }
    }, 30000)
  })

  // --- web_fetch contract ---

  describe('web_fetch contract', () => {
    it('fetches a URL and returns markdown content', async () => {
      if (skipIfUnavailable()) return

      const result = await searcher.callTool('web_fetch', {
        url: 'https://example.com',
      })

      expect(result.success).toBe(true)

      const parsed = parseJsonContent<WebFetchResponse>(result)
      expect(parsed).not.toBeNull()
      expect(parsed!.data).toBeDefined()

      const { data } = parsed!
      expect(data.url).toBe('https://example.com')
      expect(typeof data.title).toBe('string')
      expect(typeof data.content).toBe('string')
      expect(data.content.length).toBeGreaterThan(0)
      expect(typeof data.contentLength).toBe('number')
      expect(typeof data.truncated).toBe('boolean')
      log(`web_fetch returned ${data.contentLength} chars, truncated=${data.truncated}`, 'success')
    }, 30000)

    it('respects maxLength truncation through Orchestrator', async () => {
      if (skipIfUnavailable()) return

      const result = await searcher.callTool('web_fetch', {
        url: 'https://example.com',
        maxLength: 1000,
      })

      expect(result.success).toBe(true)

      const parsed = parseJsonContent<WebFetchResponse>(result)
      expect(parsed).not.toBeNull()

      const { data } = parsed!
      // Content should be within the maxLength bound
      expect(data.content.length).toBeLessThanOrEqual(1000)
      log(`web_fetch truncation: content=${data.content.length} chars, truncated=${data.truncated}`, 'success')
    }, 30000)
  })

  // --- Error propagation ---

  describe('Error propagation', () => {
    it('returns error for unknown tool', async () => {
      if (!orchestratorAvailable) return

      const result = await searcher.callTool('nonexistent_tool', { query: 'test' })

      expect(result.success).toBe(false)
      log(`Unknown tool error propagated: ${result.error?.slice(0, 100)}`, 'success')
    }, 15000)
  })

  // --- Rate limit resilience ---

  describe('Rate limit resilience', () => {
    it('sequential searches complete without 429 errors', async () => {
      if (skipIfUnavailable()) return

      const queries = ['nodejs streams', 'react hooks', 'rust ownership']
      const results: boolean[] = []

      for (const query of queries) {
        const result = await searcher.callTool('web_search', { query, count: 2 })
        results.push(result.success)

        if (!result.success) {
          log(`Query "${query}" failed: ${result.error}`, 'warn')
        }

        await sleep(RATE_LIMIT_DELAY)
      }

      // All should succeed — rate limiter in brave.ts should space them out
      const allSucceeded = results.every(Boolean)
      if (allSucceeded) {
        log(`All ${queries.length} sequential searches succeeded`, 'success')
      } else {
        const failCount = results.filter(r => !r).length
        log(`${failCount}/${queries.length} searches failed (possible rate limit)`, 'warn')
      }

      expect(allSucceeded).toBe(true)
    }, 60000)
  })

  // --- Summary ---

  describe('Summary', () => {
    it('reports E2E test status', () => {
      logSection('SEARCHER E2E TEST SUMMARY')
      log(`Orchestrator: ${orchestratorAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}`, 'info')
      log(`Searcher: ${searcherAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}`, 'info')
      log('Searcher E2E tests completed', 'success')
    })
  })
})
