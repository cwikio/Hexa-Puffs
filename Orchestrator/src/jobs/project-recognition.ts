/**
 * Project Recognition — Inngest function that discovers projects from
 * external MCPs, fuzzy-matches them against unified projects in Memorizer,
 * and notifies the user via Telegram with linking suggestions.
 *
 * Two modes:
 * - 'single': triggered when a new external MCP is hot-reloaded
 * - 'full-scan': triggered on startup (first time or new MCPs) or via /scan-projects
 */

import { inngest } from './inngest-client.js';
import { notifyTelegram } from './helpers.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── Types ────────────────────────────────────────────────────────────

type MCPContentBlock = { type: string; text?: string };
type MCPContent = { content?: MCPContentBlock[] };

export interface ExternalProject {
  id: string;
  name: string;
}

export interface DiscoveredMCPProjects {
  mcpName: string;
  projects: ExternalProject[];
}

export interface ProjectCluster {
  normalizedName: string;
  sources: Array<{ mcpName: string; externalId: string; externalName: string }>;
  unifiedProjectId?: number;
  unifiedProjectName?: string;
}

interface ScanState {
  lastScanAt: string;
  scannedMCPs: string[];
}

// ── Fuzzy matching ───────────────────────────────────────────────────

export function normalizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+(prod|staging|dev|test|preview|production|development)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function projectNamesMatch(a: string, b: string): boolean {
  const na = normalizeProjectName(a);
  const nb = normalizeProjectName(b);
  if (na === nb) return true;
  if (na.length > 2 && nb.length > 2) {
    return na.includes(nb) || nb.includes(na);
  }
  return false;
}

/** Extract text from an MCP tool call result. */
function extractTextFromResult(result: { content?: unknown } | null | undefined): string | null {
  if (!result) return null;
  const mcpContent = result.content as MCPContent | undefined;
  const textBlock = mcpContent?.content?.find((c) => c.type === 'text');
  return textBlock?.text ?? null;
}

// ── Helpers ──────────────────────────────────────────────────────────

const SCAN_STATE_PATH = join(homedir(), '.hexa-puffs', 'data', 'project-scan-done.json');

