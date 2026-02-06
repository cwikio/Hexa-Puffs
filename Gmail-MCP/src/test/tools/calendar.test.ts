/**
 * Unit tests for Calendar tool handlers with mocked calendar client.
 *
 * Run with:
 *   npx vitest run src/test/tools/calendar.test.ts
 */

import { vi, beforeEach, describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Mock calendar client — vi.hoisted ensures fns exist when vi.mock is hoisted
// ---------------------------------------------------------------------------

const {
  mockListCalendars,
  mockListEvents,
  mockGetEvent,
  mockCreateEvent,
  mockUpdateEvent,
  mockDeleteEvent,
  mockQuickAddEvent,
  mockFindFreeTime,
} = vi.hoisted(() => ({
  mockListCalendars: vi.fn(),
  mockListEvents: vi.fn(),
  mockGetEvent: vi.fn(),
  mockCreateEvent: vi.fn(),
  mockUpdateEvent: vi.fn(),
  mockDeleteEvent: vi.fn(),
  mockQuickAddEvent: vi.fn(),
  mockFindFreeTime: vi.fn(),
}));

vi.mock("../../calendar/client.js", () => ({
  listCalendars: mockListCalendars,
  listEvents: mockListEvents,
  getEvent: mockGetEvent,
  createEvent: mockCreateEvent,
  updateEvent: mockUpdateEvent,
  deleteEvent: mockDeleteEvent,
  quickAddEvent: mockQuickAddEvent,
  findFreeTime: mockFindFreeTime,
}));

// ---------------------------------------------------------------------------
// Imports (must come after vi.mock calls)
// ---------------------------------------------------------------------------

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

import { expectSuccess, expectError, expectValidationError } from "../helpers.js";

import {
  MOCK_CALENDARS,
  MOCK_LIST_EVENTS_RESULT,
  MOCK_TIMED_EVENT,
  MOCK_FREEBUSY_RESULT,
} from "../fixtures/calendar.js";

// ---------------------------------------------------------------------------
// Reset hoisted mocks before each test (setup.ts clearAllMocks may not cover these)
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockListCalendars.mockReset();
  mockListEvents.mockReset();
  mockGetEvent.mockReset();
  mockCreateEvent.mockReset();
  mockUpdateEvent.mockReset();
  mockDeleteEvent.mockReset();
  mockQuickAddEvent.mockReset();
  mockFindFreeTime.mockReset();
});

// ===========================================================================
// handleListCalendars
// ===========================================================================

describe("handleListCalendars", () => {
  it("should return CalendarInfo array on success", async () => {
    mockListCalendars.mockResolvedValueOnce(MOCK_CALENDARS);

    const response = await handleListCalendars({});
    const data = expectSuccess(response);

    expect(data).toEqual(MOCK_CALENDARS);
    expect(data).toHaveLength(2);
    expect(data[0].id).toBe("tomasz@example.com");
    expect(mockListCalendars).toHaveBeenCalledOnce();
  });

  it("should wrap API errors", async () => {
    mockListCalendars.mockRejectedValueOnce(new Error("API quota exceeded"));

    const response = await handleListCalendars({});
    const error = expectError(response);

    expect(error).toContain("Failed to list calendars");
    expect(error).toContain("API quota exceeded");
  });
});

// ===========================================================================
// handleListEvents
// ===========================================================================

describe("handleListEvents", () => {
  it("should return events with empty args (defaults)", async () => {
    mockListEvents.mockResolvedValueOnce(MOCK_LIST_EVENTS_RESULT);

    const response = await handleListEvents({});
    const data = expectSuccess(response);

    expect(data).toEqual(MOCK_LIST_EVENTS_RESULT);
    expect(data.events).toHaveLength(2);
    expect(mockListEvents).toHaveBeenCalledWith({
      calendarId: undefined,
      timeMin: undefined,
      timeMax: undefined,
      query: undefined,
      maxResults: undefined,
      pageToken: undefined,
    });
  });

  it("should pass all params mapped to camelCase", async () => {
    mockListEvents.mockResolvedValueOnce(MOCK_LIST_EVENTS_RESULT);

    await handleListEvents({
      calendar_id: "team@group.calendar.google.com",
      time_min: "2025-03-17T00:00:00Z",
      time_max: "2025-03-18T00:00:00Z",
      query: "sprint",
      max_results: 10,
      page_token: "abc123",
    });

    expect(mockListEvents).toHaveBeenCalledWith({
      calendarId: "team@group.calendar.google.com",
      timeMin: "2025-03-17T00:00:00Z",
      timeMax: "2025-03-18T00:00:00Z",
      query: "sprint",
      maxResults: 10,
      pageToken: "abc123",
    });
  });

  it("should reject max_results > 250", async () => {
    const response = await handleListEvents({ max_results: 300 });
    expectValidationError(response);
    expect(mockListEvents).not.toHaveBeenCalled();
  });

  it("should reject max_results < 1", async () => {
    const response = await handleListEvents({ max_results: 0 });
    expectValidationError(response);
    expect(mockListEvents).not.toHaveBeenCalled();
  });

  it("should wrap API errors", async () => {
    mockListEvents.mockRejectedValueOnce(new Error("Network failure"));

    const response = await handleListEvents({});
    const error = expectError(response);

    expect(error).toContain("Failed to list events");
    expect(error).toContain("Network failure");
  });
});

