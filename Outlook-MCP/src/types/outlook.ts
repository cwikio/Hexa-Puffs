/**
 * Outlook / Microsoft Graph API types
 */

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailMessage {
  id: string;
  conversationId: string;
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
  bodyPreview: string;
  hasAttachments: boolean;
  isRead: boolean;
  importance: "low" | "normal" | "high";
  parentFolderId: string;
}

export interface EmailSummary {
  id: string;
  conversationId: string;
  subject: string;
  from: EmailAddress;
  bodyPreview: string;
  date: string;
  isRead: boolean;
  hasAttachments: boolean;
  importance: "low" | "normal" | "high";
}

export interface MailFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
  childFolderCount: number;
  totalItemCount: number;
  unreadItemCount: number;
  isHidden: boolean;
}

export interface ListEmailsOptions {
  folderId?: string;
  search?: string;
  filter?: string;
  top?: number;
  skip?: number;
  orderBy?: string;
}

export interface ListEmailsResult {
  messages: EmailSummary[];
  nextLink?: string;
  totalCount?: number;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  isHtml?: boolean;
  saveToSentItems?: boolean;
}
