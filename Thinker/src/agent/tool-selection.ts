import type { CoreTool } from 'ai';
import type { EmbeddingToolSelector } from './embedding-tool-selector.js';
import { selectToolsForMessage } from './tool-selector.js';
import { Logger } from '@mcp/shared/Utils/logger.js';
import type { MCPMetadata } from '../orchestrator/types.js';

const logger = new Logger('thinker:tool-selection');

const MAX_TOOLS = parseInt(process.env.TOOL_SELECTOR_MAX_TOOLS ?? '25', 10);

/** Core tools that are always included regardless of selection method */
export const CORE_TOOL_NAMES = [
  'send_telegram',
  'store_fact',
  'search_memories',
  'get_status',
  'spawn_subagent',
];

/**
 * Applies a hard cap on the number of tools using tiered priority:
 *  Tier 1: Core tools (always kept)
 *  Tier 2: Tools with embedding scores, sorted descending
 *  Tier 3: Regex-only tools (no score), alphabetical
 */
function applyToolCap(
  tools: Record<string, CoreTool>,
  coreNames: string[],
  scores: Map<string, number> | null,
  cap: number,
): Record<string, CoreTool> {
  const names = Object.keys(tools);
  if (names.length <= cap) return tools;

  const coreSet = new Set(coreNames);
  const kept: string[] = [];

  // Tier 1: core tools
  for (const name of names) {
    if (coreSet.has(name)) kept.push(name);
  }

  // Remaining non-core tools
  const remaining = names.filter(n => !coreSet.has(n));

  // Tier 2 + 3: sort by score descending, no-score tools last (alphabetical)
  remaining.sort((a, b) => {
    const sa = scores?.get(a) ?? -1;
    const sb = scores?.get(b) ?? -1;
    if (sa !== sb) return sb - sa;
    return a.localeCompare(b);
  });

  const slotsLeft = cap - kept.length;
  const dropped = remaining.slice(slotsLeft);
  kept.push(...remaining.slice(0, slotsLeft));

  if (dropped.length > 0) {
    logger.info(`Tool cap: kept ${kept.length}/${names.length}, dropped ${dropped.length}: ${dropped.join(', ')}`);
  }

  const result: Record<string, CoreTool> = {};
  for (const name of kept) {
    result[name] = tools[name];
  }
  return result;
}

/**
 * Select tools with embedding-based selection, falling back to regex on error or absence.
 *
 * @param message - The user message text
 * @param allTools - All available tools
 * @param embeddingSelector - The embedding selector (null if not configured)
 * @param mcpMetadata - Optional MCP metadata for dynamic group/keyword generation
 * @returns Filtered tool map
 */
export async function selectToolsWithFallback(
  message: string,
  allTools: Record<string, CoreTool>,
  embeddingSelector: EmbeddingToolSelector | null,
  mcpMetadata?: Record<string, MCPMetadata>,
): Promise<Record<string, CoreTool>> {
  if (embeddingSelector?.isInitialized()) {
    try {
      const embeddingResult = await embeddingSelector.selectTools(message, allTools, CORE_TOOL_NAMES);

      // Always merge regex keyword-matched tools — they encode curated domain
      // knowledge (e.g. image requests need both search AND telegram groups)
      // that pure semantic similarity can miss.
      const regexResult = selectToolsForMessage(message, allTools, mcpMetadata);
      const merged = { ...embeddingResult };
      let regexAdded = 0;
      for (const [name, tool] of Object.entries(regexResult)) {
        if (!(name in merged)) {
          merged[name] = tool;
          regexAdded++;
        }
      }

      const stats = embeddingSelector.getLastSelectionStats();
      if (stats) {
        logger.info(
          `Tool selection: method=embedding+regex, embedding=${stats.selectedCount}, regex added=${regexAdded}, total=${Object.keys(merged).length}/${stats.totalTools}, topScore=${stats.topScore.toFixed(3)}`
        );
      }

      return applyToolCap(merged, CORE_TOOL_NAMES, embeddingSelector.getLastScores(), MAX_TOOLS);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`Embedding tool selection failed, falling back to regex: ${msg}`);
    }
  }

  // Fallback: existing regex-based selector
  logger.info('Tool selection: method=regex (embedding unavailable)');
  return applyToolCap(selectToolsForMessage(message, allTools, mcpMetadata), CORE_TOOL_NAMES, null, MAX_TOOLS);
}
