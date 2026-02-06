import { z } from "zod";
import {
  listCalendars,
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  quickAddEvent,
  findFreeTime,
} from "../calendar/client.js";
import { logger } from "../utils/logger.js";
import {
  type StandardResponse,
  createSuccess,
  createError,
} from "@mcp/shared/Types/StandardResponse.js";
import type {
  CalendarInfo,
  CalendarEvent,
  ListEventsResult,
  FreeBusyResult,
} from "../types/calendar.js";

// ============ LIST CALENDARS ============

export const listCalendarsTool = {
  name: "list_calendars",
  description:
    "List all calendars the user has access to, including shared calendars",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [] as string[],
  },
};

export const ListCalendarsInputSchema = z.object({});

export async function handleListCalendars(
  _args: unknown
): Promise<StandardResponse<CalendarInfo[]>> {
  try {
    const calendars = await listCalendars();
    return createSuccess(calendars);
  } catch (error) {
    logger.error("Failed to list calendars", { error });
    return createError(
      `Failed to list calendars: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ LIST EVENTS ============

export const listEventsTool = {
  name: "list_events",
  description:
    "List calendar events within a date range. Defaults to primary calendar. Use ISO 8601 datetime format for time_min/time_max (e.g., '2026-01-01T00:00:00Z').",
  inputSchema: {
    type: "object" as const,
    properties: {
      calendar_id: {
        type: "string",
        description: 'Calendar ID to list events from (default: "primary")',
      },
      time_min: {
        type: "string",
        description:
          "Start of time range (ISO 8601, e.g., '2026-01-01T00:00:00Z')",
      },
      time_max: {
        type: "string",
        description:
          "End of time range (ISO 8601, e.g., '2026-01-31T23:59:59Z')",
      },
      query: {
        type: "string",
        description:
          "Free text search terms to find events matching summary, description, location, etc.",
      },
      max_results: {
        type: "number",
        description:
          "Maximum number of events to return (default: 25, max: 250)",
      },
      page_token: {
        type: "string",
        description: "Token for pagination to get next page of results",
      },
    },
    required: [] as string[],
  },
};

export const ListEventsInputSchema = z.object({
  calendar_id: z.string().optional(),
  time_min: z.string().optional(),
  time_max: z.string().optional(),
  query: z.string().optional(),
  max_results: z.coerce.number().min(1).max(250).optional(),
  page_token: z.string().optional(),
});

export async function handleListEvents(
  args: unknown
): Promise<StandardResponse<ListEventsResult>> {
  const parseResult = ListEventsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { calendar_id, time_min, time_max, query, max_results, page_token } =
    parseResult.data;

  try {
    const result = await listEvents({
      calendarId: calendar_id,
      timeMin: time_min,
      timeMax: time_max,
      query,
      maxResults: max_results,
      pageToken: page_token,
    });

    return createSuccess(result);
  } catch (error) {
    logger.error("Failed to list events", { error });
    return createError(
      `Failed to list events: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ GET EVENT ============

export const getEventTool = {
  name: "get_event",
  description:
    "Get detailed information about a specific calendar event by ID",
  inputSchema: {
    type: "object" as const,
    properties: {
      event_id: {
        type: "string",
        description: "The ID of the event to retrieve",
      },
      calendar_id: {
        type: "string",
        description:
          'Calendar ID containing the event (default: "primary")',
      },
    },
    required: ["event_id"],
  },
};

export const GetEventInputSchema = z.object({
  event_id: z.string().min(1),
  calendar_id: z.string().optional(),
});

export async function handleGetEvent(
  args: unknown
): Promise<StandardResponse<CalendarEvent>> {
  const parseResult = GetEventInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { event_id, calendar_id } = parseResult.data;

  try {
    const event = await getEvent(event_id, calendar_id);
    return createSuccess(event);
  } catch (error) {
    logger.error("Failed to get event", { error });
    return createError(
      `Failed to get event: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ CREATE EVENT ============

export const createEventTool = {
  name: "create_event",
  description:
    "Create a new calendar event. For timed events use start_date_time/end_date_time (ISO 8601). For all-day events use start_date/end_date (YYYY-MM-DD, end date is exclusive).",
  inputSchema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description: "Event title",
      },
      description: {
        type: "string",
        description: "Event description/notes",
      },
      location: {
        type: "string",
        description: "Event location",
      },
      start_date_time: {
        type: "string",
        description:
          "Start time for timed events (ISO 8601, e.g., '2026-01-15T09:00:00-05:00')",
      },
      start_date: {
        type: "string",
        description: "Start date for all-day events (YYYY-MM-DD)",
      },
      end_date_time: {
        type: "string",
        description: "End time for timed events (ISO 8601)",
      },
      end_date: {
        type: "string",
        description: "End date for all-day events (YYYY-MM-DD, exclusive)",
      },
      time_zone: {
        type: "string",
        description:
          "IANA time zone (e.g., 'America/New_York'). Defaults to calendar's time zone.",
      },
      attendees: {
        type: "array",
        items: { type: "string" },
        description: "Email addresses of attendees",
      },
      recurrence: {
        type: "array",
        items: { type: "string" },
        description:
          'RRULE strings for recurring events (e.g., ["RRULE:FREQ=WEEKLY;COUNT=10"])',
      },
      reminders: {
        type: "array",
        items: {
          type: "object",
          properties: {
            method: {
              type: "string",
              description: '"email" or "popup"',
            },
            minutes: {
              type: "number",
              description: "Minutes before event",
            },
          },
          required: ["method", "minutes"],
        },
        description: "Custom reminders (overrides default reminders)",
      },
      calendar_id: {
        type: "string",
        description:
          'Calendar to create event in (default: "primary")',
      },
    },
    required: ["summary"],
  },
};

export const CreateEventInputSchema = z.object({
  summary: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  start_date_time: z.string().optional(),
  start_date: z.string().optional(),
  end_date_time: z.string().optional(),
  end_date: z.string().optional(),
  time_zone: z.string().optional(),
  attendees: z.array(z.string()).optional(),
  recurrence: z.array(z.string()).optional(),
  reminders: z
    .array(
      z.object({
        method: z.enum(["email", "popup"]),
        minutes: z.coerce.number().min(0),
      })
    )
    .optional(),
  calendar_id: z.string().optional(),
});

export async function handleCreateEvent(
  args: unknown
): Promise<StandardResponse<CalendarEvent>> {
  const parseResult = CreateEventInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const data = parseResult.data;

  // Validate: must provide either start_date_time or start_date
  if (!data.start_date_time && !data.start_date) {
    return createError(
      "Must provide either start_date_time (for timed events) or start_date (for all-day events)"
    );
  }

  if (data.start_date_time && data.start_date) {
    return createError(
      "Provide either start_date_time or start_date, not both"
    );
  }

  try {
    const event = await createEvent({
      calendarId: data.calendar_id,
      summary: data.summary,
      description: data.description,
      location: data.location,
      startDateTime: data.start_date_time,
      startDate: data.start_date,
      endDateTime: data.end_date_time,
      endDate: data.end_date,
      timeZone: data.time_zone,
      attendees: data.attendees,
      recurrence: data.recurrence,
      reminders: data.reminders,
    });

    return createSuccess(event);
  } catch (error) {
    logger.error("Failed to create event", { error });
    return createError(
      `Failed to create event: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ UPDATE EVENT ============

export const updateEventTool = {
  name: "update_event",
  description:
    "Update an existing calendar event. Only provide fields you want to change. Use response_status to accept, decline, or tentatively accept an invite.",
  inputSchema: {
    type: "object" as const,
    properties: {
      event_id: {
        type: "string",
        description: "ID of the event to update",
      },
      summary: {
        type: "string",
        description: "Updated event title",
      },
      description: {
        type: "string",
        description: "Updated event description/notes",
      },
      location: {
        type: "string",
        description: "Updated event location",
      },
      start_date_time: {
        type: "string",
        description: "Updated start time (ISO 8601)",
      },
      start_date: {
        type: "string",
        description: "Updated start date for all-day events (YYYY-MM-DD)",
      },
      end_date_time: {
        type: "string",
        description: "Updated end time (ISO 8601)",
      },
      end_date: {
        type: "string",
        description:
          "Updated end date for all-day events (YYYY-MM-DD, exclusive)",
      },
      time_zone: {
        type: "string",
        description: "Updated IANA time zone",
      },
      attendees: {
        type: "array",
        items: { type: "string" },
        description:
          "Updated list of attendee email addresses (replaces existing list)",
      },
      response_status: {
        type: "string",
        enum: ["accepted", "declined", "tentative"],
        description:
          "RSVP to a calendar invite: accept, decline, or tentatively accept",
      },
      calendar_id: {
        type: "string",
        description:
          'Calendar containing the event (default: "primary")',
      },
    },
    required: ["event_id"],
  },
};

export const UpdateEventInputSchema = z.object({
  event_id: z.string().min(1),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start_date_time: z.string().optional(),
  start_date: z.string().optional(),
  end_date_time: z.string().optional(),
  end_date: z.string().optional(),
  time_zone: z.string().optional(),
  attendees: z.array(z.string()).optional(),
  response_status: z.enum(["accepted", "declined", "tentative"]).optional(),
  calendar_id: z.string().optional(),
});

export async function handleUpdateEvent(
  args: unknown
): Promise<StandardResponse<CalendarEvent>> {
  const parseResult = UpdateEventInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const data = parseResult.data;

  if (data.start_date_time && data.start_date) {
    return createError(
      "Provide either start_date_time or start_date, not both"
    );
  }

  try {
    const event = await updateEvent({
      calendarId: data.calendar_id,
      eventId: data.event_id,
      summary: data.summary,
      description: data.description,
      location: data.location,
      startDateTime: data.start_date_time,
      startDate: data.start_date,
      endDateTime: data.end_date_time,
      endDate: data.end_date,
      timeZone: data.time_zone,
      attendees: data.attendees,
      responseStatus: data.response_status,
    });

    return createSuccess(event);
  } catch (error) {
    logger.error("Failed to update event", { error });
    return createError(
      `Failed to update event: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ DELETE EVENT ============

export const deleteEventTool = {
  name: "delete_event",
  description: "Delete a calendar event",
  inputSchema: {
    type: "object" as const,
    properties: {
      event_id: {
        type: "string",
        description: "ID of the event to delete",
      },
      calendar_id: {
        type: "string",
        description:
          'Calendar containing the event (default: "primary")',
      },
    },
    required: ["event_id"],
  },
};

export const DeleteEventInputSchema = z.object({
  event_id: z.string().min(1),
  calendar_id: z.string().optional(),
});

export async function handleDeleteEvent(
  args: unknown
): Promise<StandardResponse<{ deleted: boolean }>> {
  const parseResult = DeleteEventInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { event_id, calendar_id } = parseResult.data;

  try {
    await deleteEvent(event_id, calendar_id);
    return createSuccess({ deleted: true });
  } catch (error) {
    logger.error("Failed to delete event", { error });
    return createError(
      `Failed to delete event: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ QUICK ADD EVENT ============

export const quickAddEventTool = {
  name: "quick_add_event",
  description:
    'Create a calendar event using natural language (e.g., "Meeting with John tomorrow at 3pm for 1 hour")',
  inputSchema: {
    type: "object" as const,
    properties: {
      text: {
        type: "string",
        description: "Natural language description of the event to create",
      },
      calendar_id: {
        type: "string",
        description:
          'Calendar to create event in (default: "primary")',
      },
    },
    required: ["text"],
  },
};

export const QuickAddEventInputSchema = z.object({
  text: z.string().min(1),
  calendar_id: z.string().optional(),
});

export async function handleQuickAddEvent(
  args: unknown
): Promise<StandardResponse<CalendarEvent>> {
  const parseResult = QuickAddEventInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { text, calendar_id } = parseResult.data;

  try {
    const event = await quickAddEvent(text, calendar_id);
    return createSuccess(event);
  } catch (error) {
    logger.error("Failed to quick add event", { error });
    return createError(
      `Failed to quick add event: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ FIND FREE TIME ============

export const findFreeTimeTool = {
  name: "find_free_time",
  description:
    "Query free/busy information for one or more calendars within a time range. Returns busy time blocks.",
  inputSchema: {
    type: "object" as const,
    properties: {
      time_min: {
        type: "string",
        description: "Start of time range to check (ISO 8601)",
      },
      time_max: {
        type: "string",
        description: "End of time range to check (ISO 8601)",
      },
      calendar_ids: {
        type: "array",
        items: { type: "string" },
        description: 'Calendar IDs to check (default: ["primary"])',
      },
    },
    required: ["time_min", "time_max"],
  },
};

export const FindFreeTimeInputSchema = z.object({
  time_min: z.string().min(1),
  time_max: z.string().min(1),
  calendar_ids: z.array(z.string()).optional(),
});

export async function handleFindFreeTime(
  args: unknown
): Promise<StandardResponse<FreeBusyResult>> {
  const parseResult = FindFreeTimeInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { time_min, time_max, calendar_ids } = parseResult.data;

  try {
    const result = await findFreeTime(time_min, time_max, calendar_ids);
    return createSuccess(result);
  } catch (error) {
    logger.error("Failed to query free/busy", { error });
    return createError(
      `Failed to query free/busy: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
