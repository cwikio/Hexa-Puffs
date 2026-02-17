import { logger, type Logger } from '../Utils/logger.js';

export interface EmbeddingProvider {
  /**
   * Generate an embedding vector for a single text.
   * Returns a Float32Array of length matching the configured dimensions.
   */
  embed(text: string): Promise<Float32Array>;

  /**
   * Generate embeddings for multiple texts in a single batch.
   * More efficient than calling embed() in a loop for providers that support batching.
   */
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

export abstract class BaseEmbeddingProvider implements EmbeddingProvider {
  protected logger: Logger;

  constructor(name: string) {
    this.logger = logger.child(name);
  }

  abstract embed(text: string): Promise<Float32Array>;
  abstract embedBatch(texts: string[]): Promise<Float32Array[]>;
}
