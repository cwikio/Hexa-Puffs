/**
 * Calendar fixture data for tests.
 * These match the transformed types returned by client functions, NOT raw googleapis responses.
 */

import type {
  CalendarInfo,
  CalendarEvent,
  CalendarEventSummary,
  ListEventsResult,
  FreeBusyResult,
} from "../../types/calendar.js";

// ---------------------------------------------------------------------------
// Calendars
// ---------------------------------------------------------------------------

export const MOCK_CALENDAR_INFO: CalendarInfo = {
  id: "tomasz@example.com",
  summary: "Tomasz",
  description: "Primary calendar",
  timeZone: "America/New_York",
  backgroundColor: "#4285f4",
  foregroundColor: "#ffffff",
  primary: true,
  accessRole: "owner",
};

export const MOCK_CALENDARS: CalendarInfo[] = [
  MOCK_CALENDAR_INFO,
  {
    id: "team-shared@group.calendar.google.com",
    summary: "Engineering Team",
    description: "Shared calendar for the engineering team",
    timeZone: "America/New_York",
    backgroundColor: "#0b8043",
    foregroundColor: "#ffffff",
    primary: false,
    accessRole: "writer",
  },
];

// ---------------------------------------------------------------------------
// Full events
// ---------------------------------------------------------------------------

export const MOCK_TIMED_EVENT: CalendarEvent = {
  id: "evt_abc123def456",
  calendarId: "tomasz@example.com",
  summary: "Sprint Planning",
  description:
    "Review backlog and plan next sprint. Please come prepared with your estimates.",
  location: "Conference Room B",
  start: {
    dateTime: "2025-03-17T10:00:00-04:00",
    timeZone: "America/New_York",
  },
  end: {
    dateTime: "2025-03-17T11:30:00-04:00",
    timeZone: "America/New_York",
  },
  status: "confirmed",
  htmlLink:
    "https://www.google.com/calendar/event?eid=ZXZ0X2FiYzEyM2RlZjQ1Ng",
  creator: { email: "tomasz@example.com", displayName: "Tomasz" },
  organizer: { email: "tomasz@example.com", displayName: "Tomasz" },
  attendees: [
    {
      email: "tomasz@example.com",
      displayName: "Tomasz",
      responseStatus: "accepted",
      organizer: true,
      self: true,
    },
    {
      email: "sarah.chen@acme.com",
      displayName: "Sarah Chen",
      responseStatus: "accepted",
    },
    {
      email: "james.miller@acme.com",
      displayName: "James Miller",
      responseStatus: "tentative",
    },
  ],
  created: "2025-03-10T08:00:00Z",
  updated: "2025-03-14T12:30:00Z",
  reminders: {
    useDefault: false,
    overrides: [
      { method: "popup", minutes: 10 },
      { method: "email", minutes: 60 },
    ],
  },
  conferenceData: {
    entryPoints: [
      {
        entryPointType: "video",
        uri: "https://meet.google.com/abc-defg-hij",
        label: "meet.google.com/abc-defg-hij",
      },
    ],
  },
};

export const MOCK_ALL_DAY_EVENT: CalendarEvent = {
  id: "evt_xyz789ghi012",
  calendarId: "tomasz@example.com",
  summary: "Company Offsite",
  description: "Annual company offsite at the lakehouse retreat.",
  location: "Lakehouse Retreat, 123 Lake Drive, Hudson Valley, NY",
  start: {
    date: "2025-03-20",
  },
  end: {
    date: "2025-03-22",
  },
  status: "confirmed",
  htmlLink:
    "https://www.google.com/calendar/event?eid=ZXZ0X3h5ejc4OWdoaTAxMg",
  creator: { email: "hr@acme.com", displayName: "HR Team" },
  organizer: { email: "hr@acme.com", displayName: "HR Team" },
  created: "2025-02-01T10:00:00Z",
  updated: "2025-03-05T15:00:00Z",
  reminders: {
    useDefault: true,
  },
};

// ---------------------------------------------------------------------------
// Event summaries
// ---------------------------------------------------------------------------

export const MOCK_EVENT_SUMMARY: CalendarEventSummary = {
  id: "evt_abc123def456",
  calendarId: "tomasz@example.com",
  summary: "Sprint Planning",
  start: {
    dateTime: "2025-03-17T10:00:00-04:00",
    timeZone: "America/New_York",
  },
  end: {
    dateTime: "2025-03-17T11:30:00-04:00",
    timeZone: "America/New_York",
  },
  status: "confirmed",
  location: "Conference Room B",
  attendeeCount: 3,
  isAllDay: false,
};

const secondEventSummary: CalendarEventSummary = {
  id: "evt_mno345pqr678",
  calendarId: "tomasz@example.com",
  summary: "1:1 with Sarah",
  start: {
    dateTime: "2025-03-17T14:00:00-04:00",
    timeZone: "America/New_York",
  },
  end: {
    dateTime: "2025-03-17T14:30:00-04:00",
    timeZone: "America/New_York",
  },
  status: "confirmed",
  attendeeCount: 2,
  isAllDay: false,
};

export const MOCK_LIST_EVENTS_RESULT: ListEventsResult = {
  events: [MOCK_EVENT_SUMMARY, secondEventSummary],
  nextPageToken: "CigKGmk2OWlhNmVmZjRiZjY0YzEQgL3P9asxGAEg",
  timeZone: "America/New_York",
};

// ---------------------------------------------------------------------------
// Free/busy
// ---------------------------------------------------------------------------

export const MOCK_FREEBUSY_RESULT: FreeBusyResult = {
  timeMin: "2025-03-17T00:00:00-04:00",
  timeMax: "2025-03-17T23:59:59-04:00",
  calendars: {
    "tomasz@example.com": {
      busy: [
        {
          start: "2025-03-17T10:00:00-04:00",
          end: "2025-03-17T11:30:00-04:00",
        },
        {
          start: "2025-03-17T14:00:00-04:00",
          end: "2025-03-17T14:30:00-04:00",
        },
      ],
    },
    "sarah.chen@acme.com": {
      busy: [
        {
          start: "2025-03-17T09:00:00-04:00",
          end: "2025-03-17T10:00:00-04:00",
        },
        {
          start: "2025-03-17T13:00:00-04:00",
          end: "2025-03-17T15:00:00-04:00",
        },
      ],
    },
  },
};
