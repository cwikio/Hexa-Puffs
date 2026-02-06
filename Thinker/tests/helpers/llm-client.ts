/**
 * LLM Test Client - Helper for testing LLM completion
 *
 * Uses the same configuration and provider setup as Thinker
 */

import 'dotenv/config'
import { generateText } from 'ai'
import { loadConfig, validateProviderConfig, type Config } from '../../src/config.js'
import { createLanguageModel } from '../../src/llm/factory.js'
import { getProviderDisplayName } from '../../src/llm/providers.js'
import { log } from './test-client.js'

export interface LLMCompletionResult {
  success: boolean
  provider: string
  model: string
  prompt: string
  response?: string
  tokenUsage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  duration: number
  error?: string
}

/**
 * Load Thinker configuration from environment
 */
export function loadTestConfig(): Config {
  return loadConfig()
}

/**
 * Get provider information from config
 */
export function getProviderInfo(config: Config): { provider: string; model: string } {
  const provider = getProviderDisplayName(config.llmProvider)
  const model =
    config.llmProvider === 'groq'
      ? config.groqModel
      : config.llmProvider === 'lmstudio'
        ? config.lmstudioModel || 'local-model'
        : config.ollamaModel

  return { provider, model }
}

/**
 * Check if LLM provider is properly configured
 */
export function isProviderConfigured(config: Config): {
  configured: boolean
  reason?: string
} {
  try {
    validateProviderConfig(config)
    return { configured: true }
  } catch (error) {
    return {
      configured: false,
      reason: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Test LLM completion with a simple prompt
 *
 * This sends a minimal prompt to the configured LLM provider
 * and verifies we get a response back.
 */
export async function testLLMCompletion(
  prompt: string = 'Say hello in exactly 3 words.',
  timeoutMs: number = 30000
): Promise<LLMCompletionResult> {
  const start = Date.now()

  let config: Config
  try {
    config = loadConfig()
  } catch (error) {
    return {
      success: false,
      provider: 'unknown',
      model: 'unknown',
      prompt,
      duration: Date.now() - start,
      error: `Failed to load config: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }

  const { provider, model } = getProviderInfo(config)

  // Check if provider is configured
  const providerCheck = isProviderConfigured(config)
  if (!providerCheck.configured) {
    return {
      success: false,
      provider,
      model,
      prompt,
      duration: Date.now() - start,
      error: providerCheck.reason,
    }
  }

  log(`Testing ${provider} with model: ${model}`, 'info')
  log(`Prompt: "${prompt}"`, 'debug')

  try {
    const languageModel = createLanguageModel(config)

    const result = await generateText({
      model: languageModel,
      prompt,
      maxTokens: 50,
      abortSignal: AbortSignal.timeout(timeoutMs),
    })

    const duration = Date.now() - start

    log(`Response: "${result.text}"`, 'debug')
    log(`Tokens: ${result.usage?.totalTokens || 'N/A'}, Duration: ${duration}ms`, 'debug')

    return {
      success: true,
      provider,
      model,
      prompt,
      response: result.text,
      tokenUsage: result.usage
        ? {
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
          }
        : undefined,
      duration,
    }
  } catch (error) {
    const duration = Date.now() - start
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    log(`LLM call failed: ${errorMessage}`, 'error')

    return {
      success: false,
      provider,
      model,
      prompt,
      duration,
      error: errorMessage,
    }
  }
}
