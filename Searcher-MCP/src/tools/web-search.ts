/**
 * web_search tool - Search the web using Brave Search
 */

import { z } from "zod";
import type { StandardResponse } from "../types/shared.js";
import { webSearch } from "../services/brave.js";

// Normalize common freshness values to Brave API format
const normalizeFreshness = (
  value: string | undefined
): "24h" | "week" | "month" | "year" | undefined => {
  if (!value) return undefined;
  const normalized = value.toLowerCase().trim();
  const mapping: Record<string, "24h" | "week" | "month" | "year"> = {
    "24h": "24h",
    day: "24h",
    today: "24h",
    "1d": "24h",
    week: "week",
    "7d": "week",
    month: "month",
    "30d": "month",
    year: "year",
    "1y": "year",
    "365d": "year",
  };
  return mapping[normalized];
};

export const webSearchSchema = z.object({
  query: z.string().describe("Search query"),
  count: z
    .coerce.number()
    .min(1)
    .max(20)
    .default(10)
    .describe("Number of results (1-20)"),
  freshness: z
    .string()
    .optional()
    .transform(normalizeFreshness)
    .describe("Filter results by recency (24h, day, week, month, year)"),
  safesearch: z
    .enum(["off", "moderate", "strict"])
    .default("moderate")
    .describe("Safe search level"),
});

export type WebSearchInput = z.infer<typeof webSearchSchema>;

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}

export interface WebSearchData {
  results: WebSearchResult[];
  total_count: number;
  query: string;
}

export type WebSearchToolResult = StandardResponse<WebSearchData>;

export async function handleWebSearch(
  input: WebSearchInput
): Promise<WebSearchData> {
  const response = await webSearch({
    query: input.query,
    count: input.count,
    freshness: input.freshness,
    safesearch: input.safesearch,
  });

  const results: WebSearchResult[] = (response.web?.results || []).map(
    (result) => ({
      title: result.title,
      url: result.url,
      description: result.description,
      age: result.age || result.page_age,
    })
  );

  return {
    results,
    total_count: results.length,
    query: response.query.original,
  };
}
