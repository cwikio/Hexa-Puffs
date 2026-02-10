import type { EmbeddingProvider } from '@mcp/shared/Embeddings/provider.js';
import {
  EmbeddingConfigSchema,
  createEmbeddingProvider,
} from '@mcp/shared/Embeddings/index.js';

/**
 * Create an embedding provider from environment variables.
 * Returns null if EMBEDDING_PROVIDER is unset or 'none'.
 *
 * Thinker supports `ollama` and `huggingface` (not `lmstudio` — no openai dep).
 */
export function createEmbeddingProviderFromEnv(): EmbeddingProvider | null {
  const raw = {
    provider: process.env.EMBEDDING_PROVIDER ?? 'none',
    ollamaBaseUrl: process.env.OLLAMA_EMBEDDING_BASE_URL,
    ollamaModel: process.env.OLLAMA_EMBEDDING_MODEL,
    huggingfaceApiKey: process.env.HUGGINGFACE_API_KEY,
    huggingfaceModel: process.env.HUGGINGFACE_EMBEDDING_MODEL,
    dimensions: process.env.EMBEDDING_DIMENSIONS
      ? Number(process.env.EMBEDDING_DIMENSIONS)
      : undefined,
  };

  // Strip undefined values so Zod defaults apply
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined)
  );

  const parsed = EmbeddingConfigSchema.safeParse(cleaned);
  if (!parsed.success) {
    return null;
  }

  return createEmbeddingProvider(parsed.data);
}
