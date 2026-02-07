/**
 * scan_content tool - Scans content for prompt injection attacks
 * Handles strings, objects, and arrays by recursively extracting all string values
 */

import { z } from "zod";
import {
  scanWithGuardian,
  getModelName,
  type GuardianScanResult,
} from "../provider.js";
import {
  generateScanId,
  writeAuditLog,
  createAuditEntry,
  type ThreatInfo,
} from "../logging/audit.js";

// Schema accepts string, object, or array
export const scanContentSchema = z.object({
  content: z.union([
    z.string(),
    z.record(z.any()),
    z.array(z.any()),
  ]).describe("Content to scan - can be a string, object, or array"),
  source: z
    .string()
    .optional()
    .describe("Where the content came from: email, gmail, web, file, etc."),
  context: z
    .string()
    .optional()
    .describe("Additional context about the content"),
});

export type ScanContentInput = z.infer<typeof scanContentSchema>;

export interface ScanContentResult {
  safe: boolean;
  confidence: number;
  threats: ThreatInfo[];
  explanation: string;
  scan_id: string;
}

interface ExtractedString {
  path: string;
  value: string;
}

/**
 * Recursively extract all string values from an object/array with their JSON paths
 */
function extractStrings(data: unknown, path: string = ""): ExtractedString[] {
  const results: ExtractedString[] = [];

  if (typeof data === "string") {
    if (data.trim().length > 0) {
      results.push({ path: path || "root", value: data });
    }
  } else if (Array.isArray(data)) {
    data.forEach((item, index) => {
      const newPath = path ? `${path}[${index}]` : `[${index}]`;
      results.push(...extractStrings(item, newPath));
    });
  } else if (data !== null && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      const newPath = path ? `${path}.${key}` : key;
      results.push(...extractStrings(value, newPath));
    }
  }

  return results;
}

/**
 * Create a snippet from content (first N characters)
 */
function createSnippet(content: string, maxLength: number = 100): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + "...";
}

/**
 * Serialize content to string for hashing
 */
function serializeContent(content: unknown): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

/**
 * Handle scan_content tool
 */
export async function handleScanContent(
  input: ScanContentInput
): Promise<ScanContentResult> {
  const startTime = Date.now();
  const scanId = generateScanId();
  const source = input.source || "unknown";

  // Extract all strings from the content
  const strings = extractStrings(input.content);

  if (strings.length === 0) {
    // No strings to scan
    const result: ScanContentResult = {
      safe: true,
      confidence: 1.0,
      threats: [],
      explanation: "No text content found to scan",
      scan_id: scanId,
    };

    await writeAuditLog(
      createAuditEntry(
        scanId,
        source,
        "",
        0,
        true,
        1.0,
        [],
        getModelName(),
        Date.now() - startTime
      )
    );

    return result;
  }

  // Scan each string and collect threats
  const allThreats: ThreatInfo[] = [];
  let overallSafe = true;
  let minConfidence = 1.0;
  const explanations: string[] = [];

  for (const { path, value } of strings) {
    try {
      const scanResult = await scanWithGuardian(value, input.context);

      if (!scanResult.safe) {
        overallSafe = false;

        // Add threats with path information
        for (const threatType of scanResult.threats) {
          allThreats.push({
            path,
            type: threatType,
            snippet: createSnippet(value),
          });
        }

        explanations.push(`[${path}]: ${scanResult.explanation}`);
      }

      if (scanResult.confidence < minConfidence) {
        minConfidence = scanResult.confidence;
      }
    } catch (error) {
      // If scan fails, mark as unsafe (fail closed)
      overallSafe = false;
      allThreats.push({
        path,
        type: "scan_error",
        snippet: createSnippet(value),
      });
      explanations.push(
        `[${path}]: Scan error - ${error instanceof Error ? error.message : "unknown"}`
      );
    }
  }

  const latencyMs = Date.now() - startTime;
  const serialized = serializeContent(input.content);

  const result: ScanContentResult = {
    safe: overallSafe,
    confidence: minConfidence,
    threats: allThreats,
    explanation: overallSafe
      ? `Scanned ${strings.length} text field(s) - no threats detected`
      : explanations.join("\n"),
    scan_id: scanId,
  };

  // Log to audit
  await writeAuditLog(
    createAuditEntry(
      scanId,
      source,
      serialized,
      serialized.length,
      overallSafe,
      minConfidence,
      allThreats,
      getModelName(),
      latencyMs
    )
  );

  return result;
}
