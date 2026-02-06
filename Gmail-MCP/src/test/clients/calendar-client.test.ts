import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock objects
// ---------------------------------------------------------------------------

const { mockCalendarList, mockEvents, mockFreebusy } = vi.hoisted(() => ({
  mockCalendarList: { list: vi.fn() },
  mockEvents: {
    list: vi.fn(),
    get: vi.fn(),
    insert: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    quickAdd: vi.fn(),
  },
  mockFreebusy: { query: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../gmail/auth.js", () => ({
  getAuthenticatedClient: vi.fn().mockResolvedValue({}),
}));

vi.mock("googleapis", () => ({
  google: {
    calendar: vi.fn(() => ({
      calendarList: mockCalendarList,
      events: mockEvents,
      freebusy: mockFreebusy,
    })),
  },
}));

// ---------------------------------------------------------------------------
// Import client functions AFTER mocks
// ---------------------------------------------------------------------------

import {
  listCalendars,
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  quickAddEvent,
  findFreeTime,
} from "../../calendar/client.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// listCalendars
// ===========================================================================

describe("listCalendars", () => {
  it("maps calendar list entries to CalendarInfo", async () => {
    mockCalendarList.list.mockResolvedValue({
      data: {
        items: [
          {
            id: "primary",
            summary: "My Calendar",
            timeZone: "America/New_York",
            primary: true,
            accessRole: "owner",
            backgroundColor: "#1b887a",
            foregroundColor: "#ffffff",
          },
          {
            id: "shared@group.calendar.google.com",
            summary: "Team Calendar",
            accessRole: "reader",
          },
        ],
      },
    });

    const calendars = await listCalendars();

    expect(calendars).toHaveLength(2);
    expect(calendars[0]).toEqual({
      id: "primary",
      summary: "My Calendar",
      description: undefined,
      timeZone: "America/New_York",
      backgroundColor: "#1b887a",
      foregroundColor: "#ffffff",
      primary: true,
      accessRole: "owner",
    });
    expect(calendars[1].primary).toBeUndefined();
    expect(calendars[1].accessRole).toBe("reader");
  });

  it("returns empty array when no calendars", async () => {
    mockCalendarList.list.mockResolvedValue({ data: { items: undefined } });
    const calendars = await listCalendars();
    expect(calendars).toEqual([]);
  });
});

// ===========================================================================
// listEvents
// ===========================================================================

describe("listEvents", () => {
  it("maps timed and all-day events correctly", async () => {
    mockEvents.list.mockResolvedValue({
      data: {
        items: [
          {
            id: "ev-timed",
            summary: "Meeting",
            start: {
              dateTime: "2026-02-05T09:00:00-05:00",
              timeZone: "America/New_York",
            },
            end: {
              dateTime: "2026-02-05T10:00:00-05:00",
              timeZone: "America/New_York",
            },
            status: "confirmed",
            attendees: [{ email: "a@test.com" }, { email: "b@test.com" }],
          },
          {
            id: "ev-allday",
            summary: "Holiday",
            start: { date: "2026-02-14" },
            end: { date: "2026-02-15" },
            status: "confirmed",
          },
        ],
        nextPageToken: "next",
        timeZone: "America/New_York",
      },
    });

    const result = await listEvents({ calendarId: "primary", query: "meeting" });

    expect(mockEvents.list).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        q: "meeting",
        singleEvents: true,
        orderBy: "startTime",
      })
    );

    expect(result.events).toHaveLength(2);
    expect(result.events[0].isAllDay).toBe(false);
    expect(result.events[0].attendeeCount).toBe(2);
    expect(result.events[1].isAllDay).toBe(true);
    expect(result.nextPageToken).toBe("next");
    expect(result.timeZone).toBe("America/New_York");
  });

  it("uses defaults when called with no options", async () => {
    mockEvents.list.mockResolvedValue({
      data: { items: [], timeZone: "UTC" },
    });

    await listEvents();

    expect(mockEvents.list).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        maxResults: 25,
        singleEvents: true,
        orderBy: "startTime",
      })
    );
  });
});

