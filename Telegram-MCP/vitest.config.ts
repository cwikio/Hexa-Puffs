import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000, // 30 seconds for integration tests
    hookTimeout: 30000,
    reporters: ['verbose'],
    sequence: {
      // Run tests sequentially since they share state
      concurrent: false,
    },
  },
})
