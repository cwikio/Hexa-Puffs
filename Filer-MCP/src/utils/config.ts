/**
 * Configuration loading for Filer MCP
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { Logger } from "@mcp/shared/Utils/logger.js";
import { expandPath, getEnvString, getEnvNumber } from "@mcp/shared/Utils/config.js";

const logger = new Logger('filer:config');

/**
 * Re-export expandPath as expandHome for backward compatibility.
 * All existing consumers import { expandHome } from this module.
 */
export const expandHome = expandPath;

const GrantConfigSchema = z.object({
  path: z.string(),
  permission: z.enum(["read", "read-write"]).default("read"),
});

const FileConfigSchema = z.object({
  grants: z.array(GrantConfigSchema).optional(),
});

const ConfigSchema = z.object({
  workspace: z.object({
    path: z.string(),
    structure: z.array(z.string()),
  }),
  grants: z.array(GrantConfigSchema).default([]),
  database: z.object({
    path: z.string(),
  }),
  audit: z.object({
    path: z.string(),
  }),
  cleanup: z.object({
    tempDays: z.number().int().min(1).default(7),
  }),
});

export type GrantConfig = z.infer<typeof GrantConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Load grants from fileops-mcp.yaml using proper YAML parsing
 */
function loadFileGrants(): GrantConfig[] {
  const configPath = join(process.cwd(), "fileops-mcp.yaml");
  if (!existsSync(configPath)) return [];

  try {
    const content = readFileSync(configPath, "utf-8");
    const parsed = parseYaml(content);
    const result = FileConfigSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn("Invalid config file schema", result.error.flatten());
      return [];
    }
    return (result.data.grants ?? []).map((g) => ({
      ...g,
      path: expandPath(g.path),
    }));
  } catch (error) {
    logger.warn("Could not parse config file", error);
    return [];
  }
}

// Default workspace structure
const DEFAULT_STRUCTURE = [
  "Documents/reports/",
  "Documents/notes/",
  "Documents/drafts/",
  "Code/python/",
  "Code/bash/",
  "Code/other/",
  "Research/summaries/",
  "Research/sources/",
  "Spreadsheets/",
  "temp/",
  ".fileops/",
];

/**
 * Load configuration from environment and config file
 */
export function loadConfig(): Config {
  const rawConfig = {
    workspace: {
      path: expandPath(getEnvString('WORKSPACE_PATH', '~/Downloads/AI-Workspace/')!),
      structure: DEFAULT_STRUCTURE,
    },
    grants: loadFileGrants(),
    database: {
      path: expandPath(getEnvString('GRANTS_DB_PATH', '~/.hexa-puffs/data/grants.db')!),
    },
    audit: {
      path: expandPath(getEnvString('AUDIT_LOG_PATH', '~/.hexa-puffs/logs/fileops-audit.log')!),
    },
    cleanup: {
      tempDays: getEnvNumber('TEMP_CLEANUP_DAYS', 7),
    },
  };

  const result = ConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Filer-MCP configuration validation failed:\n${errors}`);
  }

  return result.data;
}

// Singleton config instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}