// ===========================================================================
// getEvent
// ===========================================================================

describe("getEvent", () => {
  it("returns full CalendarEvent with attendees and reminders", async () => {
    mockEvents.get.mockResolvedValue({
      data: {
        id: "ev-1",
        summary: "Sprint Planning",
        description: "Plan the sprint",
        location: "Room A",
        start: {
          dateTime: "2026-02-05T09:00:00-05:00",
          timeZone: "America/New_York",
        },
        end: {
          dateTime: "2026-02-05T10:00:00-05:00",
          timeZone: "America/New_York",
        },
        status: "confirmed",
        htmlLink: "https://calendar.google.com/event/ev-1",
        creator: { email: "org@test.com", displayName: "Organizer" },
        organizer: { email: "org@test.com", displayName: "Organizer" },
        attendees: [
          {
            email: "a@test.com",
            displayName: "Person A",
            responseStatus: "accepted",
          },
        ],
        reminders: {
          useDefault: false,
          overrides: [{ method: "popup", minutes: 10 }],
        },
        conferenceData: {
          entryPoints: [
            {
              entryPointType: "video",
              uri: "https://meet.google.com/abc",
              label: "meet.google.com/abc",
            },
          ],
        },
        created: "2026-01-01T00:00:00Z",
        updated: "2026-02-01T00:00:00Z",
      },
    });

    const event = await getEvent("ev-1", "primary");

    expect(mockEvents.get).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "ev-1",
    });

    expect(event.id).toBe("ev-1");
    expect(event.calendarId).toBe("primary");
    expect(event.summary).toBe("Sprint Planning");
    expect(event.description).toBe("Plan the sprint");
    expect(event.location).toBe("Room A");
    expect(event.attendees).toHaveLength(1);
    expect(event.attendees![0].email).toBe("a@test.com");
    expect(event.attendees![0].responseStatus).toBe("accepted");
    expect(event.reminders?.useDefault).toBe(false);
    expect(event.reminders?.overrides).toHaveLength(1);
    expect(event.conferenceData?.entryPoints).toHaveLength(1);
    expect(event.conferenceData?.entryPoints![0].uri).toBe(
      "https://meet.google.com/abc"
    );
  });

  it("uses 'primary' as default calendar ID", async () => {
    mockEvents.get.mockResolvedValue({
      data: {
        id: "ev-2",
        summary: "Test",
        start: { dateTime: "2026-02-05T09:00:00Z" },
        end: { dateTime: "2026-02-05T10:00:00Z" },
        status: "confirmed",
      },
    });

    const event = await getEvent("ev-2");
    expect(event.calendarId).toBe("primary");
  });
});

// ===========================================================================
// createEvent
// ===========================================================================

