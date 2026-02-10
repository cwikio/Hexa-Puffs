import type { CoreTool } from 'ai';
import type { EmbeddingProvider } from '@mcp/shared/Embeddings/provider.js';
import { cosineSimilarity } from '@mcp/shared/Embeddings/math.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:embedding-tool-selector');

export interface EmbeddingToolSelectorConfig {
  /** Minimum cosine similarity to include a tool (default 0.3) */
  similarityThreshold: number;
  /** Maximum number of semantically selected tools (default 15) */
  topK: number;
  /** Minimum tools to include regardless of threshold (default 5) */
  minTools: number;
}

const DEFAULT_CONFIG: EmbeddingToolSelectorConfig = {
  similarityThreshold: 0.3,
  topK: 15,
  minTools: 5,
};

export class EmbeddingToolSelector {
  private provider: EmbeddingProvider;
  private config: EmbeddingToolSelectorConfig;
  private toolEmbeddings: Map<string, Float32Array> = new Map();
  private initialized = false;

  constructor(provider: EmbeddingProvider, config?: Partial<EmbeddingToolSelectorConfig>) {
    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Embed all tool descriptions once at startup.
   * Must be called before selectTools().
   */
  async initialize(tools: Record<string, CoreTool>): Promise<void> {
    const entries = Object.entries(tools);
    if (entries.length === 0) {
      this.initialized = true;
      return;
    }

    // Build text for each tool: "toolName: description"
    const names: string[] = [];
    const texts: string[] = [];

    for (const [name, tool] of entries) {
      names.push(name);
      const description = (tool as { description?: string }).description ?? '';
      texts.push(`${name}: ${description}`);
    }

    logger.info(`Embedding ${texts.length} tool descriptions...`);
    const embeddings = await this.provider.embedBatch(texts);

    for (let i = 0; i < names.length; i++) {
      this.toolEmbeddings.set(names[i], embeddings[i]);
    }

    this.initialized = true;
    logger.info('Embedding tool selector initialized');
  }

  /**
   * Select tools relevant to the given message using cosine similarity.
   *
   * @param message - The user message
   * @param allTools - All available tools
   * @param coreToolNames - Tool names that are always included (e.g. send_telegram)
   * @returns Filtered tool map
   */
  async selectTools(
    message: string,
    allTools: Record<string, CoreTool>,
    coreToolNames: string[],
  ): Promise<Record<string, CoreTool>> {
    if (!this.initialized) {
      throw new Error('EmbeddingToolSelector not initialized — call initialize() first');
    }

    // Embed the user message
    const messageEmbedding = await this.provider.embed(message);

    // Score each tool
    const scores: Array<{ name: string; score: number }> = [];
    for (const [name, embedding] of this.toolEmbeddings) {
      if (!(name in allTools)) continue; // tool was removed
      scores.push({ name, score: cosineSimilarity(messageEmbedding, embedding) });
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Build selected set: always include core tools
    const selected = new Set<string>();
    for (const name of coreToolNames) {
      if (name in allTools) selected.add(name);
    }

    // Include top minTools regardless of threshold
    let added = 0;
    for (const { name } of scores) {
      if (added >= this.config.minTools) break;
      if (!selected.has(name)) {
        selected.add(name);
        added++;
      }
    }

    // Include all above threshold up to topK
    for (const { name, score } of scores) {
      if (selected.size >= this.config.topK) break;
      if (score >= this.config.similarityThreshold) {
        selected.add(name);
      }
    }

    // Build filtered tool map
    const result: Record<string, CoreTool> = {};
    for (const name of selected) {
      if (allTools[name]) result[name] = allTools[name];
    }

    logger.info(`Embedding selector: ${selected.size} tools (top score: ${scores[0]?.score.toFixed(3) ?? 'N/A'})`);

    return result;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
