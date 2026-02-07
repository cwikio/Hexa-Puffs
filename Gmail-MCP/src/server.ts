/**
 * Gmail MCP Server
 * Provides Gmail and Google Calendar tools
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import {
  // Tool definitions (for descriptions)
  listEmailsTool, getEmailTool, sendEmailTool, replyEmailTool,
  deleteEmailTool, markReadTool, modifyLabelsTool, getNewEmailsTool,
  listDraftsTool, createDraftTool, updateDraftTool, sendDraftTool, deleteDraftTool,
  listLabelsTool, createLabelTool, deleteLabelTool,
  listAttachmentsTool, getAttachmentTool,
  listCalendarsTool, listEventsTool, getEventTool, createEventTool,
  updateEventTool, deleteEventTool, quickAddEventTool, findFreeTimeTool,
  listFiltersTool, getFilterTool, createFilterTool, deleteFilterTool,
  // Zod input schemas
  ListEmailsInputSchema, GetEmailInputSchema, SendEmailInputSchema,
  ReplyEmailInputSchema, DeleteEmailInputSchema, MarkReadInputSchema,
  ModifyLabelsInputSchema, GetNewEmailsInputSchema,
  ListDraftsInputSchema, CreateDraftInputSchema, UpdateDraftInputSchema,
  SendDraftInputSchema, DeleteDraftInputSchema,
  ListLabelsInputSchema, CreateLabelInputSchema, DeleteLabelInputSchema,
  ListAttachmentsInputSchema, GetAttachmentInputSchema,
  ListCalendarsInputSchema, ListEventsInputSchema, GetEventInputSchema,
  CreateEventInputSchema, UpdateEventInputSchema, DeleteEventInputSchema,
  QuickAddEventInputSchema, FindFreeTimeInputSchema,
  ListFiltersInputSchema, GetFilterInputSchema, CreateFilterInputSchema,
  DeleteFilterInputSchema,
  // Handlers
  handleListEmails, handleGetEmail, handleSendEmail, handleReplyEmail,
  handleDeleteEmail, handleMarkRead, handleModifyLabels, handleGetNewEmails,
  handleListDrafts, handleCreateDraft, handleUpdateDraft, handleSendDraft,
  handleDeleteDraft,
  handleListLabels, handleCreateLabel, handleDeleteLabel,
  handleListAttachments, handleGetAttachment,
  handleListCalendars, handleListEvents, handleGetEvent, handleCreateEvent,
  handleUpdateEvent, handleDeleteEvent, handleQuickAddEvent, handleFindFreeTime,
  handleListFilters, handleGetFilter, handleCreateFilter, handleDeleteFilter,
} from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "gmail-mcp",
    version: "1.0.0",
  });

  // Messages
  registerTool(server, {
    name: "list_emails",
    description: listEmailsTool.description,
    inputSchema: ListEmailsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleListEmails(params),
  });

  registerTool(server, {
    name: "get_email",
    description: getEmailTool.description,
    inputSchema: GetEmailInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleGetEmail(params),
  });

  registerTool(server, {
    name: "send_email",
    description: sendEmailTool.description,
    inputSchema: SendEmailInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleSendEmail(params),
  });

  registerTool(server, {
    name: "reply_email",
    description: replyEmailTool.description,
    inputSchema: ReplyEmailInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleReplyEmail(params),
  });

  registerTool(server, {
    name: "delete_email",
    description: deleteEmailTool.description,
    inputSchema: DeleteEmailInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    handler: async (params) => handleDeleteEmail(params),
  });

  registerTool(server, {
    name: "mark_read",
    description: markReadTool.description,
    inputSchema: MarkReadInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleMarkRead(params),
  });

  registerTool(server, {
    name: "modify_labels",
    description: modifyLabelsTool.description,
    inputSchema: ModifyLabelsInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleModifyLabels(params),
  });

  registerTool(server, {
    name: "get_new_emails",
    description: getNewEmailsTool.description,
    inputSchema: GetNewEmailsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleGetNewEmails(params),
  });

  // Drafts
  registerTool(server, {
    name: "list_drafts",
    description: listDraftsTool.description,
    inputSchema: ListDraftsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async () => handleListDrafts(),
  });

  registerTool(server, {
    name: "create_draft",
    description: createDraftTool.description,
    inputSchema: CreateDraftInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleCreateDraft(params),
  });

  registerTool(server, {
    name: "update_draft",
    description: updateDraftTool.description,
    inputSchema: UpdateDraftInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleUpdateDraft(params),
  });

  registerTool(server, {
    name: "send_draft",
    description: sendDraftTool.description,
    inputSchema: SendDraftInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleSendDraft(params),
  });

  registerTool(server, {
    name: "delete_draft",
    description: deleteDraftTool.description,
    inputSchema: DeleteDraftInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    handler: async (params) => handleDeleteDraft(params),
  });

  // Labels
  registerTool(server, {
    name: "list_labels",
    description: listLabelsTool.description,
    inputSchema: ListLabelsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async () => handleListLabels(),
  });

  registerTool(server, {
    name: "create_label",
    description: createLabelTool.description,
    inputSchema: CreateLabelInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleCreateLabel(params),
  });

  registerTool(server, {
    name: "delete_label",
    description: deleteLabelTool.description,
    inputSchema: DeleteLabelInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    handler: async (params) => handleDeleteLabel(params),
  });

  // Attachments
  registerTool(server, {
    name: "list_attachments",
    description: listAttachmentsTool.description,
    inputSchema: ListAttachmentsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleListAttachments(params),
  });

  registerTool(server, {
    name: "get_attachment",
    description: getAttachmentTool.description,
    inputSchema: GetAttachmentInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleGetAttachment(params),
  });

  // Calendar
  registerTool(server, {
    name: "list_calendars",
    description: listCalendarsTool.description,
    inputSchema: ListCalendarsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async () => handleListCalendars({}),
  });

  registerTool(server, {
    name: "list_events",
    description: listEventsTool.description,
    inputSchema: ListEventsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleListEvents(params),
  });

  registerTool(server, {
    name: "get_event",
    description: getEventTool.description,
    inputSchema: GetEventInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleGetEvent(params),
  });

  registerTool(server, {
    name: "create_event",
    description: createEventTool.description,
    inputSchema: CreateEventInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleCreateEvent(params),
  });

  registerTool(server, {
    name: "update_event",
    description: updateEventTool.description,
    inputSchema: UpdateEventInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleUpdateEvent(params),
  });

  registerTool(server, {
    name: "delete_event",
    description: deleteEventTool.description,
    inputSchema: DeleteEventInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    handler: async (params) => handleDeleteEvent(params),
  });

  registerTool(server, {
    name: "quick_add_event",
    description: quickAddEventTool.description,
    inputSchema: QuickAddEventInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleQuickAddEvent(params),
  });

  registerTool(server, {
    name: "find_free_time",
    description: findFreeTimeTool.description,
    inputSchema: FindFreeTimeInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleFindFreeTime(params),
  });

  // Filters
  registerTool(server, {
    name: "list_filters",
    description: listFiltersTool.description,
    inputSchema: ListFiltersInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async () => handleListFilters(),
  });

  registerTool(server, {
    name: "get_filter",
    description: getFilterTool.description,
    inputSchema: GetFilterInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleGetFilter(params),
  });

  registerTool(server, {
    name: "create_filter",
    description: createFilterTool.description,
    inputSchema: CreateFilterInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleCreateFilter(params),
  });

  registerTool(server, {
    name: "delete_filter",
    description: deleteFilterTool.description,
    inputSchema: DeleteFilterInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    handler: async (params) => handleDeleteFilter(params),
  });

  return server;
}

export async function initializeServer(): Promise<McpServer> {
  return createServer();
}
