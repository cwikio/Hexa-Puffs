/**
 * Groq API client for the gpt-oss-safeguard-20b model.
 *
 * Uses OpenAI's "bring your own policy" safeguard model which returns
 * structured JSON classifications instead of Llama Guard's text format.
 */

import { type GuardianScanResult } from "../ollama/client.js";
import { GroqClientError } from "../errors.js";
import { waitForRateLimit } from "./rate-limiter.js";
import { MCP_SECURITY_POLICY, SAFEGUARD_CATEGORY_MAP } from "./policies.js";
import { Logger } from "@mcp/shared/Utils/logger.js";

const logger = new Logger('guardian:groq-safeguard');

export type { GuardianScanResult };

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_BASE_URL =
  process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const MODEL_NAME =
  process.env.GROQ_MODEL || "openai/gpt-oss-safeguard-20b";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

interface SafeguardResponse {
  violation: number;
  category: string | null;
  rationale: string;
}

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
 * Verify Groq API is accessible
 */
export async function verifyConnection(): Promise<void> {
  if (!GROQ_API_KEY) {
    throw new GroqClientError(
      "GROQ_API_KEY is not set. Add it to Guardian/.env"
    );
  }

  const isHealthy = await healthCheck();
  if (!isHealthy) {
    throw new GroqClientError(
      "Cannot connect to Groq API. Check GROQ_API_KEY."
    );
  }
}

/**
 * Parse the safeguard model's JSON response into a GuardianScanResult.
 */
function parseSafeguardResponse(content: string): GuardianScanResult {
  let parsed: SafeguardResponse;
  try {
    parsed = JSON.parse(content);
  } catch {
    // If JSON parsing fails, treat as safe (fail open for parse errors)
    return {
      safe: true,
      confidence: 0.5,
      threats: [],
      explanation: "Failed to parse safeguard response",
    };
  }

  const isViolation = parsed.violation === 1;
  const threats: string[] = [];

  if (isViolation && parsed.category) {
    const mappedThreat =
      SAFEGUARD_CATEGORY_MAP[parsed.category] || "malicious_content";
    threats.push(mappedThreat);
  } else if (isViolation) {
    threats.push("malicious_content");
  }

  return {
    safe: !isViolation,
    confidence: 0.95,
    threats,
    explanation: parsed.rationale || (isViolation ? "Policy violation detected" : "Content appears safe"),
  };
}

/**
 * Send content to gpt-oss-safeguard-20b for security scanning.
 */
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
        role: "system",
        content: MCP_SECURITY_POLICY,
      },
      {
        role: "user",
        content: `${content}${sourceContext}`,
      },
    ],
    response_format: { type: "json_object" },
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
      logger.warn(
        `Groq 429 rate limit — retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
      );
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

    return parseSafeguardResponse(responseText);
  }

  throw new GroqClientError(
    "Groq API rate limit exceeded after all retries",
    429
  );
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
