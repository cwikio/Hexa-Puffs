import { z } from 'zod';

export const AIProviderConfigSchema = z.object({
  provider: z.enum(['groq', 'lmstudio']).default('groq'),

  // Groq settings
  groqApiKey: z.string().optional(),
  groqModel: z.string().default('llama-3.3-70b-versatile'),

  // LM Studio settings
  lmstudioBaseUrl: z.string().default('http://localhost:1234/v1'),
  lmstudioModel: z.string().default('local-model'),

  // Common settings
  temperature: z.number().min(0).max(2).default(0.3),
  maxTokens: z.number().positive().default(500),
});

export type AIProviderConfig = z.infer<typeof AIProviderConfigSchema>;

export const ExtractionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
  maxFactsPerConversation: z.number().positive().default(3),
  skipShortConversations: z.number().positive().default(50),
});

export type ExtractionConfig = z.infer<typeof ExtractionConfigSchema>;

export const EmbeddingConfigSchema = z.object({
  provider: z.enum(['ollama', 'lmstudio', 'none']).default('none'),

  // Ollama settings
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  ollamaModel: z.string().default('nomic-embed-text'),

  // LM Studio settings
  lmstudioBaseUrl: z.string().default('http://localhost:1234/v1'),
  lmstudioModel: z.string().default('text-embedding-nomic-embed-text-v1.5'),

  // Dimensions must match the model used (768 for nomic-embed-text)
  dimensions: z.number().positive().default(768),

  // Hybrid search weights (60/40 — balanced for short fact strings)
  vectorWeight: z.number().min(0).max(1).default(0.6),
  textWeight: z.number().min(0).max(1).default(0.4),
});

export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;

export const ConfigSchema = z.object({
  transport: z.enum(['stdio', 'sse']).default('stdio'),
  port: z.number().positive().default(8005),

  database: z.object({
    path: z.string(),
  }),

  export: z.object({
    path: z.string(),
  }),

  ai: AIProviderConfigSchema,
  extraction: ExtractionConfigSchema,
  embedding: EmbeddingConfigSchema,

  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;
