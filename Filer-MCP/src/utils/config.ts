/**
 * Configuration loading for Filer MCP
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { Logger } from "@mcp/shared/Utils/logger.js";

const logger = new Logger('filer:config');

export interface GrantConfig {
  path: string;
  permission: "read" | "read-write";
}

export interface Config {
  workspace: {
    path: string;
    structure: string[];
  };
  grants: GrantConfig[];
  database: {
    path: string;
  };
  audit: {
    path: string;
  };
  cleanup: {
    tempDays: number;
  };
}

/**
 * Expand ~ to home directory
 */
export function expandHome(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

/**
 * Load configuration from environment and config file
 */
export function loadConfig(): Config {
  const defaultWorkspacePath = expandHome(
    process.env.WORKSPACE_PATH || "~/Downloads/AI-Workspace/"
  );
  const defaultDbPath = expandHome(
    process.env.GRANTS_DB_PATH || "~/.annabelle/data/grants.db"
  );
  const defaultAuditPath = expandHome(
    process.env.AUDIT_LOG_PATH || "~/.annabelle/logs/fileops-audit.log"
  );
  const tempCleanupDays = parseInt(process.env.TEMP_CLEANUP_DAYS || "7", 10);

  // Default workspace structure
  const defaultStructure = [
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

  // Try to load config file
  const configPath = join(process.cwd(), "fileops-mcp.yaml");
  let fileConfig: Partial<Config> = {};

  if (existsSync(configPath)) {
    try {
      // Simple YAML parsing for grants section
      const content = readFileSync(configPath, "utf-8");
      const grantsMatch = content.match(/grants:\s*\n((?:\s+-[^\n]+\n?)+)/);
      if (grantsMatch) {
        const grantsSection = grantsMatch[1];
        const grants: GrantConfig[] = [];
        const grantBlocks = grantsSection.split(/\n\s+-\s+/).filter(Boolean);
        for (const block of grantBlocks) {
          const pathMatch = block.match(/path:\s*([^\n]+)/);
          const permMatch = block.match(/permission:\s*([^\n]+)/);
          if (pathMatch) {
            grants.push({
              path: expandHome(pathMatch[1].trim()),
              permission: (permMatch?.[1]?.trim() as "read" | "read-write") || "read",
            });
          }
        }
        fileConfig.grants = grants;
      }
    } catch (error) {
      logger.warn("Could not parse config file", error);
    }
  }

  return {
    workspace: {
      path: defaultWorkspacePath,
      structure: defaultStructure,
    },
    grants: fileConfig.grants || [],
    database: {
      path: defaultDbPath,
    },
    audit: {
      path: defaultAuditPath,
    },
    cleanup: {
      tempDays: tempCleanupDays,
    },
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
