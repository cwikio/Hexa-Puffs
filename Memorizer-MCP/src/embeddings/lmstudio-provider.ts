import OpenAI from 'openai';
import { type EmbeddingConfig } from '@mcp/shared/Embeddings/config.js';
import { BaseEmbeddingProvider } from '@mcp/shared/Embeddings/provider.js';

export class LMStudioEmbeddingProvider extends BaseEmbeddingProvider {
  private client: OpenAI;
  private model: string;

  constructor(config: EmbeddingConfig) {
    super('lmstudio-embedding');

    this.client = new OpenAI({
      baseURL: config.lmstudioBaseUrl,
      apiKey: 'not-needed',
    });
    this.model = config.lmstudioModel;

    this.logger.info('LM Studio embedding provider initialized', {
      baseUrl: config.lmstudioBaseUrl,
      model: this.model,
    });
  }

  async embed(text: string): Promise<Float32Array> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      encoding_format: 'float',
    });

    return new Float32Array(response.data[0].embedding);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const BATCH_SIZE = 100;
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
        encoding_format: 'float',
      });

      for (const item of response.data) {
        results.push(new Float32Array(item.embedding));
      }
    }

    return results;
  }
}
