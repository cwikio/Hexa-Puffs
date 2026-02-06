import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock all client modules so tool handlers can be imported without googleapis
// ---------------------------------------------------------------------------

vi.mock("../gmail/client.js", () => ({
  listEmails: vi.fn(),
  getEmail: vi.fn(),
  sendEmail: vi.fn(),
  replyToEmail: vi.fn(),
  trashEmail: vi.fn(),
  deleteEmail: vi.fn(),
  markRead: vi.fn(),
  modifyLabels: vi.fn(),
  listLabels: vi.fn(),
  createLabel: vi.fn(),
  deleteLabel: vi.fn(),
  listDrafts: vi.fn(),
  createDraft: vi.fn(),
  updateDraft: vi.fn(),
  sendDraft: vi.fn(),
  deleteDraft: vi.fn(),
  getAttachment: vi.fn(),
  listAttachments: vi.fn(),
  getProfile: vi.fn(),
  getHistory: vi.fn(),
  listFilters: vi.fn(),
  getFilter: vi.fn(),
  createFilter: vi.fn(),
  deleteFilter: vi.fn(),
}));

vi.mock("../calendar/client.js", () => ({
  listCalendars: vi.fn(),
  listEvents: vi.fn(),
  getEvent: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  quickAddEvent: vi.fn(),
  findFreeTime: vi.fn(),
}));

vi.mock("../gmail/polling.js", () => ({
  getNewEmails: vi.fn().mockReturnValue([]),
  clearNewEmails: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

import { allTools } from "../tools/index.js";

// ---------------------------------------------------------------------------
// Expected tool names (all 30)
// ---------------------------------------------------------------------------

const EXPECTED_TOOL_NAMES = [
  // Messages (8)
  "list_emails",
  "get_email",
  "send_email",
  "reply_email",
  "delete_email",
  "mark_read",
  "modify_labels",
  "get_new_emails",
  // Drafts (5)
  "list_drafts",
  "create_draft",
  "update_draft",
  "send_draft",
  "delete_draft",
  // Labels (3)
  "list_labels",
  "create_label",
  "delete_label",
  // Attachments (2)
  "list_attachments",
  "get_attachment",
  // Calendar (8)
  "list_calendars",
  "list_events",
  "get_event",
  "create_event",
  "update_event",
  "delete_event",
  "quick_add_event",
  "find_free_time",
  // Filters (4)
  "list_filters",
  "get_filter",
  "create_filter",
  "delete_filter",
];

// ===========================================================================
// Tool Registry
// ===========================================================================

describe("Tool Registry", () => {
  it("registers all 30 tools", () => {
    expect(allTools).toHaveLength(30);
  });

  it("includes all expected tool names", () => {
    const registeredNames = allTools.map((t) => t.tool.name);
    for (const name of EXPECTED_TOOL_NAMES) {
      expect(registeredNames).toContain(name);
    }
  });

  it("has no duplicate tool names", () => {
    const names = allTools.map((t) => t.tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("each tool has required schema fields", () => {
    for (const { tool } of allTools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    }
  });

  it("each tool has a handler function", () => {
    for (const { handler } of allTools) {
      expect(typeof handler).toBe("function");
    }
  });
});
