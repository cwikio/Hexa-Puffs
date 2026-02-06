import { describe, it, expect, vi, type Mock } from "vitest";
import {
  MOCK_DRAFTS,
  MOCK_DRAFT_RESULT,
  MOCK_SEND_RESULT,
} from "../fixtures/gmail.js";
import { expectSuccess, expectError, expectValidationError } from "../helpers.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../gmail/client.js", () => ({
  listDrafts: vi.fn(),
  createDraft: vi.fn(),
  updateDraft: vi.fn(),
  sendDraft: vi.fn(),
  deleteDraft: vi.fn(),
}));

import {
  handleListDrafts,
  handleCreateDraft,
  handleUpdateDraft,
  handleSendDraft,
  handleDeleteDraft,
} from "../../tools/drafts.js";

import {
  listDrafts,
  createDraft,
  updateDraft,
  sendDraft,
  deleteDraft,
} from "../../gmail/client.js";

// ===========================================================================
// handleListDrafts
// ===========================================================================

describe("handleListDrafts", () => {
  it("succeeds and returns drafts array", async () => {
    (listDrafts as Mock).mockResolvedValue(MOCK_DRAFTS);

    const res = await handleListDrafts();
    const data = expectSuccess(res);

    expect(data).toEqual(MOCK_DRAFTS);
    expect(listDrafts).toHaveBeenCalled();
  });

  it("wraps API errors in StandardResponse", async () => {
    (listDrafts as Mock).mockRejectedValue(new Error("Service unavailable"));

    const res = await handleListDrafts();
    const errMsg = expectError(res);

    expect(errMsg).toContain("Failed to list drafts");
    expect(errMsg).toContain("Service unavailable");
  });
});

// ===========================================================================
// handleCreateDraft
// ===========================================================================

describe("handleCreateDraft", () => {
  it("succeeds with to, subject, body (maps is_html to isHtml)", async () => {
    (createDraft as Mock).mockResolvedValue(MOCK_DRAFT_RESULT);

    const res = await handleCreateDraft({
      to: "alice@example.com",
      subject: "Draft subject",
      body: "Draft body",
    });
    const data = expectSuccess(res);

    expect(data).toEqual(MOCK_DRAFT_RESULT);
    expect(createDraft).toHaveBeenCalledWith({
      to: "alice@example.com",
      subject: "Draft subject",
      body: "Draft body",
      cc: undefined,
      bcc: undefined,
      isHtml: undefined,
    });
  });

  it("passes optional cc, bcc, is_html", async () => {
    (createDraft as Mock).mockResolvedValue(MOCK_DRAFT_RESULT);

    await handleCreateDraft({
      to: "alice@example.com",
      subject: "Hi",
      body: "<p>HTML draft</p>",
      cc: "bob@example.com",
      bcc: "eve@example.com",
      is_html: true,
    });

    expect(createDraft).toHaveBeenCalledWith({
      to: "alice@example.com",
      subject: "Hi",
      body: "<p>HTML draft</p>",
      cc: "bob@example.com",
      bcc: "eve@example.com",
      isHtml: true,
    });
  });

  it("rejects missing to (validation)", async () => {
    const res = await handleCreateDraft({ subject: "Hi", body: "text" });
    expectValidationError(res);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("rejects missing body (validation)", async () => {
    const res = await handleCreateDraft({
      to: "a@b.com",
      subject: "Hi",
    });
    expectValidationError(res);
    expect(createDraft).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// handleUpdateDraft
// ===========================================================================

describe("handleUpdateDraft", () => {
  it("succeeds with draft_id, to, subject, body", async () => {
    (updateDraft as Mock).mockResolvedValue(MOCK_DRAFT_RESULT);

    const res = await handleUpdateDraft({
      draft_id: "draft_abc",
      to: "alice@example.com",
      subject: "Updated",
      body: "New body",
    });
    const data = expectSuccess(res);

    expect(data).toEqual(MOCK_DRAFT_RESULT);
    expect(updateDraft).toHaveBeenCalledWith("draft_abc", {
      to: "alice@example.com",
      subject: "Updated",
      body: "New body",
      cc: undefined,
      bcc: undefined,
      isHtml: undefined,
    });
  });

  it("rejects missing draft_id (min(1) validation)", async () => {
    const res = await handleUpdateDraft({
      draft_id: "",
      to: "a@b.com",
      subject: "Hi",
      body: "text",
    });
    expectValidationError(res);
    expect(updateDraft).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// handleSendDraft
// ===========================================================================

describe("handleSendDraft", () => {
  it("succeeds and returns { id, threadId }", async () => {
    (sendDraft as Mock).mockResolvedValue(MOCK_SEND_RESULT);

    const res = await handleSendDraft({ draft_id: "draft_send" });
    const data = expectSuccess(res);

    expect(data).toEqual(MOCK_SEND_RESULT);
    expect(sendDraft).toHaveBeenCalledWith("draft_send");
  });

  it("rejects empty draft_id (validation)", async () => {
    const res = await handleSendDraft({ draft_id: "" });
    expectValidationError(res);
    expect(sendDraft).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// handleDeleteDraft
// ===========================================================================

describe("handleDeleteDraft", () => {
  it("succeeds and returns { deleted: true }", async () => {
    (deleteDraft as Mock).mockResolvedValue(undefined);

    const res = await handleDeleteDraft({ draft_id: "draft_del" });
    const data = expectSuccess(res);

    expect(data).toEqual({ deleted: true });
    expect(deleteDraft).toHaveBeenCalledWith("draft_del");
  });

  it("rejects empty draft_id (validation)", async () => {
    const res = await handleDeleteDraft({ draft_id: "" });
    expectValidationError(res);
    expect(deleteDraft).not.toHaveBeenCalled();
  });
});
