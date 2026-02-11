import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock gmail client
// ---------------------------------------------------------------------------

const mockListFilters = vi.fn();
const mockGetFilter = vi.fn();
const mockCreateFilter = vi.fn();
const mockDeleteFilter = vi.fn();

vi.mock("../../gmail/client.js", () => ({
  listFilters: (...args: unknown[]) => mockListFilters(...args),
  getFilter: (...args: unknown[]) => mockGetFilter(...args),
  createFilter: (...args: unknown[]) => mockCreateFilter(...args),
  deleteFilter: (...args: unknown[]) => mockDeleteFilter(...args),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  handleListFilters,
  handleGetFilter,
  handleCreateFilter,
  handleDeleteFilter,
} from "../../tools/filters.js";
import { MOCK_FILTERS, MOCK_FILTER } from "../fixtures/gmail.js";

// ---------------------------------------------------------------------------
// Tests — handlers return StandardResponse { success, data?, error? }
// ---------------------------------------------------------------------------

describe("handleListFilters", () => {
  it("success returns StandardResponse with filters", async () => {
    mockListFilters.mockResolvedValueOnce(MOCK_FILTERS);

    const result = await handleListFilters();

    expect(result).toEqual({ success: true, data: { filters: MOCK_FILTERS } });
    expect(mockListFilters).toHaveBeenCalledOnce();
  });

  it("returns error response on API failure", async () => {
    mockListFilters.mockRejectedValueOnce(new Error("API unavailable"));

    const result = await handleListFilters();

    expect(result.success).toBe(false);
    expect(result.error).toContain("API unavailable");
  });
});

describe("handleGetFilter", () => {
  it("success returns StandardResponse with filter", async () => {
    mockGetFilter.mockResolvedValueOnce(MOCK_FILTER);

    const result = await handleGetFilter({ filter_id: "ANe1Bmj5Kz8Xp3wR" });

    expect(result).toEqual({ success: true, data: { filter: MOCK_FILTER } });
    expect(mockGetFilter).toHaveBeenCalledWith("ANe1Bmj5Kz8Xp3wR");
  });

  it("returns error when filter_id is missing", async () => {
    const result = await handleGetFilter({});

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns error when filter_id is not a string", async () => {
    const result = await handleGetFilter({ filter_id: 42 });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("handleCreateFilter", () => {
  it("success returns StandardResponse with filter", async () => {
    mockCreateFilter.mockResolvedValueOnce(MOCK_FILTER);

    const result = await handleCreateFilter({
      criteria: { from: "notifications@github.com", has_attachment: false },
      action: { add_label_ids: ["Label_42"], remove_label_ids: ["INBOX"] },
    });

    expect(result).toEqual({ success: true, data: { filter: MOCK_FILTER } });
    expect(mockCreateFilter).toHaveBeenCalledWith(
      {
        from: "notifications@github.com",
        to: undefined,
        subject: undefined,
        query: undefined,
        hasAttachment: false,
        size: undefined,
        sizeComparison: undefined,
      },
      {
        addLabelIds: ["Label_42"],
        removeLabelIds: ["INBOX"],
        forward: undefined,
      }
    );
  });

  it("returns error when criteria missing", async () => {
    const result = await handleCreateFilter({
      action: { add_label_ids: ["Label_1"] },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns error when action missing", async () => {
    const result = await handleCreateFilter({
      criteria: { from: "test@example.com" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("handleDeleteFilter", () => {
  it("success returns StandardResponse with deleted flag", async () => {
    mockDeleteFilter.mockResolvedValueOnce(undefined);

    const result = await handleDeleteFilter({
      filter_id: "ANe1Bmj5Kz8Xp3wR",
    });

    expect(result).toEqual({ success: true, data: { deleted: true } });
    expect(mockDeleteFilter).toHaveBeenCalledWith("ANe1Bmj5Kz8Xp3wR");
  });

  it("returns error when filter_id missing", async () => {
    const result = await handleDeleteFilter({});

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
