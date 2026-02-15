/**
 * Guardian Security Scanner Configuration
 *
 * Controls where Guardian scanning is active in the Annabelle MCP ecosystem.
 * Guardian wraps MCP clients as a decorator — scanning happens transparently
 * at the Orchestrator level when tool calls are routed to downstream MCPs.
 *
 * Edit this file to toggle scanning per MCP, globally, or change fail mode.
 */

/**
 * Per-agent Guardian overrides.
 * When an agent is listed here, its input/output flags are merged on top of the
 * global defaults. Unlisted MCPs inherit the global setting.
 */
export interface AgentGuardianOverride {
  input?: Record<string, boolean>
  output?: Record<string, boolean>
}

export const guardianConfig = {
  /** Global kill switch — set to true to enable Guardian scanning */
  enabled: true,

  /** What to do when Guardian MCP is unavailable:
   *  'closed' = block all requests (secure default)
   *  'open'   = allow all requests (availability over security)
   */
  failMode: 'closed' as const,

  /**
   * Default scanning for MCPs not explicitly listed below.
   * With auto-discovery and external MCP hot-reload, new MCPs can appear
   * dynamically — these defaults ensure they get Guardian coverage.
   */
  defaultInput: true,
  defaultOutput: true,

  /**
   * Scan the ARGUMENTS going into an MCP (→ direction).
   * When Thinker/Claude calls a tool, this checks what's being sent
   * BEFORE it reaches the target MCP.
   *
   * Per-MCP scan config is now declared in each MCP's package.json manifest
   * via the `guardianScan` field. Entries here serve as legacy overrides.
   * MCPs not listed here and without manifest config inherit `defaultInput`.
   */
  input: {} as Record<string, boolean>,

  /**
   * Scan the RESULTS coming back from an MCP (← direction).
   * After an MCP processes a tool call, this checks what it returned
   * BEFORE Thinker/Claude sees the response.
   *
   * Per-MCP scan config is now declared in each MCP's package.json manifest
   * via the `guardianScan` field. Entries here serve as legacy overrides.
   * MCPs not listed here and without manifest config inherit `defaultOutput`.
   */
  output: {} as Record<string, boolean>,

  /**
   * Per-agent overrides: allows stricter or more relaxed scanning per agent.
   * Example: a "work" agent might skip output scanning on memory,
   * while a "code-review" agent might scan everything.
   *
   * Usage:
   *   agentOverrides: {
   *     'work-assistant': { input: { memory: false }, output: { gmail: false } },
   *   }
   */
  agentOverrides: {} as Record<string, AgentGuardianOverride>,
}

export type GuardianConfig = typeof guardianConfig

/**
 * Resolve effective scan flags for a specific agent.
 * Falls back to global defaults for any MCPs not overridden.
 */
export function getEffectiveScanFlags(agentId?: string): { input: Record<string, boolean>; output: Record<string, boolean> } {
  const base = {
    input: { ...guardianConfig.input },
    output: { ...guardianConfig.output },
  }

  if (!agentId) return base

  const overrides = guardianConfig.agentOverrides[agentId]
  if (!overrides) return base

  if (overrides.input) {
    Object.assign(base.input, overrides.input)
  }
  if (overrides.output) {
    Object.assign(base.output, overrides.output)
  }

  return base
}
