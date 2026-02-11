import { config as dotenvConfig } from "dotenv";
import { ConfigSchema, type Config } from "./schema.js";
import { logger } from "../utils/logger.js";
import {
  expandPath,
  getEnvString,
  getEnvNumber,
  getEnvBoolean,
} from "../utils/config.js";

dotenvConfig();

let configInstance: Config | null = null;

export function loadConfig(): Config {
  const rawConfig = {
    transport: getEnvString("TRANSPORT", "stdio"),
    port: getEnvNumber("PORT", 8008),

    gmail: {
      credentialsPath: expandPath(
        getEnvString("GMAIL_CREDENTIALS_PATH", "~/.annabelle/gmail/credentials.json") ?? ""
      ),
      tokenPath: expandPath(
        getEnvString("GMAIL_TOKEN_PATH", "~/.annabelle/gmail/token.json") ?? ""
      ),
    },

    polling: {
      enabled: getEnvBoolean("GMAIL_POLLING_ENABLED", false),
      intervalMs: getEnvNumber("GMAIL_POLLING_INTERVAL_MS", 60000),
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
