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
      const result = await embeddingSelector.selectTools(message, allTools, CORE_TOOL_NAMES);

      const stats = embeddingSelector.getLastSelectionStats();
      if (stats) {
        logger.info(
          `Tool selection: method=embedding, selected=${stats.selectedCount}/${stats.totalTools}, topScore=${stats.topScore.toFixed(3)}`
        );

        // Debug: compare with regex selector
        if (logger.getLevel() === 'debug') {
          const regexResult = selectToolsForMessage(message, allTools);
          const regexNames = new Set(Object.keys(regexResult));
          const embeddingNames = new Set(Object.keys(result));
          const overlap = [...embeddingNames].filter(n => regexNames.has(n)).length;
          logger.debug(
            `Regex comparison: would select ${regexNames.size}, overlap: ${overlap}/${embeddingNames.size}`
          );
        }
      }

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`Embedding tool selection failed, falling back to regex: ${msg}`);
    }
  }

  // Fallback: existing regex-based selector
  logger.info('Tool selection: method=regex (embedding unavailable)');
  return selectToolsForMessage(message, allTools);
}
