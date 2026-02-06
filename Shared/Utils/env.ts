import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Safely load .env from the package root. Prevents dotenv v17 from writing
 * debug output to stdout, which corrupts MCP stdio transport.
 *
 * @param importMetaUrl - pass `import.meta.url` from the entry point
 * @param levelsUp - directories up from compiled file to package root (default: 1 for src/index.ts)
 */
export function loadEnvSafely(importMetaUrl: string, levelsUp = 1): void {
  let dir = dirname(fileURLToPath(importMetaUrl));
  for (let i = 0; i < levelsUp; i++) {
    dir = dirname(dir);
  }
  const envPath = resolve(dir, '.env');
  if (existsSync(envPath)) {
    dotenvConfig({ path: envPath, quiet: true });
  }
}
