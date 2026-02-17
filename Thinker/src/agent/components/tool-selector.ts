import { Logger } from '@mcp/shared/Utils/logger.js';
import { CORE_TOOL_NAMES, selectToolsWithFallback } from '../tool-selection.js';
import { TOOL_GROUPS } from '../tool-selector.js';
import { CoreTool } from 'ai';

const logger = new Logger('thinker:component:tool-selector');

const STICKY_TOOLS_MAX = parseInt(process.env.THINKER_STICKY_TOOLS_MAX ?? '8', 10);

export class ToolSelector {
  constructor(
    private embeddingSelector: any, // Type will be imported from embedding selector
    private tools: Record<string, CoreTool>,
    private orchestratorMetadata: any
  ) {}

  /**
   * Select tools for the current turn, including:
   * 1. Embedding-based selection (RAG)
   * 2. Playbook-required tools (forced injection)
   * 3. Sticky tools (recently used tools for follow-up context)
   * 4. Sibling tools (related tools for used tools)
   */
  async selectTools(
    text: string,
    playbookRequiredTools: string[],
    recentToolsByTurn: { tools: string[] }[]
  ): Promise<Record<string, CoreTool>> {
    // 1. Base selection via Embeddings/Keywords
    const selectedTools = await selectToolsWithFallback(
      text,
      this.tools,
      this.embeddingSelector,
      this.orchestratorMetadata
    );

    // 2. Playbook Requirements
    if (selectedTools && playbookRequiredTools.length > 0) {
      this.injectPlaybookTools(selectedTools, playbookRequiredTools);
    }

    // 3 & 4. Sticky Tools & Siblings
    // Sticky tools: inject tools used in recent turns so follow-up messages
    // ("what about the other one?") can still call them even when the embedding
    // selector doesn't match them for the current message.
    if (selectedTools && recentToolsByTurn.length > 0) {
      this.injectStickyTools(selectedTools, recentToolsByTurn);
    }

    return selectedTools;
  }

  private injectPlaybookTools(selectedTools: Record<string, CoreTool>, requiredTools: string[]) {
    let injected = 0;
    for (const name of requiredTools) {
      if (!selectedTools[name] && this.tools[name]) {
        selectedTools[name] = this.tools[name];
        injected++;
      } else if (!this.tools[name]) {
        logger.warn(`[playbook-tools] Required tool '${name}' not found (MCP may be down)`);
      }
    }
    if (injected > 0) {
      logger.info(`[playbook-tools] Injected ${injected} required tool(s) from matched playbook(s)`);
    }
  }

  private injectStickyTools(selectedTools: Record<string, CoreTool>, recentToolsByTurn: { tools: string[] }[]) {
    const coreSet = new Set(CORE_TOOL_NAMES);
    const allToolNames = Object.keys(this.tools);
    const stickyNames: string[] = [];

    // Collect exact tools used in recent turns (newest first)
    const usedNames: string[] = [];
    for (let i = recentToolsByTurn.length - 1; i >= 0; i--) {
      for (const name of recentToolsByTurn[i].tools) {
        if (!coreSet.has(name) && !usedNames.includes(name)) {
          usedNames.push(name);
        }
      }
    }

    // Expand to group siblings: find groups each used tool belongs to,
    // then include all tools from those groups.
    const siblingGroups = new Set<string>();
    for (const usedName of usedNames) {
      for (const [groupName, patterns] of Object.entries(TOOL_GROUPS)) {
        if (groupName === 'core') continue;
        for (const pattern of patterns) {
          if (pattern.includes('*')) {
            const re = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
            if (re.test(usedName)) siblingGroups.add(groupName);
          } else if (pattern === usedName) {
            siblingGroups.add(groupName);
          }
        }
      }
    }

    // Add exact used tools first, then sibling tools
    for (const name of usedNames) {
      if (!selectedTools[name] && this.tools[name] && !stickyNames.includes(name)) {
        stickyNames.push(name);
      }
    }
    for (const groupName of siblingGroups) {
      const patterns = TOOL_GROUPS[groupName];
      if (!patterns) continue;
      for (const pattern of patterns) {
        const expanded = pattern.includes('*')
          ? allToolNames.filter(n => new RegExp(`^${pattern.replace(/\*/g, '.*')}$`).test(n))
          : [pattern];
        for (const name of expanded) {
          if (!selectedTools[name] && this.tools[name] && !coreSet.has(name) && !stickyNames.includes(name)) {
            stickyNames.push(name);
          }
        }
      }
    }

    const toInject = stickyNames.slice(0, STICKY_TOOLS_MAX);
    for (const name of toInject) {
      selectedTools[name] = this.tools[name];
    }
    if (toInject.length > 0) {
      logger.info(`[sticky-tools] Injected ${toInject.length} tool(s) from recent turns: ${toInject.join(', ')}`);
    }
  }
}