async function loadScanState(): Promise<ScanState | null> {
  try {
    if (!existsSync(SCAN_STATE_PATH)) return null;
    const raw = await readFile(SCAN_STATE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveScanState(state: ScanState): Promise<void> {
  const dir = join(homedir(), '.hexa-puffs', 'data');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(SCAN_STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Discover projects from a single MCP using the ToolRouter.
 */
async function discoverProjectsFromMCP(
  toolRouter: import('../routing/tool-router.js').ToolRouter,
  mcpName: string,
  config: import('../config/index.js').Config,
): Promise<ExternalProject[]> {
  // Find projectDiscovery metadata from stdio or http MCP config
  const stdioConfig = config.mcpServersStdio?.[mcpName];
  const httpConfig = config.mcpServersHttp?.[mcpName];
  const discovery = stdioConfig?.metadata?.projectDiscovery ?? httpConfig?.metadata?.projectDiscovery;

  let listToolName: string | undefined;
  let listToolArgs: Record<string, unknown> = {};
  let idField = 'id';
  let nameField = 'name';

  if (discovery) {
    // Use explicit config
    listToolName = `${mcpName}_${discovery.listTool}`;
    listToolArgs = discovery.listToolArgs ?? {};
    idField = discovery.projectIdField;
    nameField = discovery.projectNameField;
  } else {
    // Heuristic: find a tool that lists projects/repos/repositories
    const routes = toolRouter.getAllRoutes().filter((r) => r.mcpName === mcpName);
    const projectTool = routes.find((r) =>
      /^(list|get|search)[_-]?(project|repo|repositor)s?(ies)?$/i.test(r.originalName)
      || /^(project|repo|repositor)s?(ies)?[_-]?(list|get|all|search)$/i.test(r.originalName)
    );
    if (projectTool) {
      listToolName = projectTool.exposedName;
    }
  }

  if (!listToolName) {
    logger.debug(`No project discovery tool found for MCP "${mcpName}"`);
    return [];
  }

  try {
    const result = await toolRouter.routeToolCall(listToolName, listToolArgs);
    const text = extractTextFromResult(result);
    if (!text) {
      logger.debug(`No text in response from MCP "${mcpName}"`);
      return [];
    }

    let data: unknown;
    try {
      data = JSON.parse(text);

      // Some MCPs (e.g. Vercel) wrap the actual JSON in {"text": "..."}
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const record = data as Record<string, unknown>;
        if (typeof record.text === 'string' && Object.keys(record).length <= 2) {
          try {
            data = JSON.parse(record.text);
          } catch {
            // Not nested JSON, keep original
          }
        }
      }
    } catch {
      // Try text table format (e.g., PostHog: [N]{fields}:\n  row,row,...)
      const tableItems = parseTextTable(text, idField, nameField);
      if (tableItems.length > 0) {
        return tableItems
          .filter((item) => item.name)
          .map((item) => ({ id: String(item.id ?? ''), name: String(item.name) }));
      }
      logger.debug(`No parseable response from MCP "${mcpName}"`);
      return [];
    }

    // Extract projects from response — handle various response shapes
    const seen = new Set<string>();
    const projects: ExternalProject[] = [];
    const items = extractItems(data, idField, nameField);
    for (const item of items) {
      if (item.name) {
        const name = String(item.name);
        // Deduplicate (e.g. Vercel returns multiple deployments per project)
        if (!seen.has(name)) {
          seen.add(name);
          projects.push({ id: String(item.id ?? ''), name });
        }
      }
    }

    return projects;
  } catch (error) {
    logger.warn(`Failed to discover projects from MCP "${mcpName}"`, { error });
    return [];
  }
}

/**
 * Parse text table format used by some MCP tools (e.g., PostHog).
 * Format: [count]{field1,field2,...}:\n  val1,val2,...\n  val1,val2,...
 */
export function parseTextTable(
  text: string,
  idField: string,
  nameField: string,
): Array<{ id: unknown; name: unknown }> {
  const headerMatch = text.match(/^\[(\d+)\]\{([^}]+)\}:/);
  if (!headerMatch) return [];

  const fields = headerMatch[2].split(',').map((f) => f.trim());
  const idIdx = fields.indexOf(idField);
  const nameIdx = fields.indexOf(nameField);

  if (idIdx === -1 && nameIdx === -1) return [];

  const results: Array<{ id: unknown; name: unknown }> = [];
  const lines = text.split('\n').slice(1);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const values = trimmed.split(',').map((v) => v.trim());
    const id = idIdx >= 0 ? values[idIdx] : undefined;
    const name = nameIdx >= 0 ? values[nameIdx] : undefined;

    if (name) {
      results.push({ id, name });
    }
  }

  return results;
}

/**
 * Extract project items from a potentially nested response.
 */
export function extractItems(
  data: unknown,
  idField: string,
  nameField: string,
): Array<{ id: unknown; name: unknown }> {
  if (Array.isArray(data)) {
    return data
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({ id: item[idField], name: item[nameField] }));
  }

  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    // Check for success wrapper from StandardResponse
    if (record.data && typeof record.data === 'object') {
      return extractItems(record.data, idField, nameField);
    }
    // Check for common array fields
    for (const key of ['projects', 'results', 'items', 'data', 'repos', 'repositories', 'deployments']) {
      if (Array.isArray(record[key])) {
        return extractItems(record[key], idField, nameField);
      }
    }
    // Single item
    if (record[nameField]) {
      return [{ id: record[idField], name: record[nameField] }];
    }
  }

  return [];
}

// ── Clustering ───────────────────────────────────────────────────────

