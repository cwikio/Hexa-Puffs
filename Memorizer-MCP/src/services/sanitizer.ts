import { logger } from '@mcp/shared/Utils/logger.js';

// Patterns for sensitive data that should never be stored
const SENSITIVE_PATTERNS = [
  // API keys
  /sk-[a-zA-Z0-9]{20,}/g,                         // OpenAI-style API keys
  /gsk_[a-zA-Z0-9]{20,}/g,                        // Groq API keys
  /sk-ant-[a-zA-Z0-9-]{20,}/g,                    // Anthropic API keys
  /xoxb-[a-zA-Z0-9-]+/g,                          // Slack tokens
  /ghp_[a-zA-Z0-9]{36}/g,                         // GitHub tokens
  /glpat-[a-zA-Z0-9-_]{20}/g,                     // GitLab tokens

  // Passwords
  /password\s*[=:]\s*['"]?[^\s'"]+['"]?/gi,
  /pwd\s*[=:]\s*['"]?[^\s'"]+['"]?/gi,
  /secret\s*[=:]\s*['"]?[^\s'"]+['"]?/gi,

  // Credit cards (basic patterns)
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,

  // SSN (US)
  /\b\d{3}-\d{2}-\d{4}\b/g,

  // Private keys
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
  /-----BEGIN\s+(?:EC\s+)?PRIVATE\s+KEY-----/g,

  // AWS credentials
  /AKIA[0-9A-Z]{16}/g,
  /aws_secret_access_key\s*[=:]\s*['"]?[^\s'"]+['"]?/gi,

  // Database connection strings with passwords
  /(?:mysql|postgres|mongodb):\/\/[^:]+:[^@]+@/gi,
];

export interface SanitizeResult {
  isSafe: boolean;
  sanitizedText: string;
  detectedPatterns: string[];
}

/**
 * Check if text contains sensitive data patterns
 */
export function containsSensitiveData(text: string): boolean {
  for (const pattern of SENSITIVE_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Sanitize text by removing or redacting sensitive data
 * Returns null if the text is too sensitive to store
 */
export function sanitizeText(text: string): SanitizeResult {
  const detectedPatterns: string[] = [];
  let sanitizedText = text;

  for (const pattern of SENSITIVE_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      detectedPatterns.push(pattern.source.substring(0, 30) + '...');
      // Replace matches with [REDACTED]
      pattern.lastIndex = 0;
      sanitizedText = sanitizedText.replace(pattern, '[REDACTED]');
    }
  }

  const isSafe = detectedPatterns.length === 0;

  if (!isSafe) {
    logger.warn('Sensitive data detected and redacted', {
      patternsFound: detectedPatterns.length,
    });
  }

  return {
    isSafe,
    sanitizedText,
    detectedPatterns,
  };
}

/**
 * Check if a fact should be stored (not containing sensitive data)
 */
export function isFactSafe(fact: string): boolean {
  return !containsSensitiveData(fact);
}
