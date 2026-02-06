import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    reporters: ["verbose"],
    sequence: {
      shuffle: false,
    },
    // Run test files sequentially to avoid API rate limiting
    fileParallelism: false,
  },
});
