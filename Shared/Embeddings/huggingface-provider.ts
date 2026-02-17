import { type EmbeddingConfig } from './config.js';
import { BaseEmbeddingProvider } from './provider.js';

export class HuggingFaceEmbeddingProvider extends BaseEmbeddingProvider {
  private apiKey: string;
  private model: string;

  constructor(config: EmbeddingConfig) {
    super('huggingface-embedding');

    if (!config.huggingfaceApiKey) {
      throw new Error('HuggingFace API key is required (set HUGGINGFACE_API_KEY)');
    }

    this.apiKey = config.huggingfaceApiKey;
    this.model = config.huggingfaceModel;

    this.logger.info('HuggingFace embedding provider initialized', {
      model: this.model,
    });
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.callHuggingFace([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    return this.callHuggingFace(texts);
  }

  private async callHuggingFace(inputs: string[]): Promise<Float32Array[]> {
    const url = `https://api-inference.huggingface.co/pipeline/feature-extraction/${this.model}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs,
        options: { wait_for_model: true },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HuggingFace embedding request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as number[][];

    if (!Array.isArray(data) || data.length !== inputs.length) {
      throw new Error(
        `HuggingFace returned ${Array.isArray(data) ? data.length : 0} embeddings for ${inputs.length} inputs`
      );
    }

    return data.map(vec => new Float32Array(vec));
  }
}
