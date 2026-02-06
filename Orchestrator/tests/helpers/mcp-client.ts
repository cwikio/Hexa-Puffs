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

  constructor(name: string, baseUrl: string, timeout = 10000) {
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

// Pre-configured clients for each MCP
// Note: With stdio mode, Orchestrator (8010) spawns downstream MCPs internally
// The legacy ports (8002-8005) are for backwards compatibility when running MCPs individually
export const MCP_URLS = {
  // Legacy individual MCP ports (HTTP mode)
  telegram: process.env.TELEGRAM_URL || 'http://localhost:8002',
  filer: process.env.FILER_URL || 'http://localhost:8004',
  memory: process.env.MEMORY_URL || 'http://localhost:8005',
  guardian: process.env.GUARDIAN_URL || 'http://localhost:8003',
  onepassword: process.env.ONEPASSWORD_URL || 'http://localhost:8001',
  searcher: process.env.SEARCHER_URL || 'http://localhost:8007',
  // Orchestrator (stdio mode with HTTP transport for clients)
  orchestrator: process.env.ORCHESTRATOR_URL || 'http://localhost:8010',
  // Thinker (connects to Orchestrator via HTTP)
  thinker: process.env.THINKER_URL || 'http://localhost:8006',
}

export function createTelegramClient(): MCPTestClient {
  return new MCPTestClient('Telegram', MCP_URLS.telegram)
}

export function createFilerClient(): MCPTestClient {
  return new MCPTestClient('Filer', MCP_URLS.filer)
}

export function createMemoryClient(): MCPTestClient {
  return new MCPTestClient('Memory', MCP_URLS.memory)
}

export function createGuardianClient(): MCPTestClient {
  return new MCPTestClient('Guardian', MCP_URLS.guardian)
}

export function createOnePasswordClient(): MCPTestClient {
  return new MCPTestClient('1Password', MCP_URLS.onepassword)
}

export function createOrchestratorClient(): MCPTestClient {
  return new MCPTestClient('Orchestrator', MCP_URLS.orchestrator, 15000)
}

export function createThinkerClient(): MCPTestClient {
  return new MCPTestClient('Thinker', MCP_URLS.thinker)
}

export function createSearcherClient(): MCPTestClient {
  return new MCPTestClient('Searcher', MCP_URLS.searcher)
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
