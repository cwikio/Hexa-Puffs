import { z } from 'zod';
import { type AIProvider, createAIProvider } from './ai-provider.js';
import { isFactSafe } from './sanitizer.js';
import { getConfig, type ExtractionConfig } from '../config/index.js';
import { ExtractionError } from '../utils/errors.js';
import { parseJsonFromLLM } from '../utils/parse-json.js';
import { logger, Logger } from '@mcp/shared/Utils/logger.js';
import { type FactCategory, FACT_CATEGORIES } from '../db/schema.js';

// Schema for extracted facts
const ExtractedFactSchema = z.object({
  fact: z.string(),
  category: z.enum(FACT_CATEGORIES),
  confidence: z.number().min(0).max(1),
});

const ExtractionResponseSchema = z.object({
  facts: z.array(ExtractedFactSchema),
});

export interface ExtractedFact {
  fact: string;
  category: FactCategory;
  confidence: number;
}

export interface ExtractionResult {
  facts: ExtractedFact[];
  skipped: boolean;
  reason?: string;
}

const EXTRACTION_PROMPT = `Analyze this conversation and extract discrete facts about the user.

Conversation:
User: {user_message}
Assistant: {agent_response}

Extract facts in these categories:
- preference: What the user likes or dislikes
- background: Information about who the user is
- pattern: Behavioral patterns you observe
- project: Current work or projects mentioned
- contact: People mentioned by name
- decision: Choices the user made

Rules:
- Only extract CLEAR, EXPLICIT facts (not assumptions)
- Facts should be standalone (understandable without context)
- Skip generic statements that aren't user-specific
- Maximum 3 facts per conversation
- Confidence should be 0.0-1.0 based on how certain you are

Return ONLY valid JSON in this exact format:
{
  "facts": [
    {"fact": "...", "category": "...", "confidence": 0.9}
  ]
}

If no facts can be extracted, return: {"facts": []}`;

export class FactExtractor {
  private provider: AIProvider;
  private config: ExtractionConfig;
  private logger: Logger;

  constructor() {
    const config = getConfig();
    this.provider = createAIProvider(config.ai);
    this.config = config.extraction;
    this.logger = logger.child('fact-extractor');
  }

  /**
   * Extract facts from a conversation
   */
  async extract(
    userMessage: string,
    agentResponse: string
  ): Promise<ExtractionResult> {
    // Check if extraction is enabled
    if (!this.config.enabled) {
      return { facts: [], skipped: true, reason: 'Extraction disabled' };
    }

    // Skip short conversations
    const totalLength = userMessage.length + agentResponse.length;
    if (totalLength < this.config.skipShortConversations) {
      return { facts: [], skipped: true, reason: 'Conversation too short' };
    }

    try {
      // Build the prompt
      const prompt = EXTRACTION_PROMPT
        .replace('{user_message}', userMessage)
        .replace('{agent_response}', agentResponse);

      // Call the AI provider
      const response = await this.provider.complete(prompt);

      // Parse the response
      const facts = this.parseResponse(response);

      // Filter by confidence threshold and safety
      const filteredFacts = facts
        .filter(f => f.confidence >= this.config.confidenceThreshold)
        .filter(f => isFactSafe(f.fact))
        .slice(0, this.config.maxFactsPerConversation);

      this.logger.info('Facts extracted', {
        total: facts.length,
        afterFilter: filteredFacts.length,
      });

      return { facts: filteredFacts, skipped: false };
    } catch (error) {
      this.logger.error('Fact extraction failed', { error });
      return {
        facts: [],
        skipped: true,
        reason: `Extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Parse the AI response into structured facts
   */
  private parseResponse(response: string): ExtractedFact[] {
    const parsed = parseJsonFromLLM(response);
    if (parsed === null) {
      this.logger.warn('No JSON found in extraction response');
      return [];
    }

    const result = ExtractionResponseSchema.safeParse(parsed);

    if (!result.success) {
      this.logger.warn('Response validation failed', {
        errors: result.error.flatten(),
      });
      return [];
    }

    return result.data.facts;
  }
}

// Singleton instance
let extractorInstance: FactExtractor | null = null;

export function getFactExtractor(): FactExtractor {
  if (!extractorInstance) {
    extractorInstance = new FactExtractor();
  }
  return extractorInstance;
}
