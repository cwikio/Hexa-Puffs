/**
 * MCP Auto-Discovery Scanner
 *
 * Scans sibling directories of the Orchestrator for MCP packages that declare
 * an "annabelle" manifest in their package.json. This allows new MCPs to be
 * registered automatically by simply dropping a folder into the MCPs root.
 *
 * Convention: each MCP's package.json must include:
 *   "annabelle": { "mcpName": "my-mcp" }
 *
 * See Orchestrator/README.md for the full manifest schema.
 */

import { resolve } from 'path';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { logger } from '@mcp/shared/Utils/logger.js';
import { getEnvBoolean } from '@mcp/shared/Utils/config.js';

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
}

/**
 * Scan the MCPs root directory for sibling packages with an "annabelle" manifest.
 * Returns an array of discovered MCPs, excluding any disabled via env vars.
 */
export function scanForMCPs(mcpsRoot: string): DiscoveredMCP[] {
  const log = logger.child('mcp-scanner');
  const discovered: DiscoveredMCP[] = [];

  let entries: string[];
  try {
    entries = readdirSync(mcpsRoot);
  } catch {
    log.error(`Cannot read MCPs root directory: ${mcpsRoot}`);
    return [];
  }

  for (const entry of entries) {
    const dir = resolve(mcpsRoot, entry);

    // Skip non-directories
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }

    // Skip if no package.json
    const pkgPath = resolve(dir, 'package.json');
    if (!existsSync(pkgPath)) continue;

    // Parse package.json
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
      log.warn(`Failed to parse ${pkgPath} — skipping`);
      continue;
    }

    // Skip if no annabelle manifest or no mcpName
    const manifest = pkg.annabelle as AnnabelleManifest | undefined;
    if (!manifest || typeof manifest !== 'object' || !manifest.mcpName) continue;

    // Check if disabled via env var (e.g. FILER_MCP_ENABLED=false)
    const envPrefix = manifest.mcpName.toUpperCase();
    const enabled = getEnvBoolean(`${envPrefix}_MCP_ENABLED`, true);
    if (!enabled) {
      log.info(`MCP ${manifest.mcpName} disabled via ${envPrefix}_MCP_ENABLED=false`);
      continue;
    }

    // Resolve entry point from "main" field
    const mainField = (pkg.main as string) || 'dist/index.js';
    const entryPoint = resolve(dir, mainField);

    const mcp: DiscoveredMCP = {
      name: manifest.mcpName,
      dir,
      entryPoint,
      transport: manifest.transport ?? 'stdio',
      sensitive: manifest.sensitive ?? false,
      isGuardian: manifest.role === 'guardian',
      isChannel: manifest.role === 'channel',
      channelConfig: manifest.channel,
      timeout: manifest.timeout ?? 30000,
      required: manifest.required ?? false,
      httpPort: manifest.httpPort,
    };

    discovered.push(mcp);
    log.info(`Discovered MCP: ${mcp.name} (${entry}, transport: ${mcp.transport})`);
  }

  log.info(`Auto-discovery complete: ${discovered.length} MCP(s) found`);
  return discovered;
}
