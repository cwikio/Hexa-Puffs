/**
 * Real Gmail API integration tests.
 *
 * These tests call actual Gmail API handlers — NO mocks.
 * A valid OAuth token at ~/.annabelle/gmail/token.json is required.
 * The entire suite is skipped when the token file is missing.
 *
 * Run with: npx vitest run --config vitest.api.config.ts
 */

import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { describe, it, expect, afterAll } from "vitest";

// Handlers — messages
import {
  handleListEmails,
  handleGetEmail,
  handleMarkRead,
} from "../../tools/messages.js";

// Handlers — labels
import {
  handleListLabels,
  handleCreateLabel,
  handleDeleteLabel,
} from "../../tools/labels.js";

// Handlers — drafts
import {
  handleListDrafts,
  handleCreateDraft,
  handleUpdateDraft,
  handleDeleteDraft,
} from "../../tools/drafts.js";

// Handlers — filters
import { handleListFilters } from "../../tools/filters.js";

// Helper
import { expectSuccess } from "../helpers.js";

// ---------------------------------------------------------------------------
// Token gate
// ---------------------------------------------------------------------------

const TOKEN_PATH = join(homedir(), ".annabelle", "gmail", "token.json");
const tokenExists = existsSync(TOKEN_PATH);

// ---------------------------------------------------------------------------
// Test suite — skips entirely when no token is present
// ---------------------------------------------------------------------------

