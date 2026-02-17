import { Api } from "telegram";

export interface TelegramConfig {
  apiId: number;
  apiHash: string;
  session: string;
}

export interface ChatInfo {
  id: string;
  type: "user" | "group" | "supergroup" | "channel";
  title: string;
  username?: string;
  unreadCount: number;
  lastMessage?: MessageInfo;
}

export interface MessageInfo {
  id: number;
  chatId: string;
  senderId?: string;
  senderName?: string;
  text: string;
  date: string;
  replyToMessageId?: number;
  hasMedia: boolean;
  mediaType?: string;
}

export interface UserInfo {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
  phone?: string;
  isBot: boolean;
  isContact: boolean;
}

export interface ContactInfo {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
  phone?: string;
}

export function getEntityId(entity: Api.TypePeer | Api.User | Api.Chat | Api.Channel | bigint): string {
  if (typeof entity === "bigint") {
    return entity.toString();
  }
  if ("userId" in entity) {
    return entity.userId.toString();
  }
  if ("chatId" in entity) {
    return `-${entity.chatId.toString()}`;
  }
  if ("channelId" in entity) {
    return `-100${entity.channelId.toString()}`;
  }
  if ("id" in entity) {
    const id = entity.id.toString();
    if (entity.className === "Channel") {
      return `-100${id}`;
    }
    if (entity.className === "Chat") {
      return `-${id}`;
    }
    return id;
  }
  return "";
}

export function getChatType(entity: Api.User | Api.Chat | Api.Channel): ChatInfo["type"] {
  if (entity.className === "User") {
    return "user";
  }
  if (entity.className === "Chat") {
    return "group";
  }
  if (entity.className === "Channel") {
    return (entity as Api.Channel).megagroup ? "supergroup" : "channel";
  }
  return "user";
}

export function getChatTitle(entity: Api.User | Api.Chat | Api.Channel): string {
  if (entity.className === "User") {
    const user = entity as Api.User;
    return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "Unknown";
  }
  return (entity as Api.Chat | Api.Channel).title || "Unknown";
}

export function formatMessage(message: Api.Message, chatId: string): MessageInfo {
  let senderName: string | undefined;

  if (message.fromId) {
    if ("userId" in message.fromId) {
      senderName = message.fromId.userId.toString();
    }
  }

  return {
    id: message.id,
    chatId,
    senderId: message.fromId ? getEntityId(message.fromId) : undefined,
    senderName,
    text: message.message || "",
    date: new Date(message.date * 1000).toISOString(),
    replyToMessageId: message.replyTo && "replyToMsgId" in message.replyTo
      ? message.replyTo.replyToMsgId
      : undefined,
    hasMedia: !!message.media,
    mediaType: message.media?.className,
  };
}

export function formatUser(user: Api.User): UserInfo {
  return {
    id: user.id.toString(),
    firstName: user.firstName || "",
    lastName: user.lastName,
    username: user.username,
    phone: user.phone,
    isBot: user.bot || false,
    isContact: user.contact || false,
  };
}

export function formatContact(user: Api.User): ContactInfo {
  return {
    id: user.id.toString(),
    firstName: user.firstName || "",
    lastName: user.lastName,
    username: user.username,
    phone: user.phone,
  };
}
