/**
 * Configuration loading for Searcher MCP
 */

export interface Config {
  braveApiKey: string;
  transport: "stdio" | "http" | "sse";
  port: number;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  const braveApiKey = process.env.BRAVE_API_KEY;

  if (!braveApiKey) {
    throw new Error("BRAVE_API_KEY environment variable is required");
  }

  const transport = (process.env.TRANSPORT || "stdio") as
    | "stdio"
    | "http"
    | "sse";
  const port = parseInt(process.env.PORT || "8007", 10);

  return {
    braveApiKey,
    transport,
    port,
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
