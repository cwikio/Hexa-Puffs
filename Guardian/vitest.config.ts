import { defineConfig, mergeConfig } from 'vitest/config';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import baseConfig from '../vitest.base.js';

// Load Guardian .env so tests have GROQ_API_KEY for provider selection
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '.env') });

export default mergeConfig(baseConfig, defineConfig({
  test: {
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
}));
