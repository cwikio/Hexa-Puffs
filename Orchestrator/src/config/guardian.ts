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
  enabled: false,

  /** What to do when Guardian MCP is unavailable:
   *  'closed' = block all requests (secure default)
   *  'open'   = allow all requests (availability over security)
   */
  failMode: 'closed' as const,

  /**
   * Scan tool arguments BEFORE they reach the downstream MCP.
   * Catches prompt injection in inputs (e.g., malicious message before sending to Telegram).
   */
  input: {
    telegram: true,
    onepassword: true,
    memory: true,
    filer: true,
    searcher: false,
    gmail: true,
  } as Record<string, boolean>,

  /**
   * Scan tool results BEFORE returning to the caller.
   * Catches malicious content in responses (e.g., credential leakage, injected payloads).
   */
  output: {
    telegram: false,
    onepassword: true,
    memory: false,
    filer: true,
    searcher: false,
    gmail: true,
  } as Record<string, boolean>,
};

export type GuardianConfig = typeof guardianConfig;
