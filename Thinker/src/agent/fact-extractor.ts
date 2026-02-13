import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { generateText, type LanguageModelV1 } from 'ai';
import { z } from 'zod';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:fact-extraction');

/**
 * Fact categories matching Memorizer-MCP's schema
 */
const FACT_CATEGORIES = [
  'preference',
  'background',
  'contact',
  'project',
  'decision',
  'pattern',
] as const;

/**
 * Schema for a single extracted fact
 */
const ExtractedFactSchema = z.object({
  fact: z.string().min(1),
  category: z.enum(FACT_CATEGORIES),
  confidence: z.number().min(0).max(1),
});

const ExtractionResponseSchema = z.object({
  facts: z.array(ExtractedFactSchema),
});

export interface ExtractedFact {
  fact: string;
  category: z.infer<typeof ExtractedFactSchema>['category'];
  confidence: number;
}

/** Cached file-based template (null = use hardcoded fallback) */
let cachedTemplate: string | null = null;

/**
 * Load the extraction prompt template from a file.
 * Called once at startup from Agent.initialize().
 * Template should contain {{KNOWN_FACTS}} and {{CONVERSATION}} placeholders.
 */
export async function loadExtractionPromptTemplate(filePath?: string): Promise<void> {
  const templatePath = filePath
    ?? resolve(import.meta.dirname, '../../prompts/fact-extraction-prompt.md');
  try {
    const content = await readFile(templatePath, 'utf-8');
    if (content.trim().length > 0) {
      cachedTemplate = content.trim();
      logger.info(`Loaded fact extraction prompt template from ${templatePath} (${cachedTemplate.length} chars)`);
    }
  } catch {
    logger.info(`No fact extraction prompt template at ${templatePath}, using built-in fallback`);
    cachedTemplate = null;
  }
}

export interface UserIdentity {
  name?: string;
  email?: string;
}

/**
 * Build the extraction prompt with conversation context and known facts
 */
function buildExtractionPrompt(
  recentMessages: Array<{ role: string; content: string }>,
  knownFacts: string[],
  userIdentity?: UserIdentity,
): string {
  const conversationText = recentMessages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const knownFactsText =
    knownFacts.length > 0
      ? `\nAlready known facts (DO NOT extract these again):\n${knownFacts.map((f) => `- ${f}`).join('\n')}\n`
      : '\nNo facts currently stored.\n';

  const identityText = userIdentity?.name
    ? `\nThe user is "${userIdentity.name}"${userIdentity.email ? ` (email: ${userIdentity.email})` : ''}. When extracting contact facts about meetings or interactions, identify the OTHER party — not the user themselves. Do NOT store facts like "meeting with ${userIdentity.name}" — instead identify who the meeting is with.\n`
    : '';

  // Use file-based template if loaded, otherwise fall back to hardcoded prompt
  if (cachedTemplate) {
    return cachedTemplate
      .replace('{{KNOWN_FACTS}}', knownFactsText)
      .replace('{{USER_IDENTITY}}', identityText)
      .replace('{{CONVERSATION}}', conversationText);
  }

  return `Analyze this conversation and extract NEW facts about the user that are not already known.
${identityText}${knownFactsText}
Conversation:
${conversationText}

Extract facts in these categories:
- preference: What the user likes, dislikes, or prefers
- background: Information about who the user is (location, job, age, etc.)
- pattern: Behavioral patterns you observe
- project: Current work or projects mentioned
- contact: People mentioned by name (with any context like role, email, etc.)
- decision: Choices the user made

Rules:
- Only extract CLEAR, EXPLICIT facts stated or strongly implied in the conversation
- Facts must be standalone (understandable without the conversation)
- Skip generic statements that aren't user-specific
- Skip facts that overlap with the already known facts listed above
- Maximum 5 facts per extraction
- Confidence: 0.9+ for explicitly stated facts, 0.7-0.9 for strongly implied
- Temporal facts (meetings, appointments, schedules) should use LOW confidence (0.5-0.6) — they expire quickly
- If a new fact contradicts a known fact, extract the correction with HIGH confidence (0.9+)
- Prefer extracting durable contact details (email, phone, role, company) over transient schedule data

Return ONLY valid JSON in this exact format:
{
  "facts": [
    {"fact": "...", "category": "...", "confidence": 0.9}
  ]
}

If no NEW facts can be extracted, return: {"facts": []}`;
}

/**
 * Extract facts from a recent conversation using a cheap LLM model.
 *
 * This is a post-conversation extraction step that reviews multiple turns
 * with awareness of already-known facts, complementing the per-turn
 * extraction in Memorizer-MCP's store_conversation.
 *
 * @param model - Cheap LLM model (e.g. Groq Llama 8B) from ModelFactory.getCompactionModel()
 * @param recentMessages - Recent conversation turns to analyze
 * @param knownFacts - Already-known fact strings for deduplication
 * @param confidenceThreshold - Minimum confidence to include a fact (default 0.7)
 * @param userIdentity - Optional user name/email to avoid extracting "meeting with self" facts
 * @returns Extracted facts, or empty array on any error
 */
export async function extractFactsFromConversation(
  model: LanguageModelV1,
  recentMessages: Array<{ role: string; content: string }>,
  knownFacts: string[],
  confidenceThreshold: number = 0.7,
  userIdentity?: UserIdentity,
): Promise<ExtractedFact[]> {
  if (recentMessages.length < 4) {
    // Need at least 2 exchanges (4 messages) to extract meaningful facts
    return [];
  }

  try {
    const prompt = buildExtractionPrompt(recentMessages, knownFacts, userIdentity);

    const result = await generateText({
      model,
      messages: [{ role: 'user', content: prompt }],
      abortSignal: AbortSignal.timeout(30_000),
    });

    const responseText = result.text || '';

    // Extract JSON from response (handle models that wrap in markdown)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.info('No JSON found in LLM response');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const validated = ExtractionResponseSchema.safeParse(parsed);

    if (!validated.success) {
      logger.warn('Response validation failed', validated.error.flatten());
      return [];
    }

    return validated.data.facts
      .filter((f) => f.confidence >= confidenceThreshold)
      .slice(0, 5);
  } catch (error) {
    logger.warn('Extraction failed (non-fatal)', error instanceof Error ? error.message : error);
    return [];
  }
}
