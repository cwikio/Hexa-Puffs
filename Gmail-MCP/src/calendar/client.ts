import { google, calendar_v3 } from "googleapis";
import { getAuthenticatedClient } from "../gmail/auth.js";
import { logger } from "../utils/logger.js";
import type {
  CalendarInfo,
  CalendarEvent,
  CalendarEventSummary,
  ListEventsOptions,
  ListEventsResult,
  CreateEventOptions,
  UpdateEventOptions,
  FreeBusyResult,
  EventAttendee,
  EventReminder,
} from "../types/calendar.js";

let calendarClient: calendar_v3.Calendar | null = null;

/**
 * Get authenticated Calendar client
 */
export async function getCalendarClient(): Promise<calendar_v3.Calendar> {
  if (!calendarClient) {
    const auth = await getAuthenticatedClient();
    calendarClient = google.calendar({ version: "v3", auth });
  }
  return calendarClient;
}

/**
 * Convert API event to CalendarEventSummary
 */
function toEventSummary(
  event: calendar_v3.Schema$Event,
  calendarId: string
): CalendarEventSummary {
  const isAllDay = !!event.start?.date && !event.start?.dateTime;

  return {
    id: event.id!,
    calendarId,
    summary: event.summary ?? "(No Title)",
    start: {
      dateTime: event.start?.dateTime ?? undefined,
      date: event.start?.date ?? undefined,
      timeZone: event.start?.timeZone ?? undefined,
    },
    end: {
      dateTime: event.end?.dateTime ?? undefined,
      date: event.end?.date ?? undefined,
      timeZone: event.end?.timeZone ?? undefined,
    },
    status: event.status ?? "confirmed",
    location: event.location ?? undefined,
    attendeeCount: event.attendees?.length,
    isAllDay,
  };
}

/**
 * Convert API event to full CalendarEvent
 */
function toCalendarEvent(
  event: calendar_v3.Schema$Event,
  calendarId: string
): CalendarEvent {
  const attendees: EventAttendee[] | undefined = event.attendees?.map((a) => ({
    email: a.email!,
    displayName: a.displayName ?? undefined,
    responseStatus: (a.responseStatus as EventAttendee["responseStatus"]) ?? undefined,
    organizer: a.organizer ?? undefined,
    self: a.self ?? undefined,
  }));

  const reminders: CalendarEvent["reminders"] = event.reminders
    ? {
        useDefault: event.reminders.useDefault ?? true,
        overrides: event.reminders.overrides?.map((r) => ({
          method: r.method as EventReminder["method"],
          minutes: r.minutes!,
        })),
      }
    : undefined;

  const conferenceData: CalendarEvent["conferenceData"] =
    event.conferenceData?.entryPoints
      ? {
          entryPoints: event.conferenceData.entryPoints.map((ep) => ({
            entryPointType: ep.entryPointType!,
            uri: ep.uri!,
            label: ep.label ?? undefined,
          })),
        }
      : undefined;

  return {
    id: event.id!,
    calendarId,
    summary: event.summary ?? "(No Title)",
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    start: {
      dateTime: event.start?.dateTime ?? undefined,
      date: event.start?.date ?? undefined,
      timeZone: event.start?.timeZone ?? undefined,
    },
    end: {
      dateTime: event.end?.dateTime ?? undefined,
      date: event.end?.date ?? undefined,
      timeZone: event.end?.timeZone ?? undefined,
    },
    status: event.status ?? "confirmed",
    htmlLink: event.htmlLink ?? undefined,
    creator: event.creator
      ? {
          email: event.creator.email!,
          displayName: event.creator.displayName ?? undefined,
        }
      : undefined,
    organizer: event.organizer
      ? {
          email: event.organizer.email!,
          displayName: event.organizer.displayName ?? undefined,
        }
      : undefined,
    attendees,
    recurrence: event.recurrence ?? undefined,
    recurringEventId: event.recurringEventId ?? undefined,
    created: event.created ?? undefined,
    updated: event.updated ?? undefined,
    reminders,
    conferenceData,
  };
}

// ============ PUBLIC API ============

/**
 * List all calendars the user has access to
 */
export async function listCalendars(): Promise<CalendarInfo[]> {
  const calendar = await getCalendarClient();

  const response = await calendar.calendarList.list();

  const calendars: CalendarInfo[] = (response.data.items ?? []).map((c) => ({
    id: c.id!,
    summary: c.summary ?? "",
    description: c.description ?? undefined,
    timeZone: c.timeZone ?? undefined,
    backgroundColor: c.backgroundColor ?? undefined,
    foregroundColor: c.foregroundColor ?? undefined,
    primary: c.primary ?? undefined,
    accessRole: c.accessRole ?? "reader",
  }));

  logger.debug("Listed calendars", { count: calendars.length });
  return calendars;
}

/**
 * List events with optional filters
 */
export async function listEvents(
  options: ListEventsOptions = {}
): Promise<ListEventsResult> {
  const calendar = await getCalendarClient();
  const calendarId = options.calendarId ?? "primary";

  const response = await calendar.events.list({
    calendarId,
    timeMin: options.timeMin,
    timeMax: options.timeMax,
    q: options.query,
    maxResults: options.maxResults ?? 25,
    pageToken: options.pageToken,
    singleEvents: options.singleEvents ?? true,
    orderBy: (options.singleEvents ?? true) ? "startTime" : undefined,
  });

  const events: CalendarEventSummary[] = (response.data.items ?? []).map(
    (event) => toEventSummary(event, calendarId)
  );

  logger.debug("Listed events", {
    count: events.length,
    calendarId,
    query: options.query,
  });

  return {
    events,
    nextPageToken: response.data.nextPageToken ?? undefined,
    timeZone: response.data.timeZone ?? "UTC",
  };
}

