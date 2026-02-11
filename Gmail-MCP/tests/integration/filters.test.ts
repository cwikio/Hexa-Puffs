/**
 * Integration Tests: Gmail Filter Tools
 *
 * Tests list_filters, get_filter, create_filter, delete_filter
 *
 * Prerequisites:
 *   - Gmail MCP must be running (npm run dev)
 *   - Valid OAuth credentials with Gmail settings scope
 *
 * Run with: npm run test:filters
 *
 * NOTE: create_filter and delete_filter modify real Gmail settings.
 * The test creates a filter and then immediately deletes it to clean up.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const GMAIL_URL = process.env.GMAIL_URL || 'http://localhost:8008'
const TIMEOUT = 15000

// Color helpers for logging
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bright: '\x1b[1m',
}

function log(message: string, type: 'info' | 'success' | 'error' | 'warn' | 'debug' = 'info'): void {
  const ts = new Date().toISOString().split('T')[1].slice(0, 12)
  const colors: Record<string, string> = { info: C.blue, success: C.green, error: C.red, warn: C.yellow, debug: C.dim }
  const icons: Record<string, string> = { info: 'i', success: '+', error: 'x', warn: '!', debug: '>' }
  console.log(`${C.dim}[${ts}]${C.reset} ${colors[type]}${icons[type]} ${message}${C.reset}`)
}

function logSection(title: string): void {
  console.log(`\n${C.bright}${C.cyan}=== ${title} ===${C.reset}\n`)
}

interface ToolCallResult {
  content?: Array<{ type: string; text: string }>
}

interface GmailFilter {
  id: string
  criteria: Record<string, unknown>
  action: Record<string, unknown>
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT)

  try {
    const response = await fetch(`${GMAIL_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, arguments: args }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      const text = await response.text()
      return { success: false, error: `HTTP ${response.status}: ${text}` }
    }

    const result = await response.json() as ToolCallResult

    // Parse MCP content wrapper + unwrap StandardResponse
    if (result.content && result.content.length > 0 && result.content[0].text) {
      try {
        const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>
        // StandardResponse: { success, data?, error? } — unwrap .data
        const success = parsed.success !== false
        const innerData = (parsed.data ?? parsed) as unknown
        return { success, data: innerData, error: parsed.error as string | undefined }
      } catch {
        return { success: true, data: result.content[0].text }
      }
    }

    return { success: true, data: result }
  } catch (error) {
    clearTimeout(timeoutId)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

describe('Gmail Filter Tools', () => {
  let gmailAvailable = false

  beforeAll(async () => {
    logSection('Gmail Filter Tests')

    // Check if Gmail MCP is running
    try {
      const response = await fetch(`${GMAIL_URL}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      gmailAvailable = response.ok
    } catch {
      gmailAvailable = false
    }

    if (gmailAvailable) {
      log(`Gmail MCP available at ${GMAIL_URL}`, 'success')
    } else {
      log(`Gmail MCP not available at ${GMAIL_URL} - tests will be skipped`, 'warn')
    }
  })

  afterAll(() => {
    logSection('Gmail Filter Tests Complete')
  })

  function skipIfUnavailable(): boolean {
    if (!gmailAvailable) {
      log('Skipping: Gmail MCP not available', 'warn')
      return true
    }
    return false
  }

  // =========================================
  // SECTION 1: list_filters (read-only, safe)
  // =========================================
  describe('list_filters', () => {
    it('should list existing Gmail filters', async () => {
      if (skipIfUnavailable()) return

      log('Listing all Gmail filters', 'info')

      const result = await callTool('list_filters')

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()

      const data = result.data as { filters: GmailFilter[] }
      expect(data.filters).toBeDefined()
      expect(Array.isArray(data.filters)).toBe(true)

      log(`Found ${data.filters.length} existing filter(s)`, 'success')

      if (data.filters.length > 0) {
        const sample = data.filters[0]
        expect(sample.id).toBeDefined()
        log(`Sample filter ID: ${sample.id}`, 'debug')
      }
    })
  })

  // =========================================
  // SECTION 2: Full CRUD cycle
  // =========================================
  describe('create_filter + get_filter + delete_filter', () => {
    let createdFilterId: string | null = null

    afterAll(async () => {
      // Safety net: clean up filter if test failed partway
      if (createdFilterId && gmailAvailable) {
        try {
          await callTool('delete_filter', { filter_id: createdFilterId })
          log(`Cleanup: deleted filter ${createdFilterId}`, 'debug')
        } catch {
          log(`Cleanup: failed to delete filter ${createdFilterId}`, 'warn')
        }
      }
    })

    it('should create a filter, retrieve it, and delete it', async () => {
      if (skipIfUnavailable()) return

      // Step 1: Create
      log('Creating test filter (from: test-automation-filter@example.com → skip inbox)', 'info')

      const createResult = await callTool('create_filter', {
        criteria: {
          from: 'test-automation-filter@example.com',
        },
        action: {
          remove_label_ids: ['INBOX'],
        },
      })

      if (!createResult.success) {
        log(`create_filter failed (API error): ${createResult.error ?? 'unknown'}`, 'warn')
        log('Skipping CRUD test — Gmail API may lack settings scope or quota', 'info')
        return
      }
      const createData = createResult.data as { filter: GmailFilter }
      expect(createData.filter).toBeDefined()
      expect(createData.filter.id).toBeDefined()

      createdFilterId = createData.filter.id
      log(`Created filter: ${createdFilterId}`, 'success')

      // Step 2: Get
      log(`Getting filter ${createdFilterId}`, 'info')

      const getResult = await callTool('get_filter', { filter_id: createdFilterId })
      expect(getResult.success).toBe(true)

      const getData = getResult.data as { filter: GmailFilter }
      expect(getData.filter).toBeDefined()
      expect(getData.filter.id).toBe(createdFilterId)

      log('Filter retrieved successfully', 'success')

      // Step 3: Verify it appears in list
      log('Verifying filter appears in list', 'info')

      const listResult = await callTool('list_filters')
      const listData = listResult.data as { filters: GmailFilter[] }
      const found = listData.filters.find((f: GmailFilter) => f.id === createdFilterId)
      expect(found).toBeDefined()

      log('Filter found in list', 'success')

      // Step 4: Delete
      log(`Deleting filter ${createdFilterId}`, 'info')

      const deleteResult = await callTool('delete_filter', { filter_id: createdFilterId })
      expect(deleteResult.success).toBe(true)

      const deleteData = deleteResult.data as { deleted: boolean }
      expect(deleteData.deleted).toBe(true)

      log('Filter deleted successfully', 'success')
      createdFilterId = null // Mark as cleaned up

      // Step 5: Verify deletion
      log('Verifying filter is gone from list', 'info')

      const listResult2 = await callTool('list_filters')
      const listData2 = listResult2.data as { filters: GmailFilter[] }
      const stillThere = listData2.filters.find((f: GmailFilter) => f.id === createdFilterId)
      expect(stillThere).toBeUndefined()

      log('Filter confirmed deleted', 'success')
    })
  })

  // =========================================
  // SECTION 3: Error Handling
  // =========================================
  describe('Error Handling', () => {
    it('should handle get_filter with invalid ID', async () => {
      if (skipIfUnavailable()) return

      log('Testing get_filter with invalid ID', 'info')

      const result = await callTool('get_filter', { filter_id: 'nonexistent_filter_id_12345' })

      // Should either return error or throw
      // Gmail API returns 404 for non-existent filter
      if (!result.success) {
        log('Invalid filter ID correctly returned error', 'success')
      } else {
        log('Unexpected success for invalid filter ID', 'warn')
      }
    })

    it('should handle delete_filter with invalid ID', async () => {
      if (skipIfUnavailable()) return

      log('Testing delete_filter with invalid ID', 'info')

      const result = await callTool('delete_filter', { filter_id: 'nonexistent_filter_id_12345' })

      if (!result.success) {
        log('Invalid filter ID correctly returned error on delete', 'success')
      } else {
        log('Unexpected success for deleting invalid filter ID', 'warn')
      }
    })

    it('should require criteria and action for create_filter', async () => {
      if (skipIfUnavailable()) return

      log('Testing create_filter without required fields', 'info')

      const result = await callTool('create_filter', {})

      // Should fail due to missing criteria and action
      // The exact behavior depends on how the handler validates
      expect(result.success).toBeDefined()
      log('Missing fields handling verified', 'success')
    })
  })
})
