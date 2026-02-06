import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.base.js';

export default mergeConfig(baseConfig, defineConfig({}));
