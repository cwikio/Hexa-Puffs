// Messages
import {
  listEmailsTool,
  handleListEmails,
  ListEmailsInputSchema,
  getEmailTool,
  handleGetEmail,
  GetEmailInputSchema,
  sendEmailTool,
  handleSendEmail,
  SendEmailInputSchema,
  replyEmailTool,
  handleReplyEmail,
  ReplyEmailInputSchema,
  deleteEmailTool,
  handleDeleteEmail,
  DeleteEmailInputSchema,
  markReadTool,
  handleMarkRead,
  MarkReadInputSchema,
  modifyLabelsTool,
  handleModifyLabels,
  ModifyLabelsInputSchema,
  getNewEmailsTool,
  handleGetNewEmails,
  GetNewEmailsInputSchema,
} from "./messages.js";

// Drafts
import {
  listDraftsTool,
  handleListDrafts,
  ListDraftsInputSchema,
  createDraftTool,
  handleCreateDraft,
  CreateDraftInputSchema,
  updateDraftTool,
  handleUpdateDraft,
  UpdateDraftInputSchema,
  sendDraftTool,
  handleSendDraft,
  SendDraftInputSchema,
  deleteDraftTool,
  handleDeleteDraft,
  DeleteDraftInputSchema,
} from "./drafts.js";

// Labels
import {
  listLabelsTool,
  handleListLabels,
  ListLabelsInputSchema,
  createLabelTool,
  handleCreateLabel,
  CreateLabelInputSchema,
  deleteLabelTool,
  handleDeleteLabel,
  DeleteLabelInputSchema,
} from "./labels.js";

// Attachments
import {
  listAttachmentsTool,
  handleListAttachments,
  ListAttachmentsInputSchema,
  getAttachmentTool,
  handleGetAttachment,
  GetAttachmentInputSchema,
} from "./attachments.js";

// Calendar
import {
  listCalendarsTool,
  handleListCalendars,
  ListCalendarsInputSchema,
  listEventsTool,
  handleListEvents,
  ListEventsInputSchema,
  getEventTool,
  handleGetEvent,
  GetEventInputSchema,
  createEventTool,
  handleCreateEvent,
  CreateEventInputSchema,
  updateEventTool,
  handleUpdateEvent,
  UpdateEventInputSchema,
  deleteEventTool,
  handleDeleteEvent,
  DeleteEventInputSchema,
  quickAddEventTool,
  handleQuickAddEvent,
  QuickAddEventInputSchema,
  findFreeTimeTool,
  handleFindFreeTime,
  FindFreeTimeInputSchema,
} from "./calendar.js";

// Filters
import {
  listFiltersTool,
  handleListFilters,
  ListFiltersInputSchema,
  getFilterTool,
  handleGetFilter,
  GetFilterInputSchema,
  createFilterTool,
  handleCreateFilter,
  CreateFilterInputSchema,
  deleteFilterTool,
  handleDeleteFilter,
  DeleteFilterInputSchema,
} from "./filters.js";

