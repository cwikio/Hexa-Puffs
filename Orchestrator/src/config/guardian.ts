/**
 * Guardian Security Scanner Configuration
 *
 * Controls where Guardian scanning is active in the Annabelle MCP ecosystem.
 * Guardian wraps MCP clients as a decorator — scanning happens transparently
 * at the Orchestrator level when tool calls are routed to downstream MCPs.
 *
 * Edit this file to toggle scanning per MCP, globally, or change fail mode.
 */

export const guardianConfig = {
  /** Global kill switch — set to true to enable Guardian scanning */
  enabled: true,

  /** What to do when Guardian MCP is unavailable:
   *  'closed' = block all requests (secure default)
   *  'open'   = allow all requests (availability over security)
   */
  failMode: 'closed' as const,

  /**
   * Scan the ARGUMENTS going into an MCP (→ direction).
   * When Thinker/Claude calls a tool, this checks what's being sent
   * BEFORE it reaches the target MCP.
   *
   * Example: Thinker sends a message via Telegram — input scan checks
   * the message text before Telegram MCP receives it.
   */
  input: {
    telegram: true,
    onepassword: true,
    memory: true,
    filer: true,
    searcher: true,
    gmail: true,
  } as Record<string, boolean>,

  /**
   * Scan the RESULTS coming back from an MCP (← direction).
   * After an MCP processes a tool call, this checks what it returned
   * BEFORE Thinker/Claude sees the response.
   *
   * Example: Gmail returns email content — output scan checks it
   * for malicious payloads before Thinker receives it.
   */
  output: {
    telegram: false,
    onepassword: true,
    memory: false,
    filer: true,
    searcher: true,
    gmail: true,
  } as Record<string, boolean>,
}

export type GuardianConfig = typeof guardianConfig
