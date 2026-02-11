/**
 * Google Calendar API types
 */

export interface CalendarInfo {
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  primary?: boolean;
  accessRole: string;
}

export interface EventAttendee {
  email: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  organizer?: boolean;
  self?: boolean;
}

export interface EventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface EventReminder {
  method: "email" | "popup";
  minutes: number;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  status: string;
  htmlLink?: string;
  creator?: { email: string; displayName?: string };
  organizer?: { email: string; displayName?: string };
  attendees?: EventAttendee[];
  recurrence?: string[];
  recurringEventId?: string;
  created?: string;
  updated?: string;
  reminders?: {
    useDefault: boolean;
    overrides?: EventReminder[];
  };
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType: string;
      uri: string;
      label?: string;
    }>;
  };
}

export interface CalendarEventSummary {
  id: string;
  calendarId: string;
  summary: string;
  start: EventDateTime;
  end: EventDateTime;
  status: string;
  location?: string;
  attendeeCount?: number;
  isAllDay: boolean;
}

export interface ListEventsOptions {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  query?: string;
  maxResults?: number;
  pageToken?: string;
  singleEvents?: boolean;
  orderBy?: "startTime" | "updated";
}

export interface ListEventsResult {
  events: CalendarEventSummary[];
  nextPageToken?: string;
  timeZone: string;
}

export interface CreateEventOptions {
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  startDateTime?: string;
  startDate?: string;
  endDateTime?: string;
  endDate?: string;
  timeZone?: string;
  attendees?: string[];
  recurrence?: string[];
  reminders?: EventReminder[];
}

export interface UpdateEventOptions {
  calendarId?: string;
  eventId: string;
  summary?: string;
  description?: string;
  location?: string;
  startDateTime?: string;
  startDate?: string;
  endDateTime?: string;
  endDate?: string;
  timeZone?: string;
  attendees?: string[];
  responseStatus?: "accepted" | "declined" | "tentative";
}

export interface FreeBusyResult {
  timeMin: string;
  timeMax: string;
  calendars: Record<
    string,
    {
      busy: Array<{ start: string; end: string }>;
    }
  >;
}
