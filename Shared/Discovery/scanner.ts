/**
 * MCP Auto-Discovery Scanner
 *
 * Scans sibling directories of the MCPs root for packages that declare
 * an "annabelle" manifest in their package.json. This allows new MCPs to be
 * registered automatically by simply dropping a folder into the MCPs root.
 *
 * Convention: each MCP's package.json must include:
 *   "annabelle": { "mcpName": "my-mcp" }
 *
 * Used by both the Orchestrator (TypeScript import) and start-all.sh (CLI).
 */

import { resolve } from 'path';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { logger } from '../Utils/logger.js';
import { getEnvBoolean } from '../Utils/config.js';
import type { AnnabelleManifest, DiscoveredMCP } from './types.js';

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
      command: manifest.command ?? 'node',
      commandArgs: manifest.commandArgs ?? [],
      metadata: {
        label: manifest.label,
        toolGroup: manifest.toolGroup,
        keywords: manifest.keywords,
        guardianScan: manifest.guardianScan,
      },
    };

    discovered.push(mcp);
    log.info(`Discovered MCP: ${mcp.name} (${entry}, transport: ${mcp.transport})`);
  }

  log.info(`Auto-discovery complete: ${discovered.length} MCP(s) found`);
  return discovered;
}