/**
 * Get a single event by ID
 */
export async function getEvent(
  eventId: string,
  calendarId = "primary"
): Promise<CalendarEvent> {
  const calendar = await getCalendarClient();

  const response = await calendar.events.get({
    calendarId,
    eventId,
  });

  logger.debug("Got event", { id: eventId, calendarId });
  return toCalendarEvent(response.data, calendarId);
}

/**
 * Create a new event
 */
export async function createEvent(
  options: CreateEventOptions
): Promise<CalendarEvent> {
  const calendar = await getCalendarClient();
  const calendarId = options.calendarId ?? "primary";

  const isAllDay = !!options.startDate;

  // Build start/end
  const start: calendar_v3.Schema$EventDateTime = isAllDay
    ? { date: options.startDate, timeZone: options.timeZone }
    : { dateTime: options.startDateTime, timeZone: options.timeZone };

  let end: calendar_v3.Schema$EventDateTime;
  if (isAllDay) {
    if (options.endDate) {
      end = { date: options.endDate, timeZone: options.timeZone };
    } else {
      // Default: next day (all-day end is exclusive)
      const startD = new Date(options.startDate!);
      startD.setDate(startD.getDate() + 1);
      const nextDay = startD.toISOString().split("T")[0];
      end = { date: nextDay, timeZone: options.timeZone };
    }
  } else {
    if (options.endDateTime) {
      end = { dateTime: options.endDateTime, timeZone: options.timeZone };
    } else {
      // Default: 1 hour after start
      const startMs = new Date(options.startDateTime!).getTime();
      end = {
        dateTime: new Date(startMs + 3600000).toISOString(),
        timeZone: options.timeZone,
      };
    }
  }

  const resource: calendar_v3.Schema$Event = {
    summary: options.summary,
    description: options.description,
    location: options.location,
    start,
    end,
    attendees: options.attendees?.map((email) => ({ email })),
    recurrence: options.recurrence,
  };

  if (options.reminders) {
    resource.reminders = {
      useDefault: false,
      overrides: options.reminders.map((r) => ({
        method: r.method,
        minutes: r.minutes,
      })),
    };
  }

  const response = await calendar.events.insert({
    calendarId,
    requestBody: resource,
    sendUpdates: "all",
  });

  logger.info("Created event", { id: response.data.id, summary: options.summary });
  return toCalendarEvent(response.data, calendarId);
}

/**
 * Update an existing event (partial update via patch)
 */
export async function updateEvent(
  options: UpdateEventOptions
): Promise<CalendarEvent> {
  const calendar = await getCalendarClient();
  const calendarId = options.calendarId ?? "primary";

  const resource: calendar_v3.Schema$Event = {};

  if (options.summary !== undefined) resource.summary = options.summary;
  if (options.description !== undefined) resource.description = options.description;
  if (options.location !== undefined) resource.location = options.location;

  if (options.startDateTime) {
    resource.start = { dateTime: options.startDateTime, timeZone: options.timeZone };
  } else if (options.startDate) {
    resource.start = { date: options.startDate, timeZone: options.timeZone };
  }

  if (options.endDateTime) {
    resource.end = { dateTime: options.endDateTime, timeZone: options.timeZone };
  } else if (options.endDate) {
    resource.end = { date: options.endDate, timeZone: options.timeZone };
  }

  if (options.attendees !== undefined) {
    resource.attendees = options.attendees.map((email) => ({ email }));
  }

  // RSVP: update the authenticated user's responseStatus on the event
  if (options.responseStatus) {
    // Fetch the current event to get the attendees list
    const existing = await calendar.events.get({ calendarId, eventId: options.eventId });
    const attendees = existing.data.attendees ?? [];
    const selfAttendee = attendees.find((a) => a.self);
    if (selfAttendee) {
      selfAttendee.responseStatus = options.responseStatus;
    } else {
      // If no self entry found, we can't RSVP — the user may not be an attendee
      throw new Error("Cannot RSVP: you are not an attendee of this event");
    }
    resource.attendees = attendees;
  }

  const response = await calendar.events.patch({
    calendarId,
    eventId: options.eventId,
    requestBody: resource,
    sendUpdates: "all",
  });

  logger.info("Updated event", { id: options.eventId });
  return toCalendarEvent(response.data, calendarId);
}

/**
 * Delete an event
 */
export async function deleteEvent(
  eventId: string,
  calendarId = "primary"
): Promise<void> {
  const calendar = await getCalendarClient();

  await calendar.events.delete({
    calendarId,
    eventId,
    sendUpdates: "all",
  });

  logger.info("Deleted event", { id: eventId, calendarId });
}

/**
 * Quick add event using natural language
 */
export async function quickAddEvent(
  text: string,
  calendarId = "primary"
): Promise<CalendarEvent> {
  const calendar = await getCalendarClient();

  const response = await calendar.events.quickAdd({
    calendarId,
    text,
  });

  logger.info("Quick added event", { id: response.data.id, text });
  return toCalendarEvent(response.data, calendarId);
}

/**
 * Query free/busy information
 */
export async function findFreeTime(
  timeMin: string,
  timeMax: string,
  calendarIds: string[] = ["primary"]
): Promise<FreeBusyResult> {
  const calendar = await getCalendarClient();

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      items: calendarIds.map((id) => ({ id })),
    },
  });

  const calendars: FreeBusyResult["calendars"] = {};

  if (response.data.calendars) {
    for (const [id, info] of Object.entries(response.data.calendars)) {
      calendars[id] = {
        busy: (info.busy ?? []).map((b) => ({
          start: b.start!,
          end: b.end!,
        })),
      };
    }
  }

  logger.debug("Free/busy query", { timeMin, timeMax, calendarIds });
  return { timeMin, timeMax, calendars };
}
