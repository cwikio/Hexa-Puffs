import { z } from 'zod';
import { getDatabase, type FactRow, FACT_CATEGORIES } from '../db/index.js';
import { createAIProvider } from '../services/ai-provider.js';
import { getConfig } from '../config/index.js';
import { reembedFact, deleteFactEmbedding } from '../embeddings/fact-embeddings.js';
import { parseJsonFromLLM } from '../utils/parse-json.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  createSuccess,
  createError,
  createErrorFromException,
} from '@mcp/shared/Types/StandardResponse.js';

// Tool definition
export const synthesizeFactsToolDefinition = {
  name: 'synthesize_facts',
  description:
    'Consolidate accumulated facts: merge duplicates, resolve contradictions, flag stale entries. ' +
    'Processes facts per category (max 100 oldest per category for quality). ' +
    'Designed to run weekly via Inngest cron.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to synthesize facts for',
        default: 'main',
      },
      category: {
        type: 'string',
        description: 'Optional: synthesize only one category. If omitted, processes all categories.',
        enum: FACT_CATEGORIES,
      },
      max_facts_per_category: {
        type: 'number',
        description: 'Maximum facts to process per category (default 100, oldest first)',
        default: 100,
      },
    },
  },
};

// Zod input schema
export const SynthesizeFactsInputSchema = z.object({
  agent_id: z.string().default('main'),
  category: z.enum(FACT_CATEGORIES).optional(),
  max_facts_per_category: z.number().positive().max(200).default(100),
});

// Action types from LLM response
const SynthesisActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('merge'),
    keep_id: z.number(),
    delete_ids: z.array(z.number()),
    updated_text: z.string(),
  }),
  z.object({
    type: z.literal('delete'),
    fact_id: z.number(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('update'),
    fact_id: z.number(),
    new_text: z.string(),
    reason: z.string(),
  }),
]);

const SynthesisResponseSchema = z.object({
  actions: z.array(SynthesisActionSchema),
  summary: z.string(),
});

// Response type
export interface SynthesizeFactsData {
  categories_processed: number;
  merges: number;
  deletions: number;
  updates: number;
  summaries: Record<string, string>;
}

function buildSynthesisPrompt(category: string, facts: FactRow[]): string {
  const factList = facts
    .map((f) => `[${f.id}] ${f.fact} (confidence: ${f.confidence}, created: ${f.created_at})`)
    .join('\n');

  return `You are a memory curator. Review these facts about a user and suggest improvements.

Facts (category: ${category}):
${factList}

Instructions:
1. Identify duplicate facts that say the same thing differently → suggest MERGE (keep the most complete one, delete others)
2. Find contradictory facts → suggest UPDATE to the most recent/accurate one, DELETE the outdated one
3. Flag facts that seem stale or time-sensitive → suggest DELETE with a reason
4. Leave clear, unique facts unchanged

Return ONLY valid JSON. No markdown code blocks, no JavaScript, no explanation text — just the raw JSON object:
{
  "actions": [
    { "type": "merge", "keep_id": 5, "delete_ids": [12, 23], "updated_text": "merged text" },
    { "type": "delete", "fact_id": 8, "reason": "outdated" },
    { "type": "update", "fact_id": 15, "new_text": "corrected text", "reason": "clarified" }
  ],
  "summary": "Brief description of changes made"
}

If no changes needed, return: { "actions": [], "summary": "All facts are clean" }`;
}

// Handler
export async function handleSynthesizeFacts(
  args: unknown,
): Promise<StandardResponse<SynthesizeFactsData>> {
  const parseResult = SynthesizeFactsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, category, max_facts_per_category } = parseResult.data;

  try {
    const db = getDatabase();
    const config = getConfig();
    const provider = createAIProvider(config.ai);

    const categoriesToProcess = category ? [category] : [...FACT_CATEGORIES];

    let totalMerges = 0;
    let totalDeletions = 0;
    let totalUpdates = 0;
    const summaries: Record<string, string> = {};

    for (const cat of categoriesToProcess) {
      // Load oldest facts for this category (oldest are most likely to have stale/duplicate issues)
      const facts = db
        .prepare(
          `SELECT * FROM facts
           WHERE agent_id = ? AND category = ?
           ORDER BY created_at ASC
           LIMIT ?`,
        )
        .all(agent_id, cat, max_facts_per_category) as FactRow[];

      if (facts.length < 2) {
        // Need at least 2 facts to synthesize
        summaries[cat] = `Skipped — only ${facts.length} fact(s)`;
        continue;
      }

      try {
        const prompt = buildSynthesisPrompt(cat, facts);
        const response = await provider.complete(prompt, {
          jsonMode: true,
          maxTokens: config.ai.synthesisMaxTokens,
        });

        // Parse JSON from response using robust 3-tier fallback
        const parsed = parseJsonFromLLM(response);
        if (parsed === null) {
          logger.warn('No JSON found in synthesis response', { category: cat });
          summaries[cat] = 'No valid response from LLM';
          continue;
        }

        const validated = SynthesisResponseSchema.safeParse(parsed);

        if (!validated.success) {
          logger.warn('Synthesis response validation failed', {
            category: cat,
            errors: validated.error.flatten(),
          });
          summaries[cat] = 'Invalid response format from LLM';
          continue;
        }

        const { actions, summary } = validated.data;

        // Collect all fact IDs in this category for validation
        const validIds = new Set(facts.map((f) => f.id));

        // Apply actions
        for (const action of actions) {
          switch (action.type) {
            case 'merge': {
              if (!validIds.has(action.keep_id)) break;
              // Update the kept fact with merged text
              db.prepare(
                `UPDATE facts SET fact = ?, updated_at = datetime('now') WHERE id = ?`,
              ).run(action.updated_text, action.keep_id);
              await reembedFact(action.keep_id, action.updated_text);
              // Delete the duplicate facts
              for (const deleteId of action.delete_ids) {
                if (validIds.has(deleteId) && deleteId !== action.keep_id) {
                  db.prepare(`DELETE FROM facts WHERE id = ?`).run(deleteId);
                  deleteFactEmbedding(deleteId);
                  totalDeletions++;
                }
              }
              totalMerges++;
              break;
            }
            case 'delete': {
              if (!validIds.has(action.fact_id)) break;
              db.prepare(`DELETE FROM facts WHERE id = ?`).run(action.fact_id);
              deleteFactEmbedding(action.fact_id);
              totalDeletions++;
              break;
            }
            case 'update': {
              if (!validIds.has(action.fact_id)) break;
              db.prepare(
                `UPDATE facts SET fact = ?, updated_at = datetime('now') WHERE id = ?`,
              ).run(action.new_text, action.fact_id);
              await reembedFact(action.fact_id, action.new_text);
              totalUpdates++;
              break;
            }
          }
        }

        summaries[cat] = summary;
      } catch (error) {
        logger.warn('Synthesis failed for category', { category: cat, error });
        summaries[cat] = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    logger.info('Fact synthesis completed', {
      categories_processed: categoriesToProcess.length,
      merges: totalMerges,
      deletions: totalDeletions,
      updates: totalUpdates,
    });

    return createSuccess({
      categories_processed: categoriesToProcess.length,
      merges: totalMerges,
      deletions: totalDeletions,
      updates: totalUpdates,
      summaries,
    });
  } catch (error) {
    logger.error('Fact synthesis failed', { error });
    return createErrorFromException(error);
  }
}
