/**
 * Schema and types for external MCP configuration.
 *
 * External MCPs are declared in ~/.annabelle/external-mcps.json and merged
 * into the Orchestrator's stdio MCP config alongside auto-discovered internal MCPs.
 */
import { z } from 'zod';

export const ExternalMCPConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().positive().default(30000),
  sensitive: z.boolean().default(false),
  description: z.string().optional(),
  metadata: z.object({
    label: z.string().optional(),
    toolGroup: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    guardianScan: z.object({
      input: z.boolean().optional(),
      output: z.boolean().optional(),
    }).optional(),
  }).optional(),
});

export type ExternalMCPConfig = z.infer<typeof ExternalMCPConfigSchema>;

export const ExternalMCPsFileSchema = z.record(z.string(), ExternalMCPConfigSchema);

export type ExternalMCPsFile = z.infer<typeof ExternalMCPsFileSchema>;
