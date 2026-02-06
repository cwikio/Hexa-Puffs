import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.base.js';

export default mergeConfig(baseConfig, defineConfig({
  test: {
    setupFiles: ['src/test/setup.ts'],
    include: ['src/test/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['src/test/**/*.api.test.ts'],
  },
}));
