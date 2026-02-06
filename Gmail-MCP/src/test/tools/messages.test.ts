import { describe, it, expect, vi, type Mock } from "vitest";
import {
  MOCK_LIST_EMAILS_RESULT,
  MOCK_EMAIL_MESSAGE,
  MOCK_SEND_RESULT,
} from "../fixtures/gmail.js";
import { expectSuccess, expectError, expectValidationError } from "../helpers.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../gmail/client.js", () => ({
  listEmails: vi.fn(),
  getEmail: vi.fn(),
  sendEmail: vi.fn(),
  replyToEmail: vi.fn(),
  trashEmail: vi.fn(),
  markRead: vi.fn(),
  modifyLabels: vi.fn(),
  listLabels: vi.fn(),
}));

vi.mock("../../gmail/polling.js", () => ({
  getNewEmails: vi.fn(),
  clearNewEmails: vi.fn(),
}));

import {
  handleListEmails,
  handleGetEmail,
  handleSendEmail,
  handleReplyEmail,
  handleDeleteEmail,
  handleMarkRead,
  handleModifyLabels,
  handleGetNewEmails,
} from "../../tools/messages.js";

import {
  listEmails,
  getEmail,
  sendEmail,
  replyToEmail,
  trashEmail,
  markRead,
  modifyLabels,
  listLabels,
} from "../../gmail/client.js";

import { getNewEmails, clearNewEmails } from "../../gmail/polling.js";

// ===========================================================================
// handleListEmails
// ===========================================================================

describe("handleListEmails", () => {
  it("succeeds with empty args (defaults)", async () => {
    (listEmails as Mock).mockResolvedValue(MOCK_LIST_EMAILS_RESULT);

    const res = await handleListEmails({});
    const data = expectSuccess(res);

    expect(data).toEqual(MOCK_LIST_EMAILS_RESULT);
    expect(listEmails).toHaveBeenCalledWith({
      query: undefined,
      maxResults: undefined,
      labelIds: undefined,
      pageToken: undefined,
    });
  });

  it("passes query, max_results, label_ids, page_token mapped to camelCase", async () => {
    (listEmails as Mock).mockResolvedValue(MOCK_LIST_EMAILS_RESULT);

    await handleListEmails({
      query: "is:unread",
      max_results: 5,
      label_ids: ["INBOX", "UNREAD"],
      page_token: "tok_abc",
    });

    expect(listEmails).toHaveBeenCalledWith({
      query: "is:unread",
      maxResults: 5,
      labelIds: ["INBOX", "UNREAD"],
      pageToken: "tok_abc",
    });
  });

  it("rejects max_results > 100 (validation error)", async () => {
    const res = await handleListEmails({ max_results: 101 });
    expectValidationError(res);
    expect(listEmails).not.toHaveBeenCalled();
  });

  it("rejects max_results < 1 (validation error)", async () => {
    const res = await handleListEmails({ max_results: 0 });
    expectValidationError(res);
    expect(listEmails).not.toHaveBeenCalled();
  });

  it("wraps API errors in StandardResponse", async () => {
    (listEmails as Mock).mockRejectedValue(new Error("Gmail API down"));

    const res = await handleListEmails({});
    const errMsg = expectError(res);

    expect(errMsg).toContain("Failed to list emails");
    expect(errMsg).toContain("Gmail API down");
  });
});

// ===========================================================================
// handleGetEmail
// ===========================================================================

describe("handleGetEmail", () => {
  it("succeeds with valid message_id", async () => {
    (getEmail as Mock).mockResolvedValue(MOCK_EMAIL_MESSAGE);

    const res = await handleGetEmail({ message_id: "msg_123" });
    const data = expectSuccess(res);

    expect(data).toEqual(MOCK_EMAIL_MESSAGE);
    expect(getEmail).toHaveBeenCalledWith("msg_123");
  });

  it("rejects missing message_id (validation)", async () => {
    const res = await handleGetEmail({});
    expectValidationError(res);
    expect(getEmail).not.toHaveBeenCalled();
  });

  it("rejects empty message_id (min(1) validation)", async () => {
    const res = await handleGetEmail({ message_id: "" });
    expectValidationError(res);
    expect(getEmail).not.toHaveBeenCalled();
  });

  it("wraps API errors in StandardResponse", async () => {
    (getEmail as Mock).mockRejectedValue(new Error("Not found"));

    const res = await handleGetEmail({ message_id: "msg_bad" });
    const errMsg = expectError(res);

    expect(errMsg).toContain("Failed to get email");
    expect(errMsg).toContain("Not found");
  });
});

