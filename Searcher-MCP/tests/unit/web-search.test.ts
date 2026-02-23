import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWebSearch = vi.fn();

vi.mock('../../src/services/brave.js', () => ({
  webSearch: (...args: unknown[]) => mockWebSearch(...args),
}));

import { webSearchSchema, handleWebSearch } from '../../src/tools/web-search.js';

describe('web-search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('webSearchSchema', () => {
    it('accepts valid input', () => {
      const result = webSearchSchema.safeParse({ query: 'test' });
      expect(result.success).toBe(true);
    });

    it('rejects missing query', () => {
      const result = webSearchSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('normalizes "day" to "24h"', () => {
      const result = webSearchSchema.safeParse({ query: 'test', freshness: 'day' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.freshness).toBe('24h');
    });

    it('normalizes "7d" to "week"', () => {
      const result = webSearchSchema.safeParse({ query: 'test', freshness: '7d' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.freshness).toBe('week');
    });

    it('normalizes "365d" to "year"', () => {
      const result = webSearchSchema.safeParse({ query: 'test', freshness: '365d' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.freshness).toBe('year');
    });

    it('rejects invalid freshness value', () => {
      const result = webSearchSchema.safeParse({ query: 'test', freshness: 'yesterday' });
      expect(result.success).toBe(false);
    });

    it('defaults count to 10 and safesearch to "moderate"', () => {
      const result = webSearchSchema.safeParse({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.count).toBe(10);
        expect(result.data.safesearch).toBe('moderate');
      }
    });
  });

  describe('handleWebSearch', () => {
    it('maps Brave results to WebSearchResult format', async () => {
      mockWebSearch.mockResolvedValueOnce({
        query: { original: 'test query' },
        web: {
          results: [
            { title: 'Result 1', url: 'https://example.com', description: 'Desc 1', age: '2h' },
          ],
        },
      });

      const input = webSearchSchema.parse({ query: 'test query' });
      const data = await handleWebSearch(input);

      expect(data.results).toHaveLength(1);
      expect(data.results[0].title).toBe('Result 1');
      expect(data.results[0].url).toBe('https://example.com');
      expect(data.results[0].description).toBe('Desc 1');
      expect(data.results[0].age).toBe('2h');
      expect(data.total_count).toBe(1);
      expect(data.query).toBe('test query');
    });

    it('extracts age from page_age when age is missing', async () => {
      mockWebSearch.mockResolvedValueOnce({
        query: { original: 'test' },
        web: {
          results: [
            { title: 'R1', url: 'https://a.com', description: 'd', page_age: '3 days ago' },
          ],
        },
      });

      const input = webSearchSchema.parse({ query: 'test' });
      const data = await handleWebSearch(input);

      expect(data.results[0].age).toBe('3 days ago');
    });

    it('includes extra_snippets when present', async () => {
      mockWebSearch.mockResolvedValueOnce({
        query: { original: 'test' },
        web: {
          results: [
            {
              title: 'R1', url: 'https://a.com', description: 'd',
              extra_snippets: ['snippet 1', 'snippet 2'],
            },
          ],
        },
      });

      const input = webSearchSchema.parse({ query: 'test' });
      const data = await handleWebSearch(input);

      expect(data.results[0].extra_snippets).toEqual(['snippet 1', 'snippet 2']);
    });

    it('includes infobox results when present', async () => {
      mockWebSearch.mockResolvedValueOnce({
        query: { original: 'test' },
        web: { results: [] },
        infobox: {
          results: [
            { title: 'Wikipedia', description: 'An article', long_desc: 'Longer description' },
          ],
        },
      });

      const input = webSearchSchema.parse({ query: 'test' });
      const data = await handleWebSearch(input);

      expect(data.infobox).toHaveLength(1);
      expect(data.infobox![0].title).toBe('Wikipedia');
      expect(data.infobox![0].long_desc).toBe('Longer description');
    });

    it('handles empty web results', async () => {
      mockWebSearch.mockResolvedValueOnce({
        query: { original: 'obscure query' },
        web: { results: [] },
      });

      const input = webSearchSchema.parse({ query: 'obscure query' });
      const data = await handleWebSearch(input);

      expect(data.results).toEqual([]);
      expect(data.total_count).toBe(0);
    });
  });
});
