import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.base.js';

export default mergeConfig(baseConfig, defineConfig({
  test: {
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
}));
