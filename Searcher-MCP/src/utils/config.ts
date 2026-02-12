/**
 * Configuration loading for Searcher MCP
 */

export interface Config {
  braveApiKey: string;
  braveRateLimitMs: number;
  transport: "stdio" | "http" | "sse";
  port: number;
  webFetchMaxLength: number;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  const braveApiKey = process.env.BRAVE_API_KEY;

  if (!braveApiKey) {
    throw new Error("BRAVE_API_KEY environment variable is required");
  }

  const braveRateLimitMs = parseInt(process.env.BRAVE_RATE_LIMIT_MS || "1100", 10);
  const transport = (process.env.TRANSPORT || "stdio") as
    | "stdio"
    | "http"
    | "sse";
  const port = parseInt(process.env.PORT || "8007", 10);
  const webFetchMaxLength = parseInt(process.env.WEB_FETCH_MAX_LENGTH || "20000", 10);

  return {
    braveApiKey,
    braveRateLimitMs,
    transport,
    port,
    webFetchMaxLength,
  };
}

// Singleton config instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}