// ===========================================================================
// handleGetEvent
// ===========================================================================

describe("handleGetEvent", () => {
  it("should return event on success", async () => {
    mockGetEvent.mockResolvedValueOnce(MOCK_TIMED_EVENT);

    const response = await handleGetEvent({ event_id: "evt_abc123def456" });
    const data = expectSuccess(response);

    expect(data).toEqual(MOCK_TIMED_EVENT);
    expect(mockGetEvent).toHaveBeenCalledWith("evt_abc123def456", undefined);
  });

  it("should pass optional calendar_id", async () => {
    mockGetEvent.mockResolvedValueOnce(MOCK_TIMED_EVENT);

    await handleGetEvent({
      event_id: "evt_abc123def456",
      calendar_id: "team@group.calendar.google.com",
    });

    expect(mockGetEvent).toHaveBeenCalledWith(
      "evt_abc123def456",
      "team@group.calendar.google.com"
    );
  });

  it("should reject empty event_id", async () => {
    const response = await handleGetEvent({ event_id: "" });
    expectValidationError(response);
    expect(mockGetEvent).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// handleCreateEvent
// ===========================================================================

describe("handleCreateEvent", () => {
  it("should create a timed event with summary + start_date_time", async () => {
    mockCreateEvent.mockResolvedValueOnce(MOCK_TIMED_EVENT);

    const response = await handleCreateEvent({
      summary: "Sprint Planning",
      start_date_time: "2025-03-17T10:00:00-04:00",
    });

    const data = expectSuccess(response);
    expect(data).toEqual(MOCK_TIMED_EVENT);
    expect(mockCreateEvent).toHaveBeenCalledWith({
      calendarId: undefined,
      summary: "Sprint Planning",
      description: undefined,
      location: undefined,
      startDateTime: "2025-03-17T10:00:00-04:00",
      startDate: undefined,
      endDateTime: undefined,
      endDate: undefined,
      timeZone: undefined,
      attendees: undefined,
      recurrence: undefined,
      reminders: undefined,
    });
  });

  it("should create an all-day event with summary + start_date", async () => {
    mockCreateEvent.mockResolvedValueOnce(MOCK_TIMED_EVENT);

    const response = await handleCreateEvent({
      summary: "Company Offsite",
      start_date: "2025-03-20",
    });

    const data = expectSuccess(response);
    expect(data).toEqual(MOCK_TIMED_EVENT);
    expect(mockCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "Company Offsite",
        startDate: "2025-03-20",
        startDateTime: undefined,
      })
    );
  });

  it("should reject missing both start_date_time and start_date (custom validation)", async () => {
    const response = await handleCreateEvent({
      summary: "No Start Time",
    });

    const error = expectError(response);
    expect(error).toBe(
      "Must provide either start_date_time (for timed events) or start_date (for all-day events)"
    );
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it("should reject providing both start_date_time and start_date (custom validation)", async () => {
    const response = await handleCreateEvent({
      summary: "Both Starts",
      start_date_time: "2025-03-17T10:00:00-04:00",
      start_date: "2025-03-17",
    });

    const error = expectError(response);
    expect(error).toBe("Provide either start_date_time or start_date, not both");
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it("should reject missing summary (Zod validation)", async () => {
    const response = await handleCreateEvent({
      start_date_time: "2025-03-17T10:00:00-04:00",
    });

    expectValidationError(response);
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it("should pass optional fields to client", async () => {
    mockCreateEvent.mockResolvedValueOnce(MOCK_TIMED_EVENT);

    await handleCreateEvent({
      summary: "Full Event",
      start_date_time: "2025-03-17T10:00:00-04:00",
      end_date_time: "2025-03-17T11:30:00-04:00",
      description: "A detailed description",
      location: "Conference Room B",
      time_zone: "America/New_York",
      attendees: ["sarah@acme.com", "james@acme.com"],
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=4"],
      reminders: [{ method: "popup" as const, minutes: 10 }],
      calendar_id: "team@group.calendar.google.com",
    });

    expect(mockCreateEvent).toHaveBeenCalledWith({
      calendarId: "team@group.calendar.google.com",
      summary: "Full Event",
      description: "A detailed description",
      location: "Conference Room B",
      startDateTime: "2025-03-17T10:00:00-04:00",
      startDate: undefined,
      endDateTime: "2025-03-17T11:30:00-04:00",
      endDate: undefined,
      timeZone: "America/New_York",
      attendees: ["sarah@acme.com", "james@acme.com"],
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=4"],
      reminders: [{ method: "popup", minutes: 10 }],
    });
  });
});

// ===========================================================================
// handleUpdateEvent
// ===========================================================================

describe("handleUpdateEvent", () => {
  it("should update event with partial fields", async () => {
    mockUpdateEvent.mockResolvedValueOnce(MOCK_TIMED_EVENT);

    const response = await handleUpdateEvent({
      event_id: "evt_abc123def456",
      summary: "Updated Title",
      location: "New Room",
    });

    const data = expectSuccess(response);
    expect(data).toEqual(MOCK_TIMED_EVENT);
    expect(mockUpdateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_abc123def456",
        summary: "Updated Title",
        location: "New Room",
      })
    );
  });

  it("should reject providing both start_date_time and start_date", async () => {
    const response = await handleUpdateEvent({
      event_id: "evt_abc123def456",
      start_date_time: "2025-03-17T10:00:00-04:00",
      start_date: "2025-03-17",
    });

    const error = expectError(response);
    expect(error).toBe("Provide either start_date_time or start_date, not both");
    expect(mockUpdateEvent).not.toHaveBeenCalled();
  });

  it("should reject empty event_id", async () => {
    const response = await handleUpdateEvent({ event_id: "" });
    expectValidationError(response);
    expect(mockUpdateEvent).not.toHaveBeenCalled();
  });

  it("should pass response_status for RSVP accept", async () => {
    mockUpdateEvent.mockResolvedValueOnce(MOCK_TIMED_EVENT);

    const response = await handleUpdateEvent({
      event_id: "evt_abc123def456",
      response_status: "accepted",
    });

    const data = expectSuccess(response);
    expect(data).toEqual(MOCK_TIMED_EVENT);
    expect(mockUpdateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_abc123def456",
        responseStatus: "accepted",
      })
    );
  });

  it("should pass response_status for RSVP decline", async () => {
    mockUpdateEvent.mockResolvedValueOnce(MOCK_TIMED_EVENT);

    const response = await handleUpdateEvent({
      event_id: "evt_abc123def456",
      response_status: "declined",
    });

    expectSuccess(response);
    expect(mockUpdateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_abc123def456",
        responseStatus: "declined",
      })
    );
  });

  it("should pass response_status for RSVP tentative", async () => {
    mockUpdateEvent.mockResolvedValueOnce(MOCK_TIMED_EVENT);

    const response = await handleUpdateEvent({
      event_id: "evt_abc123def456",
      response_status: "tentative",
    });

    expectSuccess(response);
    expect(mockUpdateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_abc123def456",
        responseStatus: "tentative",
      })
    );
  });

  it("should reject invalid response_status value", async () => {
    const response = await handleUpdateEvent({
      event_id: "evt_abc123def456",
      response_status: "maybe",
    });

    expectValidationError(response);
    expect(mockUpdateEvent).not.toHaveBeenCalled();
  });

  it("should propagate RSVP error (not an attendee)", async () => {
    mockUpdateEvent.mockRejectedValueOnce(
      new Error("Cannot RSVP: you are not an attendee of this event")
    );

    const response = await handleUpdateEvent({
      event_id: "evt_abc123def456",
      response_status: "accepted",
    });

    const error = expectError(response);
    expect(error).toContain("Cannot RSVP");
    expect(error).toContain("not an attendee");
  });
});

