/**
 * Workflow Test Helpers - Utilities for cross-MCP workflow testing
 */

import { unlinkSync } from 'fs'
import { join } from 'path'
import { MCPTestClient, MCPToolCallResult, log } from './mcp-client.js'

export interface WorkflowStep {
  name: string
  client: MCPTestClient
  tool: string
  args: Record<string, unknown>
  shouldSucceed?: boolean
}

export interface WorkflowResult {
  success: boolean
  results: Map<string, MCPToolCallResult>
  failedStep?: string
  error?: string
}

/**
 * Execute a multi-step workflow, collecting results for each step.
 * Fails fast if any step doesn't meet its expected outcome.
 */
export async function executeWorkflow(steps: WorkflowStep[]): Promise<WorkflowResult> {
  const results = new Map<string, MCPToolCallResult>()

  for (const step of steps) {
    log(`Workflow step: ${step.name} (${step.client.getName()}.${step.tool})`, 'info')

    const result = await step.client.callTool(step.tool, step.args)
    results.set(step.name, result)

    const expectedSuccess = step.shouldSucceed ?? true
    if (result.success !== expectedSuccess) {
      log(`Step "${step.name}" ${result.success ? 'succeeded' : 'failed'} unexpectedly`, 'error')
      return {
        success: false,
        results,
        failedStep: step.name,
        error: result.error || `Expected success=${expectedSuccess}, got ${result.success}`,
      }
    }

    log(`Step "${step.name}" completed (${result.duration}ms)`, 'success')
  }

  return { success: true, results }
}

export interface GuardianScanResult {
  allowed: boolean
  risk: 'none' | 'low' | 'medium' | 'high'
  reason?: string
  threats?: string[]
}

/**
 * Parse Guardian scan_content tool result into structured format.
 *
 * Guardian returns a StandardResponse wrapping ScanContentResult:
 *   { success: true, data: { safe, confidence, threats, explanation, scan_id } }
 */
export function parseGuardianResult(result: MCPToolCallResult): GuardianScanResult | null {
  if (!result.data) return null

  try {
    let scan: Record<string, unknown>

    // Check for raw MCP envelope
    const data = result.data as { content?: Array<{ type: string; text?: string }> }
    const content = data.content?.[0]
    if (content?.type === 'text' && content.text) {
      const parsed = JSON.parse(content.text)
      scan = (parsed.data ?? parsed) as Record<string, unknown>
    } else {
      // Already unwrapped by callTool
      scan = result.data as Record<string, unknown>
    }

    const safe = (scan.safe as boolean) ?? true
    const confidence = (scan.confidence as number) ?? 1

    let risk: GuardianScanResult['risk'] = 'none'
    if (!safe) {
      risk = confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'medium' : 'low'
    }

    return {
      allowed: safe,
      risk,
      reason: scan.explanation as string | undefined,
      threats: scan.threats as string[] | undefined,
    }
  } catch {
    return null
  }
}

/**
 * Parse text content from MCP tool response.
 * Handles both raw MCP envelope and already-unwrapped data from callTool().
 */
export function parseTextContent(result: MCPToolCallResult): string | null {
  if (!result.data) return null

  try {
    // Check for raw MCP envelope (content[0].text)
    const data = result.data as { content?: Array<{ type: string; text?: string }> }
    const content = data.content?.[0]
    if (content?.type === 'text' && content.text) {
      return content.text
    }
    // Already unwrapped by callTool — stringify for compatibility
    return typeof result.data === 'string' ? result.data : JSON.stringify(result.data)
  } catch {
    return null
  }
}

/**
 * Parse JSON from MCP tool response text content.
 * Handles both raw MCP envelope and already-unwrapped data from callTool().
 *
 * When callTool() has already unwrapped the MCP envelope, it strips the
 * StandardResponse wrapper (extracting .data). This function reconstructs
 * the { success, data, error } shape that tests expect.
 */
export function parseJsonContent<T = unknown>(result: MCPToolCallResult): T | null {
  if (!result.data) return null

  try {
    // Check for raw MCP envelope first
    const data = result.data as { content?: Array<{ type: string; text?: string }> }
    const content = data.content?.[0]
    if (content?.type === 'text' && content.text) {
      return JSON.parse(content.text) as T
    }
    // Already unwrapped by callTool — reconstruct StandardResponse shape
    return { success: result.success, data: result.data, error: result.error } as T
  } catch {
    return null
  }
}

/**
 * Wait for a job to complete by polling its status.
 */
export async function waitForJobCompletion(
  client: MCPTestClient,
  taskId: string,
  maxWaitMs: number = 30000,
  pollIntervalMs: number = 1000
): Promise<{ completed: boolean; status?: string; result?: MCPToolCallResult }> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    const result = await client.callTool('get_job_status', { taskId })

    if (result.success) {
      const parsed = parseJsonContent<{ status: string }>(result)
      if (parsed?.status === 'completed' || parsed?.status === 'failed') {
        return {
          completed: true,
          status: parsed.status,
          result,
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  return { completed: false }
}

/**
 * Generate a unique test identifier for isolation.
 */
export function testId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Create a test fact for Memory MCP with consistent format.
 */
export function createAuditFact(operation: string, details: string): string {
  return `[AUDIT] ${operation}: ${details} (${new Date().toISOString()})`
}

/**
 * Cleanup helper - delete facts by IDs, ignoring errors.
 */
export async function cleanupFacts(
  memoryClient: MCPTestClient,
  factIds: number[]
): Promise<void> {
  for (const id of factIds) {
    try {
      await memoryClient.callTool('delete_fact', { factId: id })
      log(`Cleaned up fact ${id}`, 'debug')
    } catch {
      log(`Failed to cleanup fact ${id}`, 'warn')
    }
  }
}

/**
 * Cleanup helper - delete files by paths, ignoring errors.
 */
export async function cleanupFiles(
  filerClient: MCPTestClient,
  paths: string[]
): Promise<void> {
  for (const path of paths) {
    try {
      await filerClient.callTool('delete_file', { path })
      log(`Cleaned up file ${path}`, 'debug')
    } catch {
      log(`Failed to cleanup file ${path}`, 'warn')
    }
  }
}

/**
 * Cleanup helper - delete task JSON files from storage.
 * Tasks have no MCP delete tool, so we clean up via direct filesystem access.
 */
export function cleanupTasks(taskIds: string[]): void {
  const tasksDir = join(process.env.HOME || '~', '.annabelle/data/tasks')

  for (const taskId of taskIds) {
    try {
      unlinkSync(join(tasksDir, `${taskId}.json`))
      log(`Cleaned up task ${taskId}`, 'debug')
    } catch {
      // File may not exist if Inngest wasn't running
    }
  }
}
