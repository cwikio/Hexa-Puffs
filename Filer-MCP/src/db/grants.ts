/**
 * Grant CRUD operations using JSON file storage
 */

import { getGrantsData, saveGrants, generateGrantId } from "./index.js";
import { getConfig, expandHome } from "../utils/config.js";

export interface Grant {
  id: string;
  path: string;
  permission: "read" | "read-write" | "write";
  scope: "session" | "permanent";
  granted_at: string;
  granted_by: "user_explicit" | "user_implicit" | "system_setup" | "config_file";
  expires_at: string | null;
  last_accessed: string | null;
  access_count: number;
}

/**
 * Find a grant that covers the given path
 * Returns the most specific (longest) matching grant
 */
export async function findGrantForPath(path: string): Promise<Grant | null> {
  const data = await getGrantsData();

  // Find all grants that could cover this path
  const matchingGrants = data.grants.filter(
    (g) => path.startsWith(g.path) || path === g.path
  );

  if (matchingGrants.length === 0) {
    return null;
  }

  // Sort by path length descending (most specific first)
  matchingGrants.sort((a, b) => b.path.length - a.path.length);
  const grant = matchingGrants[0];

  // Check if grant has expired
  if (grant.expires_at && new Date(grant.expires_at) < new Date()) {
    return null;
  }

  return grant;
}

/**
 * Create a new grant
 */
export async function createGrant(
  path: string,
  permission: "read" | "read-write" | "write",
  grantedBy: Grant["granted_by"],
  scope: "session" | "permanent" = "permanent"
): Promise<Grant> {
  const data = await getGrantsData();
  const id = generateGrantId();
  const now = new Date().toISOString();

  const grant: Grant = {
    id,
    path,
    permission,
    scope,
    granted_at: now,
    granted_by: grantedBy,
    expires_at: null,
    last_accessed: null,
    access_count: 0,
  };

  data.grants.push(grant);
  await saveGrants();

  return grant;
}

/**
 * List all active grants
 */
export async function listGrants(): Promise<Grant[]> {
  const data = await getGrantsData();
  const now = new Date();

  return data.grants.filter(
    (g) => !g.expires_at || new Date(g.expires_at) > now
  );
}

/**
 * Revoke a grant by ID
 */
export async function revokeGrant(grantId: string): Promise<boolean> {
  const data = await getGrantsData();
  const index = data.grants.findIndex((g) => g.id === grantId);

  if (index === -1) {
    return false;
  }

  data.grants.splice(index, 1);
  await saveGrants();
  return true;
}

/**
 * Update last accessed timestamp and increment access count
 */
export async function recordAccess(grantId: string): Promise<void> {
  const data = await getGrantsData();
  const grant = data.grants.find((g) => g.id === grantId);

  if (grant) {
    grant.last_accessed = new Date().toISOString();
    grant.access_count++;
    await saveGrants();
  }
}

/**
 * Load grants from config file into storage
 * Called on startup to populate grants from fileops-mcp.yaml
 */
export async function loadConfigGrants(): Promise<number> {
  const config = getConfig();
  const configGrants = config.grants;

  if (configGrants.length === 0) {
    return 0;
  }

  const data = await getGrantsData();
  let loaded = 0;

  for (const grantConfig of configGrants) {
    // Check if grant for this path already exists
    const existing = data.grants.find((g) => g.path === grantConfig.path);

    if (!existing) {
      await createGrant(grantConfig.path, grantConfig.permission, "config_file", "permanent");
      loaded++;
    }
  }

  return loaded;
}

/**
 * Ensure built-in system grants exist for Annabelle's own directories.
 * Called on startup — idempotent (skips if grant already exists).
 */
export async function ensureSystemGrants(): Promise<number> {
  const systemPaths = [
    expandHome("~/.annabelle/documentation/"),
    expandHome("~/.annabelle/logs/"),
  ];

  let created = 0;
  for (const path of systemPaths) {
    const existing = await findGrantForPath(path);
    if (!existing) {
      await createGrant(path, "read", "system_setup", "permanent");
      created++;
    }
  }

  return created;
}

/**
 * Check if a path has a valid grant with required permission
 */
export async function checkPermission(
  path: string,
  requiredPermission: "read" | "write"
): Promise<{ allowed: boolean; grant?: Grant; reason?: string }> {
  const grant = await findGrantForPath(path);

  if (!grant) {
    return {
      allowed: false,
      reason: `No access grant for path: ${path}. Configure grants in fileops-mcp.yaml`,
    };
  }

  // Check permission level
  if (requiredPermission === "write" && grant.permission === "read") {
    return {
      allowed: false,
      grant,
      reason: `Grant for ${path} is read-only`,
    };
  }

  // Record the access
  await recordAccess(grant.id);

  return { allowed: true, grant };
}
