import { z } from 'zod';
import { AgentDefinitionSchema, ChannelBindingSchema } from './agents.js';

// Metadata from MCP manifest — used by ToolRouter, Guardian, and Thinker
export const MCPMetadataSchema = z.object({
  label: z.string().optional(),
  toolGroup: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  guardianScan: z.object({
    input: z.boolean().optional(),
    output: z.boolean().optional(),
  }).optional(),
});

export type MCPMetadata = z.infer<typeof MCPMetadataSchema>;

// Stdio-based MCP server config (spawns process)
export const StdioMCPServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  timeout: z.number().positive().default(30000),
  required: z.boolean().default(false),
  sensitive: z.boolean().default(false),
  description: z.string().optional(),
  metadata: MCPMetadataSchema.optional(),
});

export type StdioMCPServerConfig = z.infer<typeof StdioMCPServerConfigSchema>;


export const SecurityConfigSchema = z.object({
  scanAllInputs: z.boolean().default(true),
  sensitiveTools: z.array(z.string()).default([]),
  failMode: z.enum(['open', 'closed']).default('closed'),
});

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

export const JobsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().positive().default(3000),
  inngestUrl: z.string().default('http://localhost:8288'),
  defaultRetries: z.number().positive().default(3),
  defaultConcurrency: z.number().positive().default(10),
});

export type JobsConfig = z.infer<typeof JobsConfigSchema>;

export const ChannelPollingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  intervalMs: z.number().int().min(1000).default(10000),
  maxMessagesPerCycle: z.number().int().min(1).default(3),
});

export type ChannelPollingConfig = z.infer<typeof ChannelPollingConfigSchema>;

export const ChannelMCPEntrySchema = z.object({
  name: z.string(),
  botPatterns: z.array(z.string()).optional(),
  chatRefreshIntervalMs: z.number().optional(),
  maxMessageAgeMs: z.number().optional(),
});

export type ChannelMCPEntry = z.infer<typeof ChannelMCPEntrySchema>;

export const ConfigSchema = z.object({
  // Transport for incoming connections (from Claude Desktop/Thinker)
  transport: z.enum(['stdio', 'sse', 'http']).default('stdio'),
  port: z.number().positive().default(8010),

  // Connection mode for downstream MCPs (always stdio)
  mcpConnectionMode: z.literal('stdio').default('stdio'),

  // Stdio-based MCP server configs (used when mcpConnectionMode = 'stdio')
  // Dynamic: keys are auto-discovered from sibling MCP directories
  mcpServersStdio: z.record(z.string(), StdioMCPServerConfigSchema).optional(),


  security: SecurityConfigSchema,

  jobs: JobsConfigSchema.optional(),

  // Channel polling (Orchestrator polls Telegram and dispatches to Thinker)
  channelPolling: ChannelPollingConfigSchema.default({}),

  // Thinker URL for skill execution and message dispatch (single-agent fallback)
  thinkerUrl: z.string().default('http://localhost:8006'),

  // Multi-agent: agent definitions (when set, overrides thinkerUrl)
  agents: z.array(AgentDefinitionSchema).optional(),

  // Path to agents config JSON file (alternative to inline agents array)
  agentsConfigPath: z.string().optional(),

  // Channel bindings: map (channel, chatId) → agentId
  bindings: z.array(ChannelBindingSchema).optional(),

  // Auto-discovered channel MCPs (populated by scanner, not set manually)
  channelMCPs: z.array(ChannelMCPEntrySchema).default([]),

  // Names of external MCPs (loaded from external-mcps.json, tracked for health reporting)
  externalMCPNames: z.array(z.string()).default([]),

  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;
