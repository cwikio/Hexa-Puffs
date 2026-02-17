#!/usr/bin/env node

/**
 * CLI entry point for MCP auto-discovery.
 *
 * Usage:
 *   MCPS_ROOT=/path/to/MCPs node Shared/dist/Discovery/cli.js
 *   node Shared/dist/Discovery/cli.js /path/to/MCPs
 *
 * Outputs pipe-delimited lines consumed by start-all.sh:
 *   mcpName|transport|httpPort|dir|sensitive
 */

import { scanForMCPs } from './scanner.js';
import { formatPipe } from './format.js';

const mcpsRoot = process.argv[2] || process.env.MCPS_ROOT;

if (!mcpsRoot) {
  process.stderr.write('Usage: MCPS_ROOT=<path> node cli.js  or  node cli.js <path>\n');
  process.exit(1);
}

const discovered = scanForMCPs(mcpsRoot);
const output = formatPipe(discovered);

if (output) {
  process.stdout.write(output + '\n');
}
