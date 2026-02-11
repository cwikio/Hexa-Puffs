/**
 * Test fixtures for Searcher MCP tests
 */

// Valid search queries for testing
export const validQueries = {
  simple: "TypeScript programming",
  multiWord: "how to learn machine learning",
  withNumbers: "iPhone 15 pro max review",
  withSpecialChars: "c++ vs rust performance 2024",
  unicode: "programming tutorial",
  newsWorthy: "breaking news technology",
  trending: "AI artificial intelligence latest",
};

// Freshness filter test values
export const freshnessValues = {
  webSearch: ["24h", "week", "month", "year"] as const,
  newsSearch: ["24h", "week", "month"] as const,
};

// Safesearch test values (only for web_search)
export const safesearchValues = ["off", "moderate", "strict"] as const;

// Count parameter test values
export const countTestCases = {
  valid: [1, 5, 10, 15, 20],
  invalid: {
    tooLow: 0,
    tooHigh: 21,
    negative: -1,
    nonInteger: 5.5,
  },
};

// Invalid input test cases for validation testing
export const invalidInputs = {
  missingQuery: {
    args: {},
    expectedErrorPattern: /query|required/i,
  },
  emptyQuery: {
    args: { query: "" },
    expectedErrorPattern: /query|empty/i,
  },
  nullQuery: {
    args: { query: null },
    expectedErrorPattern: /query|required|expected/i,
  },
  invalidCount: {
    tooLow: {
      args: { query: "test", count: 0 },
      expectedErrorPattern: /count|minimum|greater/i,
    },
    tooHigh: {
      args: { query: "test", count: 25 },
      expectedErrorPattern: /count|maximum|less/i,
    },
    nonNumber: {
      args: { query: "test", count: "five" },
      expectedErrorPattern: /count|number|expected/i,
    },
  },
  invalidFreshness: {
    webSearch: {
      args: { query: "test", freshness: "invalid" },
      expectedErrorPattern: /freshness|enum|invalid/i,
    },
    newsSearch: {
      // news_search doesn't support "year" freshness
      args: { query: "test", freshness: "year" },
      expectedErrorPattern: /freshness|enum|invalid/i,
    },
  },
  invalidSafesearch: {
    args: { query: "test", safesearch: "invalid" },
    expectedErrorPattern: /safesearch|enum|invalid/i,
  },
};

// URLs for web_fetch testing
export const fetchUrls = {
  simple: "https://example.com",
  httpError404: "https://httpstat.us/404",
  httpError500: "https://httpstat.us/500",
  nonExistent: "https://this-domain-definitely-does-not-exist-xyz.com",
};

// Expected response structure for validation
export const expectedResponseStructure = {
  webSearch: {
    requiredFields: ["results", "total_count", "query"],
    resultFields: ["title", "url", "description"],
    optionalResultFields: ["age"],
  },
  newsSearch: {
    requiredFields: ["results", "total_count", "query"],
    resultFields: ["title", "url", "description", "source", "age"],
    optionalResultFields: ["thumbnail", "breaking"],
  },
  webFetch: {
    requiredFields: ["url", "title", "content", "contentLength", "truncated"],
  },
};

// Unknown tool test case
export const unknownToolName = "unknown_tool_xyz";
