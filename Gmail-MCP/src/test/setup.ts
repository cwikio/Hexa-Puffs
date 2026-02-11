import { vi, beforeEach } from "vitest";

// Suppress logger output during tests
vi.mock("../utils/logger.js", () => {
  const noop = vi.fn();
  const noopLogger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: vi.fn(() => noopLogger),
  };
  return { logger: noopLogger };
});

// Mock config to avoid reading .env / filesystem
vi.mock("../config/index.js", () => ({
  getConfig: vi.fn().mockReturnValue({
    transport: "stdio",
    port: 8008,
    gmail: {
      credentialsPath: "/fake/credentials.json",
      tokenPath: "/fake/token.json",
    },
    polling: { enabled: false, intervalMs: 60000 },
    logLevel: "error",
  }),
  loadConfig: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});
