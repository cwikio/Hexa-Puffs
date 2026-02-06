/**
 * Gmail fixture data for tests.
 * These match the transformed types returned by client functions, NOT raw googleapis responses.
 */

import type {
  EmailSummary,
  EmailMessage,
  Label,
  Draft,
  ListEmailsResult,
  GmailFilter,
} from "../../types/gmail.js";

// ---------------------------------------------------------------------------
// Email summaries & messages
// ---------------------------------------------------------------------------

export const MOCK_EMAIL_SUMMARY: EmailSummary = {
  id: "18f4a2b3c4d5e6f7",
  threadId: "18f4a2b3c4d5e6f7",
  subject: "Q1 Budget Review - Action Required",
  from: { email: "sarah.chen@acme.com", name: "Sarah Chen" },
  snippet:
    "Hi team, please review the attached Q1 budget spreadsheet and provide your feedback by Friday...",
  date: "2025-03-15T09:24:00Z",
  isUnread: true,
  labelIds: ["INBOX", "UNREAD", "CATEGORY_UPDATES"],
};

export const MOCK_EMAIL_MESSAGE: EmailMessage = {
  id: "18f4a2b3c4d5e6f7",
  threadId: "18f4a2b3c4d5e6f7",
  labelIds: ["INBOX", "UNREAD"],
  snippet:
    "Hi Tomasz, just a quick reminder that the project kickoff meeting is scheduled for Monday at 10am...",
  subject: "Project Kickoff - Monday 10am",
  from: { email: "james.miller@acme.com", name: "James Miller" },
  to: [{ email: "tomasz@example.com", name: "Tomasz" }],
  cc: [{ email: "lisa.park@acme.com", name: "Lisa Park" }],
  date: "2025-03-14T16:45:00Z",
  body: {
    text: "Hi Tomasz,\n\nJust a quick reminder that the project kickoff meeting is scheduled for Monday at 10am in Conference Room B.\n\nPlease bring your laptop and any preliminary notes.\n\nBest,\nJames",
  },
  isUnread: true,
};

export const MOCK_EMAIL_MESSAGE_HTML: EmailMessage = {
  id: "18f5b3c4d5e6f7a8",
  threadId: "18f5b3c4d5e6f7a8",
  labelIds: ["INBOX"],
  snippet: "Your weekly analytics report is ready. Website traffic increased by 23% compared to...",
  subject: "Weekly Analytics Report - March 10-16",
  from: { email: "noreply@analytics.example.com", name: "Analytics Dashboard" },
  to: [{ email: "tomasz@example.com", name: "Tomasz" }],
  date: "2025-03-16T08:00:00Z",
  body: {
    html: '<div style="font-family: Arial, sans-serif;"><h2>Weekly Analytics Report</h2><p>Your website traffic increased by <strong>23%</strong> compared to last week.</p><table><tr><th>Metric</th><th>Value</th></tr><tr><td>Page Views</td><td>12,450</td></tr><tr><td>Unique Visitors</td><td>3,820</td></tr></table></div>',
  },
  isUnread: false,
};

export const MOCK_EMAIL_MESSAGE_WITH_ATTACHMENT: EmailMessage = {
  id: "18f6c4d5e6f7a8b9",
  threadId: "18f6c4d5e6f7a8b9",
  labelIds: ["INBOX", "UNREAD", "IMPORTANT"],
  snippet: "Please find the signed contract attached. Let me know if you need any revisions...",
  subject: "Signed Contract - Project Alpha",
  from: { email: "legal@partnerco.com", name: "Maria Gonzalez" },
  to: [{ email: "tomasz@example.com", name: "Tomasz" }],
  date: "2025-03-13T14:30:00Z",
  body: {
    text: "Hi Tomasz,\n\nPlease find the signed contract attached. Let me know if you need any revisions before we proceed.\n\nRegards,\nMaria Gonzalez\nLegal Department, PartnerCo",
  },
  attachments: [
    {
      attachmentId: "ANGjdJ9Tz3qFk7XbRtVm",
      filename: "Contract_ProjectAlpha_Signed.pdf",
      mimeType: "application/pdf",
      size: 245_760,
    },
  ],
  isUnread: true,
};

// ---------------------------------------------------------------------------
// List results
// ---------------------------------------------------------------------------

const secondSummary: EmailSummary = {
  id: "18f3b1a2c3d4e5f6",
  threadId: "18f3b1a2c3d4e5f6",
  subject: "Lunch tomorrow?",
  from: { email: "dave.wilson@acme.com", name: "Dave Wilson" },
  snippet: "Hey, want to grab lunch tomorrow at the new Thai place?",
  date: "2025-03-14T11:02:00Z",
  isUnread: false,
  labelIds: ["INBOX"],
};

export const MOCK_LIST_EMAILS_RESULT: ListEmailsResult = {
  messages: [MOCK_EMAIL_SUMMARY, secondSummary],
  nextPageToken: "token_abc123def456",
  resultSizeEstimate: 42,
};

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const MOCK_LABEL: Label = {
  id: "Label_42",
  name: "Work",
  type: "user",
  messagesTotal: 128,
  messagesUnread: 5,
};

export const MOCK_LABELS: Label[] = [
  {
    id: "INBOX",
    name: "INBOX",
    type: "system",
    messagesTotal: 1_024,
    messagesUnread: 17,
  },
  MOCK_LABEL,
];

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export const MOCK_DRAFT: Draft = {
  id: "r_draft_abc123",
  message: {
    id: "18f7d5e6f7a8b9c0",
    threadId: "18f7d5e6f7a8b9c0",
    subject: "Re: Partnership Proposal",
    to: [{ email: "ceo@startupxyz.com", name: "Alex Rivera" }],
    snippet: "Thanks for reaching out. I've reviewed the proposal and have a few questions...",
  },
};

export const MOCK_DRAFTS: Draft[] = [
  MOCK_DRAFT,
  {
    id: "r_draft_def456",
    message: {
      id: "18f8e6f7a8b9c0d1",
      threadId: "18f4a2b3c4d5e6f7",
      subject: "Re: Q1 Budget Review - Action Required",
      to: [{ email: "sarah.chen@acme.com", name: "Sarah Chen" }],
      snippet: "Hi Sarah, I've gone through the numbers and everything looks good except...",
    },
  },
];

// ---------------------------------------------------------------------------
// Send / Draft results
// ---------------------------------------------------------------------------

export const MOCK_SEND_RESULT: { id: string; threadId: string } = {
  id: "18f9f7a8b9c0d1e2",
  threadId: "18f4a2b3c4d5e6f7",
};

export const MOCK_DRAFT_RESULT: { id: string; messageId: string } = {
  id: "r_draft_ghi789",
  messageId: "18faa8b9c0d1e2f3",
};

// ---------------------------------------------------------------------------
// Attachment data
// ---------------------------------------------------------------------------

export const MOCK_ATTACHMENT_DATA: { data: string; size: number } = {
  data: "JVBERi0xLjcKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2Jq",
  size: 245_760,
};

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const MOCK_FILTER: GmailFilter = {
  id: "ANe1Bmj5Kz8Xp3wR",
  criteria: {
    from: "notifications@github.com",
    hasAttachment: false,
  },
  action: {
    addLabelIds: ["Label_42"],
    removeLabelIds: ["INBOX"],
  },
};

export const MOCK_FILTERS: GmailFilter[] = [
  MOCK_FILTER,
  {
    id: "ANe1Bmk7Yt9Xq4vS",
    criteria: {
      from: "billing@aws.amazon.com",
      subject: "AWS Invoice",
    },
    action: {
      addLabelIds: ["Label_55"],
    },
  },
];
