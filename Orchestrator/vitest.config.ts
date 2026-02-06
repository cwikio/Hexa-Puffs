import { defineConfig, mergeConfig } from 'vitest/config';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import baseConfig from '../vitest.base.js';

// Load Guardian .env so tests that spawn Guardian via stdio have GROQ_API_KEY
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../Guardian/.env') });

export default mergeConfig(baseConfig, defineConfig({
  test: {
    // Integration tests all hit the same live Orchestrator — run sequentially to avoid connection saturation
    fileParallelism: false,
  },
}));
