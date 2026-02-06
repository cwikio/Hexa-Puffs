/**
 * Database initialization and management
 * Uses JSON file storage instead of SQLite for simplicity
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { getConfig } from "../utils/config.js";
import type { Grant } from "./grants.js";

export interface GrantsData {
  grants: Grant[];
}

let grantsData: GrantsData | null = null;
let dbPath: string | null = null;

function getDbPath(): string {
  if (!dbPath) {
    // Use .json extension instead of .db
    dbPath = getConfig().database.path.replace(/\.db$/, ".json");
  }
  return dbPath;
}

/**
 * Load grants from JSON file
 */
export async function loadGrants(): Promise<GrantsData> {
  if (grantsData) return grantsData;

  const path = getDbPath();

  // Ensure directory exists
  const dir = dirname(path);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  // Load or create empty grants file
  if (existsSync(path)) {
    try {
      const content = await readFile(path, "utf-8");
      grantsData = JSON.parse(content) as GrantsData;
    } catch {
      grantsData = { grants: [] };
    }
  } else {
    grantsData = { grants: [] };
  }

  return grantsData;
}

/**
 * Save grants to JSON file
 * Writes are serialized via a Promise queue to prevent interleaved writeFile calls
 */
let saveQueue: Promise<void> = Promise.resolve();

export async function saveGrants(): Promise<void> {
  const doSave = async () => {
    if (!grantsData) return;

    const path = getDbPath();
    const dir = dirname(path);

    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    await writeFile(path, JSON.stringify(grantsData, null, 2), "utf-8");
  };

  saveQueue = saveQueue.then(doSave, doSave);
  return saveQueue;
}

/**
 * Get grants data (loads if needed)
 */
export async function getGrantsData(): Promise<GrantsData> {
  return loadGrants();
}

/**
 * Initialize database (called on startup)
 */
export async function initDatabase(): Promise<void> {
  await loadGrants();
}

/**
 * Generate a unique grant ID
 */
export function generateGrantId(): string {
  return `grant_${randomUUID()}`;
}
