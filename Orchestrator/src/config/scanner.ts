/**
 * MCP Auto-Discovery Scanner — re-exported from @mcp/shared.
 *
 * The canonical implementation lives in Shared/Discovery/scanner.ts.
 * This module re-exports for backward compatibility with existing Orchestrator imports.
 */

export {
  scanForMCPs,
  type DiscoveredMCP,
  type AnnabelleManifest,
  type ChannelManifestConfig,
} from '@mcp/shared/Discovery/index.js';
