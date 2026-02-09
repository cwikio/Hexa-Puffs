import { z } from 'zod';
import { AgentDefinitionSchema, ChannelBindingSchema } from './agents.js';

// Stdio-based MCP server config (spawns process)
export const StdioMCPServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  timeout: z.number().positive().default(30000),
  required: z.boolean().default(false),
  sensitive: z.boolean().default(false),
});

export type StdioMCPServerConfig = z.infer<typeof StdioMCPServerConfigSchema>;

// Legacy HTTP-based MCP server config (for backwards compatibility)
export const MCPServerConfigSchema = z.object({
  url: z.string().url(),
  timeout: z.number().positive().default(5000),
  required: z.boolean().default(false),
  sensitive: z.boolean().default(false),
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

export const SecurityConfigSchema = z.object({
  scanAllInputs: z.boolean().default(true),
  sensitiveTools: z.array(z.string()).default(['onepassword_get', 'telegram_send']),
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

  // Connection mode for downstream MCPs
  mcpConnectionMode: z.enum(['stdio', 'http']).default('stdio'),

  // Stdio-based MCP server configs (used when mcpConnectionMode = 'stdio')
  // Dynamic: keys are auto-discovered from sibling MCP directories
  mcpServersStdio: z.record(z.string(), StdioMCPServerConfigSchema).optional(),

  // HTTP-based MCP server configs (used when mcpConnectionMode = 'http' or for HTTP-only MCPs)
  // Dynamic: keys are auto-discovered from sibling MCP directories
  mcpServers: z.record(z.string(), MCPServerConfigSchema).optional(),

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

  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;
