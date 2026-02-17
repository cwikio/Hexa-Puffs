import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock objects — available inside vi.mock factories
// ---------------------------------------------------------------------------

const { mockMessages, mockLabels, mockDrafts, mockFilters, mockGetProfile, mockHistoryList } =
  vi.hoisted(() => ({
    mockMessages: {
      list: vi.fn(),
      get: vi.fn(),
      send: vi.fn(),
      trash: vi.fn(),
      delete: vi.fn(),
      modify: vi.fn(),
      attachments: { get: vi.fn() },
    },
    mockLabels: {
      list: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    mockDrafts: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      send: vi.fn(),
      delete: vi.fn(),
    },
    mockFilters: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    mockGetProfile: vi.fn(),
    mockHistoryList: vi.fn(),
  }));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../gmail/auth.js", () => ({
  getAuthenticatedClient: vi.fn().mockResolvedValue({}),
}));

vi.mock("googleapis", () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        messages: mockMessages,
        labels: mockLabels,
        drafts: mockDrafts,
        getProfile: mockGetProfile,
        history: { list: mockHistoryList },
        settings: { filters: mockFilters },
      },
    })),
  },
}));

// ---------------------------------------------------------------------------
// Import client functions AFTER mocks are set up
// ---------------------------------------------------------------------------

import {
  listEmails,
  getEmail,
  sendEmail,
  replyToEmail,
  trashEmail,
  deleteEmail,
  markRead,
  modifyLabels,
  listLabels,
  createLabel,
  deleteLabel,
  listDrafts,
  createDraft,
  updateDraft,
  sendDraft,
  deleteDraft,
  getAttachment,
  listAttachments,
  getProfile,
  getHistory,
  listFilters,
  getFilter,
  createFilter,
  deleteFilter,
} from "../../gmail/client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Base64url-encode a UTF-8 string (matching Gmail API encoding). */
function toBase64Url(str: string): string {
  return Buffer.from(str, "utf-8").toString("base64url");
}