describe("createEvent", () => {
  it("creates a timed event with correct start/end", async () => {
    mockEvents.insert.mockResolvedValue({
      data: {
        id: "ev-new",
        summary: "New Meeting",
        start: { dateTime: "2026-02-05T14:00:00Z" },
        end: { dateTime: "2026-02-05T15:00:00Z" },
        status: "confirmed",
      },
    });

    const event = await createEvent({
      summary: "New Meeting",
      startDateTime: "2026-02-05T14:00:00Z",
      endDateTime: "2026-02-05T15:00:00Z",
      timeZone: "UTC",
    });

    const callArgs = mockEvents.insert.mock.calls[0][0];
    expect(callArgs.calendarId).toBe("primary");
    expect(callArgs.sendUpdates).toBe("all");
    expect(callArgs.requestBody.summary).toBe("New Meeting");
    expect(callArgs.requestBody.start).toEqual({
      dateTime: "2026-02-05T14:00:00Z",
      timeZone: "UTC",
    });
    expect(callArgs.requestBody.end).toEqual({
      dateTime: "2026-02-05T15:00:00Z",
      timeZone: "UTC",
    });

    expect(event.id).toBe("ev-new");
  });

  it("creates an all-day event with default end (next day)", async () => {
    mockEvents.insert.mockResolvedValue({
      data: {
        id: "ev-allday",
        summary: "Day Off",
        start: { date: "2026-03-01" },
        end: { date: "2026-03-02" },
        status: "confirmed",
      },
    });

    await createEvent({
      summary: "Day Off",
      startDate: "2026-03-01",
    });

    const callArgs = mockEvents.insert.mock.calls[0][0];
    expect(callArgs.requestBody.start).toEqual({
      date: "2026-03-01",
      timeZone: undefined,
    });
    expect(callArgs.requestBody.end.date).toBe("2026-03-02");
  });

  it("defaults to 1 hour duration for timed events without end", async () => {
    mockEvents.insert.mockResolvedValue({
      data: {
        id: "ev-1hr",
        summary: "Quick",
        start: { dateTime: "2026-02-05T14:00:00.000Z" },
        end: { dateTime: "2026-02-05T15:00:00.000Z" },
        status: "confirmed",
      },
    });

    await createEvent({
      summary: "Quick",
      startDateTime: "2026-02-05T14:00:00.000Z",
    });

    const callArgs = mockEvents.insert.mock.calls[0][0];
    const endDt = new Date(callArgs.requestBody.end.dateTime);
    const startDt = new Date("2026-02-05T14:00:00.000Z");
    expect(endDt.getTime() - startDt.getTime()).toBe(3600000);
  });

  it("passes attendees and reminders", async () => {
    mockEvents.insert.mockResolvedValue({
      data: {
        id: "ev-att",
        summary: "Team Sync",
        start: { dateTime: "2026-02-05T09:00:00Z" },
        end: { dateTime: "2026-02-05T10:00:00Z" },
        status: "confirmed",
      },
    });

    await createEvent({
      summary: "Team Sync",
      startDateTime: "2026-02-05T09:00:00Z",
      endDateTime: "2026-02-05T10:00:00Z",
      attendees: ["alice@test.com", "bob@test.com"],
      reminders: [{ method: "popup", minutes: 15 }],
    });

    const callArgs = mockEvents.insert.mock.calls[0][0];
    expect(callArgs.requestBody.attendees).toEqual([
      { email: "alice@test.com" },
      { email: "bob@test.com" },
    ]);
    expect(callArgs.requestBody.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 15 }],
    });
  });
});

// ===========================================================================
// updateEvent
// ===========================================================================

describe("updateEvent", () => {
  it("sends only changed fields via events.patch", async () => {
    mockEvents.patch.mockResolvedValue({
      data: {
        id: "ev-upd",
        summary: "Updated Title",
        start: { dateTime: "2026-02-05T09:00:00Z" },
        end: { dateTime: "2026-02-05T10:00:00Z" },
        status: "confirmed",
      },
    });

    await updateEvent({
      eventId: "ev-upd",
      summary: "Updated Title",
    });

    const callArgs = mockEvents.patch.mock.calls[0][0];
    expect(callArgs.calendarId).toBe("primary");
    expect(callArgs.eventId).toBe("ev-upd");
    expect(callArgs.sendUpdates).toBe("all");
    expect(callArgs.requestBody.summary).toBe("Updated Title");
    // start/end should not be in requestBody since we didn't update them
    expect(callArgs.requestBody.start).toBeUndefined();
    expect(callArgs.requestBody.end).toBeUndefined();
  });

  it("updates attendees list", async () => {
    mockEvents.patch.mockResolvedValue({
      data: {
        id: "ev-upd2",
        summary: "Meeting",
        start: { dateTime: "2026-02-05T09:00:00Z" },
        end: { dateTime: "2026-02-05T10:00:00Z" },
        status: "confirmed",
      },
    });

    await updateEvent({
      eventId: "ev-upd2",
      attendees: ["new@test.com"],
    });

    const callArgs = mockEvents.patch.mock.calls[0][0];
    expect(callArgs.requestBody.attendees).toEqual([{ email: "new@test.com" }]);
  });
});

