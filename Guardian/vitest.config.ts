import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60000, // 60s for model inference
    hookTimeout: 60000,
    fileParallelism: false, // Run test files sequentially (shared MCP connection)
    sequence: {
      shuffle: false,
    },
  },
});
