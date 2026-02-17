import { config as dotenvConfig } from "dotenv";
import { ConfigSchema, type Config } from "./schema.js";
import { logger } from "../utils/logger.js";
import {
  expandPath,
  getEnvString,
  getEnvNumber,
} from "../utils/config.js";

dotenvConfig();

let configInstance: Config | null = null;

export function loadConfig(): Config {
  const rawConfig = {
    transport: getEnvString("TRANSPORT", "stdio"),
    port: getEnvNumber("PORT", 8012),

    outlook: {
      credentialsPath: expandPath(
        getEnvString("OUTLOOK_CREDENTIALS_PATH", "~/.hexa-puffs/outlook/credentials.json") ?? ""
      ),
      tokenCachePath: expandPath(
        getEnvString("OUTLOOK_TOKEN_CACHE_PATH", "~/.hexa-puffs/outlook/token-cache.json") ?? ""
      ),
    },

    logLevel: getEnvString("LOG_LEVEL", "info"),
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.flatten();
    logger.error("Configuration validation failed", errors);
    throw new Error(`Invalid configuration: ${JSON.stringify(errors)}`);
  }

  logger.info("Configuration loaded successfully");
  return result.data;
}

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

export { type Config };
