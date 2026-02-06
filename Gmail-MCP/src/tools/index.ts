// Messages
import {
  listEmailsTool,
  handleListEmails,
  getEmailTool,
  handleGetEmail,
  sendEmailTool,
  handleSendEmail,
  replyEmailTool,
  handleReplyEmail,
  deleteEmailTool,
  handleDeleteEmail,
  markReadTool,
  handleMarkRead,
  modifyLabelsTool,
  handleModifyLabels,
  getNewEmailsTool,
  handleGetNewEmails,
} from "./messages.js";

// Drafts
import {
  listDraftsTool,
  handleListDrafts,
  createDraftTool,
  handleCreateDraft,
  updateDraftTool,
  handleUpdateDraft,
  sendDraftTool,
  handleSendDraft,
  deleteDraftTool,
  handleDeleteDraft,
} from "./drafts.js";

// Labels
import {
  listLabelsTool,
  handleListLabels,
  createLabelTool,
  handleCreateLabel,
  deleteLabelTool,
  handleDeleteLabel,
} from "./labels.js";

// Attachments
import {
  listAttachmentsTool,
  handleListAttachments,
  getAttachmentTool,
  handleGetAttachment,
} from "./attachments.js";

// Calendar
import {
  listCalendarsTool,
  handleListCalendars,
  listEventsTool,
  handleListEvents,
  getEventTool,
  handleGetEvent,
  createEventTool,
  handleCreateEvent,
  updateEventTool,
  handleUpdateEvent,
  deleteEventTool,
  handleDeleteEvent,
  quickAddEventTool,
  handleQuickAddEvent,
  findFreeTimeTool,
  handleFindFreeTime,
} from "./calendar.js";

// Filters
import {
  listFiltersTool,
  handleListFilters,
  getFilterTool,
  handleGetFilter,
  createFilterTool,
  handleCreateFilter,
  deleteFilterTool,
  handleDeleteFilter,
} from "./filters.js";

// Re-export all
export {
  // Messages
  listEmailsTool,
  handleListEmails,
  getEmailTool,
  handleGetEmail,
  sendEmailTool,
  handleSendEmail,
  replyEmailTool,
  handleReplyEmail,
  deleteEmailTool,
  handleDeleteEmail,
  markReadTool,
  handleMarkRead,
  modifyLabelsTool,
  handleModifyLabels,
  getNewEmailsTool,
  handleGetNewEmails,
  // Drafts
  listDraftsTool,
  handleListDrafts,
  createDraftTool,
  handleCreateDraft,
  updateDraftTool,
  handleUpdateDraft,
  sendDraftTool,
  handleSendDraft,
  deleteDraftTool,
  handleDeleteDraft,
  // Labels
  listLabelsTool,
  handleListLabels,
  createLabelTool,
  handleCreateLabel,
  deleteLabelTool,
  handleDeleteLabel,
  // Attachments
  listAttachmentsTool,
  handleListAttachments,
  getAttachmentTool,
  handleGetAttachment,
  // Calendar
  listCalendarsTool,
  handleListCalendars,
  listEventsTool,
  handleListEvents,
  getEventTool,
  handleGetEvent,
  createEventTool,
  handleCreateEvent,
  updateEventTool,
  handleUpdateEvent,
  deleteEventTool,
  handleDeleteEvent,
  quickAddEventTool,
  handleQuickAddEvent,
  findFreeTimeTool,
  handleFindFreeTime,
  // Filters
  listFiltersTool,
  handleListFilters,
  getFilterTool,
  handleGetFilter,
  createFilterTool,
  handleCreateFilter,
  deleteFilterTool,
  handleDeleteFilter,
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