// Re-export all
export {
  // Messages
  listEmailsTool,
  handleListEmails,
  ListEmailsInputSchema,
  getEmailTool,
  handleGetEmail,
  GetEmailInputSchema,
  sendEmailTool,
  handleSendEmail,
  SendEmailInputSchema,
  replyEmailTool,
  handleReplyEmail,
  ReplyEmailInputSchema,
  deleteEmailTool,
  handleDeleteEmail,
  DeleteEmailInputSchema,
  markReadTool,
  handleMarkRead,
  MarkReadInputSchema,
  modifyLabelsTool,
  handleModifyLabels,
  ModifyLabelsInputSchema,
  getNewEmailsTool,
  handleGetNewEmails,
  GetNewEmailsInputSchema,
  // Drafts
  listDraftsTool,
  handleListDrafts,
  ListDraftsInputSchema,
  createDraftTool,
  handleCreateDraft,
  CreateDraftInputSchema,
  updateDraftTool,
  handleUpdateDraft,
  UpdateDraftInputSchema,
  sendDraftTool,
  handleSendDraft,
  SendDraftInputSchema,
  deleteDraftTool,
  handleDeleteDraft,
  DeleteDraftInputSchema,
  // Labels
  listLabelsTool,
  handleListLabels,
  ListLabelsInputSchema,
  createLabelTool,
  handleCreateLabel,
  CreateLabelInputSchema,
  deleteLabelTool,
  handleDeleteLabel,
  DeleteLabelInputSchema,
  // Attachments
  listAttachmentsTool,
  handleListAttachments,
  ListAttachmentsInputSchema,
  getAttachmentTool,
  handleGetAttachment,
  GetAttachmentInputSchema,
  // Calendar
  listCalendarsTool,
  handleListCalendars,
  ListCalendarsInputSchema,
  listEventsTool,
  handleListEvents,
  ListEventsInputSchema,
  getEventTool,
  handleGetEvent,
  GetEventInputSchema,
  createEventTool,
  handleCreateEvent,
  CreateEventInputSchema,
  updateEventTool,
  handleUpdateEvent,
  UpdateEventInputSchema,
  deleteEventTool,
  handleDeleteEvent,
  DeleteEventInputSchema,
  quickAddEventTool,
  handleQuickAddEvent,
  QuickAddEventInputSchema,
  findFreeTimeTool,
  handleFindFreeTime,
  FindFreeTimeInputSchema,
  // Filters
  listFiltersTool,
  handleListFilters,
  ListFiltersInputSchema,
  getFilterTool,
  handleGetFilter,
  GetFilterInputSchema,
  createFilterTool,
  handleCreateFilter,
  CreateFilterInputSchema,
  deleteFilterTool,
  handleDeleteFilter,
  DeleteFilterInputSchema,
};

// Type for tool handler
type ToolHandler = (args: unknown) => Promise<unknown>;

// Tool entry interface
interface ToolEntry {
  tool: {
    name: string;
    description: string;
    inputSchema: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
  handler: ToolHandler;
}

// All tools array for registration
export const allTools: ToolEntry[] = [
  // Messages
  { tool: listEmailsTool, handler: handleListEmails },
  { tool: getEmailTool, handler: handleGetEmail },
  { tool: sendEmailTool, handler: handleSendEmail },
  { tool: replyEmailTool, handler: handleReplyEmail },
  { tool: deleteEmailTool, handler: handleDeleteEmail },
  { tool: markReadTool, handler: handleMarkRead },
  { tool: modifyLabelsTool, handler: handleModifyLabels },
  { tool: getNewEmailsTool, handler: handleGetNewEmails },
  // Drafts
  { tool: listDraftsTool, handler: handleListDrafts },
  { tool: createDraftTool, handler: handleCreateDraft },
  { tool: updateDraftTool, handler: handleUpdateDraft },
  { tool: sendDraftTool, handler: handleSendDraft },
  { tool: deleteDraftTool, handler: handleDeleteDraft },
  // Labels
  { tool: listLabelsTool, handler: handleListLabels },
  { tool: createLabelTool, handler: handleCreateLabel },
  { tool: deleteLabelTool, handler: handleDeleteLabel },
  // Attachments
  { tool: listAttachmentsTool, handler: handleListAttachments },
  { tool: getAttachmentTool, handler: handleGetAttachment },
  // Calendar
  { tool: listCalendarsTool, handler: handleListCalendars },
  { tool: listEventsTool, handler: handleListEvents },
  { tool: getEventTool, handler: handleGetEvent },
  { tool: createEventTool, handler: handleCreateEvent },
  { tool: updateEventTool, handler: handleUpdateEvent },
  { tool: deleteEventTool, handler: handleDeleteEvent },
  { tool: quickAddEventTool, handler: handleQuickAddEvent },
  { tool: findFreeTimeTool, handler: handleFindFreeTime },
  // Filters
  { tool: listFiltersTool, handler: handleListFilters },
  { tool: getFilterTool, handler: handleGetFilter },
  { tool: createFilterTool, handler: handleCreateFilter },
  { tool: deleteFilterTool, handler: handleDeleteFilter },
];
