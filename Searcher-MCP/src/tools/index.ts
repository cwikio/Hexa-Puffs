/**
 * Export all tools
 */

export {
  webSearchSchema,
  handleWebSearch,
  type WebSearchInput,
  type WebSearchData,
  type WebSearchToolResult,
  type WebSearchResult,
} from "./web-search.js";

export {
  newsSearchSchema,
  handleNewsSearch,
  type NewsSearchInput,
  type NewsSearchData,
  type NewsSearchToolResult,
  type NewsResult,
} from "./news-search.js";

export {
  imageSearchSchema,
  handleImageSearch,
  type ImageSearchInput,
  type ImageSearchData,
  type ImageSearchToolResult,
  type ImageSearchResult,
} from "./image-search.js";

export {
  webFetchSchema,
  handleWebFetch,
  type WebFetchInput,
  type WebFetchData,
  type WebFetchToolResult,
} from "./web-fetch.js";