describe.skipIf(!tokenExists)("Gmail API Integration", () => {
  // ========================================================================
  // 1. list_emails + get_email
  // ========================================================================

  describe("list_emails + get_email", () => {
    it("should list emails and verify response shape", async () => {
      const result = await handleListEmails({ max_results: 3 });
      const data = expectSuccess(result);

      expect(data).toHaveProperty("messages");
      expect(data).toHaveProperty("resultSizeEstimate");
      expect(Array.isArray(data.messages)).toBe(true);

      if (data.messages.length > 0) {
        const msg = data.messages[0];
        expect(msg).toHaveProperty("id");
        expect(msg).toHaveProperty("threadId");
        expect(msg).toHaveProperty("subject");
        expect(msg).toHaveProperty("from");
        expect(msg).toHaveProperty("snippet");
        expect(msg).toHaveProperty("date");
        expect(msg).toHaveProperty("isUnread");
        expect(msg).toHaveProperty("labelIds");
      }
    });

    it("should get a full email by ID", async () => {
      const listResult = await handleListEmails({ max_results: 1 });
      const listData = expectSuccess(listResult);

      // Need at least one email to test get_email
      if (listData.messages.length === 0) return;

      const messageId = listData.messages[0].id;
      const result = await handleGetEmail({ message_id: messageId });
      const email = expectSuccess(result);

      expect(email).toHaveProperty("id", messageId);
      expect(email).toHaveProperty("threadId");
      expect(email).toHaveProperty("labelIds");
      expect(email).toHaveProperty("snippet");
      expect(email).toHaveProperty("subject");
      expect(email).toHaveProperty("from");
      expect(email.from).toHaveProperty("email");
      expect(email).toHaveProperty("to");
      expect(Array.isArray(email.to)).toBe(true);
      expect(email).toHaveProperty("date");
      expect(email).toHaveProperty("body");
      expect(email).toHaveProperty("isUnread");
    });
  });

  // ========================================================================
  // 2. list_labels
  // ========================================================================

  describe("list_labels", () => {
    it("should list labels and include INBOX", async () => {
      const result = await handleListLabels();
      const labels = expectSuccess(result);

      expect(Array.isArray(labels)).toBe(true);
      expect(labels.length).toBeGreaterThan(0);

      const inbox = labels.find((l) => l.id === "INBOX");
      expect(inbox).toBeDefined();
      expect(inbox!.name).toBe("INBOX");
      expect(inbox!.type).toBe("system");
    });
  });

  // ========================================================================
  // 3. create_label -> delete_label
  // ========================================================================

  describe.sequential("create_label -> delete_label", () => {
    const labelName = `mcp-test-${Date.now()}`;
    let createdLabelId: string | undefined;

    afterAll(async () => {
      // Cleanup: delete the label if it was created, even if tests failed
      if (createdLabelId) {
        try {
          await handleDeleteLabel({ label_id: createdLabelId });
        } catch {
          // Best-effort cleanup
        }
      }
    });

    it("should create a new label", async () => {
      const result = await handleCreateLabel({ name: labelName });
      const label = expectSuccess(result);

      expect(label).toHaveProperty("id");
      expect(label).toHaveProperty("name", labelName);
      expect(label).toHaveProperty("type", "user");

      createdLabelId = label.id;
    });

    it("should delete the created label", async () => {
      expect(createdLabelId).toBeDefined();

      const result = await handleDeleteLabel({ label_id: createdLabelId! });
      const data = expectSuccess(result);

      expect(data).toHaveProperty("deleted", true);

      // Clear the ID so afterAll doesn't try to delete again
      createdLabelId = undefined;
    });
  });

  // ========================================================================
  // 4. list_drafts
  // ========================================================================

  describe("list_drafts", () => {
    it("should list drafts and verify response shape", async () => {
      const result = await handleListDrafts();
      const drafts = expectSuccess(result);

      expect(Array.isArray(drafts)).toBe(true);

      if (drafts.length > 0) {
        const draft = drafts[0];
        expect(draft).toHaveProperty("id");
        expect(draft).toHaveProperty("message");
        expect(draft.message).toHaveProperty("id");
        expect(draft.message).toHaveProperty("threadId");
      }
    });
  });

  // ========================================================================
  // 5. create_draft -> update_draft -> delete_draft
  // ========================================================================

  describe.sequential("create_draft -> update_draft -> delete_draft", () => {
    let createdDraftId: string | undefined;

    afterAll(async () => {
      // Cleanup: delete the draft if it was created, even if tests failed
      if (createdDraftId) {
        try {
          await handleDeleteDraft({ draft_id: createdDraftId });
        } catch {
          // Best-effort cleanup
        }
      }
    });

    it("should create a draft", async () => {
      const result = await handleCreateDraft({
        to: "test@example.com",
        subject: "MCP Test Draft",
        body: "This is an automated test draft. Safe to delete.",
      });
      const data = expectSuccess(result);

      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("messageId");
      expect(typeof data.id).toBe("string");
      expect(typeof data.messageId).toBe("string");

      createdDraftId = data.id;
    });

    it("should update the draft subject", async () => {
      expect(createdDraftId).toBeDefined();

      const result = await handleUpdateDraft({
        draft_id: createdDraftId!,
        to: "test@example.com",
        subject: "MCP Test Draft — Updated",
        body: "This is an updated automated test draft. Safe to delete.",
      });
      const data = expectSuccess(result);

      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("messageId");

      // Gmail may assign a new draft ID on update
      createdDraftId = data.id;
    });

    it("should delete the draft", async () => {
      expect(createdDraftId).toBeDefined();

      const result = await handleDeleteDraft({ draft_id: createdDraftId! });
      const data = expectSuccess(result);

      expect(data).toHaveProperty("deleted", true);

      // Clear the ID so afterAll doesn't try to delete again
      createdDraftId = undefined;
    });
  });

  // ========================================================================
  // 6. list_filters
  // ========================================================================

  describe("list_filters", () => {
    it("should list filters and return an array", async () => {
      const result = await handleListFilters();
      const data = expectSuccess(result);

      expect(data).toHaveProperty("filters");
      expect(Array.isArray(data.filters)).toBe(true);
    });
  });

  // ========================================================================
  // 7. mark_read (only if emails exist)
  // ========================================================================

  describe("mark_read", () => {
    it("should toggle read status and restore it", async () => {
      const listResult = await handleListEmails({ max_results: 1 });
      const listData = expectSuccess(listResult);

      if (listData.messages.length === 0) {
        // No emails in mailbox — skip gracefully
        return;
      }

      const messageId = listData.messages[0].id;

      // Get the current read/unread state
      const getResult = await handleGetEmail({ message_id: messageId });
      const email = expectSuccess(getResult);
      const wasUnread = email.isUnread;

      // Toggle: if unread -> mark read; if read -> mark unread
      const markResult = await handleMarkRead({
        message_id: messageId,
        read: wasUnread, // if unread, mark as read (read: true)
      });
      const markData = expectSuccess(markResult);
      expect(markData).toHaveProperty("marked", true);

      // Restore original state
      const restoreResult = await handleMarkRead({
        message_id: messageId,
        read: !wasUnread, // reverse: restore original
      });
      const restoreData = expectSuccess(restoreResult);
      expect(restoreData).toHaveProperty("marked", true);
    });
  });
});