export function clusterProjects(
  allDiscovered: DiscoveredMCPProjects[],
  unifiedProjects: Array<{ id: number; name: string }>,
): ProjectCluster[] {
  const clusters: ProjectCluster[] = [];

  // Build a flat list of all external projects with their MCP
  const allExternal: Array<{ mcpName: string; id: string; name: string; normalized: string }> = [];
  for (const { mcpName, projects } of allDiscovered) {
    for (const p of projects) {
      allExternal.push({ mcpName, id: p.id, name: p.name, normalized: normalizeProjectName(p.name) });
    }
  }

  // Group by normalized name
  const groups = new Map<string, typeof allExternal>();
  for (const ext of allExternal) {
    // Check if this matches an existing group
    let matched = false;
    for (const [key, group] of groups) {
      if (projectNamesMatch(ext.name, group[0].name)) {
        group.push(ext);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.set(ext.normalized, [ext]);
    }
  }

  // Convert groups to clusters + match against unified projects
  for (const [normalizedName, group] of groups) {
    const cluster: ProjectCluster = {
      normalizedName,
      sources: group.map((g) => ({ mcpName: g.mcpName, externalId: g.id, externalName: g.name })),
    };

    // Match against unified projects
    for (const unified of unifiedProjects) {
      if (projectNamesMatch(unified.name, group[0].name)) {
        cluster.unifiedProjectId = unified.id;
        cluster.unifiedProjectName = unified.name;
        break;
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

// ── Inngest Function ─────────────────────────────────────────────────

export const projectRecognitionFunction = inngest.createFunction(
  {
    id: 'project-recognition',
    name: 'Project Recognition',
    concurrency: { limit: 1 },
    retries: 2,
  },
  { event: 'hexa-puffs/project-recognition' },
  async ({ event, step }) => {
    const { mode, mcpNames } = event.data as { mode: 'single' | 'full-scan'; mcpNames: string[] };

    const { getOrchestrator } = await import('../core/orchestrator.js');
    const orchestrator = await getOrchestrator();
    const toolRouter = orchestrator.getToolRouter();
    const config = orchestrator.getConfig();

    if (mode === 'single') {
      // ── Single-MCP mode ──────────────────────────────────────
      await step.run('discover-projects', async () => {
        const allDiscovered: DiscoveredMCPProjects[] = [];

        for (const mcpName of mcpNames) {
          const projects = await discoverProjectsFromMCP(toolRouter, mcpName, config);
          if (projects.length > 0) {
            allDiscovered.push({ mcpName, projects });
          }
        }

        if (allDiscovered.length === 0) {
          // No projects found — notify with manual option
          for (const mcpName of mcpNames) {
            await notifyTelegram(
              `New MCP "${mcpName}" connected. No projects auto-detected.\nUse /link <project_id> ${mcpName} to link manually.`,
            );
          }
          return;
        }

        // Fetch existing unified projects
        let unifiedProjects: Array<{ id: number; name: string }> = [];
        try {
          const result = await toolRouter.routeToolCall('memory_list_projects', { limit: 200 });
          const text = extractTextFromResult(result);
          if (text) {
            const parsed = JSON.parse(text);
            const data = parsed?.data ?? parsed;
            unifiedProjects = (data?.projects ?? []).map((p: { id: number; name: string }) => ({
              id: p.id,
              name: p.name,
            }));
          }
        } catch (error) {
          logger.warn('Failed to fetch unified projects', { error });
        }

        // Match discovered projects against unified projects
        for (const { mcpName, projects } of allDiscovered) {
          for (const extProject of projects) {
            const match = unifiedProjects.find((u) => projectNamesMatch(u.name, extProject.name));

            if (match) {
              await notifyTelegram(
                `MCP "${mcpName}" has project "${extProject.name}".\n`
                + `Looks like your project "${match.name}" (id: ${match.id}).\n`
                + `Link them? Reply: /link ${match.id} ${mcpName}`,
              );
            } else {
              await notifyTelegram(
                `MCP "${mcpName}" has project "${extProject.name}" — no match found.\n`
                + `Create & link: /link new ${mcpName} ${extProject.name}\n`
                + `Or link to existing: /link <project_id> ${mcpName}`,
              );
            }
          }
        }
      });

    } else {
      // ── Full-scan mode ───────────────────────────────────────
      const allDiscovered = await step.run('discover-all-projects', async () => {
        const discovered: DiscoveredMCPProjects[] = [];
        const externalMCPNames = config.externalMCPNames ?? [];

        for (const mcpName of externalMCPNames) {
          const projects = await discoverProjectsFromMCP(toolRouter, mcpName, config);
          if (projects.length > 0) {
            discovered.push({ mcpName, projects });
            logger.info(`Discovered ${projects.length} projects from "${mcpName}"`);
          }
        }

        return discovered;
      });

      if (allDiscovered.length === 0) {
        await step.run('notify-no-projects', async () => {
          await notifyTelegram(
            'Project scan complete — no projects found across external MCPs.\n'
            + 'You can link manually: /link <project_id> <mcp_name>',
          );
          await saveScanState({ lastScanAt: new Date().toISOString(), scannedMCPs: config.externalMCPNames ?? [] });
        });
        return;
      }

      await step.run('cross-match-and-notify', async () => {
        // Fetch existing unified projects
        let unifiedProjects: Array<{ id: number; name: string }> = [];
        try {
          const result = await toolRouter.routeToolCall('memory_list_projects', { limit: 200 });
          const text = extractTextFromResult(result);
          if (text) {
            const parsed = JSON.parse(text);
            const data = parsed?.data ?? parsed;
            unifiedProjects = (data?.projects ?? []).map((p: { id: number; name: string }) => ({
              id: p.id,
              name: p.name,
            }));
          }
        } catch (error) {
          logger.warn('Failed to fetch unified projects', { error });
        }

        // Fetch existing links to avoid re-suggesting
        let existingLinks: Array<{ project_id: number; mcp_name: string }> = [];
        try {
          const result = await toolRouter.routeToolCall('memory_list_project_sources', { limit: 500 });
          const text = extractTextFromResult(result);
          if (text) {
            const parsed = JSON.parse(text);
            const data = parsed?.data ?? parsed;
            existingLinks = (data?.sources ?? []).map((s: { project_id: number; mcp_name: string }) => ({
              project_id: s.project_id,
              mcp_name: s.mcp_name,
            }));
          }
        } catch {
          // OK — just means we might re-suggest some links
        }

        const clusters = clusterProjects(allDiscovered, unifiedProjects);

        // Filter clusters — remove sources that are already linked
        const isAlreadyLinked = (mcpName: string, unifiedId?: number): boolean => {
          if (!unifiedId) return false;
          return existingLinks.some((l) => l.project_id === unifiedId && l.mcp_name === mcpName);
        };

        let notifiedCount = 0;
        const singleSourceProjects: Array<{ mcpName: string; name: string }> = [];

        for (const cluster of clusters) {
          // Filter out already-linked sources
          const unlinkedSources = cluster.sources.filter(
            (s) => !isAlreadyLinked(s.mcpName, cluster.unifiedProjectId),
          );

          if (unlinkedSources.length === 0) continue;

          if (cluster.unifiedProjectId) {
            // Matches existing unified project
            const sourceLines = cluster.sources
              .map((s) => `  - "${s.externalName}" on ${s.mcpName}`)
              .join('\n');
            await notifyTelegram(
              `Project "${cluster.unifiedProjectName}" (id: ${cluster.unifiedProjectId}) found across services:\n`
              + sourceLines + '\n'
              + `Link all: /link-all ${cluster.unifiedProjectId}`,
            );
            notifiedCount++;
          } else if (cluster.sources.length >= 2) {
            // Same project on multiple MCPs
            const sourceLines = cluster.sources
              .map((s) => `  - "${s.externalName}" on ${s.mcpName}`)
              .join('\n');
            const displayName = cluster.sources[0].externalName;
            await notifyTelegram(
              `Same project appears across multiple services:\n`
              + sourceLines + '\n'
              + `Connect them? Reply: /link-all ${displayName}`,
            );
            notifiedCount++;
          } else {
            // Single-MCP project — collect for summary
            singleSourceProjects.push({
              mcpName: unlinkedSources[0].mcpName,
              name: unlinkedSources[0].externalName,
            });
          }
        }

        // Notify about single-source projects in a summary
        if (singleSourceProjects.length > 0) {
          const grouped = new Map<string, string[]>();
          for (const p of singleSourceProjects) {
            const list = grouped.get(p.mcpName) ?? [];
            list.push(p.name);
            grouped.set(p.mcpName, list);
          }
          const lines: string[] = [];
          for (const [mcpName, names] of grouped) {
            lines.push(`${mcpName}: ${names.join(', ')}`);
          }
          await notifyTelegram(
            `Discovered projects:\n${lines.join('\n')}\n\n`
            + `Create & link: /link new <mcp_name> <project_name>`,
          );
          notifiedCount++;
        }

        if (notifiedCount === 0) {
          await notifyTelegram(
            'Project scan complete — no new projects found.',
          );
        }

        // Save scan state
        await saveScanState({
          lastScanAt: new Date().toISOString(),
          scannedMCPs: config.externalMCPNames ?? [],
        });
      });
    }
  },
);

// ── Startup check ────────────────────────────────────────────────────

/**
 * Check whether a full project scan should run on startup.
 * Returns true if no scan has been done yet, or if the MCP set has changed.
 */
export async function shouldRunStartupScan(currentExternalMCPs: string[]): Promise<boolean> {
  const state = await loadScanState();
  if (!state) return true;

  const previousSet = new Set(state.scannedMCPs);
  return currentExternalMCPs.some((name) => !previousSet.has(name));
}
