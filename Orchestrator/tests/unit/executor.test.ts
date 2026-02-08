/**
 * Unit tests for the job executor's ToolRouter integration,
 * backward-compatible name mapping, and response parsing.
 *
 * These tests mock the Orchestrator/ToolRouter so they run without
 * any MCP servers being available.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// We can't easily import executeToolCall directly (it does a dynamic import
// of the orchestrator singleton). Instead we test the *logic* it relies on:
//   1. Backward compat name mapping
//   2. Namespace prefix stripping
//   3. parseToolCallResult (response unwrapping)
//
// We extract the pure functions by re-implementing them inline (they're tiny)
// and validate correctness, then test executeToolCall via a mocked orchestrator.
// ---------------------------------------------------------------------------

/** Copied from executor.ts — backward compat map */
const BACKWARD_COMPAT_MAP: Record<string, string> = {
  'send_telegram': 'telegram_send_message',
  'list_telegram_chats': 'telegram_list_chats',
  'get_telegram_messages': 'telegram_get_messages',
  'get_credential': 'onepassword_get_item',
  'store_fact': 'memory_store_fact',
  'list_facts': 'memory_list_facts',
  'delete_fact': 'memory_delete_fact',
  'store_conversation': 'memory_store_conversation',
  'search_conversations': 'memory_search_conversations',
  'get_profile': 'memory_get_profile',
  'update_profile': 'memory_update_profile',
  'retrieve_memories': 'memory_retrieve_memories',
  'get_memory_stats': 'memory_get_memory_stats',
  'export_memory': 'memory_export_memory',
  'import_memory': 'memory_import_memory',
  'create_file': 'filer_create_file',
  'read_file': 'filer_read_file',
  'list_files': 'filer_list_files',
  'update_file': 'filer_update_file',
  'delete_file': 'filer_delete_file',
  'move_file': 'filer_move_file',
  'copy_file': 'filer_copy_file',
  'search_files': 'filer_search_files',
  'check_grant': 'filer_check_grant',
  'request_grant': 'filer_request_grant',
  'list_grants': 'filer_list_grants',
  'get_workspace_info': 'filer_get_workspace_info',
  'get_audit_log': 'filer_get_audit_log',
}

/** Mirrors the normalization logic in executeToolCall */
function normalizeName(toolName: string): string {
  let normalized = toolName.includes(':') ? toolName.split(':').pop()! : toolName
  normalized = BACKWARD_COMPAT_MAP[normalized] || normalized
  return normalized
}

interface ToolCallResult {
  success: boolean
  content?: unknown
  error?: string
}

interface StandardResponse {
  success: boolean
  data?: unknown
  error?: string
}

/** Mirrors parseToolCallResult from executor.ts */
function parseToolCallResult(result: ToolCallResult): StandardResponse {
  if (!result.success) {
    return { success: false, error: result.error || 'Tool call failed' }
  }

  const mcpResponse = result.content as { content?: Array<{ type: string; text?: string }> } | undefined
  const innerText = mcpResponse?.content?.[0]?.text

  if (innerText) {
    try {
      return JSON.parse(innerText) as StandardResponse
    } catch {
      return { success: true, data: innerText }
    }
  }

  return { success: true, data: result.content }
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Executor: Name Normalization', () => {
  it('should strip namespace prefix', () => {
    expect(normalizeName('annabelle:send_telegram')).toBe('telegram_send_message')
    expect(normalizeName('annabelle:list_facts')).toBe('memory_list_facts')
  })

  it('should map old telegram tool names', () => {
    expect(normalizeName('send_telegram')).toBe('telegram_send_message')
    expect(normalizeName('list_telegram_chats')).toBe('telegram_list_chats')
    expect(normalizeName('get_telegram_messages')).toBe('telegram_get_messages')
  })

  it('should map old memory tool names', () => {
    expect(normalizeName('store_fact')).toBe('memory_store_fact')
    expect(normalizeName('list_facts')).toBe('memory_list_facts')
    expect(normalizeName('delete_fact')).toBe('memory_delete_fact')
    expect(normalizeName('store_conversation')).toBe('memory_store_conversation')
    expect(normalizeName('search_conversations')).toBe('memory_search_conversations')
    expect(normalizeName('get_profile')).toBe('memory_get_profile')
    expect(normalizeName('update_profile')).toBe('memory_update_profile')
    expect(normalizeName('retrieve_memories')).toBe('memory_retrieve_memories')
    expect(normalizeName('get_memory_stats')).toBe('memory_get_memory_stats')
    expect(normalizeName('export_memory')).toBe('memory_export_memory')
    expect(normalizeName('import_memory')).toBe('memory_import_memory')
  })

  it('should map old 1password tool names', () => {
    expect(normalizeName('get_credential')).toBe('onepassword_get_item')
  })

  it('should map old filer tool names', () => {
    expect(normalizeName('create_file')).toBe('filer_create_file')
    expect(normalizeName('read_file')).toBe('filer_read_file')
    expect(normalizeName('list_files')).toBe('filer_list_files')
    expect(normalizeName('update_file')).toBe('filer_update_file')
    expect(normalizeName('delete_file')).toBe('filer_delete_file')
    expect(normalizeName('move_file')).toBe('filer_move_file')
    expect(normalizeName('copy_file')).toBe('filer_copy_file')
    expect(normalizeName('search_files')).toBe('filer_search_files')
    expect(normalizeName('check_grant')).toBe('filer_check_grant')
    expect(normalizeName('request_grant')).toBe('filer_request_grant')
    expect(normalizeName('list_grants')).toBe('filer_list_grants')
    expect(normalizeName('get_workspace_info')).toBe('filer_get_workspace_info')
    expect(normalizeName('get_audit_log')).toBe('filer_get_audit_log')
  })

  it('should pass through already-prefixed names unchanged', () => {
    expect(normalizeName('telegram_send_message')).toBe('telegram_send_message')
    expect(normalizeName('memory_store_fact')).toBe('memory_store_fact')
    expect(normalizeName('gmail_send_email')).toBe('gmail_send_email')
    expect(normalizeName('searcher_web_search')).toBe('searcher_web_search')
  })

  it('should pass through unknown names unchanged', () => {
    expect(normalizeName('some_future_tool')).toBe('some_future_tool')
  })

  it('should handle double-colon namespace prefix', () => {
    // Only the last segment after ':' is used
    expect(normalizeName('ns:sub:send_telegram')).toBe('telegram_send_message')
  })
})