// ===========================================================================
// deleteEvent
// ===========================================================================

describe("deleteEvent", () => {
  it("calls events.delete with correct params", async () => {
    mockEvents.delete.mockResolvedValue({});

    await deleteEvent("ev-del", "primary");

    expect(mockEvents.delete).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "ev-del",
      sendUpdates: "all",
    });
  });

  it("uses 'primary' as default calendar", async () => {
    mockEvents.delete.mockResolvedValue({});
    await deleteEvent("ev-del2");
    expect(mockEvents.delete).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: "primary" })
    );
  });
});

// ===========================================================================
// quickAddEvent
// ===========================================================================

describe("quickAddEvent", () => {
  it("creates event from natural language text", async () => {
    mockEvents.quickAdd.mockResolvedValue({
      data: {
        id: "ev-quick",
        summary: "Lunch with Bob",
        start: { dateTime: "2026-02-06T12:00:00Z" },
        end: { dateTime: "2026-02-06T13:00:00Z" },
        status: "confirmed",
      },
    });

    const event = await quickAddEvent("Lunch with Bob tomorrow at noon");

    expect(mockEvents.quickAdd).toHaveBeenCalledWith({
      calendarId: "primary",
      text: "Lunch with Bob tomorrow at noon",
    });
    expect(event.id).toBe("ev-quick");
    expect(event.summary).toBe("Lunch with Bob");
  });

  it("uses custom calendar ID when provided", async () => {
    mockEvents.quickAdd.mockResolvedValue({
      data: {
        id: "ev-q2",
        summary: "Event",
        start: { dateTime: "2026-02-06T12:00:00Z" },
        end: { dateTime: "2026-02-06T13:00:00Z" },
        status: "confirmed",
      },
    });

    await quickAddEvent("Event", "work@group.calendar.google.com");

    expect(mockEvents.quickAdd).toHaveBeenCalledWith({
      calendarId: "work@group.calendar.google.com",
      text: "Event",
    });
  });
});

// ===========================================================================
// findFreeTime
// ===========================================================================

describe("findFreeTime", () => {
  it("maps free/busy response correctly", async () => {
    mockFreebusy.query.mockResolvedValue({
      data: {
        calendars: {
          primary: {
            busy: [
              {
                start: "2026-02-05T09:00:00Z",
                end: "2026-02-05T10:00:00Z",
              },
              {
                start: "2026-02-05T14:00:00Z",
                end: "2026-02-05T15:00:00Z",
              },
            ],
          },
        },
      },
    });

    const result = await findFreeTime(
      "2026-02-05T00:00:00Z",
      "2026-02-05T23:59:59Z"
    );

    expect(mockFreebusy.query).toHaveBeenCalledWith({
      requestBody: {
        timeMin: "2026-02-05T00:00:00Z",
        timeMax: "2026-02-05T23:59:59Z",
        items: [{ id: "primary" }],
      },
    });

    expect(result.timeMin).toBe("2026-02-05T00:00:00Z");
    expect(result.timeMax).toBe("2026-02-05T23:59:59Z");
    expect(result.calendars.primary.busy).toHaveLength(2);
    expect(result.calendars.primary.busy[0]).toEqual({
      start: "2026-02-05T09:00:00Z",
      end: "2026-02-05T10:00:00Z",
    });
  });

  it("passes custom calendar IDs", async () => {
    mockFreebusy.query.mockResolvedValue({
      data: { calendars: {} },
    });

    await findFreeTime("2026-02-05T00:00:00Z", "2026-02-05T23:59:59Z", [
      "cal-1",
      "cal-2",
    ]);

    expect(mockFreebusy.query).toHaveBeenCalledWith({
      requestBody: expect.objectContaining({
        items: [{ id: "cal-1" }, { id: "cal-2" }],
      }),
    });
  });
});
