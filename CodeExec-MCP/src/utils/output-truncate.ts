/**
 * Head+tail output truncation.
 *
 * When output exceeds the limit, keeps the first `head` characters and the
 * last `tail` characters with a separator in between. This preserves both
 * the beginning (typically key results) and the end (typically errors/status).
 */

export interface TruncateConfig {
  maxChars: number;
  head: number;
  tail: number;
}

export interface TruncateResult {
  text: string;
  truncated: boolean;
}

export function truncateOutput(
  output: string,
  config: TruncateConfig,
): TruncateResult {
  if (output.length <= config.maxChars) {
    return { text: output, truncated: false };
  }

  const dropped = output.length - config.head - config.tail;
  const separator = `\n\n[... truncated ${dropped} characters ...]\n\n`;
  const text =
    output.slice(0, config.head) + separator + output.slice(-config.tail);

  return { text, truncated: true };
}
