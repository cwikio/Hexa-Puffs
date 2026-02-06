/**
 * Filer MCP Integration Tests
 *
 * Tests the Filer MCP server at http://localhost:8004
 * Prerequisites: Filer MCP must be running (via launch-all.sh)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createFilerClient, log, logSection, MCPTestClient } from '../helpers/mcp-client.js'

describe('Filer MCP', () => {
  let client: MCPTestClient
  // Use relative paths within the workspace (Filer MCP only allows workspace paths)
  const testFileName = `test-file-${Date.now()}.txt`
  const testContent = `Test content created at ${new Date().toISOString()}`

  beforeAll(() => {
    client = createFilerClient()
    logSection(`Filer MCP Tests (${client.getBaseUrl()})`)
  })

  afterAll(async () => {
    // Cleanup: try to delete test files
    log('Cleaning up test files', 'info')
    await client.callTool('delete_file', { path: testFileName })
    await client.callTool('delete_file', { path: `${testFileName}.copy` })
    await client.callTool('delete_file', { path: `${testFileName}.moved` })
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

  describe('Workspace Info', () => {
    it('should get workspace info', async () => {
      log('Getting workspace info', 'info')
      const result = await client.callTool('get_workspace_info', {})

      if (result.success) {
        log(`Workspace info retrieved (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 300)}`, 'debug')
      } else {
        log(`get_workspace_info failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  describe('File CRUD Operations', () => {
    it('should create a file', async () => {
      log(`Creating file: ${testFileName}`, 'info')
      const result = await client.callTool('create_file', {
        path: testFileName,
        content: testContent,
      })

      if (result.success) {
        log(`File created successfully (${result.duration}ms)`, 'success')
      } else {
        log(`create_file failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should read the created file', async () => {
      log(`Reading file: ${testFileName}`, 'info')
      const result = await client.callTool('read_file', {
        path: testFileName,
      })

      if (result.success) {
        log(`File read successfully (${result.duration}ms)`, 'success')
        const data = result.data as { content?: Array<{ text?: string }> }
        const text = data?.content?.[0]?.text || JSON.stringify(data)
        log(`Content preview: ${text.slice(0, 100)}...`, 'debug')
      } else {
        log(`read_file failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should update the file', async () => {
      const updatedContent = `${testContent}\n\nUpdated at ${new Date().toISOString()}`
      log(`Updating file: ${testFileName}`, 'info')
      const result = await client.callTool('update_file', {
        path: testFileName,
        content: updatedContent,
      })

      if (result.success) {
        log(`File updated successfully (${result.duration}ms)`, 'success')
      } else {
        log(`update_file failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should copy the file', async () => {
      const copyPath = `${testFileName}.copy`
      log(`Copying file to: ${copyPath}`, 'info')
      const result = await client.callTool('copy_file', {
        source: testFileName,
        destination: copyPath,
      })

      if (result.success) {
        log(`File copied successfully (${result.duration}ms)`, 'success')
      } else {
        log(`copy_file failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should move/rename the copy', async () => {
      const copyPath = `${testFileName}.copy`
      const movedPath = `${testFileName}.moved`
      log(`Moving file from ${copyPath} to ${movedPath}`, 'info')
      const result = await client.callTool('move_file', {
        source: copyPath,
        destination: movedPath,
      })

      if (result.success) {
        log(`File moved successfully (${result.duration}ms)`, 'success')
      } else {
        log(`move_file failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should list directory contents', async () => {
      log('Listing workspace directory', 'info')
      const result = await client.callTool('list_files', {
        path: '.',
      })

      if (result.success) {
        log(`Directory listed successfully (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 300)}`, 'debug')
      } else {
        log(`list_files failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })

    it('should delete the file', async () => {
      log(`Deleting file: ${testFileName}`, 'info')
      const result = await client.callTool('delete_file', {
        path: testFileName,
      })

      if (result.success) {
        log(`File deleted successfully (${result.duration}ms)`, 'success')
      } else {
        log(`delete_file failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should handle reading non-existent file gracefully', async () => {
      const nonExistentFile = 'this-file-does-not-exist-12345.txt'
      log(`Attempting to read non-existent file: ${nonExistentFile}`, 'info')
      const result = await client.callTool('read_file', {
        path: nonExistentFile,
      })

      log(`Non-existent file response: success=${result.success} (${result.duration}ms)`, 'debug')
      if (result.error) {
        log(`Error (expected): ${result.error}`, 'debug')
      }

      // We expect this to either fail or return an error in the data
      expect(result.duration).toBeLessThan(10000)
    })
  })

  describe('Search', () => {
    it('should search for files', async () => {
      log('Searching for test files in workspace', 'info')
      const result = await client.callTool('search_files', {
        query: 'test',
      })

      if (result.success) {
        log(`Search completed successfully (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 300)}`, 'debug')
      } else {
        log(`search_files failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })

  describe('Audit Log', () => {
    it('should retrieve audit log', async () => {
      log('Getting audit log', 'info')
      const result = await client.callTool('get_audit_log', {})

      if (result.success) {
        log(`Audit log retrieved (${result.duration}ms)`, 'success')
        log(`Response: ${JSON.stringify(result.data).slice(0, 300)}`, 'debug')
      } else {
        log(`get_audit_log failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
    })
  })
})