// ===========================================================================
// handleSendEmail
// ===========================================================================

describe("handleSendEmail", () => {
  it("succeeds with to, subject, body", async () => {
    (sendEmail as Mock).mockResolvedValue(MOCK_SEND_RESULT);

    const res = await handleSendEmail({
      to: "alice@example.com",
      subject: "Hello",
      body: "World",
    });
    const data = expectSuccess(res);

    expect(data).toEqual(MOCK_SEND_RESULT);
    expect(sendEmail).toHaveBeenCalledWith({
      to: "alice@example.com",
      subject: "Hello",
      body: "World",
      cc: undefined,
      bcc: undefined,
      isHtml: undefined,
    });
  });

  it("passes optional cc, bcc, is_html mapped to isHtml", async () => {
    (sendEmail as Mock).mockResolvedValue(MOCK_SEND_RESULT);

    await handleSendEmail({
      to: "alice@example.com",
      subject: "Hi",
      body: "<b>Bold</b>",
      cc: "bob@example.com",
      bcc: "eve@example.com",
      is_html: true,
    });

    expect(sendEmail).toHaveBeenCalledWith({
      to: "alice@example.com",
      subject: "Hi",
      body: "<b>Bold</b>",
      cc: "bob@example.com",
      bcc: "eve@example.com",
      isHtml: true,
    });
  });

  it("rejects missing to (validation)", async () => {
    const res = await handleSendEmail({ subject: "Hi", body: "text" });
    expectValidationError(res);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects missing body (validation)", async () => {
    const res = await handleSendEmail({ to: "a@b.com", subject: "Hi" });
    expectValidationError(res);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("wraps API errors in StandardResponse", async () => {
    (sendEmail as Mock).mockRejectedValue(new Error("Rate limited"));

    const res = await handleSendEmail({
      to: "a@b.com",
      subject: "Hi",
      body: "text",
    });
    const errMsg = expectError(res);

    expect(errMsg).toContain("Failed to send email");
    expect(errMsg).toContain("Rate limited");
  });
});

// ===========================================================================
// handleReplyEmail
// ===========================================================================

describe("handleReplyEmail", () => {
  it("succeeds with message_id and body", async () => {
    (replyToEmail as Mock).mockResolvedValue(MOCK_SEND_RESULT);

    const res = await handleReplyEmail({
      message_id: "msg_123",
      body: "Thanks!",
    });
    const data = expectSuccess(res);

    expect(data).toEqual(MOCK_SEND_RESULT);
    expect(replyToEmail).toHaveBeenCalledWith("msg_123", "Thanks!", undefined);
  });

  it("passes optional is_html", async () => {
    (replyToEmail as Mock).mockResolvedValue(MOCK_SEND_RESULT);

    await handleReplyEmail({
      message_id: "msg_123",
      body: "<p>Reply</p>",
      is_html: true,
    });

    expect(replyToEmail).toHaveBeenCalledWith("msg_123", "<p>Reply</p>", true);
  });

  it("rejects missing message_id (validation)", async () => {
    const res = await handleReplyEmail({ body: "text" });
    expectValidationError(res);
    expect(replyToEmail).not.toHaveBeenCalled();
  });

  it("rejects missing body (validation)", async () => {
    const res = await handleReplyEmail({ message_id: "msg_123" });
    expectValidationError(res);
    expect(replyToEmail).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// handleDeleteEmail
// ===========================================================================

describe("handleDeleteEmail", () => {
  it("succeeds and returns { deleted: true }", async () => {
    (trashEmail as Mock).mockResolvedValue(undefined);

    const res = await handleDeleteEmail({ message_id: "msg_del" });
    const data = expectSuccess(res);

    expect(data).toEqual({ deleted: true });
    expect(trashEmail).toHaveBeenCalledWith("msg_del");
  });

  it("rejects empty message_id (validation)", async () => {
    const res = await handleDeleteEmail({ message_id: "" });
    expectValidationError(res);
    expect(trashEmail).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// handleMarkRead
// ===========================================================================

describe("handleMarkRead", () => {
  it("succeeds marking read (read: true)", async () => {
    (markRead as Mock).mockResolvedValue(undefined);

    const res = await handleMarkRead({ message_id: "msg_r", read: true });
    const data = expectSuccess(res);

    expect(data).toEqual({ marked: true });
    expect(markRead).toHaveBeenCalledWith("msg_r", true);
  });

  it("succeeds marking unread (read: false)", async () => {
    (markRead as Mock).mockResolvedValue(undefined);

    const res = await handleMarkRead({ message_id: "msg_r", read: false });
    const data = expectSuccess(res);

    expect(data).toEqual({ marked: true });
    expect(markRead).toHaveBeenCalledWith("msg_r", false);
  });

  it("rejects missing message_id (validation)", async () => {
    const res = await handleMarkRead({ read: true });
    expectValidationError(res);
    expect(markRead).not.toHaveBeenCalled();
  });

  it("rejects missing read field (validation)", async () => {
    const res = await handleMarkRead({ message_id: "msg_r" });
    expectValidationError(res);
    expect(markRead).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// handleModifyLabels
// ===========================================================================

describe("handleModifyLabels", () => {
  const MOCK_LABELS = [
    { id: "STARRED", name: "STARRED", type: "system" as const },
    { id: "IMPORTANT", name: "IMPORTANT", type: "system" as const },
    { id: "UNREAD", name: "UNREAD", type: "system" as const },
    { id: "Label_42", name: "Work", type: "user" as const },
  ];

  it("succeeds adding labels by ID", async () => {
    (listLabels as Mock).mockResolvedValue(MOCK_LABELS);
    (modifyLabels as Mock).mockResolvedValue(undefined);

    const res = await handleModifyLabels({
      message_id: "msg_lbl",
      add_label_ids: ["STARRED", "IMPORTANT"],
    });
    const data = expectSuccess(res);

    expect(data).toEqual({ modified: true });
    expect(modifyLabels).toHaveBeenCalledWith(
      "msg_lbl",
      ["STARRED", "IMPORTANT"],
      []
    );
  });

  it("succeeds adding labels by name", async () => {
    (listLabels as Mock).mockResolvedValue(MOCK_LABELS);
    (modifyLabels as Mock).mockResolvedValue(undefined);

    const res = await handleModifyLabels({
      message_id: "msg_lbl",
      add_label_ids: ["Work"],
    });
    const data = expectSuccess(res);

    expect(data).toEqual({ modified: true });
    expect(modifyLabels).toHaveBeenCalledWith("msg_lbl", ["Label_42"], []);
  });

  it("succeeds removing labels", async () => {
    (listLabels as Mock).mockResolvedValue(MOCK_LABELS);
    (modifyLabels as Mock).mockResolvedValue(undefined);

    const res = await handleModifyLabels({
      message_id: "msg_lbl",
      remove_label_ids: ["UNREAD"],
    });
    const data = expectSuccess(res);

    expect(data).toEqual({ modified: true });
    expect(modifyLabels).toHaveBeenCalledWith("msg_lbl", [], ["UNREAD"]);
  });

  it("returns error for unknown label names", async () => {
    (listLabels as Mock).mockResolvedValue(MOCK_LABELS);

    const res = await handleModifyLabels({
      message_id: "msg_lbl",
      add_label_ids: ["NonExistent"],
    });
    expectError(res);
    expect(modifyLabels).not.toHaveBeenCalled();
  });

  it("rejects missing message_id (validation)", async () => {
    const res = await handleModifyLabels({ add_label_ids: ["STARRED"] });
    expectValidationError(res);
    expect(modifyLabels).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// handleGetNewEmails
// ===========================================================================

describe("handleGetNewEmails", () => {
  it("succeeds and returns emails from polling queue", async () => {
    (getNewEmails as Mock).mockReturnValue([MOCK_EMAIL_MESSAGE]);

    const res = await handleGetNewEmails({});
    const data = expectSuccess(res);

    expect(data).toEqual({ emails: [MOCK_EMAIL_MESSAGE], count: 1 });
    expect(getNewEmails).toHaveBeenCalled();
    expect(clearNewEmails).not.toHaveBeenCalled();
  });

  it("calls clearNewEmails when clear: true", async () => {
    (getNewEmails as Mock).mockReturnValue([]);

    const res = await handleGetNewEmails({ clear: true });
    expectSuccess(res);

    expect(clearNewEmails).toHaveBeenCalled();
  });
});
