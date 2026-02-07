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
  magenta: '\x1b[35m',
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

export function logResult(testName: string, passed: boolean, details?: string): void {
  const icon = passed ? `${COLORS.green}✓` : `${COLORS.red}✗`
  const status = passed ? 'PASS' : 'FAIL'
  console.log(`  ${icon} ${COLORS.bright}${testName}${COLORS.reset} [${status}]`)
  if (details) {
    console.log(`    ${COLORS.dim}${details}${COLORS.reset}`)
  }
}

export class MCPTestClient {
  private baseUrl: string
  private name: string
  private timeout: number
  private toolPrefix: string

  constructor(name: string, baseUrl: string, timeout = 10000, toolPrefix = '') {
    this.name = name
    this.baseUrl = baseUrl
    this.timeout = timeout
    this.toolPrefix = toolPrefix
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

      const prefixedName = this.toolPrefix ? `${this.toolPrefix}${toolName}` : toolName
      const response = await fetch(`${this.baseUrl}/tools/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: prefixedName,
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

// URL configuration
export const MCP_URLS = {
  // Orchestrator (stdio mode — routes to all downstream MCPs)
  orchestrator: process.env.ORCHESTRATOR_URL || 'http://localhost:8010',
  // Standalone HTTP MCPs (still running their own servers)
  telegram: process.env.TELEGRAM_URL || 'http://localhost:8002',
  searcher: process.env.SEARCHER_URL || 'http://localhost:8007',
  // Thinker (connects to Orchestrator via HTTP)
  thinker: process.env.THINKER_URL || 'http://localhost:8006',
}

// Primary factory functions — route through Orchestrator with prefixed tool names.
// All stdio MCPs (Telegram, Memory, Filer, Guardian, 1Password, Searcher, Gmail)
// are accessed via the Orchestrator on port 8010.

export function createTelegramClient(): MCPTestClient {
  return new MCPTestClient('Telegram', MCP_URLS.orchestrator, 10000, 'telegram_')
}

export function createFilerClient(): MCPTestClient {
  return new MCPTestClient('Filer', MCP_URLS.orchestrator, 10000, 'filer_')
}

export function createMemoryClient(): MCPTestClient {
  return new MCPTestClient('Memory', MCP_URLS.orchestrator, 10000, 'memory_')
}

export function createGuardianClient(): MCPTestClient {
  return new MCPTestClient('Guardian', MCP_URLS.orchestrator, 10000, 'guardian_')
}

export function createOnePasswordClient(): MCPTestClient {
  return new MCPTestClient('1Password', MCP_URLS.orchestrator, 10000, 'onepassword_')
}

export function createSearcherClient(): MCPTestClient {
  return new MCPTestClient('Searcher', MCP_URLS.orchestrator, 10000, 'searcher_')
}

export function createGmailClient(): MCPTestClient {
  return new MCPTestClient('Gmail', MCP_URLS.orchestrator, 10000, 'gmail_')
}

export function createOrchestratorClient(): MCPTestClient {
  return new MCPTestClient('Orchestrator', MCP_URLS.orchestrator, 15000)
}

export function createThinkerClient(): MCPTestClient {
  return new MCPTestClient('Thinker', MCP_URLS.thinker)
}

/**
 * Check if multiple MCPs are available. Returns map of MCP name to availability.
 */
export async function checkMCPsAvailable(clients: MCPTestClient[]): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>()
  await Promise.all(
    clients.map(async (client) => {
      const health = await client.healthCheck()
      results.set(client.getName(), health.healthy)
      if (!health.healthy) {
        log(`${client.getName()} MCP is unavailable: ${health.error || 'unknown'}`, 'warn')
      }
    })
  )
  return results
}
