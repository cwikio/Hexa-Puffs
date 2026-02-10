import { z } from 'zod';

export const EmbeddingConfigSchema = z.object({
  provider: z.enum(['ollama', 'lmstudio', 'huggingface', 'none']).default('none'),

  // Ollama settings
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  ollamaModel: z.string().default('nomic-embed-text'),

  // LM Studio settings
  lmstudioBaseUrl: z.string().default('http://localhost:1234/v1'),
  lmstudioModel: z.string().default('text-embedding-nomic-embed-text-v1.5'),

  // HuggingFace Inference API settings
  huggingfaceApiKey: z.string().optional(),
  huggingfaceModel: z.string().default('nomic-ai/nomic-embed-text-v1.5'),

  // Dimensions must match the model used (768 for nomic-embed-text)
  dimensions: z.number().positive().default(768),

  // Hybrid search weights (60/40 — balanced for short fact strings)
  vectorWeight: z.number().min(0).max(1).default(0.6),
  textWeight: z.number().min(0).max(1).default(0.4),
});

export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
