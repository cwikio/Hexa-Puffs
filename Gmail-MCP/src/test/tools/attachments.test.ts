import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock gmail client
// ---------------------------------------------------------------------------

const mockListAttachments = vi.fn();
const mockGetAttachment = vi.fn();

vi.mock("../../gmail/client.js", () => ({
  listAttachments: (...args: unknown[]) => mockListAttachments(...args),
  getAttachment: (...args: unknown[]) => mockGetAttachment(...args),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  handleListAttachments,
  handleGetAttachment,
} from "../../tools/attachments.js";
import { expectSuccess, expectError, expectValidationError } from "../helpers.js";
import { MOCK_ATTACHMENT_DATA } from "../fixtures/gmail.js";

// ---------------------------------------------------------------------------
// Local fixtures
// ---------------------------------------------------------------------------

const mockAttachments = [
  {
    attachmentId: "att-1",
    filename: "doc.pdf",
    mimeType: "application/pdf",
    size: 1234,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleListAttachments", () => {
  it("success returns attachments array", async () => {
    mockListAttachments.mockResolvedValueOnce(mockAttachments);

    const result = await handleListAttachments({ message_id: "msg-123" });
    const data = expectSuccess(result);

    expect(data).toEqual(mockAttachments);
    expect(mockListAttachments).toHaveBeenCalledWith("msg-123");
  });

  it("rejects empty message_id", async () => {
    const result = await handleListAttachments({ message_id: "" });
    expectValidationError(result);
  });

  it("wraps API errors", async () => {
    mockListAttachments.mockRejectedValueOnce(new Error("Message not found"));

    const result = await handleListAttachments({ message_id: "msg-123" });
    const error = expectError(result);

    expect(error).toContain("Failed to list attachments");
    expect(error).toContain("Message not found");
  });
});

describe("handleGetAttachment", () => {
  it("success returns { data, size }", async () => {
    mockGetAttachment.mockResolvedValueOnce(MOCK_ATTACHMENT_DATA);

    const result = await handleGetAttachment({
      message_id: "msg-123",
      attachment_id: "att-1",
    });
    const data = expectSuccess(result);

    expect(data).toEqual(MOCK_ATTACHMENT_DATA);
    expect(mockGetAttachment).toHaveBeenCalledWith("msg-123", "att-1");
  });

  it("rejects missing message_id", async () => {
    const result = await handleGetAttachment({ attachment_id: "att-1" });
    expectValidationError(result);
  });

  it("rejects missing attachment_id", async () => {
    const result = await handleGetAttachment({ message_id: "msg-123" });
    expectValidationError(result);
  });

  it("wraps API errors", async () => {
    mockGetAttachment.mockRejectedValueOnce(new Error("Attachment not found"));

    const result = await handleGetAttachment({
      message_id: "msg-123",
      attachment_id: "att-1",
    });
    const error = expectError(result);

    expect(error).toContain("Failed to get attachment");
    expect(error).toContain("Attachment not found");
  });
});
