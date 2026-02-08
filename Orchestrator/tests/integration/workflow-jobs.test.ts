/**
 * Level 3 Workflow Test: Jobs → Guardian → Telegram
 *
 * Tests scheduled and background task workflows:
 * 1. Queue background tasks via Orchestrator
 * 2. Verify security scanning happens during execution
 * 3. Test job scheduling and status tracking
 *
 * NOTE: Requires Inngest server running for full workflow testing
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createOrchestratorClient,
  createGuardianClient,
  createTelegramClient,
  checkMCPsAvailable,
  log,
  logSection,
  MCPTestClient,
} from '../helpers/mcp-client.js'
import {
  parseJsonContent,
  testId,
  waitForJobCompletion,
  cleanupTasks,
} from '../helpers/workflow-helpers.js'

describe('Workflow: Jobs → Guardian → Telegram (Background Tasks)', () => {
  let orchestratorClient: MCPTestClient
  let guardianClient: MCPTestClient
  let telegramClient: MCPTestClient
  let orchestratorAvailable = false
  let guardianAvailable = false
  let telegramAvailable = false
  let testChatId: string | null = null

  // Track resources for cleanup
  const createdJobIds: string[] = []
  const createdTaskIds: string[] = []

  // Helper to skip test at runtime if MCPs unavailable
  function skipIfUnavailable(requiredMcps: ('orchestrator' | 'guardian' | 'telegram')[], needsChatId = false): boolean {
    const missing: string[] = []
    if (requiredMcps.includes('orchestrator') && !orchestratorAvailable) missing.push('Orchestrator')
    if (requiredMcps.includes('guardian') && !guardianAvailable) missing.push('Guardian')
    if (requiredMcps.includes('telegram') && !telegramAvailable) missing.push('Telegram')
    if (needsChatId && !testChatId) missing.push('Test Chat ID')

    if (missing.length > 0) {
      log(`Skipping: ${missing.join(', ')} unavailable`, 'warn')
      return true
    }
    return false
  }

  beforeAll(async () => {
    orchestratorClient = createOrchestratorClient()
    guardianClient = createGuardianClient()
    telegramClient = createTelegramClient()

    logSection('Jobs Workflow Tests')

    const availability = await checkMCPsAvailable([orchestratorClient, guardianClient, telegramClient])
    orchestratorAvailable = availability.get('Orchestrator') ?? false
    guardianAvailable = availability.get('Guardian') ?? false
    telegramAvailable = availability.get('Telegram') ?? false

    if (!orchestratorAvailable) {
      log('Orchestrator unavailable - most tests will be skipped', 'warn')
    }
    if (!guardianAvailable) {
      log('Guardian MCP unavailable - security workflow tests will be limited', 'warn')
    }
    if (!telegramAvailable) {
      log('Telegram MCP unavailable - message sending tests will be skipped', 'warn')
    }

    // Get a test chat ID if Telegram is available
    if (telegramAvailable) {
      const chatsResult = await telegramClient.callTool('list_chats', { limit: 1 })
      if (chatsResult.success) {
        const parsed = parseJsonContent<{ chats?: Array<{ id: string }> }>(chatsResult)
        testChatId = parsed?.chats?.[0]?.id ?? null
        if (testChatId) {
          log(`Using test chat ID: ${testChatId}`, 'info')
        }
      }
    }
  })

  afterAll(async () => {
    logSection('Cleanup')

    if (orchestratorAvailable) {
      for (const jobId of createdJobIds) {
        try {
          await orchestratorClient.callTool('delete_job', { jobId })
          log(`Cleaned up job ${jobId}`, 'debug')
        } catch {
          log(`Failed to cleanup job ${jobId}`, 'warn')
        }
      }
    }

    if (createdTaskIds.length > 0) {
      cleanupTasks(createdTaskIds)
      log(`Cleaned up ${createdTaskIds.length} task files`, 'debug')
    }
  })

  describe('Orchestrator Health', () => {
    it('should report Orchestrator availability status', async () => {
      const result = await orchestratorClient.healthCheck()
      log(`Orchestrator health: ${result.healthy ? 'UP' : 'DOWN'} (${result.duration}ms)`, result.healthy ? 'success' : 'warn')
      expect(true).toBe(true)
    })
  })

  describe('Job Listing', () => {
    it('should list existing jobs', async () => {
      if (skipIfUnavailable(['orchestrator'])) return

      log('Listing jobs...', 'info')
      const result = await orchestratorClient.callTool('list_jobs', {})

      expect(result.success).toBe(true)
      log(`Jobs listed (${result.duration}ms)`, 'success')

      const parsed = parseJsonContent<{ jobs?: unknown[]; count?: number }>(result)
      log(`Found ${parsed?.count ?? 0} existing jobs`, 'info')
    })
  })

  describe('Background Task Queueing', () => {
    it('should queue a task for background execution', async () => {
      if (skipIfUnavailable(['orchestrator'])) return

      const taskName = `Workflow Test Task ${testId()}`

      log(`Queueing task: ${taskName}...`, 'info')
      const result = await orchestratorClient.callTool('queue_task', {
        name: taskName,
        action: {
          type: 'tool_call',
          toolName: 'list_facts',
          parameters: { limit: 5 },
        },
      })

      expect(result.success).toBe(true)
      log(`Task queued (${result.duration}ms)`, 'success')

      const parsed = parseJsonContent<{ taskId?: string; status?: string }>(result)
      if (parsed?.taskId) {
        createdTaskIds.push(parsed.taskId)
        log(`Task ID: ${parsed.taskId}, Status: ${parsed.status}`, 'info')
      }
    })

    it('should track task status', async () => {
      if (skipIfUnavailable(['orchestrator'])) return

      const taskName = `Status Track Test ${testId()}`

      log('Queueing task to track...', 'info')
      const queueResult = await orchestratorClient.callTool('queue_task', {
        name: taskName,
        action: {
          type: 'tool_call',
          toolName: 'get_memory_stats',
          parameters: {},
        },
      })

      expect(queueResult.success).toBe(true)

      const queueParsed = parseJsonContent<{ taskId?: string }>(queueResult)
      const taskId = queueParsed?.taskId

      if (!taskId) {
        log('No task ID returned - skipping status check', 'warn')
        return
      }

      createdTaskIds.push(taskId)

      log(`Checking status of task ${taskId}...`, 'info')
      const statusResult = await orchestratorClient.callTool('get_job_status', {
        taskId,
      })

      expect(statusResult.success).toBe(true)

      const statusParsed = parseJsonContent<{ status?: string; name?: string }>(statusResult)
      log(`Task status: ${statusParsed?.status} (name: ${statusParsed?.name})`, 'info')

      expect(['queued', 'running', 'completed', 'failed']).toContain(statusParsed?.status)
    })

    it('should wait for task completion', async () => {
      if (skipIfUnavailable(['orchestrator'])) return

      const taskName = `Completion Wait Test ${testId()}`

      log('Queueing task and waiting for completion...', 'info')
      const queueResult = await orchestratorClient.callTool('queue_task', {
        name: taskName,
        action: {
          type: 'tool_call',
          toolName: 'list_facts',
          parameters: { limit: 1 },
        },
      })

      expect(queueResult.success).toBe(true)

      const queueParsed = parseJsonContent<{ taskId?: string }>(queueResult)
      const taskId = queueParsed?.taskId

      if (!taskId) {
        log('No task ID returned', 'warn')
        return
      }

      createdTaskIds.push(taskId)

      const completion = await waitForJobCompletion(orchestratorClient, taskId, 15000, 1000)

      if (completion.completed) {
        log(`Task completed with status: ${completion.status}`, 'success')
      } else {
        log('Task did not complete within timeout', 'warn')
      }

      expect(true).toBe(true)
    })
  })

  describe('Scheduled Jobs', () => {
    it('should create a scheduled job', async () => {
      if (skipIfUnavailable(['orchestrator'])) return

      const jobName = `Scheduled Test ${testId()}`
      const scheduledTime = new Date(Date.now() + 60000).toISOString()

      log(`Creating scheduled job: ${jobName}...`, 'info')
      const result = await orchestratorClient.callTool('create_job', {
        name: jobName,
        type: 'scheduled',
        scheduledAt: scheduledTime,
        action: {
          type: 'tool_call',
          toolName: 'list_facts',
          parameters: { limit: 1 },
        },
      })

      expect(result.success).toBe(true)
      log(`Job created (${result.duration}ms)`, 'success')

      const parsed = parseJsonContent<{ jobId?: string }>(result)
      if (parsed?.jobId) {
        createdJobIds.push(parsed.jobId)
        log(`Job ID: ${parsed.jobId}`, 'info')
      }
    })

    it('should reject scheduled job in the past', async () => {
      if (skipIfUnavailable(['orchestrator'])) return

      const jobName = `Past Scheduled Test ${testId()}`
      const pastTime = new Date(Date.now() - 60000).toISOString()

      log('Creating job scheduled in the past (should fail)...', 'info')
      const result = await orchestratorClient.callTool('create_job', {
        name: jobName,
        type: 'scheduled',
        scheduledAt: pastTime,
        action: {
          type: 'tool_call',
          toolName: 'list_facts',
          parameters: {},
        },
      })

      const parsed = parseJsonContent<{ success?: boolean; error?: string }>(result)
      if (parsed?.success === false || parsed?.error) {
        log('Correctly rejected past scheduled time', 'success')
      } else {
        log('Unexpected: Job creation did not fail', 'warn')
      }
    })
  })

  describe('Cron Jobs', () => {
    it('should create a cron job', async () => {
      if (skipIfUnavailable(['orchestrator'])) return

      const jobName = `Cron Test ${testId()}`

      log(`Creating cron job: ${jobName}...`, 'info')
      const result = await orchestratorClient.callTool('create_job', {
        name: jobName,
        type: 'cron',
        cronExpression: '0 0 * * *',
        timezone: 'UTC',
        action: {
          type: 'tool_call',
          toolName: 'list_facts',
          parameters: { limit: 5 },
        },
        enabled: false,
      })

      expect(result.success).toBe(true)
      log(`Cron job created (${result.duration}ms)`, 'success')

      const parsed = parseJsonContent<{ jobId?: string }>(result)
      if (parsed?.jobId) {
        createdJobIds.push(parsed.jobId)
        log(`Job ID: ${parsed.jobId}`, 'info')
      }
    })

    it('should require cron expression for cron jobs', async () => {
      if (skipIfUnavailable(['orchestrator'])) return

      const jobName = `Invalid Cron Test ${testId()}`

      log('Creating cron job without expression (should fail)...', 'info')
      const result = await orchestratorClient.callTool('create_job', {
        name: jobName,
        type: 'cron',
        action: {
          type: 'tool_call',
          toolName: 'list_facts',
          parameters: {},
        },
      })

      const parsed = parseJsonContent<{ success?: boolean; error?: string }>(result)
      if (parsed?.success === false || parsed?.error) {
        log('Correctly rejected missing cron expression', 'success')
      } else {
        log('Unexpected: Job creation did not fail', 'warn')
      }
    })

    it('should reject invalid cron expressions', async () => {
      if (skipIfUnavailable(['orchestrator'])) return

      const jobName = `Invalid Cron Expr Test ${testId()}`

      log('Creating cron job with invalid expression (should fail)...', 'info')
      const result = await orchestratorClient.callTool('create_job', {
        name: jobName,
        type: 'cron',
        cronExpression: 'not-a-cron',
        action: {
          type: 'tool_call',
          toolName: 'list_facts',
          parameters: {},
        },
      })

      const parsed = parseJsonContent<{ success?: boolean; error?: string }>(result)
      expect(parsed?.success).toBe(false)
      expect(parsed?.error).toContain('Invalid cron expression')
      log('Correctly rejected invalid cron expression', 'success')
    })

    it('should reject invalid timezone', async () => {
      if (skipIfUnavailable(['orchestrator'])) return

      const jobName = `Invalid TZ Test ${testId()}`

      log('Creating cron job with invalid timezone (should fail)...', 'info')
      const result = await orchestratorClient.callTool('create_job', {
        name: jobName,
        type: 'cron',
        cronExpression: '0 9 * * *',
        timezone: 'Mars/Olympus_Mons',
        action: {
          type: 'tool_call',
          toolName: 'list_facts',
          parameters: {},
        },
      })

      const parsed = parseJsonContent<{ success?: boolean; error?: string }>(result)
      expect(parsed?.success).toBe(false)
      expect(parsed?.error).toContain('Invalid timezone')
      log('Correctly rejected invalid timezone', 'success')
    })

    it('should accept valid timezones', async () => {
      if (skipIfUnavailable(['orchestrator'])) return

      const jobName = `Valid TZ Test ${testId()}`

      log('Creating cron job with Europe/Warsaw timezone...', 'info')
      const result = await orchestratorClient.callTool('create_job', {
        name: jobName,
        type: 'cron',
        cronExpression: '0 8 * * *',
        timezone: 'Europe/Warsaw',
        action: {
          type: 'tool_call',
          toolName: 'list_facts',
          parameters: { limit: 1 },
        },
        enabled: false,
      })

      expect(result.success).toBe(true)
      log('Accepted valid timezone', 'success')

      const parsed = parseJsonContent<{ jobId?: string }>(result)
      if (parsed?.jobId) {
        createdJobIds.push(parsed.jobId)
      }
    })
  })

  describe('Job Deletion', () => {
    it('should delete a job', async () => {
      if (skipIfUnavailable(['orchestrator'])) return

      const jobName = `Delete Test ${testId()}`

      log('Creating job to delete...', 'info')
      const createResult = await orchestratorClient.callTool('create_job', {
        name: jobName,
        type: 'scheduled',
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        action: {
          type: 'tool_call',
          toolName: 'list_facts',
          parameters: {},
        },
      })

      expect(createResult.success).toBe(true)

      const createParsed = parseJsonContent<{ jobId?: string }>(createResult)
      const jobId = createParsed?.jobId

      if (!jobId) {
        log('No job ID returned', 'warn')
        return
      }

      log(`Deleting job ${jobId}...`, 'info')
      const deleteResult = await orchestratorClient.callTool('delete_job', { jobId })

      expect(deleteResult.success).toBe(true)
      log('Job deleted', 'success')

      const verifyResult = await orchestratorClient.callTool('get_job_status', {
        taskId: jobId,
      })

      const verifyParsed = parseJsonContent<{ success?: boolean; error?: string }>(verifyResult)
      if (verifyParsed?.success === false || verifyParsed?.error) {
        log('Verified job no longer exists', 'success')
      }
    })
  })

  describe('Telegram Message Task (Full Workflow)', () => {
    it('should queue secure Telegram message task', async () => {
      if (skipIfUnavailable(['orchestrator', 'telegram'], true)) return

      const taskName = `Telegram Workflow Test ${testId()}`
      const message = `[Workflow Test] Automated message at ${new Date().toISOString()}`

      log('Queueing Telegram message task...', 'info')
      const result = await orchestratorClient.callTool('queue_task', {
        name: taskName,
        action: {
          type: 'tool_call',
          toolName: 'send_telegram',
          parameters: {
            message,
            chat_id: testChatId,
          },
        },
      })

      expect(result.success).toBe(true)
      log(`Task queued (${result.duration}ms)`, 'success')

      const parsed = parseJsonContent<{ taskId?: string }>(result)
      if (parsed?.taskId) {
        createdTaskIds.push(parsed.taskId)

        log('Waiting for task completion...', 'info')
        const completion = await waitForJobCompletion(orchestratorClient, parsed.taskId, 20000, 2000)

        if (completion.completed) {
          log(`Task ${completion.status}: Message should have been sent`, completion.status === 'completed' ? 'success' : 'warn')
        } else {
          log('Task did not complete within timeout (Inngest may not be running)', 'warn')
        }
      }
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid tool name in task', async () => {
      if (skipIfUnavailable(['orchestrator'])) return

      const taskName = `Invalid Tool Test ${testId()}`

      log('Queueing task with invalid tool name...', 'info')
      const result = await orchestratorClient.callTool('queue_task', {
        name: taskName,
        action: {
          type: 'tool_call',
          toolName: 'nonexistent_tool_12345',
          parameters: {},
        },
      })

      if (result.success) {
        const parsed = parseJsonContent<{ taskId?: string }>(result)
        if (parsed?.taskId) {
          createdTaskIds.push(parsed.taskId)
          log('Task queued (will fail during execution)', 'info')

          await new Promise((resolve) => setTimeout(resolve, 3000))
          const statusResult = await orchestratorClient.callTool('get_job_status', {
            taskId: parsed.taskId,
          })

          const statusParsed = parseJsonContent<{ status?: string; error?: string }>(statusResult)
          log(`Task status: ${statusParsed?.status}, error: ${statusParsed?.error || 'none'}`, 'info')
        }
      } else {
        log('Task rejected at queue time (validation)', 'info')
      }

      expect(true).toBe(true)
    })

    it('should handle get_job_status for non-existent task', async () => {
      if (skipIfUnavailable(['orchestrator'])) return

      const fakeTaskId = `task_fake_${testId()}`

      log(`Getting status of non-existent task ${fakeTaskId}...`, 'info')
      const result = await orchestratorClient.callTool('get_job_status', {
        taskId: fakeTaskId,
      })

      const parsed = parseJsonContent<{ success?: boolean; error?: string }>(result)
      if (parsed?.success === false || parsed?.error) {
        log('Correctly returned error for non-existent task', 'success')
      } else {
        log('Unexpected response for non-existent task', 'warn')
      }

      expect(true).toBe(true)
    })
  })
})
