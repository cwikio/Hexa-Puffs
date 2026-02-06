/**
 * Gmail API types
 */

export interface EmailHeader {
  name: string;
  value: string;
}

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  date: string;
  body: {
    text?: string;
    html?: string;
  };
  attachments?: AttachmentInfo[];
  isUnread: boolean;
}

export interface EmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: EmailAddress;
  snippet: string;
  date: string;
  isUnread: boolean;
  labelIds: string[];
}

export interface AttachmentInfo {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface Label {
  id: string;
  name: string;
  type: "system" | "user";
  messagesTotal?: number;
  messagesUnread?: number;
}

export interface Draft {
  id: string;
  message: {
    id: string;
    threadId: string;
    subject: string;
    to: EmailAddress[];
    snippet: string;
  };
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  isHtml?: boolean;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

export interface ListEmailsOptions {
  query?: string;
  maxResults?: number;
  labelIds?: string[];
  pageToken?: string;
  includeSpamTrash?: boolean;
}

export interface ListEmailsResult {
  messages: EmailSummary[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}

// ============ FILTERS ============

export interface FilterCriteria {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  hasAttachment?: boolean;
  size?: number;
  sizeComparison?: "larger" | "smaller";
}

export interface FilterAction {
  addLabelIds?: string[];
  removeLabelIds?: string[];
  forward?: string;
}

export interface GmailFilter {
  id: string;
  criteria: FilterCriteria;
  action: FilterAction;
}
