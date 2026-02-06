/**
 * Output formatters for discovery results.
 *
 * The pipe-delimited format is consumed by start-all.sh:
 *   mcpName|transport|httpPort|dir|sensitive
 */

import type { DiscoveredMCP } from './types.js';

/**
 * Format discovered MCPs as pipe-delimited lines for bash consumption.
 * Each line: name|transport|httpPort|dir|sensitive
 */
export function formatPipe(mcps: DiscoveredMCP[]): string {
  return mcps
    .map((mcp) => {
      const parts = [
        mcp.name,
        mcp.transport,
        mcp.httpPort ?? '',
        mcp.dir,
        mcp.sensitive ? '1' : '0',
      ];
      return parts.join('|');
    })
    .join('\n');
}
