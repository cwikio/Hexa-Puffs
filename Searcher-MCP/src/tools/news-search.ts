/**
 * news_search tool - Search news using Brave Search
 */

import { z } from "zod";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { newsSearch } from "../services/brave.js";

const VALID_NEWS_FRESHNESS = new Set([
  "24h", "day", "today", "1d",
  "week", "7d",
  "month", "30d",
]);

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
    .refine((v) => !v || VALID_NEWS_FRESHNESS.has(v.toLowerCase().trim()), {
      message: "Invalid freshness value. Valid values: 24h, day, week, month (year not supported for news)",
    })
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
