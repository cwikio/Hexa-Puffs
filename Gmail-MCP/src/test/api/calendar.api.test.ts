/**
 * Real API integration tests for Calendar tools.
 *
 * These tests call the actual Google Calendar API through the handler
 * functions — NO mocks. A valid OAuth token must exist at
 * ~/.annabelle/gmail/token.json for the suite to run.
 *
 * Run with:
 *   npx vitest run src/test/api/calendar.api.test.ts
 */

import { describe, it, expect, afterAll } from "vitest";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import {
  handleListCalendars,
  handleListEvents,
  handleGetEvent,
  handleCreateEvent,
  handleUpdateEvent,
  handleDeleteEvent,
  handleQuickAddEvent,
  handleFindFreeTime,
} from "../../tools/calendar.js";

import type { CalendarEvent, CalendarInfo, ListEventsResult, FreeBusyResult } from "../../types/calendar.js";
import type { StandardResponse } from "../../types/responses.js";

// ---------------------------------------------------------------------------
// Token check — skip the entire suite when no OAuth token is available
// ---------------------------------------------------------------------------

const tokenPath = join(homedir(), ".annabelle", "gmail", "token.json");
const tokenExists = existsSync(tokenPath);

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfToday(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function oneHourFromNow(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}

function twoHoursFromNow(): string {
  const d = new Date();
  d.setHours(d.getHours() + 2);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Helper to safely delete an event (ignores errors)
// ---------------------------------------------------------------------------

async function safeDelete(eventId: string | undefined): Promise<void> {
  if (!eventId) return;
  try {
    await handleDeleteEvent({ event_id: eventId });
  } catch {
    // best-effort cleanup
  }
}

// ===========================================================================
// Test suite
// ===========================================================================

describe.skipIf(!tokenExists)("Calendar API integration tests", () => {
  // -------------------------------------------------------------------------
  // 1. list_calendars
  // -------------------------------------------------------------------------

  describe("list_calendars", () => {
    it("should list calendars and include at least one with id and summary", async () => {
      const response: StandardResponse<CalendarInfo[]> = await handleListCalendars({});

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data!.length).toBeGreaterThanOrEqual(1);

      const first = response.data![0];
      expect(first).toHaveProperty("id");
      expect(first).toHaveProperty("summary");
      expect(typeof first.id).toBe("string");
      expect(typeof first.summary).toBe("string");
    });

    it("should contain a primary calendar", async () => {
      const response = await handleListCalendars({});

      expect(response.success).toBe(true);
      const calendars = response.data!;
      const primary = calendars.find((c) => c.primary === true);
      expect(primary).toBeDefined();
      expect(primary!.id).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // 2. list_events
  // -------------------------------------------------------------------------

  describe("list_events", () => {
    it("should list events for today and return correct response shape", async () => {
      const response: StandardResponse<ListEventsResult> = await handleListEvents({
        time_min: startOfToday(),
        time_max: endOfToday(),
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();

      const data = response.data!;
      expect(Array.isArray(data.events)).toBe(true);
      expect(typeof data.timeZone).toBe("string");
      expect(data.timeZone.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Event CRUD lifecycle (sequential)
  // -------------------------------------------------------------------------

  describe.sequential("Event CRUD lifecycle", () => {
    let createdEventId: string | undefined;

    afterAll(async () => {
      await safeDelete(createdEventId);
    });

    it("should create a timed event", async () => {
      const response: StandardResponse<CalendarEvent> = await handleCreateEvent({
        summary: "MCP Test Event",
        start_date_time: oneHourFromNow(),
        end_date_time: twoHoursFromNow(),
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();

      const event = response.data!;
      expect(event.id).toBeTruthy();
      expect(event.summary).toBe("MCP Test Event");

      createdEventId = event.id;
    });

    it("should get the event by ID", async () => {
      expect(createdEventId).toBeDefined();

      const response: StandardResponse<CalendarEvent> = await handleGetEvent({
        event_id: createdEventId,
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(response.data!.id).toBe(createdEventId);
      expect(response.data!.summary).toBe("MCP Test Event");
    });

    it("should update the event summary", async () => {
      expect(createdEventId).toBeDefined();

      const response: StandardResponse<CalendarEvent> = await handleUpdateEvent({
        event_id: createdEventId,
        summary: "MCP Test Event Updated",
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(response.data!.summary).toBe("MCP Test Event Updated");
    });

    it("should delete the event", async () => {
      expect(createdEventId).toBeDefined();

      const response: StandardResponse<{ deleted: boolean }> = await handleDeleteEvent({
        event_id: createdEventId,
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(response.data!.deleted).toBe(true);

      // Clear so afterAll doesn't try to delete again
      createdEventId = undefined;
    });
  });

  // -------------------------------------------------------------------------
  // 4. quick_add_event
  // -------------------------------------------------------------------------

  describe("quick_add_event", () => {
    let quickEventId: string | undefined;

    afterAll(async () => {
      await safeDelete(quickEventId);
    });

    it("should create an event via natural language and then clean up", async () => {
      const response: StandardResponse<CalendarEvent> = await handleQuickAddEvent({
        text: "MCP Test Quick Event tomorrow at noon",
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();

      const event = response.data!;
      expect(event.id).toBeTruthy();
      expect(event.summary).toBeTruthy();

      quickEventId = event.id;

      // Clean up immediately as well
      const deleteResponse = await handleDeleteEvent({ event_id: quickEventId });
      expect(deleteResponse.success).toBe(true);

      // Clear so afterAll doesn't try again
      quickEventId = undefined;
    });
  });

  // -------------------------------------------------------------------------
  // 5. find_free_time
  // -------------------------------------------------------------------------

  describe("find_free_time", () => {
    it("should return free/busy info for today with a calendars object", async () => {
      const response: StandardResponse<FreeBusyResult> = await handleFindFreeTime({
        time_min: startOfToday(),
        time_max: endOfToday(),
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();

      const data = response.data!;
      expect(data).toHaveProperty("calendars");
      expect(typeof data.calendars).toBe("object");
      expect(data.calendars).not.toBeNull();
      expect(typeof data.timeMin).toBe("string");
      expect(typeof data.timeMax).toBe("string");
    });
  });
});
