import { logger } from '@mcp/shared/Utils/logger.js';

/**
 * Extract and parse a JSON object from an LLM response string.
 * Uses a 3-tier fallback strategy:
 *   1. Direct JSON.parse (clean response)
 *   2. Greedy regex extraction (response wrapped in text)
 *   3. Brace-balanced extraction (response with trailing garbage)
 *
 * Returns null if no valid JSON object can be extracted.
 */
export function parseJsonFromLLM(response: string): unknown | null {
  // Strip markdown code blocks if present
  const stripped = stripCodeBlocks(response);

  // Tier 1: entire response is valid JSON
  try {
    return JSON.parse(stripped);
  } catch {
    // fall through
  }

  // Tier 2: greedy regex extraction
  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // fall through to tier 3
    }
  }

  // Tier 3: brace-balanced extraction (finds first complete JSON object)
  const start = stripped.indexOf('{');
  if (start === -1) {
    logger.warn('No JSON object found in LLM response');
    return null;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < stripped.length; i++) {
    const char = stripped[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth++;
    else if (char === '}') depth--;

    if (depth === 0) {
      try {
        return JSON.parse(stripped.substring(start, i + 1));
      } catch {
        logger.warn('Balanced braces found but content is not valid JSON');
        return null;
      }
    }
  }

  logger.warn('No balanced JSON object found in LLM response');
  return null;
}

/**
 * Strip markdown code block fences from a response.
 * Handles ```json ... ``` and ``` ... ```
 */
function stripCodeBlocks(text: string): string {
  // Match ```json\n...\n``` or ```\n...\n```
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return text.trim();
}
