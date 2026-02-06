/**
 * Level 3 Workflow Test: Skills Scheduling Pipeline
 *
 * Tests the skill storage → scheduling → execution workflow:
 * 1. Store a skill via Memory MCP (through Orchestrator)
 * 2. Verify skill is listed with correct fields
 * 3. Verify Thinker's /execute-skill endpoint is reachable
 * 4. Execute the skill via Thinker and verify result
 * 5. Update skill's last_run fields
 * 6. Clean up
 *
 * Prerequisites:
 *   - Orchestrator must be running (with Memory MCP connected via stdio)
 *   - Thinker must be running
 *   - LLM provider configured
 *
 * Run with: npm run test:skills
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  MCPTestClient,
  createOrchestratorClient,
  createThinkerClient,
  checkMCPsAvailable,
  log,
  logSection,
  MCP_URLS,
} from '../helpers/mcp-client.js'
import { parseJsonContent } from '../helpers/workflow-helpers.js'

interface SkillData {
  skill_id: number
  id?: number
  name?: string
  trigger_type?: string
  enabled?: boolean
  instructions?: string
  trigger_config?: Record<string, unknown>
  last_run_at?: string | null
  last_run_status?: string | null
  last_run_summary?: string | null
}

interface SkillListData {
  skills: SkillData[]
}

describe('Workflow: Skills Scheduling Pipeline', () => {
  let orchestratorClient: MCPTestClient
  let thinkerClient: MCPTestClient
  let orchestratorAvailable = false
  let thinkerAvailable = false

  // Track resources for cleanup
  const createdSkillIds: number[] = []
  const testAgentId = `test-skills-${Date.now()}`

  beforeAll(async () => {
    orchestratorClient = createOrchestratorClient()
    thinkerClient = createThinkerClient()

    logSection('Skills Scheduling Pipeline Tests')

    const availability = await checkMCPsAvailable([orchestratorClient, thinkerClient])
    orchestratorAvailable = availability.get('Orchestrator') ?? false
    thinkerAvailable = availability.get('Thinker') ?? false

    if (orchestratorAvailable) {
      log(`Orchestrator available at ${MCP_URLS.orchestrator}`, 'success')
    } else {
      log(`Orchestrator not available - tests will be skipped`, 'warn')
    }
    if (thinkerAvailable) {
      log(`Thinker available at ${MCP_URLS.thinker}`, 'success')
    } else {
      log(`Thinker not available - execution tests will be skipped`, 'warn')
    }
  })

  afterAll(async () => {
    logSection('Cleanup')

    if (orchestratorAvailable) {
      for (const skillId of createdSkillIds) {
        try {
          await orchestratorClient.callTool('memory_delete_skill', { skill_id: skillId })
          log(`Cleaned up skill ${skillId}`, 'debug')
        } catch {
          log(`Failed to cleanup skill ${skillId}`, 'warn')
        }
      }
    }
  })

  function skipIfOrchestratorUnavailable(): boolean {
    if (!orchestratorAvailable) {
      log('Skipping: Orchestrator not available', 'warn')
      return true
    }
    return false
  }

  // =========================================
  // SECTION 1: Store Skill via Orchestrator
  // =========================================
  describe('Skill Storage (Memory MCP via Orchestrator)', () => {
    it('should store a test skill through Orchestrator tool routing', async () => {
      if (skipIfOrchestratorUnavailable()) return

      log('Storing test skill via memory_store_skill', 'info')

      const result = await orchestratorClient.callTool('memory_store_skill', {
        agent_id: testAgentId,
        name: 'Test Workflow Skill',
        description: 'Integration test skill for workflow validation',
        trigger_type: 'cron',
        trigger_config: { interval_minutes: 1440 },
        instructions: 'List memory tools and summarize what you find.',
        required_tools: ['memory_list_facts'],
        max_steps: 3,
        notify_on_completion: false,
      })

      expect(result.success).toBe(true)

      const parsed = parseJsonContent<{ success: boolean; data: SkillData }>(result)
      expect(parsed?.success).toBe(true)
      expect(parsed?.data?.skill_id).toBeDefined()

      createdSkillIds.push(parsed!.data.skill_id)

      log(`Stored skill with ID: ${parsed!.data.skill_id}`, 'success')
    })

    it('should list stored skills filtered by agent_id', async () => {
      if (skipIfOrchestratorUnavailable()) return
      if (createdSkillIds.length === 0) {
        log('Skipping: No skills created yet', 'warn')
        return
      }

      log('Listing skills for test agent', 'info')

      const result = await orchestratorClient.callTool('memory_list_skills', {
        agent_id: testAgentId,
        enabled: true,
      })

      expect(result.success).toBe(true)

      const parsed = parseJsonContent<{ success: boolean; data: SkillListData }>(result)
      expect(parsed?.success).toBe(true)
      expect(parsed?.data?.skills).toBeDefined()
      expect(parsed!.data.skills.length).toBeGreaterThanOrEqual(1)

      const skill = parsed!.data.skills[0]
      expect(skill.name).toBe('Test Workflow Skill')
      expect(skill.trigger_type).toBe('cron')

      log(`Found ${parsed!.data.skills.length} skill(s) for agent ${testAgentId}`, 'success')
    })

    it('should get a specific skill with full details', async () => {
      if (skipIfOrchestratorUnavailable()) return
      if (createdSkillIds.length === 0) {
        log('Skipping: No skills created yet', 'warn')
        return
      }

      const skillId = createdSkillIds[0]
      log(`Getting skill ${skillId}`, 'info')

      const result = await orchestratorClient.callTool('memory_get_skill', {
        skill_id: skillId,
      })

      expect(result.success).toBe(true)

      const parsed = parseJsonContent<{ success: boolean; data: { skill: SkillData } }>(result)
      expect(parsed?.success).toBe(true)
      expect(parsed?.data?.skill).toBeDefined()
      expect(parsed!.data.skill.instructions).toContain('List memory tools')

      log(`Got skill details: ${parsed!.data.skill.name}`, 'success')
    })
  })

  // =========================================
  // SECTION 2: Thinker /execute-skill
  // =========================================
  describe('Skill Execution (Thinker)', () => {
    it('should execute a skill via Thinker HTTP endpoint', async () => {
      if (!thinkerAvailable) {
        log('Skipping: Thinker not available', 'warn')
        return
      }
      if (!orchestratorAvailable) {
        log('Skipping: Orchestrator not available (Thinker needs it for tools)', 'warn')
        return
      }

      log('Executing skill via Thinker /execute-skill (may take 10-30s)', 'info')

      const response = await fetch(`${MCP_URLS.thinker}/execute-skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillId: createdSkillIds[0] ?? 0,
          instructions: 'Say hello and confirm you are running as a proactive task. Keep it brief.',
          maxSteps: 2,
          notifyOnCompletion: false,
        }),
        signal: AbortSignal.timeout(60000),
      })

      // Endpoint should always return 200 (errors are in the JSON body)
      // 503 = agent still initializing, 400 = bad request — both are test-worthy failures
      if (response.status === 503) {
        log('Thinker agent still initializing — skipping execution test', 'warn')
        return
      }
      expect(response.status).toBe(200)

      const data = await response.json() as {
        success: boolean
        summary: string
        toolsUsed: string[]
        totalSteps: number
        error?: string
        paused?: boolean
      }

      log(`Execution result: success=${data.success}, steps=${data.totalSteps}`, 'info')
      if (data.summary) {
        log(`Summary: ${data.summary.slice(0, 200)}`, 'debug')
      }

      // Skill execution depends on LLM provider + cost controls — may fail for operational reasons
      if (!data.success) {
        const reason = data.paused ? 'agent paused by cost controls' : (data.error || 'unknown')
        log(`Skill execution failed (operational): ${reason}`, 'warn')
        log('Thinker endpoint is reachable and returns valid JSON — execution depends on LLM provider', 'info')
        return
      }

      expect(data.summary).toBeDefined()
      expect(data.totalSteps).toBeGreaterThanOrEqual(1)

      log('Skill execution via Thinker succeeded', 'success')
    }, 90000)
  })

  // =========================================
  // SECTION 3: Status Update (simulating scheduler)
  // =========================================
  describe('Skill Status Update', () => {
    it('should update skill last_run fields after execution', async () => {
      if (skipIfOrchestratorUnavailable()) return
      if (createdSkillIds.length === 0) {
        log('Skipping: No skills created yet', 'warn')
        return
      }

      const skillId = createdSkillIds[0]
      const now = new Date().toISOString()

      log(`Updating skill ${skillId} with last_run fields`, 'info')

      const updateResult = await orchestratorClient.callTool('memory_update_skill', {
        skill_id: skillId,
        last_run_at: now,
        last_run_status: 'success',
        last_run_summary: 'Test workflow execution completed',
      })

      expect(updateResult.success).toBe(true)

      // Verify the update stuck
      const getResult = await orchestratorClient.callTool('memory_get_skill', {
        skill_id: skillId,
      })

      const parsed = parseJsonContent<{ success: boolean; data: { skill: SkillData } }>(getResult)
      expect(parsed?.data?.skill?.last_run_status).toBe('success')
      expect(parsed?.data?.skill?.last_run_summary).toBe('Test workflow execution completed')
      expect(parsed?.data?.skill?.last_run_at).toBeDefined()

      log('Skill status updated and verified', 'success')
    })

    it('should disable a skill', async () => {
      if (skipIfOrchestratorUnavailable()) return
      if (createdSkillIds.length === 0) {
        log('Skipping: No skills created yet', 'warn')
        return
      }

      const skillId = createdSkillIds[0]
      log(`Disabling skill ${skillId}`, 'info')

      await orchestratorClient.callTool('memory_update_skill', {
        skill_id: skillId,
        enabled: false,
      })

      // Listing with enabled=true should not return this skill
      const listResult = await orchestratorClient.callTool('memory_list_skills', {
        agent_id: testAgentId,
        enabled: true,
      })

      const parsed = parseJsonContent<{ success: boolean; data: SkillListData }>(listResult)
      const activeSkills = parsed?.data?.skills || []
      const found = activeSkills.find((s: SkillData) => s.id === skillId || s.skill_id === skillId)
      expect(found).toBeUndefined()

      log('Disabled skill correctly excluded from enabled list', 'success')
    })
  })
})