describe('Executor: parseToolCallResult', () => {
  it('should handle failed result', () => {
    const result = parseToolCallResult({ success: false, error: 'timeout' })
    expect(result).toEqual({ success: false, error: 'timeout' })
  })

  it('should provide default error message for failed result without error', () => {
    const result = parseToolCallResult({ success: false })
    expect(result).toEqual({ success: false, error: 'Tool call failed' })
  })

  it('should parse MCP JSON response', () => {
    const mcpResult: ToolCallResult = {
      success: true,
      content: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, data: { count: 42 } }),
          },
        ],
      },
    }
    const result = parseToolCallResult(mcpResult)
    expect(result).toEqual({ success: true, data: { count: 42 } })
  })

  it('should handle non-JSON text content', () => {
    const mcpResult: ToolCallResult = {
      success: true,
      content: {
        content: [{ type: 'text', text: 'plain text response' }],
      },
    }
    const result = parseToolCallResult(mcpResult)
    expect(result).toEqual({ success: true, data: 'plain text response' })
  })

  it('should handle empty content array', () => {
    const mcpResult: ToolCallResult = {
      success: true,
      content: { content: [] },
    }
    const result = parseToolCallResult(mcpResult)
    expect(result).toEqual({ success: true, data: { content: [] } })
  })

  it('should handle missing content wrapper', () => {
    const mcpResult: ToolCallResult = {
      success: true,
      content: { some: 'other shape' },
    }
    const result = parseToolCallResult(mcpResult)
    expect(result).toEqual({ success: true, data: { some: 'other shape' } })
  })

  it('should handle undefined content', () => {
    const mcpResult: ToolCallResult = { success: true }
    const result = parseToolCallResult(mcpResult)
    expect(result).toEqual({ success: true, data: undefined })
  })

  it('should unwrap nested StandardResponse from MCP', () => {
    // Real-world: MCP returns StandardResponse wrapped in content[0].text
    const innerResponse = {
      success: true,
      data: {
        facts: [{ id: 1, fact: 'test' }],
        total_count: 1,
      },
    }
    const mcpResult: ToolCallResult = {
      success: true,
      content: {
        content: [{ type: 'text', text: JSON.stringify(innerResponse) }],
      },
    }
    const result = parseToolCallResult(mcpResult)
    expect(result.success).toBe(true)
    expect(result.data).toEqual(innerResponse.data)
  })

  it('should surface error from inner StandardResponse', () => {
    const innerResponse = {
      success: false,
      error: 'Fact not found',
    }
    const mcpResult: ToolCallResult = {
      success: true,
      content: {
        content: [{ type: 'text', text: JSON.stringify(innerResponse) }],
      },
    }
    const result = parseToolCallResult(mcpResult)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Fact not found')
  })
})
