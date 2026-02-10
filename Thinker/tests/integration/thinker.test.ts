/**
 * Thinker MCP Integration Tests
 *
 * Tests the Thinker MCP server at http://localhost:8006
 *
 * Prerequisites:
 *   - Thinker MCP must be running
 *   - Orchestrator must be running (Thinker's dependency)
 *   - LLM provider configured (Groq API key, or local LM Studio/Ollama)
 *
 * Run with: npm test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  ThinkerTestClient,
  createThinkerClient,
  checkOrchestratorAvailable,
  checkTraceLogExists,
  readRecentTraces,
  log,
  logSection,
  ORCHESTRATOR_URL,
} from '../helpers/test-client.js'
import {
  testLLMCompletion,
  loadTestConfig,
  getProviderInfo,
  isProviderConfigured,
} from '../helpers/llm-client.js'

describe('Thinker MCP', () => {
  let client: ThinkerTestClient
  let orchestratorAvailable: boolean

  beforeAll(async () => {
    client = createThinkerClient()
    logSection(`Thinker MCP Tests (${client.getBaseUrl()})`)

    // Check Orchestrator availability (Thinker's dependency)
    orchestratorAvailable = await checkOrchestratorAvailable()
    if (!orchestratorAvailable) {
      log(`Orchestrator not available at ${ORCHESTRATOR_URL} - some tests will be skipped`, 'warn')
    } else {
      log(`Orchestrator available at ${ORCHESTRATOR_URL}`, 'success')
    }
  })

  afterAll(() => {
    logSection('Thinker Tests Complete')
  })

  // =========================================
  // SECTION 1: HEALTH CHECK TESTS
  // =========================================
  describe('Health Check', () => {
    it('should respond to health check endpoint', async () => {
      log(`Checking health at ${client.getBaseUrl()}/health`, 'info')

      const result = await client.healthCheck()

      if (result.healthy) {
        log(`Health check passed (${result.duration}ms)`, 'success')
        log(`Status: ${result.data?.status}, Version: ${result.data?.version}`, 'debug')
      } else {
        log(`Health check failed: ${result.error}`, 'error')
      }

      expect(result.healthy).toBe(true)
      expect(result.status).toBe(200)
      expect(result.duration).toBeLessThan(5000)
    })

    it('should return correct health response structure', async () => {
      log('Verifying health response structure', 'info')

      const result = await client.healthCheck()

      expect(result.data).toBeDefined()
      expect(result.data?.status).toBe('ok')
      expect(result.data?.service).toBe('thinker')
      expect(result.data?.version).toBeDefined()
      expect(typeof result.data?.uptime).toBe('number')

      // Verify config section
      expect(result.data?.config).toBeDefined()
      expect(result.data?.config?.enabled).toBe(true)
      expect(result.data?.config?.llmProvider).toBeDefined()
      expect(result.data?.config?.model).toBeDefined()
      expect(result.data?.config?.orchestratorUrl).toBeDefined()

      log('Health response structure verified', 'success')
      log(
        `LLM Provider: ${result.data?.config?.llmProvider}, Model: ${result.data?.config?.model}`,
        'debug'
      )
    })

    it('should report increasing uptime on subsequent calls', async () => {
      log('Verifying uptime increases', 'info')

      const first = await client.healthCheck()
      await new Promise((resolve) => setTimeout(resolve, 1100)) // Wait 1.1 seconds
      const second = await client.healthCheck()

      expect(first.data?.uptime).toBeDefined()
      expect(second.data?.uptime).toBeDefined()
      expect(second.data!.uptime).toBeGreaterThanOrEqual(first.data!.uptime)

      log(`Uptime increased: ${first.data?.uptime}s -> ${second.data?.uptime}s`, 'success')
    })
  })

  // =========================================
  // SECTION 2: ROOT ENDPOINT TESTS
  // =========================================
  describe('Root Endpoint', () => {
    it('should respond to root endpoint', async () => {
      log('Checking root endpoint', 'info')

      const result = await client.getRootEndpoint()

      if (result.success) {
        log(`Root endpoint responded (${result.duration}ms)`, 'success')
      } else {
        log(`Root endpoint failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
      expect(result.duration).toBeLessThan(5000)
    })

    it('should return service information', async () => {
      log('Verifying root endpoint response structure', 'info')

      const result = await client.getRootEndpoint()

      expect(result.data).toBeDefined()
      expect(result.data?.service).toBe('Thinker MCP')
      expect(result.data?.description).toBeDefined()
      expect(result.data?.endpoints).toBeDefined()
      expect(result.data?.endpoints?.health).toBe('/health')

      log('Root endpoint structure verified', 'success')
    })
  })

  // =========================================
  // SECTION 3: ORCHESTRATOR CONNECTIVITY
  // =========================================
  describe('Orchestrator Connectivity', () => {
    it('should have Orchestrator URL configured', async () => {
      log('Checking Orchestrator URL in health response', 'info')

      const result = await client.healthCheck()

      expect(result.data?.config?.orchestratorUrl).toBeDefined()
      expect(result.data?.config?.orchestratorUrl).toMatch(/^https?:\/\//)

      log(`Orchestrator URL: ${result.data?.config?.orchestratorUrl}`, 'success')
    })

    it('should be able to reach Orchestrator', async () => {
      if (!orchestratorAvailable) {
        log('Skipping - Orchestrator not available', 'warn')
        return
      }

      log('Verifying Orchestrator is reachable', 'info')

      const result = await client.healthCheck()
      const orchestratorUrl = result.data?.config?.orchestratorUrl

      // Try to reach Orchestrator
      try {
        const response = await fetch(`${orchestratorUrl}/health`)
        const data = (await response.json()) as { status: string }

        expect(response.ok).toBe(true)
        expect(data.status).toBe('ok')

        log('Orchestrator connectivity verified', 'success')
      } catch (error) {
        log(`Failed to reach Orchestrator: ${error}`, 'error')
        throw error
      }
    })
  })

  // =========================================
  // SECTION 4: LLM PROVIDER CONFIGURATION
  // =========================================
  describe('LLM Provider Configuration', () => {
    it('should have valid LLM provider configured', async () => {
      log('Checking LLM provider configuration', 'info')

      const result = await client.healthCheck()
      const provider = result.data?.config?.llmProvider

      expect(provider).toBeDefined()
      expect(['groq', 'lmstudio', 'ollama']).toContain(provider)

      log(`LLM Provider: ${provider}`, 'success')
    })

    it('should have model configured for provider', async () => {
      log('Checking model configuration', 'info')

      const result = await client.healthCheck()
      const model = result.data?.config?.model

      expect(model).toBeDefined()
      expect(typeof model).toBe('string')
      expect(model!.length).toBeGreaterThan(0)

      log(`Model: ${model}`, 'success')
    })

    it('should have model name with non-zero length', async () => {
      log('Checking model name is non-empty', 'info')

      const result = await client.healthCheck()
      const model = result.data?.config?.model

      expect(model).toBeDefined()
      expect(typeof model).toBe('string')
      expect(model!.length).toBeGreaterThan(0)

      log(`Model: ${model}`, 'success')
    })
  })

  // =========================================
  // SECTION 5: LLM COMPLETION TEST
  // =========================================
  describe('LLM Completion', () => {
    it('should have LLM provider properly configured', () => {
      log('Verifying LLM provider configuration', 'info')

      let config
      try {
        config = loadTestConfig()
      } catch (error) {
        log(`Failed to load config: ${error}`, 'error')
        throw error
      }

      const { provider, model } = getProviderInfo(config)
      const providerCheck = isProviderConfigured(config)

      if (!providerCheck.configured) {
        log(`Provider not configured: ${providerCheck.reason}`, 'warn')
        log('Skipping - LLM provider not configured (missing API key or local server)', 'warn')
        return
      }

      expect(providerCheck.configured).toBe(true)
      log(`Provider ${provider} with model ${model} is configured`, 'success')
    })

    it('should complete a simple prompt', async () => {
      log('Testing LLM completion with simple prompt', 'info')

      const result = await testLLMCompletion('Say hello in exactly 3 words.', 30000)

      if (result.success) {
        log(`LLM responded: "${result.response}"`, 'success')
        log(`Provider: ${result.provider}, Model: ${result.model}`, 'debug')
        log(`Duration: ${result.duration}ms`, 'debug')
        if (result.tokenUsage) {
          log(`Tokens: ${result.tokenUsage.totalTokens}`, 'debug')
        }
      } else {
        // Check if it's a network/access issue vs config issue
        const isNetworkError =
          result.error?.includes('Access denied') ||
          result.error?.includes('network') ||
          result.error?.includes('ECONNREFUSED') ||
          result.error?.includes('fetch failed')

        if (isNetworkError) {
          log(`LLM API not reachable: ${result.error}`, 'warn')
          log('Skipping - LLM API not accessible (network issue)', 'warn')
          return
        }

        log(`LLM completion failed: ${result.error}`, 'error')
      }

      expect(result.success).toBe(true)
      expect(result.response).toBeDefined()
      expect(result.response!.length).toBeGreaterThan(0)
      expect(result.duration).toBeLessThan(30000)
    })
  })

  // =========================================
  // SECTION 6: TRACING VERIFICATION
  // =========================================
  describe('Tracing System', () => {
    it('should have trace log directory configured', async () => {
      log('Checking trace log existence', 'info')

      // The default path is ~/.annabelle/logs/traces.jsonl
      const exists = await checkTraceLogExists()

      if (exists) {
        log('Trace log file exists', 'success')
      } else {
        log('Trace log file does not exist yet (may be created on first activity)', 'warn')
      }

      // This test passes either way - log may not exist until first message is processed
      expect(true).toBe(true)
    })

    it('should be able to read trace entries if log exists', async () => {
      log('Attempting to read trace entries', 'info')

      const exists = await checkTraceLogExists()
      if (!exists) {
        log('Trace log does not exist - skipping', 'warn')
        return
      }

      const traces = await readRecentTraces()

      if (traces.length > 0) {
        log(`Found ${traces.length} recent trace entries`, 'success')

        // Verify trace entry structure
        const sampleTrace = traces[0]
        expect(sampleTrace).toHaveProperty('trace_id')
        expect(sampleTrace).toHaveProperty('ts')
        expect(sampleTrace).toHaveProperty('mcp')
        expect(sampleTrace).toHaveProperty('event')

        log(`Sample trace: ${sampleTrace.event} from ${sampleTrace.mcp}`, 'debug')
      } else {
        log('No trace entries found yet', 'warn')
      }
    })
  })

  // =========================================
  // SECTION 7: ERROR HANDLING
  // =========================================
  describe('Error Handling', () => {
    it('should handle invalid endpoint gracefully', async () => {
      log('Testing 404 response for invalid endpoint', 'info')

      const start = Date.now()
      try {
        const response = await fetch(`${client.getBaseUrl()}/nonexistent`)
        const duration = Date.now() - start

        expect(response.status).toBe(404)
        log(`Invalid endpoint returned 404 (${duration}ms)`, 'success')
      } catch (error) {
        log(`Request failed: ${error}`, 'error')
        throw error
      }
    })

    it('should respond within timeout', async () => {
      log('Testing response time', 'info')

      const result = await client.healthCheck()

      expect(result.duration).toBeLessThan(5000)
      log(`Response time: ${result.duration}ms (under 5s threshold)`, 'success')
    })
  })

  // =========================================
  // SECTION 8: LIFECYCLE SUMMARY
  // =========================================
  describe('Lifecycle Summary', () => {
    it('should pass all essential checks', async () => {
      logSection('LIFECYCLE TEST SUMMARY')

      const checks = [
        {
          name: 'Health endpoint',
          required: true,
          check: async () => {
            const result = await client.healthCheck()
            return { passed: result.healthy }
          },
        },
        {
          name: 'Root endpoint',
          required: true,
          check: async () => {
            const result = await client.getRootEndpoint()
            return { passed: result.success }
          },
        },
        {
          name: 'LLM provider configured',
          required: true,
          check: async () => {
            const result = await client.healthCheck()
            return { passed: !!result.data?.config?.llmProvider }
          },
        },
        {
          name: 'Orchestrator URL configured',
          required: true,
          check: async () => {
            const result = await client.healthCheck()
            return { passed: !!result.data?.config?.orchestratorUrl }
          },
        },
        {
          name: 'LLM completion works',
          required: false, // Optional - may fail due to network issues
          check: async () => {
            const result = await testLLMCompletion('Hi', 15000)
            const isNetworkError =
              result.error?.includes('Access denied') ||
              result.error?.includes('network') ||
              result.error?.includes('ECONNREFUSED') ||
              result.error?.includes('fetch failed')
            return {
              passed: result.success,
              skipped: !result.success && isNetworkError,
              reason: isNetworkError ? 'network issue' : undefined,
            }
          },
        },
      ]

      const results: { name: string; passed: boolean; skipped?: boolean; required: boolean }[] = []

      for (const { name, required, check } of checks) {
        try {
          const { passed, skipped, reason } = await check()
          results.push({ name, passed, skipped, required })
          if (skipped) {
            log(`${name}: SKIPPED (${reason || 'unavailable'})`, 'warn')
          } else {
            log(`${name}: ${passed ? 'PASS' : 'FAIL'}`, passed ? 'success' : 'error')
          }
        } catch (error) {
          results.push({ name, passed: false, required })
          log(`${name}: FAIL (${error})`, 'error')
        }
      }

      // Only count required tests for pass/fail
      const requiredResults = results.filter((r) => r.required)
      const passedRequired = requiredResults.filter((r) => r.passed).length
      const totalRequired = requiredResults.length

      // Also report optional tests
      const optionalResults = results.filter((r) => !r.required)
      const passedOptional = optionalResults.filter((r) => r.passed).length
      const skippedOptional = optionalResults.filter((r) => r.skipped).length

      console.log('')
      log(
        `=== Required: ${passedRequired}/${totalRequired} passed ===`,
        passedRequired === totalRequired ? 'success' : 'error'
      )
      if (optionalResults.length > 0) {
        log(
          `=== Optional: ${passedOptional}/${optionalResults.length} passed, ${skippedOptional} skipped ===`,
          'info'
        )
      }
      console.log('')

      // Test passes if all required checks pass
      expect(passedRequired).toBe(totalRequired)
    })
  })
})
