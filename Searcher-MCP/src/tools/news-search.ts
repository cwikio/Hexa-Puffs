/**
 * news_search tool - Search news using Brave Search
 */

import { z } from "zod";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { newsSearch } from "../services/brave.js";

// Normalize common freshness values to Brave API format (news only supports 24h, week, month)
const normalizeFreshness = (
  value: string | undefined
): "24h" | "week" | "month" | undefined => {
  if (!value) return undefined;
  const normalized = value.toLowerCase().trim();
  const mapping: Record<string, "24h" | "week" | "month"> = {
    "24h": "24h",
    day: "24h",
    today: "24h",
    "1d": "24h",
    week: "week",
    "7d": "week",
    month: "month",
    "30d": "month",
    year: "month", // news doesn't support year, fallback to month
    "1y": "month",
    "365d": "month",
  };
  return mapping[normalized];
};

export const newsSearchSchema = z.object({
  query: z.string().describe("News search query"),
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
    .describe("Filter results by recency (24h, day, week, month)"),
});

export type NewsSearchInput = z.infer<typeof newsSearchSchema>;

export interface NewsResult {
  title: string;
  url: string;
  description: string;
  source: string;
  age: string;
  thumbnail?: string;
  breaking?: boolean;
}

export interface NewsSearchData {
  results: NewsResult[];
  total_count: number;
  query: string;
}

export type NewsSearchToolResult = StandardResponse<NewsSearchData>;

export async function handleNewsSearch(
  input: NewsSearchInput
): Promise<NewsSearchData> {
  const response = await newsSearch({
    query: input.query,
    count: input.count,
    freshness: input.freshness,
  });

  const results: NewsResult[] = (response.results || []).map((result) => ({
    title: result.title,
    url: result.url,
    description: result.description,
    source: result.meta_url.hostname || result.meta_url.netloc,
    age: result.age,
    thumbnail: result.thumbnail?.src,
    breaking: result.breaking,
  }));

  return {
    results,
    total_count: results.length,
    query: response.query.original,
  };
}
