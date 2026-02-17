/**
 * Level 2 Integration Tests: Timeline Query Tool
 * Tests query_timeline across facts, conversations, profile changes, skills, contacts, projects
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import {
  generateTestAgentId,
  getTodayString,
  getTomorrowString,
  getYesterdayString,
} from '../helpers/test-data.js';
import type { TimelineEvent, QueryTimelineData } from '../../src/types/responses.js';

describe('Timeline Query Tool', () => {
  let client: McpClient;
  let testAgentId: string;

  beforeEach(async () => {
    client = new McpClient();
    testAgentId = generateTestAgentId('timeline');

    // Seed test data across multiple tables
    await client.storeFact('User prefers dark mode', 'preference', testAgentId);
    await client.storeFact('User works with TypeScript', 'background', testAgentId);
    await client.storeConversation(
      'Can you help me with my React project?',
      'Of course! What do you need help with?',
      testAgentId,
    );
    await client.storeConversation(
      'I decided to use Prisma for the ORM',
      'Great choice! Prisma provides excellent type safety.',
      testAgentId,
    );
    await client.createContact('Alice Smith', 'alice@example.com', testAgentId, {
      company: 'Acme Corp',
      role: 'Engineer',
    });
    await client.createProject('MCP Timeline', testAgentId, {
      description: 'Temporal indexing feature',
      status: 'active',
    });
    await client.storeSkill(
      'Daily Summary',
      'cron',
      'Summarize the day',
      testAgentId,
    );
  });

  afterEach(() => {
    dbHelper.cleanupAgent(testAgentId);
  });

  describe('basic queries', () => {
    it('should return events from all sources for today', async () => {
      const today = getTodayString();
      const result = await client.queryTimeline(today, testAgentId);

      expect(result.success).toBe(true);
      const data = result.data as QueryTimelineData;
      expect(data.events.length).toBeGreaterThan(0);
      expect(data.sources_queried).toHaveLength(6);
      expect(data.date_range.from).toContain(today);
    });

    it('should include facts in timeline', async () => {
      const today = getTodayString();
      const result = await client.queryTimeline(today, testAgentId);
      const data = result.data as QueryTimelineData;

      const factEvents = data.events.filter((e: TimelineEvent) => e.source === 'facts');
      expect(factEvents.length).toBeGreaterThanOrEqual(2);
      expect(factEvents.some((e: TimelineEvent) => e.summary.includes('dark mode'))).toBe(true);
    });

    it('should include conversations in timeline', async () => {
      const today = getTodayString();
      const result = await client.queryTimeline(today, testAgentId);
      const data = result.data as QueryTimelineData;

      const convEvents = data.events.filter((e: TimelineEvent) => e.source === 'conversations');
      expect(convEvents.length).toBeGreaterThanOrEqual(2);
      expect(convEvents.some((e: TimelineEvent) => e.summary.includes('React'))).toBe(true);
    });

    it('should include contacts in timeline', async () => {
      const today = getTodayString();
      const result = await client.queryTimeline(today, testAgentId);
      const data = result.data as QueryTimelineData;

      const contactEvents = data.events.filter((e: TimelineEvent) => e.source === 'contacts');
      expect(contactEvents.length).toBeGreaterThanOrEqual(1);
      expect(contactEvents.some((e: TimelineEvent) => e.summary.includes('Alice Smith'))).toBe(true);
    });

    it('should include projects in timeline', async () => {
      const today = getTodayString();
      const result = await client.queryTimeline(today, testAgentId);
      const data = result.data as QueryTimelineData;

      const projectEvents = data.events.filter((e: TimelineEvent) => e.source === 'projects');
      expect(projectEvents.length).toBeGreaterThanOrEqual(1);
      expect(projectEvents.some((e: TimelineEvent) => e.summary.includes('MCP Timeline'))).toBe(true);
    });

    it('should include skills in timeline', async () => {
      const today = getTodayString();
      const result = await client.queryTimeline(today, testAgentId);
      const data = result.data as QueryTimelineData;

      const skillEvents = data.events.filter((e: TimelineEvent) => e.source === 'skills');
      expect(skillEvents.length).toBeGreaterThanOrEqual(1);
      expect(skillEvents.some((e: TimelineEvent) => e.summary.includes('Daily Summary'))).toBe(true);
    });

    it('should return events sorted by timestamp descending', async () => {
      const today = getTodayString();
      const result = await client.queryTimeline(today, testAgentId);
      const data = result.data as QueryTimelineData;

      for (let i = 1; i < data.events.length; i++) {
        expect(data.events[i - 1].timestamp >= data.events[i].timestamp).toBe(true);
      }
    });
  });

  describe('filtering', () => {
    it('should filter by category', async () => {
      const today = getTodayString();
      const result = await client.queryTimeline(today, testAgentId, {
        categories: ['facts', 'conversations'],
      });
      const data = result.data as QueryTimelineData;

      expect(data.sources_queried).toEqual(['facts', 'conversations']);
      const sources = new Set(data.events.map((e: TimelineEvent) => e.source));
      expect(sources.has('contacts')).toBe(false);
      expect(sources.has('projects')).toBe(false);
    });

    it('should filter by keyword query', async () => {
      const today = getTodayString();
      const result = await client.queryTimeline(today, testAgentId, {
        query: 'dark mode',
      });
      const data = result.data as QueryTimelineData;

      expect(data.events.length).toBeGreaterThanOrEqual(1);
      expect(data.events.some((e: TimelineEvent) => e.summary.includes('dark mode'))).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const today = getTodayString();
      const result = await client.queryTimeline(today, testAgentId, {
        limit: 2,
      });
      const data = result.data as QueryTimelineData;

      expect(data.events.length).toBeLessThanOrEqual(2);
      expect(data.total_count).toBeGreaterThan(2);
    });

    it('should return empty for future date range', async () => {
      const tomorrow = getTomorrowString();
      const dayAfter = new Date();
      dayAfter.setDate(dayAfter.getDate() + 2);
      const dayAfterStr = dayAfter.toISOString().split('T')[0];

      const result = await client.queryTimeline(tomorrow, testAgentId, {
        date_to: dayAfterStr,
      });
      const data = result.data as QueryTimelineData;

      expect(data.events).toHaveLength(0);
      expect(data.total_count).toBe(0);
    });

    it('should return empty for past date range with no data', async () => {
      const result = await client.queryTimeline('2020-01-01', testAgentId, {
        date_to: '2020-01-31',
      });
      const data = result.data as QueryTimelineData;

      expect(data.events).toHaveLength(0);
    });
  });

  describe('event details', () => {
    it('should include fact details in event', async () => {
      const today = getTodayString();
      const result = await client.queryTimeline(today, testAgentId, {
        categories: ['facts'],
      });
      const data = result.data as QueryTimelineData;

      const factEvent = data.events.find((e: TimelineEvent) => e.source === 'facts');
      expect(factEvent).toBeDefined();
      expect(factEvent!.details).toHaveProperty('fact_id');
      expect(factEvent!.details).toHaveProperty('fact');
      expect(factEvent!.details).toHaveProperty('category');
      expect(factEvent!.event_type).toBe('created');
    });

    it('should include conversation details in event', async () => {
      const today = getTodayString();
      const result = await client.queryTimeline(today, testAgentId, {
        categories: ['conversations'],
      });
      const data = result.data as QueryTimelineData;

      const convEvent = data.events.find((e: TimelineEvent) => e.source === 'conversations');
      expect(convEvent).toBeDefined();
      expect(convEvent!.details).toHaveProperty('conversation_id');
      expect(convEvent!.details).toHaveProperty('user_message_preview');
      expect(convEvent!.details).toHaveProperty('response_preview');
      expect(convEvent!.event_type).toBe('created');
    });

    it('should include contact details in event', async () => {
      const today = getTodayString();
      const result = await client.queryTimeline(today, testAgentId, {
        categories: ['contacts'],
      });
      const data = result.data as QueryTimelineData;

      const contactEvent = data.events.find((e: TimelineEvent) => e.source === 'contacts');
      expect(contactEvent).toBeDefined();
      expect(contactEvent!.details).toHaveProperty('contact_id');
      expect(contactEvent!.details).toHaveProperty('name');
      expect(contactEvent!.details).toHaveProperty('email');
    });
  });

  describe('validation', () => {
    it('should reject missing date_from', async () => {
      const result = await client.callTool('query_timeline', {
        agent_id: testAgentId,
      });

      expect(result.success).toBe(false);
    });

    it('should reject empty date_from', async () => {
      const result = await client.callTool('query_timeline', {
        agent_id: testAgentId,
        date_from: '',
      });

      expect(result.success).toBe(false);
    });
  });
});
