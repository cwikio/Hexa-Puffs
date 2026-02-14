/**
 * Thinker Test Client - HTTP helper for testing Thinker MCP
 */

export interface HealthCheckResult {
  healthy: boolean
  status?: number
  data?: ThinkerHealthResponse
  error?: string
  duration: number
}

export interface ThinkerHealthResponse {
  status: 'ok' | 'error'
  service: string
  version: string
  uptime: number
  config: {
    enabled: boolean
    llmProvider: string
    model: string
    orchestratorUrl: string
  }
}

export interface RootEndpointResult {
  success: boolean
  data?: {
    service: string
    description: string
    endpoints: Record<string, string>
  }
  error?: string
  duration: number
}

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

export function log(
  message: string,
  type: 'info' | 'success' | 'error' | 'warn' | 'debug' = 'info'
): void {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12)
  const colors: Record<string, string> = {
    info: COLORS.blue,
    success: COLORS.green,
    error: COLORS.red,
    warn: COLORS.yellow,
    debug: COLORS.dim,
  }
  const icons: Record<string, string> = {
    info: 'i',
    success: '+',
    error: 'x',
    warn: '!',
    debug: '>',
  }
  console.log(
    `${COLORS.dim}[${timestamp}]${COLORS.reset} ${colors[type]}${icons[type]} ${message}${COLORS.reset}`
  )
}

export function logSection(title: string): void {
  console.log(`\n${COLORS.bright}${COLORS.cyan}=== ${title} ===${COLORS.reset}\n`)
}

export class ThinkerTestClient {
  private baseUrl: string
  private timeout: number

  constructor(baseUrl: string = 'http://localhost:8006', timeout: number = 10000) {
    this.baseUrl = baseUrl
    this.timeout = timeout
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)

      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      const duration = Date.now() - start

      if (!response.ok) {
        return {
          healthy: false,
          status: response.status,
          error: `HTTP ${response.status}`,
          duration,
        }
      }

      const data = (await response.json()) as ThinkerHealthResponse
      return {
        healthy: data.status === 'ok',
        status: response.status,
        data,
        duration,
      }
    } catch (error) {
      const duration = Date.now() - start
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      }
    }
  }

  async getRootEndpoint(): Promise<RootEndpointResult> {
    const start = Date.now()
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)

      const response = await fetch(`${this.baseUrl}/`, {
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      const duration = Date.now() - start

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}`,
          duration,
        }
      }

      const data = (await response.json()) as RootEndpointResult['data']
      return {
        success: true,
        data,
        duration,
      }
    } catch (error) {
      const duration = Date.now() - start
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      }
    }
  }

  getBaseUrl(): string {
    return this.baseUrl
  }
}

// Pre-configured URLs
export const THINKER_URL = process.env.THINKER_URL || 'http://localhost:8006'
export const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8010'

export function createThinkerClient(): ThinkerTestClient {
  return new ThinkerTestClient(THINKER_URL)
}

/**
 * Check if Orchestrator is available (required dependency for Thinker)
 */
export async function checkOrchestratorAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`${ORCHESTRATOR_URL}/health`, {
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) return false

    const data: { status: string } = await response.json()
    return data.status === 'ok'
  } catch {
    return false
  }
}

/**
 * Verify trace log file exists and is being written to
 */
export async function checkTraceLogExists(
  logPath: string = '~/.annabelle/logs/traces.jsonl'
): Promise<boolean> {
  const resolvedPath = logPath.replace('~', process.env.HOME || '')
  try {
    const { stat } = await import('node:fs/promises')
    await stat(resolvedPath)
    return true
  } catch {
    return false
  }
}

/**
 * Read recent trace entries from log file
 */
export async function readRecentTraces(
  logPath: string = '~/.annabelle/logs/traces.jsonl',
  limit: number = 10
): Promise<Array<Record<string, unknown>>> {
  const resolvedPath = logPath.replace('~', process.env.HOME || '')
  try {
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(resolvedPath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const recentLines = lines.slice(-limit)
    return recentLines.map((line): Record<string, unknown> => JSON.parse(line))
  } catch {
    return []
  }
}
