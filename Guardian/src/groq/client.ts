/**
 * Groq API client for Guardian security scanning
 * Uses Llama Guard for content safety classification
 */

import { type GuardianScanResult } from "../ollama/client.js";
import { waitForRateLimit } from "./rate-limiter.js";
import { Logger } from "@mcp/shared/Utils/logger.js";

const logger = new Logger('guardian:groq');

export type { GuardianScanResult };

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_BASE_URL =
  process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const MODEL_NAME = process.env.GROQ_MODEL || "meta-llama/llama-guard-4-12b";

interface GroqChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Map Llama Guard safety categories to Guardian threat types.
 */
const CATEGORY_MAP: Record<string, string> = {
  S1: "harmful_content",
  S2: "harmful_content",
  S3: "harmful_content",
  S4: "harmful_content",
  S5: "social_engineering",
  S6: "harmful_content",
  S7: "data_exfiltration",
  S8: "harmful_content",
  S9: "harmful_content",
  S10: "harmful_content",
  S11: "harmful_content",
  S12: "harmful_content",
  S13: "harmful_content",
  S14: "prompt_injection",
};

/**
 * Categories that should actually block tool calls in the MCP context.
 * Other categories (e.g., S8 Intellectual Property) produce false positives
 * on normal tool I/O like file paths, JSON data, email content.
 */
const BLOCKING_CATEGORIES = new Set([
  "S1",  // Violent Crimes
  "S2",  // Non-Violent Crimes
  "S3",  // Sex-Related Crimes
  "S4",  // Child Sexual Exploitation
  "S5",  // Defamation / Social Engineering
  "S7",  // Privacy / Data Exfiltration
  "S9",  // Indiscriminate Weapons
  "S14", // Code Interpreter Abuse / Prompt Injection
]);

import { GroqClientError } from '../errors.js';

/**
 * Check if Groq API is accessible
 */
export async function healthCheck(): Promise<boolean> {
  if (!GROQ_API_KEY) return false;
  try {
    const response = await fetch(`${GROQ_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if the configured model is available
 */
export async function isModelLoaded(): Promise<boolean> {
  if (!GROQ_API_KEY) return false;
  try {
    const response = await fetch(`${GROQ_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as {
      data: Array<{ id: string }>;
    };
    return data.data.some((m) => m.id === MODEL_NAME);
  } catch {
    return false;
  }
}

/**
 * Verify Groq API is accessible and model is available
 */
export async function verifyConnection(): Promise<void> {
  if (!GROQ_API_KEY) {
    throw new GroqClientError(
      "GROQ_API_KEY is not set. Add it to Guardian/.env"
    );
  }

  const isHealthy = await healthCheck();
  if (!isHealthy) {
    throw new GroqClientError("Cannot connect to Groq API. Check GROQ_API_KEY.");
  }
}

/**
 * Parse Llama Guard response into threats.
 * Llama Guard outputs "safe" or "unsafe\nS1,S2,..."
 * Only categories in BLOCKING_CATEGORIES actually block; others are logged.
 */
function parseLlamaGuardResponse(content: string): {
  safe: boolean;
  threats: string[];
  categories: string[];
} {
  const trimmed = content.trim().toLowerCase();

  if (trimmed === "safe") {
    return { safe: true, threats: [], categories: [] };
  }

  if (trimmed.startsWith("unsafe")) {
    const lines = trimmed.split("\n");
    const categories: string[] = [];
    const threats: string[] = [];
    let hasBlockingCategory = false;

    for (let i = 1; i < lines.length; i++) {
      const cats = lines[i]
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter((c) => c.startsWith("S"));
      for (const cat of cats) {
        categories.push(cat);
        if (BLOCKING_CATEGORIES.has(cat)) {
          hasBlockingCategory = true;
          const threat = CATEGORY_MAP[cat] || "malicious_content";
          if (!threats.includes(threat)) {
            threats.push(threat);
          }
        }
      }
    }

    // Only block if at least one blocking category was flagged
    if (!hasBlockingCategory) {
      return { safe: true, threats: [], categories };
    }

    if (threats.length === 0) {
      threats.push("malicious_content");
    }

    return { safe: false, threats, categories };
  }

  // Ambiguous response — treat as safe
  return { safe: true, threats: [], categories: [] };
}

/**
 * Send content to Groq for security scanning.
 * Wraps content with context about what we're scanning for.
 */
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

export async function scanWithGuardian(
  content: string,
  context?: string
): Promise<GuardianScanResult> {
  if (!GROQ_API_KEY) {
    throw new GroqClientError("GROQ_API_KEY is not set");
  }

  await waitForRateLimit();

  const sourceContext = context ? ` (source: ${context})` : "";
  const requestBody = JSON.stringify({
    model: MODEL_NAME,
    messages: [
      {
        role: "user",
        content: `${content}${sourceContext}`,
      },
    ],
    temperature: 0,
  });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: requestBody,
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 429 && attempt < MAX_RETRIES) {
      logger.warn(`Groq 429 rate limit — retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new GroqClientError(
        `Groq API error: ${response.status} ${errorBody}`,
        response.status
      );
    }

    const data = (await response.json()) as GroqChatResponse;
    const responseText = data.choices?.[0]?.message?.content || "";

    const { safe, threats, categories } = parseLlamaGuardResponse(responseText);

    return {
      safe,
      confidence: 0.95,
      threats,
      explanation: safe
        ? "Content appears safe"
        : `Llama Guard flagged categories: ${categories.join(", ")}`,
    };
  }

  // All retries exhausted (shouldn't reach here, but satisfies TypeScript)
  throw new GroqClientError("Groq API rate limit exceeded after all retries", 429);
}

/**
 * Get Groq API base URL (for diagnostics)
 */
export function getHost(): string {
  return GROQ_BASE_URL;
}

/**
 * Get model name (for diagnostics)
 */
export function getModelName(): string {
  return MODEL_NAME;
}
