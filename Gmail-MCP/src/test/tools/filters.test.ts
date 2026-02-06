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
// Tests
// ---------------------------------------------------------------------------

describe("handleListFilters", () => {
  it("success returns { filters: [...] }", async () => {
    mockListFilters.mockResolvedValueOnce(MOCK_FILTERS);

    const result = await handleListFilters();

    expect(result).toEqual({ filters: MOCK_FILTERS });
    expect(mockListFilters).toHaveBeenCalledOnce();
  });

  it("propagates API errors", async () => {
    mockListFilters.mockRejectedValueOnce(new Error("API unavailable"));

    await expect(handleListFilters()).rejects.toThrow("API unavailable");
  });
});

describe("handleGetFilter", () => {
  it("success returns { filter: {...} }", async () => {
    mockGetFilter.mockResolvedValueOnce(MOCK_FILTER);

    const result = await handleGetFilter({ filter_id: "ANe1Bmj5Kz8Xp3wR" });

    expect(result).toEqual({ filter: MOCK_FILTER });
    expect(mockGetFilter).toHaveBeenCalledWith("ANe1Bmj5Kz8Xp3wR");
  });

  it('throws "filter_id is required" when filter_id is missing', async () => {
    await expect(handleGetFilter({})).rejects.toThrow("filter_id is required");
  });

  it('throws "filter_id is required" when filter_id is not a string', async () => {
    await expect(handleGetFilter({ filter_id: 42 })).rejects.toThrow(
      "filter_id is required"
    );
  });
});

describe("handleCreateFilter", () => {
  it("success returns { filter: {...} } with criteria and action mapped", async () => {
    mockCreateFilter.mockResolvedValueOnce(MOCK_FILTER);

    const result = await handleCreateFilter({
      criteria: { from: "notifications@github.com", has_attachment: false },
      action: { add_label_ids: ["Label_42"], remove_label_ids: ["INBOX"] },
    });

    expect(result).toEqual({ filter: MOCK_FILTER });
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

  it('throws "Both criteria and action are required" when criteria missing', async () => {
    await expect(
      handleCreateFilter({ action: { add_label_ids: ["Label_1"] } })
    ).rejects.toThrow("Both criteria and action are required");
  });

  it('throws "Both criteria and action are required" when action missing', async () => {
    await expect(
      handleCreateFilter({ criteria: { from: "test@example.com" } })
    ).rejects.toThrow("Both criteria and action are required");
  });
});

describe("handleDeleteFilter", () => {
  it("success returns { deleted: true }", async () => {
    mockDeleteFilter.mockResolvedValueOnce(undefined);

    const result = await handleDeleteFilter({ filter_id: "ANe1Bmj5Kz8Xp3wR" });

    expect(result).toEqual({ deleted: true });
    expect(mockDeleteFilter).toHaveBeenCalledWith("ANe1Bmj5Kz8Xp3wR");
  });

  it('throws "filter_id is required" when filter_id missing', async () => {
    await expect(handleDeleteFilter({})).rejects.toThrow(
      "filter_id is required"
    );
  });
});
