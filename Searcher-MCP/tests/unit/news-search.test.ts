import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNewsSearch = vi.fn();

vi.mock('../../src/services/brave.js', () => ({
  newsSearch: (...args: unknown[]) => mockNewsSearch(...args),
}));

import { newsSearchSchema, handleNewsSearch } from '../../src/tools/news-search.js';

describe('news-search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('newsSearchSchema', () => {
    it('accepts valid input', () => {
      const result = newsSearchSchema.safeParse({ query: 'breaking news' });
      expect(result.success).toBe(true);
    });

    it('rejects "year" freshness (news only supports 24h/week/month)', () => {
      const result = newsSearchSchema.safeParse({ query: 'test', freshness: 'year' });
      expect(result.success).toBe(false);
    });

    it('normalizes "today" to "24h"', () => {
      const result = newsSearchSchema.safeParse({ query: 'test', freshness: 'today' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.freshness).toBe('24h');
    });

    it('normalizes "30d" to "month"', () => {
      const result = newsSearchSchema.safeParse({ query: 'test', freshness: '30d' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.freshness).toBe('month');
    });

    it('defaults count to 10', () => {
      const result = newsSearchSchema.safeParse({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.count).toBe(10);
    });

    it('rejects invalid freshness value', () => {
      const result = newsSearchSchema.safeParse({ query: 'test', freshness: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('handleNewsSearch', () => {
    it('maps Brave results to NewsResult format', async () => {
      mockNewsSearch.mockResolvedValueOnce({
        query: { original: 'tech news' },
        results: [
          {
            title: 'Breaking: Tech Update',
            url: 'https://news.example.com/article',
            description: 'Major update released',
            age: '1h',
            meta_url: { scheme: 'https', netloc: 'news.example.com', hostname: 'news.example.com' },
          },
        ],
      });

      const input = newsSearchSchema.parse({ query: 'tech news' });
      const data = await handleNewsSearch(input);

      expect(data.results).toHaveLength(1);
      expect(data.results[0].title).toBe('Breaking: Tech Update');
      expect(data.results[0].source).toBe('news.example.com');
      expect(data.results[0].age).toBe('1h');
      expect(data.total_count).toBe(1);
      expect(data.query).toBe('tech news');
    });

    it('extracts source from meta_url.hostname', async () => {
      mockNewsSearch.mockResolvedValueOnce({
        query: { original: 'test' },
        results: [
          {
            title: 'T', url: 'https://a.com', description: 'd', age: '2h',
            meta_url: { scheme: 'https', netloc: 'www.bbc.com', hostname: 'www.bbc.com' },
          },
        ],
      });

      const input = newsSearchSchema.parse({ query: 'test' });
      const data = await handleNewsSearch(input);

      expect(data.results[0].source).toBe('www.bbc.com');
    });

    it('extracts thumbnail URL when present', async () => {
      mockNewsSearch.mockResolvedValueOnce({
        query: { original: 'test' },
        results: [
          {
            title: 'T', url: 'https://a.com', description: 'd', age: '1h',
            meta_url: { scheme: 'https', netloc: 'a.com', hostname: 'a.com' },
            thumbnail: { src: 'https://img.example.com/thumb.jpg' },
          },
        ],
      });

      const input = newsSearchSchema.parse({ query: 'test' });
      const data = await handleNewsSearch(input);

      expect(data.results[0].thumbnail).toBe('https://img.example.com/thumb.jpg');
    });

    it('includes breaking flag', async () => {
      mockNewsSearch.mockResolvedValueOnce({
        query: { original: 'test' },
        results: [
          {
            title: 'T', url: 'https://a.com', description: 'd', age: '5m',
            meta_url: { scheme: 'https', netloc: 'a.com', hostname: 'a.com' },
            breaking: true,
          },
        ],
      });

      const input = newsSearchSchema.parse({ query: 'test' });
      const data = await handleNewsSearch(input);

      expect(data.results[0].breaking).toBe(true);
    });

    it('handles empty results', async () => {
      mockNewsSearch.mockResolvedValueOnce({
        query: { original: 'obscure' },
        results: [],
      });

      const input = newsSearchSchema.parse({ query: 'obscure' });
      const data = await handleNewsSearch(input);

      expect(data.results).toEqual([]);
      expect(data.total_count).toBe(0);
    });
  });
});
