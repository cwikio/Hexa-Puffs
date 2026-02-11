import type { CoreTool } from 'ai';
import type { EmbeddingToolSelector } from './embedding-tool-selector.js';
import { selectToolsForMessage } from './tool-selector.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:tool-selection');

/** Core tools that are always included regardless of selection method */
const CORE_TOOL_NAMES = [
  'send_telegram',
  'store_fact',
  'search_memories',
  'get_status',
  'spawn_subagent',
];

/**
 * Select tools with embedding-based selection, falling back to regex on error or absence.
 *
 * @param message - The user message text
 * @param allTools - All available tools
 * @param embeddingSelector - The embedding selector (null if not configured)
 * @returns Filtered tool map
 */
export async function selectToolsWithFallback(
  message: string,
  allTools: Record<string, CoreTool>,
  embeddingSelector: EmbeddingToolSelector | null,
): Promise<Record<string, CoreTool>> {
  if (embeddingSelector?.isInitialized()) {
    try {
      const embeddingResult = await embeddingSelector.selectTools(message, allTools, CORE_TOOL_NAMES);

      // Always merge regex keyword-matched tools — they encode curated domain
      // knowledge (e.g. image requests need both search AND telegram groups)
      // that pure semantic similarity can miss.
      const regexResult = selectToolsForMessage(message, allTools);
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

      return merged;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`Embedding tool selection failed, falling back to regex: ${msg}`);
    }
  }

  // Fallback: existing regex-based selector
  logger.info('Tool selection: method=regex (embedding unavailable)');
  return selectToolsForMessage(message, allTools);
}
