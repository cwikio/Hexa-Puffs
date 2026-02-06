/**
 * Searcher MCP Integration Tests
 * Comprehensive test suite covering health, tools, validation, and error handling
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  checkHealth,
  getHealthData,
  listTools,
  tools,
  callTool,
  logSection,
  logInfo,
  SEARCHER_URL,
} from "../helpers/mcp-client.js";
import {
  validQueries,
  invalidInputs,
  expectedResponseStructure,
  unknownToolName,
} from "../fixtures/search-queries.js";

// Delay between tests to avoid rate limiting (Free plan: 1 req/sec)
const RATE_LIMIT_DELAY = 1100;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Searcher MCP Tests", () => {
  // Add delay between tests to respect rate limits
  beforeEach(async () => {
    await sleep(RATE_LIMIT_DELAY);
  });
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. Health & Initialization
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("1. Health & Initialization", () => {
    it("1.1 should respond to health check with 200 OK", async () => {
      logSection(`Searcher MCP Tests (${SEARCHER_URL})`);
      const isHealthy = await checkHealth();
      expect(isHealthy).toBe(true);
    });

    it("1.2 should return correct health data structure", async () => {
      const healthData = await getHealthData();
      expect(healthData).not.toBeNull();
      expect(healthData?.status).toBe("healthy");
      expect(healthData?.transport).toBe("http");
      expect(typeof healthData?.port).toBe("number");
    });

    it("1.3 should list available tools", async () => {
      const toolsList = await listTools();
      expect(toolsList).not.toBeNull();
      expect(toolsList?.tools).toBeInstanceOf(Array);
      expect(toolsList?.tools.length).toBe(2);

      const toolNames = toolsList?.tools.map((t) => t.name) || [];
      expect(toolNames).toContain("web_search");
      expect(toolNames).toContain("news_search");
    });

    it("1.4 should have correct tool schemas", async () => {
      const toolsList = await listTools();

      const webSearch = toolsList?.tools.find((t) => t.name === "web_search");
      expect(webSearch?.description).toContain("web");
      expect(webSearch?.inputSchema).toBeDefined();

      const newsSearch = toolsList?.tools.find((t) => t.name === "news_search");
      expect(newsSearch?.description).toContain("news");
      expect(newsSearch?.inputSchema).toBeDefined();
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. Web Search Tool - Basic Operations
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("2. Web Search - Basic Operations", () => {
    it("2.1 should execute simple web search", async () => {
      logSection("Web Search Tests");
      const result = await tools.webSearch(validQueries.simple);
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.data?.results).toBeInstanceOf(Array);
      expect(result.data?.data?.query).toBe(validQueries.simple);
    });

    it("2.2 should return results with correct structure", async () => {
      const result = await tools.webSearch(validQueries.multiWord);
      expect(result.success).toBe(true);

      const data = result.data?.data;
      expect(data).toBeDefined();

      // Check required fields
      for (const field of expectedResponseStructure.webSearch.requiredFields) {
        expect(data).toHaveProperty(field);
      }

      // Check result structure if results exist
      if (data?.results && data.results.length > 0) {
        const firstResult = data.results[0];
        for (const field of expectedResponseStructure.webSearch.resultFields) {
          expect(firstResult).toHaveProperty(field);
        }
        expect(typeof firstResult.title).toBe("string");
        expect(typeof firstResult.url).toBe("string");
        expect(typeof firstResult.description).toBe("string");
      }
    });

    it("2.3 should handle query with special characters", async () => {
      const result = await tools.webSearch(validQueries.withSpecialChars);
      expect(result.success).toBe(true);
      expect(result.data?.data?.query).toBe(validQueries.withSpecialChars);
    });

    it("2.4 should handle unicode queries", async () => {
      const result = await tools.webSearch(validQueries.unicode);
      expect(result.success).toBe(true);
    });

    it("2.5 should return total_count matching results length", async () => {
      const result = await tools.webSearch(validQueries.simple, { count: 5 });
      expect(result.success).toBe(true);

      const data = result.data?.data;
      if (data?.results) {
        expect(data.total_count).toBe(data.results.length);
      }
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. Web Search - Count Parameter
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("3. Web Search - Count Parameter", () => {
    it("3.1 should use default count (10) when not specified", async () => {
      const result = await tools.webSearch(validQueries.simple);
      expect(result.success).toBe(true);
      // Default is 10, results may be less if fewer available
      expect(result.data?.data?.results?.length).toBeLessThanOrEqual(10);
    });

    it("3.2 should respect count=1", async () => {
      const result = await tools.webSearch(validQueries.simple, { count: 1 });
      expect(result.success).toBe(true);
      expect(result.data?.data?.results?.length).toBeLessThanOrEqual(1);
    });

    it("3.3 should respect count=5", async () => {
      const result = await tools.webSearch(validQueries.simple, { count: 5 });
      expect(result.success).toBe(true);
      expect(result.data?.data?.results?.length).toBeLessThanOrEqual(5);
    });

    it("3.4 should respect count=20 (maximum)", async () => {
      const result = await tools.webSearch(validQueries.simple, { count: 20 });
      expect(result.success).toBe(true);
      expect(result.data?.data?.results?.length).toBeLessThanOrEqual(20);
    });

    it("3.5 should reject count=0 (below minimum)", async () => {
      const result = await tools.webSearchRaw({
        query: validQueries.simple,
        count: 0,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(
        invalidInputs.invalidCount.tooLow.expectedErrorPattern
      );
    });

    it("3.6 should reject count=25 (above maximum)", async () => {
      const result = await tools.webSearchRaw({
        query: validQueries.simple,
        count: 25,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(
        invalidInputs.invalidCount.tooHigh.expectedErrorPattern
      );
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4. Web Search - Freshness Parameter
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("4. Web Search - Freshness Parameter", () => {
    it("4.1 should accept freshness=24h", async () => {
      const result = await tools.webSearch(validQueries.trending, {
        freshness: "24h",
      });
      expect(result.success).toBe(true);
    });

    it("4.2 should accept freshness=week", async () => {
      const result = await tools.webSearch(validQueries.trending, {
        freshness: "week",
      });
      expect(result.success).toBe(true);
    });

    it("4.3 should accept freshness=month", async () => {
      const result = await tools.webSearch(validQueries.trending, {
        freshness: "month",
      });
      expect(result.success).toBe(true);
    });

    it("4.4 should accept freshness=year", async () => {
      const result = await tools.webSearch(validQueries.simple, {
        freshness: "year",
      });
      expect(result.success).toBe(true);
    });

    it("4.5 should reject invalid freshness value", async () => {
      const result = await tools.webSearchRaw({
        query: validQueries.simple,
        freshness: "invalid",
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(
        invalidInputs.invalidFreshness.webSearch.expectedErrorPattern
      );
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 5. Web Search - Safesearch Parameter
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("5. Web Search - Safesearch Parameter", () => {
    it("5.1 should use default safesearch=moderate when not specified", async () => {
      const result = await tools.webSearch(validQueries.simple);
      expect(result.success).toBe(true);
    });

    it("5.2 should accept safesearch=off", async () => {
      const result = await tools.webSearch(validQueries.simple, {
        safesearch: "off",
      });
      expect(result.success).toBe(true);
    });

    it("5.3 should accept safesearch=moderate", async () => {
      const result = await tools.webSearch(validQueries.simple, {
        safesearch: "moderate",
      });
      expect(result.success).toBe(true);
    });

    it("5.4 should accept safesearch=strict", async () => {
      const result = await tools.webSearch(validQueries.simple, {
        safesearch: "strict",
      });
      expect(result.success).toBe(true);
    });

    it("5.5 should reject invalid safesearch value", async () => {
      const result = await tools.webSearchRaw({
        query: validQueries.simple,
        safesearch: "invalid",
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(
        invalidInputs.invalidSafesearch.expectedErrorPattern
      );
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 6. News Search Tool - Basic Operations
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("6. News Search - Basic Operations", () => {
    it("6.1 should execute simple news search", async () => {
      logSection("News Search Tests");
      const result = await tools.newsSearch(validQueries.newsWorthy);
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.data?.results).toBeInstanceOf(Array);
      expect(result.data?.data?.query).toBe(validQueries.newsWorthy);
    });

    it("6.2 should return results with correct structure", async () => {
      const result = await tools.newsSearch(validQueries.trending);
      expect(result.success).toBe(true);

      const data = result.data?.data;
      expect(data).toBeDefined();

      // Check required fields
      for (const field of expectedResponseStructure.newsSearch.requiredFields) {
        expect(data).toHaveProperty(field);
      }

      // Check result structure if results exist
      if (data?.results && data.results.length > 0) {
        const firstResult = data.results[0];
        for (const field of expectedResponseStructure.newsSearch.resultFields) {
          expect(firstResult).toHaveProperty(field);
        }
        expect(typeof firstResult.title).toBe("string");
        expect(typeof firstResult.url).toBe("string");
        expect(typeof firstResult.source).toBe("string");
        expect(typeof firstResult.age).toBe("string");
      }
    });

    it("6.3 should handle query with numbers", async () => {
      const result = await tools.newsSearch(validQueries.withNumbers);
      expect(result.success).toBe(true);
    });

    it("6.4 should return total_count matching results length", async () => {
      const result = await tools.newsSearch(validQueries.newsWorthy, {
        count: 5,
      });
      expect(result.success).toBe(true);

      const data = result.data?.data;
      if (data?.results) {
        expect(data.total_count).toBe(data.results.length);
      }
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 7. News Search - Count Parameter
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("7. News Search - Count Parameter", () => {
    it("7.1 should use default count (10) when not specified", async () => {
      const result = await tools.newsSearch(validQueries.newsWorthy);
      expect(result.success).toBe(true);
      expect(result.data?.data?.results?.length).toBeLessThanOrEqual(10);
    });

    it("7.2 should respect count=1", async () => {
      const result = await tools.newsSearch(validQueries.newsWorthy, {
        count: 1,
      });
      expect(result.success).toBe(true);
      expect(result.data?.data?.results?.length).toBeLessThanOrEqual(1);
    });

    it("7.3 should respect count=20 (maximum)", async () => {
      const result = await tools.newsSearch(validQueries.newsWorthy, {
        count: 20,
      });
      expect(result.success).toBe(true);
      expect(result.data?.data?.results?.length).toBeLessThanOrEqual(20);
    });

    it("7.4 should reject count=0 (below minimum)", async () => {
      const result = await tools.newsSearchRaw({
        query: validQueries.newsWorthy,
        count: 0,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(
        invalidInputs.invalidCount.tooLow.expectedErrorPattern
      );
    });

    it("7.5 should reject count above maximum", async () => {
      const result = await tools.newsSearchRaw({
        query: validQueries.newsWorthy,
        count: 25,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(
        invalidInputs.invalidCount.tooHigh.expectedErrorPattern
      );
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 8. News Search - Freshness Parameter
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("8. News Search - Freshness Parameter", () => {
    it("8.1 should accept freshness=24h", async () => {
      const result = await tools.newsSearch(validQueries.newsWorthy, {
        freshness: "24h",
      });
      expect(result.success).toBe(true);
    });

    it("8.2 should accept freshness=week", async () => {
      const result = await tools.newsSearch(validQueries.newsWorthy, {
        freshness: "week",
      });
      expect(result.success).toBe(true);
    });

    it("8.3 should accept freshness=month", async () => {
      const result = await tools.newsSearch(validQueries.newsWorthy, {
        freshness: "month",
      });
      expect(result.success).toBe(true);
    });

    it("8.4 should reject freshness=year (not supported for news)", async () => {
      const result = await tools.newsSearchRaw({
        query: validQueries.newsWorthy,
        freshness: "year",
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(
        invalidInputs.invalidFreshness.newsSearch.expectedErrorPattern
      );
    });

    it("8.5 should reject invalid freshness value", async () => {
      const result = await tools.newsSearchRaw({
        query: validQueries.newsWorthy,
        freshness: "invalid",
      });
      expect(result.success).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 9. Input Validation - Missing/Invalid Query
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("9. Input Validation - Query Parameter", () => {
    it("9.1 should reject web_search without query", async () => {
      logSection("Input Validation Tests");
      const result = await tools.webSearchRaw({});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(
        invalidInputs.missingQuery.expectedErrorPattern
      );
    });

    it("9.2 should reject news_search without query", async () => {
      const result = await tools.newsSearchRaw({});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(
        invalidInputs.missingQuery.expectedErrorPattern
      );
    });

    it("9.3 should reject web_search with null query", async () => {
      const result = await tools.webSearchRaw({ query: null });
      expect(result.success).toBe(false);
    });

    it("9.4 should reject news_search with null query", async () => {
      const result = await tools.newsSearchRaw({ query: null });
      expect(result.success).toBe(false);
    });

    it("9.5 should reject web_search with number query", async () => {
      const result = await tools.webSearchRaw({ query: 12345 });
      expect(result.success).toBe(false);
    });

    it("9.6 should reject news_search with object query", async () => {
      const result = await tools.newsSearchRaw({ query: { text: "test" } });
      expect(result.success).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 10. Error Handling
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("10. Error Handling", () => {
    it("10.1 should return 404 for unknown tool", async () => {
      logSection("Error Handling Tests");
      const result = await callTool(unknownToolName, { query: "test" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/unknown|not found|404/i);
    });

    it("10.2 should return proper error format for validation failures", async () => {
      const result = await tools.webSearchRaw({ count: 100 });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe("string");
    });

    it("10.3 should handle malformed JSON gracefully", async () => {
      const response = await fetch(`${SEARCHER_URL}/tools/call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{ invalid json }",
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it("10.4 should return 404 for non-existent endpoint", async () => {
      const response = await fetch(`${SEARCHER_URL}/nonexistent`);
      expect(response.status).toBe(404);
    });

    it("10.5 should handle OPTIONS request (CORS preflight)", async () => {
      const response = await fetch(`${SEARCHER_URL}/tools/call`, {
        method: "OPTIONS",
      });
      expect(response.status).toBe(204);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 11. Combined Parameters
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("11. Combined Parameters", () => {
    it("11.1 should handle web_search with all parameters", async () => {
      logSection("Combined Parameters Tests");
      const result = await tools.webSearch(validQueries.trending, {
        count: 5,
        freshness: "week",
        safesearch: "strict",
      });
      expect(result.success).toBe(true);
      expect(result.data?.data?.results?.length).toBeLessThanOrEqual(5);
    });

    it("11.2 should handle news_search with all parameters", async () => {
      const result = await tools.newsSearch(validQueries.newsWorthy, {
        count: 3,
        freshness: "24h",
      });
      expect(result.success).toBe(true);
      expect(result.data?.data?.results?.length).toBeLessThanOrEqual(3);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 12. Response Time (Performance)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("12. Response Time", () => {
    it("12.1 should respond to health check within 1 second", async () => {
      logSection("Performance Tests");
      const start = Date.now();
      await checkHealth();
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000);
      logInfo(`Health check completed in ${duration}ms`);
    });

    it("12.2 should complete web search within 10 seconds", async () => {
      const result = await tools.webSearch(validQueries.simple, { count: 5 });
      expect(result.success).toBe(true);
      expect(result.duration).toBeLessThan(10000);
      logInfo(`Web search completed in ${result.duration}ms`);
    });

    it("12.3 should complete news search within 10 seconds", async () => {
      const result = await tools.newsSearch(validQueries.newsWorthy, {
        count: 5,
      });
      expect(result.success).toBe(true);
      expect(result.duration).toBeLessThan(10000);
      logInfo(`News search completed in ${result.duration}ms`);
    });
  });
});
