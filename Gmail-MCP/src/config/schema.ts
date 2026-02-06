import { z } from "zod";

export const ConfigSchema = z.object({
  transport: z.enum(["stdio", "sse", "http"]).default("stdio"),
  port: z.number().positive().default(8008),

  gmail: z.object({
    credentialsPath: z.string(),
    tokenPath: z.string(),
  }),

  polling: z.object({
    enabled: z.boolean().default(false),
    intervalMs: z.number().positive().default(60000),
  }),

  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;
