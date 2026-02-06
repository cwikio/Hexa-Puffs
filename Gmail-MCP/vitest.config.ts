import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/test/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["src/test/**/*.api.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ["verbose"],
    sequence: { shuffle: false },
  },
});
