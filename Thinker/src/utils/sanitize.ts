/**
 * Response sanitization utilities
 *
 * Removes leaked function call syntax, thinking tags, and other technical
 * artifacts that should never appear in user-facing responses.
 */

/**
 * Patterns that indicate leaked function call syntax or internal reasoning
 */
const SANITIZE_PATTERNS: RegExp[] = [
  // XML-style function calls: <function=name>...</function> or <function=name>...<function>
  /<function[=\s][^>]*>[\s\S]*?<\/?function>/gi,

  // Generic XML tool calls: <tool_call>...</tool_call>
  /<tool_call>[\s\S]*?<\/tool_call>/gi,

  // Thinking tags: <think>...</think> or <thinking>...</thinking>
  /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi,

  // JSON-style function calls: {"function": ...}, {"tool_call": ...}, or {"name": ..., "parameters": ...}
  // Uses \s* after opening brace to handle pretty-printed/multi-line JSON from Groq/Llama
  /\{\s*"(?:function|tool_call|name)"\s*:\s*"[^"]+"\s*,?\s*(?:"(?:parameters|arguments)"\s*:\s*\{[\s\S]*?\})?\s*\}/gi,

  // Action tags: [Action: tool_name] or [[tool_name]]
  /\[(?:Action:\s*)?[a-z_]+(?:\s*\([^)]*\))?\]/gi,
];

/**
 * Sanitize LLM response text by removing any leaked function call syntax
 * or internal reasoning that should not be shown to users.
 *
 * @param text - Raw response text from the LLM
 * @returns Cleaned text safe for user display
 */
export function sanitizeResponseText(text: string): string {
  let sanitized = text;

  for (const pattern of SANITIZE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }

  // Clean up multiple newlines left by removals
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

  // Trim whitespace
  sanitized = sanitized.trim();

  // If nothing remains after sanitization, return a fallback message
  if (!sanitized) {
    return 'I apologize, but I was unable to generate a response.';
  }

  return sanitized;
}
