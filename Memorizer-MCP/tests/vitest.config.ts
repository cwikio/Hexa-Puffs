import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.base.js';

export default mergeConfig(baseConfig, defineConfig({
  test: {
    setupFiles: ['tests/helpers/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['tests/**', 'dist/**', 'node_modules/**'],
    },
  },
}));