/** Decode a base64url string back to UTF-8 (for verifying MIME output). */
function fromBase64Url(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

/** Build a minimal Gmail API message with the given headers. */
function makeGmailMessage(
  id: string,
  headers: Array<{ name: string; value: string }>,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    threadId: `thread-${id}`,
    labelIds: ["INBOX"],
    snippet: "Preview text",
    payload: { headers },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// listEmails
// ===========================================================================

describe("listEmails", () => {
  it("fetches metadata for each message and returns EmailSummary[]", async () => {
    mockMessages.list.mockResolvedValue({
      data: {
        messages: [{ id: "msg-1" }],
        nextPageToken: "next-page",
        resultSizeEstimate: 1,
      },
    });

    mockMessages.get.mockResolvedValue({
      data: makeGmailMessage("msg-1", [
        { name: "From", value: "John Doe <john@example.com>" },
        { name: "To", value: "me@test.com" },
        { name: "Subject", value: "Hello World" },
        { name: "Date", value: "Wed, 01 Jan 2026 12:00:00 +0000" },
      ]),
    });

    const result = await listEmails({ query: "is:unread", maxResults: 10 });

    expect(mockMessages.list).toHaveBeenCalledWith({
      userId: "me",
      q: "is:unread",
      maxResults: 10,
      labelIds: undefined,
      pageToken: undefined,
      includeSpamTrash: false,
    });

    expect(mockMessages.get).toHaveBeenCalledWith({
      userId: "me",
      id: "msg-1",
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Date"],
    });

    expect(result.messages).toHaveLength(1);
    expect(result.nextPageToken).toBe("next-page");
    expect(result.resultSizeEstimate).toBe(1);

    const summary = result.messages[0];
    expect(summary.id).toBe("msg-1");
    expect(summary.threadId).toBe("thread-msg-1");
    expect(summary.subject).toBe("Hello World");
    expect(summary.from).toEqual({ email: "john@example.com", name: "John Doe" });
    expect(summary.date).toBe("Wed, 01 Jan 2026 12:00:00 +0000");
    expect(summary.isUnread).toBe(false);
  });

  it("returns empty messages array when API returns no messages", async () => {
    mockMessages.list.mockResolvedValue({
      data: { messages: undefined, resultSizeEstimate: 0 },
    });

    const result = await listEmails();

    expect(mockMessages.get).not.toHaveBeenCalled();
    expect(result.messages).toEqual([]);
    expect(result.resultSizeEstimate).toBe(0);
  });

  it("uses defaults when called with no options", async () => {
    mockMessages.list.mockResolvedValue({
      data: { messages: undefined, resultSizeEstimate: 0 },
    });

    await listEmails();

    expect(mockMessages.list).toHaveBeenCalledWith({
      userId: "me",
      q: undefined,
      maxResults: 20,
      labelIds: undefined,
      pageToken: undefined,
      includeSpamTrash: false,
    });
  });

  it("detects unread messages via UNREAD label", async () => {
    mockMessages.list.mockResolvedValue({
      data: { messages: [{ id: "msg-u" }], resultSizeEstimate: 1 },
    });

    mockMessages.get.mockResolvedValue({
      data: makeGmailMessage(
        "msg-u",
        [
          { name: "From", value: "sender@test.com" },
          { name: "Subject", value: "Unread" },
          { name: "Date", value: "2026-01-01" },
        ],
        { labelIds: ["INBOX", "UNREAD"] }
      ),
    });

    const result = await listEmails();
    expect(result.messages[0].isUnread).toBe(true);
  });
});

// ===========================================================================
// getEmail
// ===========================================================================

describe("getEmail", () => {
  it("returns a fully parsed EmailMessage with text body", async () => {
    const bodyText = "Hello, this is the email body.";

    mockMessages.get.mockResolvedValue({
      data: {
        id: "msg-full",
        threadId: "thread-full",
        labelIds: ["INBOX", "UNREAD"],
        snippet: "Hello, this is the email...",
        payload: {
          headers: [
            { name: "From", value: "John Doe <john@example.com>" },
            { name: "To", value: "<me@test.com>" },
            { name: "Subject", value: "Test Subject" },
            { name: "Date", value: "2026-01-01T00:00:00Z" },
          ],
          mimeType: "text/plain",
          body: { data: toBase64Url(bodyText) },
        },
      },
    });

    const email = await getEmail("msg-full");

    expect(mockMessages.get).toHaveBeenCalledWith({
      userId: "me",
      id: "msg-full",
      format: "full",
    });

    expect(email.id).toBe("msg-full");
    expect(email.threadId).toBe("thread-full");
    expect(email.subject).toBe("Test Subject");
    expect(email.from).toEqual({ email: "john@example.com", name: "John Doe" });
    expect(email.to).toEqual([{ email: "me@test.com" }]);
    expect(email.date).toBe("2026-01-01T00:00:00Z");
    expect(email.body.text).toBe(bodyText);
    expect(email.isUnread).toBe(true);
  });

  it("parses multipart body with text and html parts", async () => {
    const textContent = "Plain text version";
    const htmlContent = "<p>HTML version</p>";

    mockMessages.get.mockResolvedValue({
      data: {
        id: "msg-multi",
        threadId: "thread-multi",
        labelIds: ["INBOX"],
        snippet: "Plain text...",
        payload: {
          mimeType: "multipart/alternative",
          headers: [
            { name: "From", value: "sender@test.com" },
            { name: "Subject", value: "Multipart" },
            { name: "Date", value: "2026-01-15" },
          ],
          parts: [
            {
              mimeType: "text/plain",
              body: { data: toBase64Url(textContent) },
            },
            {
              mimeType: "text/html",
              body: { data: toBase64Url(htmlContent) },
            },
          ],
        },
      },
    });

    const email = await getEmail("msg-multi");

    expect(email.body.text).toBe(textContent);
    expect(email.body.html).toBe(htmlContent);
  });

  it("extracts attachment info from message parts", async () => {
    mockMessages.get.mockResolvedValue({
      data: {
        id: "msg-att",
        threadId: "thread-att",
        labelIds: [],
        snippet: "",
        payload: {
          headers: [
            { name: "From", value: "sender@test.com" },
            { name: "Subject", value: "With attachment" },
            { name: "Date", value: "2026-01-15" },
          ],
          mimeType: "multipart/mixed",
          parts: [
            {
              mimeType: "text/plain",
              body: { data: toBase64Url("Body text") },
            },
            {
              filename: "report.pdf",
              mimeType: "application/pdf",
              body: { attachmentId: "att-123", size: 54321 },
            },
          ],
        },
      },
    });

    const email = await getEmail("msg-att");

    expect(email.attachments).toHaveLength(1);
    expect(email.attachments![0]).toEqual({
      attachmentId: "att-123",
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: 54321,
    });
  });

  it("handles email address without name", async () => {
    mockMessages.get.mockResolvedValue({
      data: makeGmailMessage("msg-noname", [
        { name: "From", value: "<plain@example.com>" },
        { name: "Subject", value: "No Name" },
        { name: "Date", value: "2026-01-01" },
      ]),
    });

    const email = await getEmail("msg-noname");
    expect(email.from).toEqual({ email: "plain@example.com" });
  });

  it("returns (No Subject) when Subject header is missing", async () => {
    mockMessages.get.mockResolvedValue({
      data: makeGmailMessage("msg-nosub", [
        { name: "From", value: "sender@test.com" },
        { name: "Date", value: "2026-01-01" },
      ]),
    });

    const email = await getEmail("msg-nosub");
    expect(email.subject).toBe("(No Subject)");
  });
});

// ===========================================================================
// sendEmail
// ===========================================================================

describe("sendEmail", () => {
  it("builds MIME raw email and calls messages.send", async () => {
    mockMessages.send.mockResolvedValue({
      data: { id: "sent-1", threadId: "thread-sent-1" },
    });

    const result = await sendEmail({
      to: "alice@example.com",
      subject: "Test Send",
      body: "Hello Alice",
    });

    expect(result).toEqual({ id: "sent-1", threadId: "thread-sent-1" });

    expect(mockMessages.send).toHaveBeenCalledTimes(1);
    const callArgs = mockMessages.send.mock.calls[0][0];
    expect(callArgs.userId).toBe("me");
    expect(callArgs.requestBody.threadId).toBeUndefined();

    // Decode the raw MIME to verify headers
    const rawMime = fromBase64Url(callArgs.requestBody.raw);
    expect(rawMime).toContain("To: alice@example.com");
    expect(rawMime).toContain("Subject: Test Send");
    expect(rawMime).toContain("Content-Type: text/plain; charset=utf-8");
    expect(rawMime).toContain("Hello Alice");
  });

  it("includes Cc and Bcc headers when provided", async () => {
    mockMessages.send.mockResolvedValue({
      data: { id: "sent-2", threadId: "thread-sent-2" },
    });

    await sendEmail({
      to: "alice@example.com",
      subject: "With CC",
      body: "Body",
      cc: "bob@example.com",
      bcc: "eve@example.com",
    });

    const rawMime = fromBase64Url(mockMessages.send.mock.calls[0][0].requestBody.raw);
    expect(rawMime).toContain("Cc: bob@example.com");
    expect(rawMime).toContain("Bcc: eve@example.com");
  });

  it("uses text/html content type when isHtml is true", async () => {
    mockMessages.send.mockResolvedValue({
      data: { id: "sent-3", threadId: "thread-sent-3" },
    });

    await sendEmail({
      to: "alice@example.com",
      subject: "HTML Email",
      body: "<h1>Hello</h1>",
      isHtml: true,
    });

    const rawMime = fromBase64Url(mockMessages.send.mock.calls[0][0].requestBody.raw);
    expect(rawMime).toContain("Content-Type: text/html; charset=utf-8");
  });

  it("passes threadId for threaded replies", async () => {
    mockMessages.send.mockResolvedValue({
      data: { id: "sent-4", threadId: "thread-existing" },
    });

    await sendEmail({
      to: "alice@example.com",
      subject: "Re: Thread",
      body: "Reply",
      threadId: "thread-existing",
    });

    const callArgs = mockMessages.send.mock.calls[0][0];
    expect(callArgs.requestBody.threadId).toBe("thread-existing");
  });

  it("joins multiple To addresses with commas", async () => {
    mockMessages.send.mockResolvedValue({
      data: { id: "sent-5", threadId: "thread-5" },
    });

    await sendEmail({
      to: ["alice@example.com", "bob@example.com"],
      subject: "Multi",
      body: "Body",
    });

    const rawMime = fromBase64Url(mockMessages.send.mock.calls[0][0].requestBody.raw);
    expect(rawMime).toContain("To: alice@example.com, bob@example.com");
  });

  it("includes In-Reply-To and References headers when provided", async () => {
    mockMessages.send.mockResolvedValue({
      data: { id: "sent-6", threadId: "thread-6" },
    });

    await sendEmail({
      to: "alice@example.com",
      subject: "Re: Original",
      body: "Reply body",
      inReplyTo: "<original-msg-id@mail.com>",
      references: "<original-msg-id@mail.com>",
    });

    const rawMime = fromBase64Url(mockMessages.send.mock.calls[0][0].requestBody.raw);
    expect(rawMime).toContain("In-Reply-To: <original-msg-id@mail.com>");
    expect(rawMime).toContain("References: <original-msg-id@mail.com>");
  });
});

// ===========================================================================
// replyToEmail
// ===========================================================================

describe("replyToEmail", () => {
  it("fetches original message metadata and sends a reply", async () => {
    mockMessages.get.mockResolvedValue({
      data: {
        threadId: "thread-orig",
        payload: {
          headers: [
            { name: "From", value: "sender@example.com" },
            { name: "Subject", value: "Original Subject" },
            { name: "Message-ID", value: "<msg-id-123@mail.com>" },
          ],
        },
      },
    });

    mockMessages.send.mockResolvedValue({
      data: { id: "reply-1", threadId: "thread-orig" },
    });

    const result = await replyToEmail("msg-orig", "Thank you!");

    // Should fetch original message metadata
    expect(mockMessages.get).toHaveBeenCalledWith({
      userId: "me",
      id: "msg-orig",
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Message-ID", "References"],
    });

    // Should send the reply
    expect(mockMessages.send).toHaveBeenCalledTimes(1);
    const rawMime = fromBase64Url(mockMessages.send.mock.calls[0][0].requestBody.raw);
    expect(rawMime).toContain("To: sender@example.com");
    expect(rawMime).toContain("Subject: Re: Original Subject");
    expect(rawMime).toContain("In-Reply-To: <msg-id-123@mail.com>");
    expect(rawMime).toContain("Thank you!");

    expect(result).toEqual({ id: "reply-1", threadId: "thread-orig" });
  });

  it("preserves Re: prefix if subject already starts with it", async () => {
    mockMessages.get.mockResolvedValue({
      data: {
        threadId: "thread-re",
        payload: {
          headers: [
            { name: "From", value: "sender@example.com" },
            { name: "Subject", value: "Re: Already a reply" },
            { name: "Message-ID", value: "<mid@mail.com>" },
          ],
        },
      },
    });

    mockMessages.send.mockResolvedValue({
      data: { id: "reply-2", threadId: "thread-re" },
    });

    await replyToEmail("msg-re", "Noted.");

    const rawMime = fromBase64Url(mockMessages.send.mock.calls[0][0].requestBody.raw);
    expect(rawMime).toContain("Subject: Re: Already a reply");
    // Should NOT have "Re: Re: Already a reply"
    expect(rawMime).not.toContain("Re: Re:");
  });
});

// ===========================================================================
// trashEmail / deleteEmail
// ===========================================================================

describe("trashEmail", () => {
  it("calls messages.trash with correct params", async () => {
    mockMessages.trash.mockResolvedValue({});

    await trashEmail("msg-trash");

    expect(mockMessages.trash).toHaveBeenCalledWith({
      userId: "me",
      id: "msg-trash",
    });
  });
});

describe("deleteEmail", () => {
  it("calls messages.delete with correct params", async () => {
    mockMessages.delete.mockResolvedValue({});

    await deleteEmail("msg-delete");

    expect(mockMessages.delete).toHaveBeenCalledWith({
      userId: "me",
      id: "msg-delete",
    });
  });
});

// ===========================================================================
// markRead
// ===========================================================================

describe("markRead", () => {
  it("removes UNREAD label when marking as read", async () => {
    mockMessages.modify.mockResolvedValue({});

    await markRead("msg-r", true);

    expect(mockMessages.modify).toHaveBeenCalledWith({
      userId: "me",
      id: "msg-r",
      requestBody: {
        addLabelIds: [],
        removeLabelIds: ["UNREAD"],
      },
    });
  });

  it("adds UNREAD label when marking as unread", async () => {
    mockMessages.modify.mockResolvedValue({});

    await markRead("msg-r", false);

    expect(mockMessages.modify).toHaveBeenCalledWith({
      userId: "me",
      id: "msg-r",
      requestBody: {
        addLabelIds: ["UNREAD"],
        removeLabelIds: [],
      },
    });
  });
});

// ===========================================================================
// modifyLabels
// ===========================================================================

describe("modifyLabels", () => {
  it("passes add and remove label IDs to messages.modify", async () => {
    mockMessages.modify.mockResolvedValue({});

    await modifyLabels("msg-lbl", ["STARRED"], ["UNREAD"]);

    expect(mockMessages.modify).toHaveBeenCalledWith({
      userId: "me",
      id: "msg-lbl",
      requestBody: {
        addLabelIds: ["STARRED"],
        removeLabelIds: ["UNREAD"],
      },
    });
  });

  it("uses empty arrays as defaults", async () => {
    mockMessages.modify.mockResolvedValue({});

    await modifyLabels("msg-lbl");

    expect(mockMessages.modify).toHaveBeenCalledWith({
      userId: "me",
      id: "msg-lbl",
      requestBody: {
        addLabelIds: [],
        removeLabelIds: [],
      },
    });
  });
});

// ===========================================================================
// listLabels
// ===========================================================================

describe("listLabels", () => {
  it("maps system and user labels correctly", async () => {
    mockLabels.list.mockResolvedValue({
      data: {
        labels: [
          { id: "INBOX", name: "INBOX", type: "system", messagesTotal: 100, messagesUnread: 5 },
          { id: "Label_1", name: "Custom", type: "user" },
        ],
      },
    });

    const labels = await listLabels();

    expect(mockLabels.list).toHaveBeenCalledWith({ userId: "me" });
    expect(labels).toHaveLength(2);

    expect(labels[0]).toEqual({
      id: "INBOX",
      name: "INBOX",
      type: "system",
      messagesTotal: 100,
      messagesUnread: 5,
    });

    expect(labels[1]).toEqual({
      id: "Label_1",
      name: "Custom",
      type: "user",
      messagesTotal: undefined,
      messagesUnread: undefined,
    });
  });

  it("returns empty array when no labels exist", async () => {
    mockLabels.list.mockResolvedValue({ data: { labels: undefined } });

    const labels = await listLabels();
    expect(labels).toEqual([]);
  });
});

// ===========================================================================
// createLabel
// ===========================================================================

describe("createLabel", () => {
  it("creates a label with correct visibility settings", async () => {
    mockLabels.create.mockResolvedValue({
      data: { id: "Label_new", name: "My Label" },
    });

    const label = await createLabel("My Label");

    expect(mockLabels.create).toHaveBeenCalledWith({
      userId: "me",
      requestBody: {
        name: "My Label",
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });

    expect(label).toEqual({
      id: "Label_new",
      name: "My Label",
      type: "user",
    });
  });
});

// ===========================================================================
// deleteLabel
// ===========================================================================

describe("deleteLabel", () => {
  it("calls labels.delete with correct params", async () => {
    mockLabels.delete.mockResolvedValue({});

    await deleteLabel("Label_del");

    expect(mockLabels.delete).toHaveBeenCalledWith({
      userId: "me",
      id: "Label_del",
    });
  });
});

// ===========================================================================
// listDrafts
// ===========================================================================

describe("listDrafts", () => {
  it("fetches each draft and parses headers", async () => {
    mockDrafts.list.mockResolvedValue({
      data: {
        drafts: [{ id: "draft-1" }],
      },
    });

    mockDrafts.get.mockResolvedValue({
      data: {
        id: "draft-1",
        message: {
          id: "msg-d1",
          threadId: "thread-d1",
          snippet: "Draft preview",
          payload: {
            headers: [
              { name: "Subject", value: "Draft Subject" },
              { name: "To", value: "<recipient@example.com>" },
            ],
          },
        },
      },
    });

    const drafts = await listDrafts();

    expect(mockDrafts.list).toHaveBeenCalledWith({ userId: "me" });
    expect(mockDrafts.get).toHaveBeenCalledWith({
      userId: "me",
      id: "draft-1",
      format: "metadata",
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toEqual({
      id: "draft-1",
      message: {
        id: "msg-d1",
        threadId: "thread-d1",
        subject: "Draft Subject",
        to: [{ email: "recipient@example.com" }],
        snippet: "Draft preview",
      },
    });
  });

  it("returns empty array when no drafts exist", async () => {
    mockDrafts.list.mockResolvedValue({ data: { drafts: undefined } });

    const drafts = await listDrafts();
    expect(drafts).toEqual([]);
    expect(mockDrafts.get).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// createDraft
// ===========================================================================

describe("createDraft", () => {
  it("builds MIME and creates draft with correct structure", async () => {
    mockDrafts.create.mockResolvedValue({
      data: { id: "draft-new", message: { id: "msg-dnew" } },
    });

    const result = await createDraft({
      to: "alice@example.com",
      subject: "Draft Subject",
      body: "Draft body text",
    });

    expect(result).toEqual({ id: "draft-new", messageId: "msg-dnew" });

    const callArgs = mockDrafts.create.mock.calls[0][0];
    expect(callArgs.userId).toBe("me");
    expect(callArgs.requestBody.message.raw).toBeDefined();

    const rawMime = fromBase64Url(callArgs.requestBody.message.raw);
    expect(rawMime).toContain("To: alice@example.com");
    expect(rawMime).toContain("Subject: Draft Subject");
    expect(rawMime).toContain("Draft body text");
  });
});

// ===========================================================================
// updateDraft
// ===========================================================================

describe("updateDraft", () => {
  it("updates the draft with new MIME content", async () => {
    mockDrafts.update.mockResolvedValue({
      data: { id: "draft-upd", message: { id: "msg-dupd" } },
    });

    const result = await updateDraft("draft-upd", {
      to: "updated@example.com",
      subject: "Updated Subject",
      body: "Updated body",
    });

    expect(result).toEqual({ id: "draft-upd", messageId: "msg-dupd" });

    const callArgs = mockDrafts.update.mock.calls[0][0];
    expect(callArgs.userId).toBe("me");
    expect(callArgs.id).toBe("draft-upd");

    const rawMime = fromBase64Url(callArgs.requestBody.message.raw);
    expect(rawMime).toContain("To: updated@example.com");
    expect(rawMime).toContain("Subject: Updated Subject");
  });
});

// ===========================================================================
// sendDraft
// ===========================================================================

describe("sendDraft", () => {
  it("sends the draft by ID", async () => {
    mockDrafts.send.mockResolvedValue({
      data: { id: "sent-draft", threadId: "thread-sd" },
    });

    const result = await sendDraft("draft-to-send");

    expect(mockDrafts.send).toHaveBeenCalledWith({
      userId: "me",
      requestBody: { id: "draft-to-send" },
    });

    expect(result).toEqual({ id: "sent-draft", threadId: "thread-sd" });
  });
});

// ===========================================================================
// deleteDraft
// ===========================================================================

describe("deleteDraft", () => {
  it("calls drafts.delete with correct params", async () => {
    mockDrafts.delete.mockResolvedValue({});

    await deleteDraft("draft-del");

    expect(mockDrafts.delete).toHaveBeenCalledWith({
      userId: "me",
      id: "draft-del",
    });
  });
});

// ===========================================================================
// getAttachment
// ===========================================================================

describe("getAttachment", () => {
  it("fetches attachment data by message and attachment ID", async () => {
    mockMessages.attachments.get.mockResolvedValue({
      data: { data: "base64data==", size: 1024 },
    });

    const result = await getAttachment("msg-att", "att-123");

    expect(mockMessages.attachments.get).toHaveBeenCalledWith({
      userId: "me",
      messageId: "msg-att",
      id: "att-123",
    });

    expect(result).toEqual({ data: "base64data==", size: 1024 });
  });

  it("returns empty data and zero size when API provides nulls", async () => {
    mockMessages.attachments.get.mockResolvedValue({
      data: { data: null, size: null },
    });

    const result = await getAttachment("msg-att2", "att-456");
    expect(result).toEqual({ data: "", size: 0 });
  });
});

// ===========================================================================
// listAttachments
// ===========================================================================

describe("listAttachments", () => {
  it("delegates to getEmail and returns attachments array", async () => {
    mockMessages.get.mockResolvedValue({
      data: {
        id: "msg-la",
        threadId: "thread-la",
        labelIds: [],
        snippet: "",
        payload: {
          headers: [
            { name: "From", value: "s@t.com" },
            { name: "Subject", value: "ATT" },
            { name: "Date", value: "2026-01-01" },
          ],
          mimeType: "multipart/mixed",
          parts: [
            { mimeType: "text/plain", body: { data: toBase64Url("text") } },
            {
              filename: "file.txt",
              mimeType: "text/plain",
              body: { attachmentId: "a1", size: 100 },
            },
          ],
        },
      },
    });

    const attachments = await listAttachments("msg-la");

    expect(attachments).toEqual([
      { attachmentId: "a1", filename: "file.txt", mimeType: "text/plain", size: 100 },
    ]);
  });
});

// ===========================================================================
// getProfile
// ===========================================================================

describe("getProfile", () => {
  it("returns email address and history ID", async () => {
    mockGetProfile.mockResolvedValue({
      data: { emailAddress: "me@gmail.com", historyId: "12345" },
    });

    const profile = await getProfile();

    expect(mockGetProfile).toHaveBeenCalledWith({ userId: "me" });
    expect(profile).toEqual({
      emailAddress: "me@gmail.com",
      historyId: "12345",
    });
  });
});

// ===========================================================================
// getHistory
// ===========================================================================

describe("getHistory", () => {
  it("returns added and deleted messages from history", async () => {
    mockHistoryList.mockResolvedValue({
      data: {
        historyId: "99999",
        history: [
          {
            messagesAdded: [{ message: { id: "new-1" } }],
            messagesDeleted: [{ message: { id: "del-1" } }],
          },
        ],
      },
    });

    const result = await getHistory("11111");

    expect(mockHistoryList).toHaveBeenCalledWith({
      userId: "me",
      startHistoryId: "11111",
      historyTypes: ["messageAdded"],
      labelId: "INBOX",
    });

    expect(result.historyId).toBe("99999");
    expect(result.messages).toEqual([
      { id: "new-1", action: "added" },
      { id: "del-1", action: "deleted" },
    ]);
  });

  it("returns empty messages when no history exists", async () => {
    mockHistoryList.mockResolvedValue({
      data: { historyId: "55555", history: undefined },
    });

    const result = await getHistory("44444");

    expect(result.historyId).toBe("55555");
    expect(result.messages).toEqual([]);
  });
});

// ===========================================================================
// listFilters
// ===========================================================================

describe("listFilters", () => {
  it("maps filter criteria and actions correctly", async () => {
    mockFilters.list.mockResolvedValue({
      data: {
        filter: [
          {
            id: "filter-1",
            criteria: { from: "newsletter@site.com", hasAttachment: true },
            action: { addLabelIds: ["Label_1"], removeLabelIds: ["INBOX"] },
          },
        ],
      },
    });

    const filters = await listFilters();

    expect(mockFilters.list).toHaveBeenCalledWith({ userId: "me" });
    expect(filters).toHaveLength(1);
    expect(filters[0]).toEqual({
      id: "filter-1",
      criteria: {
        from: "newsletter@site.com",
        to: undefined,
        subject: undefined,
        query: undefined,
        hasAttachment: true,
        size: undefined,
        sizeComparison: undefined,
      },
      action: {
        addLabelIds: ["Label_1"],
        removeLabelIds: ["INBOX"],
        forward: undefined,
      },
    });
  });

  it("returns empty array when no filters exist", async () => {
    mockFilters.list.mockResolvedValue({ data: { filter: undefined } });

    const filters = await listFilters();
    expect(filters).toEqual([]);
  });
});

// ===========================================================================
// getFilter
// ===========================================================================

describe("getFilter", () => {
  it("returns a single filter by ID", async () => {
    mockFilters.get.mockResolvedValue({
      data: {
        id: "filter-2",
        criteria: { subject: "invoice", query: "has:attachment" },
        action: { forward: "archive@company.com" },
      },
    });

    const filter = await getFilter("filter-2");

    expect(mockFilters.get).toHaveBeenCalledWith({
      userId: "me",
      id: "filter-2",
    });

    expect(filter.id).toBe("filter-2");
    expect(filter.criteria.subject).toBe("invoice");
    expect(filter.criteria.query).toBe("has:attachment");
    expect(filter.action.forward).toBe("archive@company.com");
  });
});

// ===========================================================================
// createFilter
// ===========================================================================

describe("createFilter", () => {
  it("creates a filter with criteria and action", async () => {
    mockFilters.create.mockResolvedValue({
      data: {
        id: "filter-new",
        criteria: { from: "boss@company.com" },
        action: { addLabelIds: ["IMPORTANT"] },
      },
    });

    const filter = await createFilter(
      { from: "boss@company.com" },
      { addLabelIds: ["IMPORTANT"] }
    );

    expect(mockFilters.create).toHaveBeenCalledWith({
      userId: "me",
      requestBody: {
        criteria: {
          from: "boss@company.com",
          to: undefined,
          subject: undefined,
          query: undefined,
          hasAttachment: undefined,
          size: undefined,
          sizeComparison: undefined,
        },
        action: {
          addLabelIds: ["IMPORTANT"],
          removeLabelIds: undefined,
          forward: undefined,
        },
      },
    });

    expect(filter.id).toBe("filter-new");
    expect(filter.criteria.from).toBe("boss@company.com");
    expect(filter.action.addLabelIds).toEqual(["IMPORTANT"]);
  });
});

// ===========================================================================
// deleteFilter
// ===========================================================================

describe("deleteFilter", () => {
  it("calls filters.delete with correct params", async () => {
    mockFilters.delete.mockResolvedValue({});

    await deleteFilter("filter-del");

    expect(mockFilters.delete).toHaveBeenCalledWith({
      userId: "me",
      id: "filter-del",
    });
  });
});
