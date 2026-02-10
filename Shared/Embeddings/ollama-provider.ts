import { type EmbeddingConfig } from './config.js';
import { BaseEmbeddingProvider } from './provider.js';

interface OllamaEmbedResponse {
  embeddings: number[][];
}

export class OllamaEmbeddingProvider extends BaseEmbeddingProvider {
  private baseUrl: string;
  private model: string;

  constructor(config: EmbeddingConfig) {
    super('ollama-embedding');

    this.baseUrl = config.ollamaBaseUrl;
    this.model = config.ollamaModel;

    this.logger.info('Ollama embedding provider initialized', {
      baseUrl: this.baseUrl,
      model: this.model,
    });
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.callOllama([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    return this.callOllama(texts);
  }

  private async callOllama(input: string[]): Promise<Float32Array[]> {
    const url = `${this.baseUrl}/api/embed`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embedding request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as OllamaEmbedResponse;

    if (!data.embeddings || data.embeddings.length !== input.length) {
      throw new Error(
        `Ollama returned ${data.embeddings?.length ?? 0} embeddings for ${input.length} inputs`
      );
    }

    return data.embeddings.map(vec => new Float32Array(vec));
  }
}