// ===========================================================================
// handleDeleteEvent
// ===========================================================================

describe("handleDeleteEvent", () => {
  it("should return { deleted: true } on success", async () => {
    mockDeleteEvent.mockResolvedValueOnce(undefined);

    const response = await handleDeleteEvent({ event_id: "evt_abc123def456" });
    const data = expectSuccess(response);

    expect(data).toEqual({ deleted: true });
    expect(mockDeleteEvent).toHaveBeenCalledWith("evt_abc123def456", undefined);
  });

  it("should pass optional calendar_id", async () => {
    mockDeleteEvent.mockResolvedValueOnce(undefined);

    await handleDeleteEvent({
      event_id: "evt_abc123def456",
      calendar_id: "team@group.calendar.google.com",
    });

    expect(mockDeleteEvent).toHaveBeenCalledWith(
      "evt_abc123def456",
      "team@group.calendar.google.com"
    );
  });

  it("should reject empty event_id", async () => {
    const response = await handleDeleteEvent({ event_id: "" });
    expectValidationError(response);
    expect(mockDeleteEvent).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// handleQuickAddEvent
// ===========================================================================

describe("handleQuickAddEvent", () => {
  it("should create event from natural language text", async () => {
    mockQuickAddEvent.mockResolvedValueOnce(MOCK_TIMED_EVENT);

    const response = await handleQuickAddEvent({
      text: "Meeting with John tomorrow at 3pm for 1 hour",
    });

    const data = expectSuccess(response);
    expect(data).toEqual(MOCK_TIMED_EVENT);
    expect(mockQuickAddEvent).toHaveBeenCalledWith(
      "Meeting with John tomorrow at 3pm for 1 hour",
      undefined
    );
  });

  it("should pass optional calendar_id", async () => {
    mockQuickAddEvent.mockResolvedValueOnce(MOCK_TIMED_EVENT);

    await handleQuickAddEvent({
      text: "Lunch at noon",
      calendar_id: "team@group.calendar.google.com",
    });

    expect(mockQuickAddEvent).toHaveBeenCalledWith(
      "Lunch at noon",
      "team@group.calendar.google.com"
    );
  });

  it("should reject empty text", async () => {
    const response = await handleQuickAddEvent({ text: "" });
    expectValidationError(response);
    expect(mockQuickAddEvent).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// handleFindFreeTime
// ===========================================================================

describe("handleFindFreeTime", () => {
  it("should return free/busy result on success", async () => {
    mockFindFreeTime.mockResolvedValueOnce(MOCK_FREEBUSY_RESULT);

    const response = await handleFindFreeTime({
      time_min: "2025-03-17T00:00:00-04:00",
      time_max: "2025-03-17T23:59:59-04:00",
    });

    const data = expectSuccess(response);
    expect(data).toEqual(MOCK_FREEBUSY_RESULT);
    expect(mockFindFreeTime).toHaveBeenCalledWith(
      "2025-03-17T00:00:00-04:00",
      "2025-03-17T23:59:59-04:00",
      undefined
    );
  });

  it("should pass optional calendar_ids", async () => {
    mockFindFreeTime.mockResolvedValueOnce(MOCK_FREEBUSY_RESULT);

    await handleFindFreeTime({
      time_min: "2025-03-17T00:00:00-04:00",
      time_max: "2025-03-17T23:59:59-04:00",
      calendar_ids: ["tomasz@example.com", "sarah.chen@acme.com"],
    });

    expect(mockFindFreeTime).toHaveBeenCalledWith(
      "2025-03-17T00:00:00-04:00",
      "2025-03-17T23:59:59-04:00",
      ["tomasz@example.com", "sarah.chen@acme.com"]
    );
  });

  it("should reject missing time_min", async () => {
    const response = await handleFindFreeTime({
      time_min: "",
      time_max: "2025-03-17T23:59:59-04:00",
    });

    expectValidationError(response);
    expect(mockFindFreeTime).not.toHaveBeenCalled();
  });

  it("should reject missing time_max", async () => {
    const response = await handleFindFreeTime({
      time_min: "2025-03-17T00:00:00-04:00",
      time_max: "",
    });

    expectValidationError(response);
    expect(mockFindFreeTime).not.toHaveBeenCalled();
  });
});
