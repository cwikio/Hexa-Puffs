/**
 * image_search tool - Search images using Brave Search
 */

import { z } from "zod";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { imageSearch } from "../services/brave.js";

export const imageSearchSchema = z.object({
  query: z.string().describe("Image search query"),
  count: z
    .coerce.number()
    .default(5)
    .transform((v) => Math.max(1, Math.min(20, v)))
    .describe("Number of results (1-20, default 5)"),
  safesearch: z
    .enum(["off", "strict"])
    .default("strict")
    .describe("Safe search level (Brave image API only supports 'off' or 'strict')"),
});

export type ImageSearchInput = z.infer<typeof imageSearchSchema>;

export interface ImageSearchResult {
  title: string;
  source_url: string;
  image_url: string;
  thumbnail_url: string;
  source: string;
}

export interface ImageSearchData {
  results: ImageSearchResult[];
  total_count: number;
  query: string;
}

export type ImageSearchToolResult = StandardResponse<ImageSearchData>;

export async function handleImageSearch(
  input: ImageSearchInput
): Promise<ImageSearchData> {
  const response = await imageSearch({
    query: input.query,
    count: input.count,
    safesearch: input.safesearch,
  });

  const results: ImageSearchResult[] = (response.results || []).map(
    (result) => ({
      title: result.title,
      source_url: result.url,
      image_url: result.properties.url,
      thumbnail_url: result.thumbnail.src,
      source: result.source,
    })
  );

  return {
    results,
    total_count: results.length,
    query: response.query.original,
  };
}
