/**
 * MCP Test Client - HTTP helper for calling MCP servers during tests
 */

export interface MCPToolCallResult {
  success: boolean
  data?: unknown
  error?: string
  duration: number
}

export interface MCPHealthResult {
  healthy: boolean
  status?: number
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
  cyan: '\x1b[36m',
}

export function log(message: string, type: 'info' | 'success' | 'error' | 'warn' | 'debug' = 'info'): void {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12)
  const colors: Record<string, string> = {
    info: COLORS.blue,
    success: COLORS.green,
    error: COLORS.red,
    warn: COLORS.yellow,
    debug: COLORS.dim,
  }
  const icons: Record<string, string> = {
    info: 'ℹ',
    success: '✓',
    error: '✗',
    warn: '⚠',
    debug: '→',
  }
  console.log(`${COLORS.dim}[${timestamp}]${COLORS.reset} ${colors[type]}${icons[type]} ${message}${COLORS.reset}`)
}

export function logSection(title: string): void {
  console.log(`\n${COLORS.bright}${COLORS.cyan}━━━ ${title} ━━━${COLORS.reset}\n`)
}

export class MCPTestClient {
  private baseUrl: string
  private name: string
  private timeout: number

  constructor(name: string, baseUrl: string, timeout = 15000) {
    this.name = name
    this.baseUrl = baseUrl
    this.timeout = timeout
  }

  async healthCheck(): Promise<MCPHealthResult> {
    const start = Date.now()
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)

      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      const duration = Date.now() - start
      return {
        healthy: response.ok,
        status: response.status,
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

  async callTool(toolName: string, args: Record<string, unknown> = {}): Promise<MCPToolCallResult> {
    const start = Date.now()
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)

      const response = await fetch(`${this.baseUrl}/tools/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: toolName,
          arguments: args,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      const duration = Date.now() - start

      if (!response.ok) {
        const text = await response.text()
        return {
          success: false,
          error: `HTTP ${response.status}: ${text}`,
          duration,
        }
      }

      const data = await response.json()

      // Parse the MCP response format
      // Response is { content: [{ type: "text", text: JSON.stringify({ success, data/error }) }] }
      if (data.content && Array.isArray(data.content) && data.content[0]?.text) {
        try {
          const parsed = JSON.parse(data.content[0].text)
          return {
            success: parsed.success !== false,
            data: parsed.data || parsed,
            error: parsed.error,
            duration,
          }
        } catch {
          return { success: true, data, duration }
        }
      }

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

  getName(): string {
    return this.name
  }

  getBaseUrl(): string {
    return this.baseUrl
  }
}

// Default URL for Telegram MCP
const TELEGRAM_URL = process.env.TELEGRAM_URL || 'http://localhost:8002'

export function createTelegramClient(): MCPTestClient {
  return new MCPTestClient('Telegram', TELEGRAM_URL)
}

// Helper to extract data from nested response
export function extractData<T>(result: MCPToolCallResult): T | null {
  if (!result.success || !result.data) return null
  return result.data as T
}

// Helper to generate unique test identifiers
export function testId(): string {
  return `TEST_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// Helper to wait for a specified time
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
