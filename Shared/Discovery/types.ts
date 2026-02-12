/**
 * Types for MCP auto-discovery.
 *
 * Defines the manifest schema declared in each MCP's package.json and
 * the discovery result consumed by both the Orchestrator and start-all.sh.
 */

export interface ChannelManifestConfig {
  botPatterns?: string[];
  chatRefreshIntervalMs?: number;
  maxMessageAgeMs?: number;
}

export interface AnnabelleManifest {
  mcpName: string;
  transport?: 'stdio' | 'http';
  sensitive?: boolean;
  role?: 'guardian' | 'channel';
  timeout?: number;
  required?: boolean;
  httpPort?: number;
  channel?: ChannelManifestConfig;
  /** Command to spawn this MCP (default: 'node'). Use for non-Node MCPs, e.g. '.venv/bin/python' */
  command?: string;
  /** Extra args inserted before entryPoint (default: []). e.g. ['run'] for 'uv run <entryPoint>' */
  commandArgs?: string[];
}

export interface DiscoveredMCP {
  /** Logical name used by Orchestrator (e.g. "filer", "telegram") */
  name: string;
  /** Absolute path to the MCP directory */
  dir: string;
  /** Absolute path to the compiled entry point */
  entryPoint: string;
  /** Transport mode */
  transport: 'stdio' | 'http';
  /** Whether tools are sensitive (Guardian wrapping) */
  sensitive: boolean;
  /** Whether this is the Guardian MCP */
  isGuardian: boolean;
  /** Whether this is a channel MCP (input/output for messages) */
  isChannel: boolean;
  /** Optional channel adapter configuration from manifest */
  channelConfig?: ChannelManifestConfig;
  /** Default timeout in ms */
  timeout: number;
  /** Whether Orchestrator should fail if this MCP doesn't start */
  required: boolean;
  /** HTTP port (for http transport) */
  httpPort?: number;
  /** Command to spawn this MCP (default: 'node') */
  command: string;
  /** Extra args inserted before entryPoint (default: []) */
  commandArgs: string[];
}
