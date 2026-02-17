import { z } from "zod";

export const ConfigSchema = z.object({
  transport: z.enum(["stdio", "sse", "http"]).default("stdio"),
  port: z.number().positive().default(8012),

  outlook: z.object({
    credentialsPath: z.string(),
    tokenCachePath: z.string(),
  }),

  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;
