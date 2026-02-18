/**
 * Schema and types for external MCP configuration.
 *
 * External MCPs are declared in external-mcps.json (project root) and merged
 * into the Orchestrator's MCP config alongside auto-discovered internal MCPs.
 *
 * Supports two transport types:
 * - stdio (default): spawns a local process (command + args)
 * - http: connects to a remote Streamable HTTP MCP server (url + optional headers)
 */
import { z } from 'zod';

const ExternalMCPMetadataSchema = z.object({
  label: z.string().optional(),
  toolGroup: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  guardianScan: z.object({
    input: z.boolean().optional(),
    output: z.boolean().optional(),
  }).optional(),
  allowDestructiveTools: z.boolean().optional(),
});

/** Fields shared by both stdio and HTTP external MCP configs. */
const ExternalMCPBaseSchema = z.object({
  timeout: z.number().positive().default(30000),
  sensitive: z.boolean().default(false),
  description: z.string().optional(),
  metadata: ExternalMCPMetadataSchema.optional(),
});

/** Stdio transport: spawns a local process. */
export const StdioExternalMCPConfigSchema = ExternalMCPBaseSchema.extend({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

/** HTTP transport: connects to a remote Streamable HTTP MCP server. */
export const HttpExternalMCPConfigSchema = ExternalMCPBaseSchema.extend({
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

export const ExternalMCPConfigSchema = z.discriminatedUnion('type', [
  StdioExternalMCPConfigSchema,
  HttpExternalMCPConfigSchema,
]);

export type ExternalMCPConfig = z.infer<typeof ExternalMCPConfigSchema>;
export type StdioExternalMCPConfig = z.infer<typeof StdioExternalMCPConfigSchema>;
export type HttpExternalMCPConfig = z.infer<typeof HttpExternalMCPConfigSchema>;

export const ExternalMCPsFileSchema = z.record(z.string(), ExternalMCPConfigSchema);
export type ExternalMCPsFile = z.infer<typeof ExternalMCPsFileSchema>;
