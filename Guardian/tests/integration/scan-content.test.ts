/**
 * Integration tests for scan_content tool
 *
 * Detection-specific tests (prompt injection, jailbreak, nested threats)
 * are calibrated for Ollama's granite-guardian model. When using Groq/Llama Guard,
 * these are skipped — Groq-specific detection tests live in groq-provider.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  connect,
  disconnect,
  checkHealth,
  scanContent,
  log,
} from "../helpers/mcp-client.js";
import {
  SAFE_PROMPTS,
  PROMPT_INJECTION,
  JAILBREAK,
  SOCIAL_ENGINEERING,
  NESTED_THREATS,
  EDGE_CASES,
} from "../fixtures/prompts.js";

// Ollama-specific detection tests are skipped when using Groq provider.
// Groq/Llama Guard has different detection characteristics — see groq-provider.test.ts.
const usingGroq = !!process.env.GROQ_API_KEY;

describe("scan_content", () => {
  beforeAll(async () => {
    log("Connecting to Guardian MCP server...");
    await connect();
    log("Connected");
  });

  afterAll(async () => {
    log("Disconnecting...");
    await disconnect();
    log("Disconnected");
  });

  describe("health check", () => {
    it("should return healthy status", async () => {
      // When using Groq provider, Ollama health check is not relevant
      if (process.env.GROQ_API_KEY) {
        log("Using Groq provider — skipping Ollama health check");
        return;
      }

      const health = await checkHealth();
      log(`Health: ${JSON.stringify(health)}`);

      expect(health.status).toBe("healthy");
      expect(health.ollama).toBe("connected");
      expect(health.model).toBe("guardian");
    });
  });

  describe("safe content", () => {
    // Note: The Guardian model may be conservative and flag some safe content.
    // These tests verify the response structure rather than exact safe/unsafe results.

    it("should return valid response for greeting", async () => {
      const result = await scanContent({ content: SAFE_PROMPTS.greeting });
      log(`Greeting scan: safe=${result.safe}, confidence=${result.confidence}`);

      expect(result.scan_id).toBeDefined();
      expect(typeof result.safe).toBe("boolean");
      expect(typeof result.confidence).toBe("number");
      expect(Array.isArray(result.threats)).toBe(true);
    });

    it("should return valid response for question", async () => {
      const result = await scanContent({ content: SAFE_PROMPTS.question });

      expect(result.scan_id).toBeDefined();
      expect(typeof result.safe).toBe("boolean");
    });

    it("should return valid response for code snippet", async () => {
      const result = await scanContent({ content: SAFE_PROMPTS.code });

      expect(result.scan_id).toBeDefined();
      expect(typeof result.safe).toBe("boolean");
    });

    it("should handle unicode content", async () => {
      const result = await scanContent({ content: SAFE_PROMPTS.unicode });

      expect(result.scan_id).toBeDefined();
      expect(typeof result.safe).toBe("boolean");
    });

    it("should handle email object structure", async () => {
      const result = await scanContent({
        content: SAFE_PROMPTS.email,
        source: "email",
      });

      expect(result.scan_id).toBeDefined();
      expect(typeof result.safe).toBe("boolean");
    });
  });

  describe("prompt injection detection (Ollama)", () => {
    it("should detect ignore instructions attack", async () => {
      if (usingGroq) { log("Skipped (Groq) — see groq-provider.test.ts"); return; }

      const result = await scanContent({
        content: PROMPT_INJECTION.ignoreInstructions,
      });
      log(`Prompt injection: safe=${result.safe}, threats=${result.threats.length}, types=${result.threats.map(t => t.type).join(",")}`);

      expect(result.safe).toBe(false);
      expect(result.threats.length).toBeGreaterThan(0);
    });

    it("should detect override rules attack", async () => {
      if (usingGroq) { log("Skipped (Groq)"); return; }

      const result = await scanContent({
        content: PROMPT_INJECTION.overrideRules,
      });

      expect(result.safe).toBe(false);
      expect(result.threats.length).toBeGreaterThan(0);
    });

    it("should detect hidden command attack", async () => {
      if (usingGroq) { log("Skipped (Groq)"); return; }

      const result = await scanContent({
        content: PROMPT_INJECTION.hiddenCommand,
      });

      expect(result.safe).toBe(false);
    });
  });

  describe("jailbreak detection (Ollama)", () => {
    it("should detect DAN jailbreak", async () => {
      if (usingGroq) { log("Skipped (Groq) — see groq-provider.test.ts"); return; }

      const result = await scanContent({ content: JAILBREAK.dan });
      log(`Jailbreak DAN: safe=${result.safe}, types=${result.threats.map(t => t.type).join(",")}`);

      expect(result.safe).toBe(false);
      expect(result.threats.length).toBeGreaterThan(0);
    });

    it("should detect developer mode jailbreak", async () => {
      if (usingGroq) { log("Skipped (Groq)"); return; }

      const result = await scanContent({ content: JAILBREAK.devMode });

      expect(result.safe).toBe(false);
    });
  });

  describe("social engineering detection", () => {
    it("should detect CEO fraud", async () => {
      const result = await scanContent({
        content: SOCIAL_ENGINEERING.ceoFraud,
      });
      log(`CEO fraud: safe=${result.safe}, types=${result.threats.map(t => t.type).join(",")}`);

      expect(result.safe).toBe(false);
      expect(result.threats.length).toBeGreaterThan(0);
      // Threat type may vary - just verify it's detected as unsafe
    });

    it("should detect phishing attempt", async () => {
      const result = await scanContent({
        content: SOCIAL_ENGINEERING.phishing,
      });

      expect(result.safe).toBe(false);
    });
  });

  describe("object and array input (Ollama)", () => {
    it("should detect threat in nested object", async () => {
      if (usingGroq) { log("Skipped (Groq) — nested payloads too subtle for Llama Guard"); return; }

      const result = await scanContent({
        content: NESTED_THREATS.emailWithHiddenThreat,
      });
      log(`Nested threat: safe=${result.safe}, paths=${result.threats.map((t) => t.path).join(", ")}`);

      expect(result.safe).toBe(false);
      expect(result.threats.some((t) => t.path.includes("hidden"))).toBe(true);
    });

    it("should detect threat in array", async () => {
      if (usingGroq) { log("Skipped (Groq)"); return; }

      const result = await scanContent({
        content: NESTED_THREATS.arrayWithThreat,
      });
      log(`Array threat: paths=${result.threats.map((t) => t.path).join(", ")}`);

      expect(result.safe).toBe(false);
      expect(result.threats.some((t) => t.path.includes("[2]"))).toBe(true);
    });

    it("should detect deeply nested threat", async () => {
      if (usingGroq) { log("Skipped (Groq)"); return; }

      const result = await scanContent({
        content: NESTED_THREATS.deeplyNested,
      });

      expect(result.safe).toBe(false);
      expect(result.threats.some((t) => t.path.includes("level3"))).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle empty content", async () => {
      const result = await scanContent({ content: EDGE_CASES.empty });

      expect(result.safe).toBe(true);
      expect(result.explanation).toContain("No text content");
    });

    it("should handle whitespace only", async () => {
      const result = await scanContent({ content: EDGE_CASES.whitespace });

      // Whitespace-only is trimmed to empty, so should be safe
      expect(result.safe).toBe(true);
    });

    it("should handle emojis without error", async () => {
      const result = await scanContent({ content: EDGE_CASES.emojis });

      // Just verify no error and valid response structure
      expect(result.scan_id).toBeDefined();
      expect(typeof result.safe).toBe("boolean");
    });

    it("should handle very long content without timeout", async () => {
      const result = await scanContent({ content: EDGE_CASES.veryLong });

      // Just verify response returned within timeout
      expect(result.scan_id).toBeDefined();
      expect(typeof result.safe).toBe("boolean");
    }, 60000); // 60s timeout for long content
  });

  describe("source parameter", () => {
    it("should accept source parameter", async () => {
      const result = await scanContent({
        content: "Hello world",
        source: "email",
      });

      // Verify response structure - source is for logging
      expect(result.scan_id).toBeDefined();
      expect(typeof result.safe).toBe("boolean");
    });

    it("should accept context parameter", async () => {
      const result = await scanContent({
        content: "Hello world",
        source: "web",
        context: "User submitted form",
      });

      expect(result.scan_id).toBeDefined();
      expect(typeof result.safe).toBe("boolean");
    });
  });
});
