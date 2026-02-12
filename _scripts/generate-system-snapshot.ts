#!/usr/bin/env npx tsx
/**
 * Generate System Snapshot — writes ~/.annabelle/documentation/system-snapshot.md
 * from live Orchestrator state.
 *
 * Queries the running Orchestrator API to build a comprehensive, always-fresh
 * reference document covering discovered MCPs, tools, agents, cron jobs, and ports.
 *
 * Usage:
 *   npx tsx _scripts/generate-system-snapshot.ts
 *
 * Prerequisites:
 *   - Orchestrator running on localhost:8010
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8010';
const OUTPUT_DIR = join(homedir(), '.annabelle', 'documentation');
const OUTPUT_PATH = join(OUTPUT_DIR, 'system-snapshot.md');
const AGENTS_PATH = join(process.cwd(), 'agents.json');

// Read auth token
let ANNABELLE_TOKEN = process.env.ANNABELLE_TOKEN || '';
if (!ANNABELLE_TOKEN) {
  try {
    ANNABELLE_TOKEN = readFileSync(join(homedir(), '.annabelle', 'annabelle.token'), 'utf-8').trim();
  } catch {
    console.warn('Warning: No auth token found. Requests may fail with 401.');
  }
}

// ─── API Helpers ────────────────────────────────────────────

async function fetchOrchestrator(path: string): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (ANNABELLE_TOKEN) {
    headers['X-Annabelle-Token'] = ANNABELLE_TOKEN;
  }

  const response = await fetch(`${ORCHESTRATOR_URL}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

async function callTool(toolName: string, args: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ANNABELLE_TOKEN) {
    headers['X-Annabelle-Token'] = ANNABELLE_TOKEN;
  }

  const response = await fetch(`${ORCHESTRATOR_URL}/tools/call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: toolName, arguments: args }),
  });

  if (!response.ok) {
    return { success: false, error: `HTTP ${response.status}` };
  }

  const result = await response.json() as { content?: unknown };
  const content = result.content;
  if (Array.isArray(content)) {
    const textBlock = content.find((b: { type: string }) => b.type === 'text');
    if (textBlock) {
      try {
        const parsed = JSON.parse(textBlock.text);
        if (parsed.success !== undefined) {
          return { success: parsed.success, data: parsed.data, error: parsed.error };
        }
        return { success: true, data: parsed };
      } catch {
        return { success: true, data: textBlock.text };
      }
    }
  }
  return { success: false, error: 'Unexpected response format' };
}

// ─── Data Gatherers ─────────────────────────────────────────

interface StatusData {
  ready: boolean;
  uptime: number;
  mcpServers: Record<string, { available: boolean; required: boolean; type: string }>;
  agents: Array<{ agentId: string; available: boolean; port: number; paused: boolean; restartCount: number }>;
  sessions: { activeSessions: number; totalTurns: number };
  security: { blockedCount: number };
}

interface ToolDef {
  name: string;
  description?: string;
}

async function getStatus(): Promise<StatusData | null> {
  try {
    return await fetchOrchestrator('/status') as StatusData;
  } catch {
    return null;
  }
}

async function getTools(): Promise<ToolDef[]> {
  try {
    const result = await fetchOrchestrator('/tools/list');
    const data = result as { tools?: ToolDef[] };
    return data.tools ?? [];
  } catch {
    return [];
  }
}

function loadAgentConfigs(): Array<{
  agentId: string;
  enabled: boolean;
  port: number;
  llmProvider: string;
  model: string;
  maxSteps: number;
  costControls?: { enabled: boolean; hardCapTokensPerHour?: number };
}> {
  try {
    const raw = readFileSync(AGENTS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.agents ?? [];
  } catch {
    return [];
  }
}

async function getCronJobs(): Promise<Array<{ name: string; cronExpression?: string; timezone?: string; enabled: boolean; lastRunAt?: string }>> {
  const result = await callTool('memory_list_skills', {
    agent_id: 'thinker',
    enabled: true,
    trigger_type: 'cron',
  });

  if (!result.success || !result.data) return [];
  const data = result.data as { skills?: Array<{ name: string; trigger_config?: { schedule?: string; timezone?: string; interval_minutes?: number }; last_run_at?: string; last_run_status?: string }> };
  const skills = data.skills ?? [];

  return skills.map((s) => ({
    name: s.name,
    cronExpression: s.trigger_config?.schedule ?? `every ${s.trigger_config?.interval_minutes ?? 1440}m`,
    timezone: s.trigger_config?.timezone,
    enabled: true,
    lastRunAt: s.last_run_at ?? undefined,
  }));
}

// ─── Markdown Generator ─────────────────────────────────────

function generateMarkdown(
  status: StatusData | null,
  tools: ToolDef[],
  agents: ReturnType<typeof loadAgentConfigs>,
  cronSkills: Awaited<ReturnType<typeof getCronJobs>>,
): string {
  const now = new Date().toISOString();
  const lines: string[] = [];

  lines.push('# System Snapshot');
  lines.push('');
  lines.push(`> Auto-generated on ${now} by \`generate-system-snapshot.ts\``);
  lines.push('> Regenerate: `npx tsx _scripts/generate-system-snapshot.ts`');
  lines.push('');

  // ─── Port Map
  lines.push('## Port Map');
  lines.push('');
  lines.push('| Service | Port | Status |');
  lines.push('|---------|------|--------|');
  lines.push(`| Orchestrator | 8010 | ${status?.ready ? 'ready' : 'unknown'} |`);

  for (const agent of agents) {
    const liveAgent = status?.agents.find((a) => a.agentId === agent.agentId);
    const agentStatus = liveAgent?.available ? 'up' : 'down';
    lines.push(`| Thinker (${agent.agentId}) | ${agent.port} | ${agentStatus} |`);
  }

  lines.push('| Inngest | 8288 | - |');
  lines.push('');

  // ─── Discovered MCPs
  lines.push('## Discovered MCPs');
  lines.push('');

  if (status) {
    // Group tools by MCP prefix
    const toolsByMcp = new Map<string, string[]>();
    for (const tool of tools) {
      const prefix = tool.name.includes('_') ? tool.name.split('_')[0] : 'other';
      const list = toolsByMcp.get(prefix) ?? [];
      list.push(tool.name);
      toolsByMcp.set(prefix, list);
    }

    lines.push('| MCP | Transport | Status | Tools |');
    lines.push('|-----|-----------|--------|-------|');

    for (const [name, info] of Object.entries(status.mcpServers)) {
      const toolCount = toolsByMcp.get(name)?.length ?? 0;
      const state = info.available ? 'up' : 'DOWN';
      lines.push(`| ${name} | ${info.type} | ${state} | ${toolCount} |`);
    }

    lines.push('');
    lines.push(`Total tools: ${tools.length}`);
  } else {
    lines.push('*Orchestrator unreachable — no live data.*');
  }
  lines.push('');

  // ─── Tool Registry
  lines.push('## Tool Registry');
  lines.push('');

  if (tools.length > 0) {
    // Group by MCP
    const grouped = new Map<string, ToolDef[]>();
    for (const tool of tools) {
      const prefix = tool.name.includes('_') ? tool.name.split('_')[0] : 'other';
      const list = grouped.get(prefix) ?? [];
      list.push(tool);
      grouped.set(prefix, list);
    }

    for (const [mcp, mcpTools] of grouped) {
      lines.push(`### ${mcp} (${mcpTools.length} tools)`);
      lines.push('');
      for (const tool of mcpTools) {
        const desc = tool.description ? ` — ${tool.description.split('\n')[0].slice(0, 80)}` : '';
        lines.push(`- \`${tool.name}\`${desc}`);
      }
      lines.push('');
    }
  } else {
    lines.push('*No tools available.*');
    lines.push('');
  }

  // ─── Agent Configs
  lines.push('## Agent Configurations');
  lines.push('');

  if (agents.length > 0) {
    for (const agent of agents) {
      lines.push(`### ${agent.agentId}`);
      lines.push('');
      lines.push(`- **Provider:** ${agent.llmProvider}`);
      lines.push(`- **Model:** ${agent.model}`);
      lines.push(`- **Port:** ${agent.port}`);
      lines.push(`- **Max Steps:** ${agent.maxSteps}`);
      lines.push(`- **Enabled:** ${agent.enabled}`);
      if (agent.costControls?.enabled) {
        lines.push(`- **Cost Controls:** enabled (cap: ${agent.costControls.hardCapTokensPerHour ?? 'none'} tokens/hr)`);
      }
      lines.push('');
    }
  } else {
    lines.push('*No agents configured.*');
    lines.push('');
  }

  // ─── Cron Skills
  lines.push('## Active Cron Skills');
  lines.push('');

  if (cronSkills.length > 0) {
    lines.push('| Name | Schedule | Timezone | Last Run |');
    lines.push('|------|----------|----------|----------|');
    for (const skill of cronSkills) {
      const tz = skill.timezone ?? 'UTC';
      const lastRun = skill.lastRunAt ? new Date(skill.lastRunAt).toISOString().slice(0, 16) : 'never';
      lines.push(`| ${skill.name} | ${skill.cronExpression} | ${tz} | ${lastRun} |`);
    }
  } else {
    lines.push('*No active cron skills.*');
  }
  lines.push('');

  // ─── System Info
  lines.push('## System Info');
  lines.push('');
  lines.push(`- **Node version:** ${process.version}`);
  lines.push(`- **Generated:** ${now}`);
  if (status) {
    const uptime = Math.round(status.uptime / 1000 / 60);
    lines.push(`- **Orchestrator uptime:** ${uptime} minutes`);
    lines.push(`- **Active sessions:** ${status.sessions.activeSessions}`);
    lines.push(`- **Blocked count:** ${status.security.blockedCount}`);
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  console.log('Generating system snapshot...');

  const [status, tools, cronSkills] = await Promise.all([
    getStatus(),
    getTools(),
    getCronJobs(),
  ]);
  const agents = loadAgentConfigs();

  if (!status) {
    console.warn('Warning: Could not reach Orchestrator — snapshot will be incomplete.');
  }

  const markdown = generateMarkdown(status, tools, agents, cronSkills);

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  writeFileSync(OUTPUT_PATH, markdown, 'utf-8');

  const toolCount = tools.length;
  const mcpCount = status ? Object.keys(status.mcpServers).length : 0;
  const agentCount = agents.length;
  const skillCount = cronSkills.length;

  console.log(`  ${mcpCount} MCPs, ${toolCount} tools, ${agentCount} agents, ${skillCount} cron skills`);
  console.log(`  Written to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error('Snapshot generation failed:', error);
  process.exit(1);
});
