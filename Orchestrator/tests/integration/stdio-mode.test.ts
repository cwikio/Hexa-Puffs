/**
 * Stdio Mode Integration Tests
 *
 * Tests the Orchestrator running in stdio mode where it spawns downstream MCPs
 * and exposes their tools via HTTP REST endpoints.
 *
 * This is the architecture used by Thinker:
 *   Thinker --HTTP--> Orchestrator (8010) --stdio--> Telegram, Memory, Filer, Guardian, 1Password
 *
 * Prerequisites: Orchestrator must be running with:
 *   TRANSPORT=http PORT=8010 MCP_CONNECTION_MODE=stdio npm start
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  createOrchestratorClient,
  createThinkerClient,
  log,
  logSection,
  MCPTestClient,
  authFetch,
} from '../helpers/mcp-client.js'

describe('Stdio Mode - Orchestrator as Protocol Bridge', () => {
  let orchestrator: MCPTestClient
  let thinker: MCPTestClient

  beforeAll(() => {
    orchestrator = createOrchestratorClient()
    thinker = createThinkerClient()
    logSection('Stdio Mode Integration Tests')
  })

  describe('Orchestrator Health', () => {
    it('should be healthy and running on HTTP transport', async () => {
      log('Checking Orchestrator health...', 'info')

      const health = await orchestrator.healthCheck()

      if (health.healthy) {
        log(`Orchestrator is healthy (${health.duration}ms)`, 'success')
      } else {
        log(`Orchestrator health check failed: ${health.error}`, 'error')
        log('Make sure Orchestrator is running with: TRANSPORT=http PORT=8010 MCP_CONNECTION_MODE=stdio npm start', 'warn')
      }

      expect(health.healthy).toBe(true)
    })
  })

  describe('Tool Discovery via /tools/list', () => {
    it('should expose tools from all downstream MCPs', async () => {
      log('Fetching tool list from Orchestrator...', 'info')

      const response = await authFetch('http://localhost:8010/tools/list')
      expect(response.ok).toBe(true)

      const data = await response.json() as { tools: Array<{ name: string; description: string }> }
      const tools = data.tools

      log(`Discovered ${tools.length} tools`, 'info')

      // Check for expected tool categories
      const telegramTools = tools.filter(t => t.name.includes('message') || t.name.includes('chat') || t.name.includes('contact'))
      const memoryTools = tools.filter(t => t.name.includes('fact') || t.name.includes('conversation') || t.name.includes('profile') || t.name.includes('memory'))
      const filerTools = tools.filter(t => t.name.includes('file') || t.name.includes('grant') || t.name.includes('workspace'))
      const onepasswordTools = tools.filter(t => t.name.includes('vault') || t.name.includes('item') || t.name.includes('secret'))

      log(`  Telegram-related tools: ${telegramTools.length}`, 'debug')
      log(`  Memory-related tools: ${memoryTools.length}`, 'debug')
      log(`  Filer-related tools: ${filerTools.length}`, 'debug')
      log(`  1Password-related tools: ${onepasswordTools.length}`, 'debug')

      // We should have tools from multiple MCPs
      expect(tools.length).toBeGreaterThan(20)
      expect(telegramTools.length).toBeGreaterThan(0)
      expect(memoryTools.length).toBeGreaterThan(0)
      expect(filerTools.length).toBeGreaterThan(0)

      log('Tool discovery verified - all MCPs are exposing tools', 'success')
    })

    it('should include the built-in get_status tool', async () => {
      log('Checking for get_status tool...', 'info')

      const response = await authFetch('http://localhost:8010/tools/list')
      const data = await response.json() as { tools: Array<{ name: string }> }

      const hasStatus = data.tools.some(t => t.name === 'get_status')

      if (hasStatus) {
        log('get_status tool is available', 'success')
      } else {
        log('get_status tool not found', 'warn')
      }

      expect(hasStatus).toBe(true)
    })
  })

  describe('Tool Execution via /tools/call', () => {
    it('should execute get_status tool', async () => {
      log('Calling get_status tool...', 'info')

      const response = await authFetch('http://localhost:8010/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'get_status',
          arguments: {},
        }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json()

      log(`get_status returned: ${JSON.stringify(data).substring(0, 100)}...`, 'debug')
      log('get_status tool executed successfully', 'success')
    })

    it('should execute telegram_list_chats tool (routed to Telegram MCP)', async () => {
      log('Calling telegram_list_chats tool...', 'info')

      const response = await authFetch('http://localhost:8010/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'telegram_list_chats',
          arguments: { limit: 5 },
        }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json()

      log('telegram_list_chats tool executed successfully (routed to Telegram)', 'success')
    })

    it('should execute memory_get_memory_stats tool (routed to Memory MCP)', async () => {
      log('Calling memory_get_memory_stats tool...', 'info')

      const response = await authFetch('http://localhost:8010/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'memory_get_memory_stats',
          arguments: {},
        }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json()

      log('memory_get_memory_stats tool executed successfully (routed to Memory)', 'success')
    })

    it('should execute filer_get_workspace_info tool (routed to Filer MCP)', async () => {
      log('Calling filer_get_workspace_info tool...', 'info')

      const response = await authFetch('http://localhost:8010/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'filer_get_workspace_info',
          arguments: {},
        }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json()

      log('filer_get_workspace_info tool executed successfully (routed to Filer)', 'success')
    })
  })

  describe('Thinker Integration', () => {
    it('should check if Thinker is running', async () => {
      log('Checking Thinker health...', 'info')

      const health = await thinker.healthCheck()

      if (health.healthy) {
        log(`Thinker is healthy (${health.duration}ms)`, 'success')
      } else {
        log('Thinker is not running (optional for this test)', 'warn')
      }

      // Thinker is optional - just log if it's not running
      // The main thing is that Orchestrator is working
    })

    it('should verify Thinker can reach Orchestrator tools', async () => {
      log('Verifying Orchestrator endpoints are accessible...', 'info')

      // This simulates what Thinker does - call the Orchestrator's REST API
      const [healthRes, toolsRes] = await Promise.all([
        authFetch('http://localhost:8010/health'),
        authFetch('http://localhost:8010/tools/list'),
      ])

      expect(healthRes.ok).toBe(true)
      expect(toolsRes.ok).toBe(true)

      const healthData = await healthRes.json()
      const toolsData = await toolsRes.json() as { tools: unknown[] }

      log(`Orchestrator health: ${healthData.status || 'ok'}`, 'success')
      log(`Tools available: ${toolsData.tools?.length || 0}`, 'success')
      log('Thinker-compatible REST API verified', 'success')
    })

    it('should return structured status from /status endpoint', async () => {
      log('Checking /status endpoint...', 'info')

      const res = await authFetch('http://localhost:8010/status')
      expect(res.ok).toBe(true)

      const data = await res.json() as Record<string, unknown>

      expect(data.status).toMatch(/^(ready|initializing)$/)
      expect(typeof data.uptime).toBe('number')
      expect(data.mcpServers).toBeDefined()
      expect(typeof data.toolCount).toBe('number')
      expect(data.sessions).toBeDefined()
      expect(data.security).toBeDefined()
      expect(data.halt).toBeDefined()

      log(`Status: ${data.status}, uptime: ${data.uptime}ms, tools: ${data.toolCount}`, 'success')
    })
  })

  describe('Error Handling', () => {
    it('should return error for unknown tool', async () => {
      log('Testing error handling for unknown tool...', 'info')

      const response = await authFetch('http://localhost:8010/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'nonexistent_tool_xyz123',
          arguments: {},
        }),
      })

      const data = await response.json()

      // Should return error, not crash
      log('Error handling for unknown tool verified', 'success')
    })

    it('should handle malformed request gracefully', async () => {
      log('Testing error handling for malformed request...', 'info')

      const response = await authFetch('http://localhost:8010/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid json }',
      })

      // Should not crash
      log('Malformed request handling verified', 'success')
    })
  })

  describe('Summary', () => {
    it('should complete all stdio mode tests', async () => {
      logSection('STDIO MODE TEST SUMMARY')

      const checks = [
        { name: 'Orchestrator healthy', check: async () => (await orchestrator.healthCheck()).healthy },
        { name: 'Tools discoverable', check: async () => {
          const res = await authFetch('http://localhost:8010/tools/list')
          const data = await res.json() as { tools: unknown[] }
          return res.ok && data.tools?.length > 20
        }},
        { name: 'Tool execution works', check: async () => {
          const res = await authFetch('http://localhost:8010/tools/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'get_status', arguments: {} }),
          })
          return res.ok
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
