import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock gmail client
// ---------------------------------------------------------------------------

const mockListLabels = vi.fn();
const mockCreateLabel = vi.fn();
const mockDeleteLabel = vi.fn();

vi.mock("../../gmail/client.js", () => ({
  listLabels: (...args: unknown[]) => mockListLabels(...args),
  createLabel: (...args: unknown[]) => mockCreateLabel(...args),
  deleteLabel: (...args: unknown[]) => mockDeleteLabel(...args),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  handleListLabels,
  handleCreateLabel,
  handleDeleteLabel,
} from "../../tools/labels.js";
import { expectSuccess, expectError, expectValidationError } from "../helpers.js";
import { MOCK_LABELS, MOCK_LABEL } from "../fixtures/gmail.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleListLabels", () => {
  it("success returns labels array", async () => {
    mockListLabels.mockResolvedValueOnce(MOCK_LABELS);

    const result = await handleListLabels();
    const data = expectSuccess(result);

    expect(data).toEqual(MOCK_LABELS);
    expect(mockListLabels).toHaveBeenCalledOnce();
  });

  it("wraps API errors", async () => {
    mockListLabels.mockRejectedValueOnce(new Error("Network timeout"));

    const result = await handleListLabels();
    const error = expectError(result);

    expect(error).toContain("Failed to list labels");
    expect(error).toContain("Network timeout");
  });
});

describe("handleCreateLabel", () => {
  it("success with name returns Label", async () => {
    mockCreateLabel.mockResolvedValueOnce(MOCK_LABEL);

    const result = await handleCreateLabel({ name: "Work" });
    const data = expectSuccess(result);

    expect(data).toEqual(MOCK_LABEL);
    expect(mockCreateLabel).toHaveBeenCalledWith("Work");
  });

  it("rejects empty name", async () => {
    const result = await handleCreateLabel({ name: "" });
    expectValidationError(result);
  });

  it("wraps API errors", async () => {
    mockCreateLabel.mockRejectedValueOnce(new Error("Label already exists"));

    const result = await handleCreateLabel({ name: "Duplicate" });
    const error = expectError(result);

    expect(error).toContain("Failed to create label");
    expect(error).toContain("Label already exists");
  });
});

describe("handleDeleteLabel", () => {
  it("success returns { deleted: true }", async () => {
    mockDeleteLabel.mockResolvedValueOnce(undefined);

    const result = await handleDeleteLabel({ label_id: "Label_42" });
    const data = expectSuccess(result);

    expect(data).toEqual({ deleted: true });
    expect(mockDeleteLabel).toHaveBeenCalledWith("Label_42");
  });

  it("rejects empty label_id", async () => {
    const result = await handleDeleteLabel({ label_id: "" });
    expectValidationError(result);
  });

  it("wraps API errors", async () => {
    mockDeleteLabel.mockRejectedValueOnce(new Error("Not found"));

    const result = await handleDeleteLabel({ label_id: "Label_99" });
    const error = expectError(result);

    expect(error).toContain("Failed to delete label");
    expect(error).toContain("Not found");
  });
});
