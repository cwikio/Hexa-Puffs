import { NewMessage, NewMessageEvent } from "telegram/events/NewMessage.js";
import { Api } from "telegram";
import { MessageInfo, formatMessage, getEntityId } from "./types.js";

export interface IncomingMessage extends MessageInfo {
  isOutgoing: boolean;
  receivedAt: string;
}

// In-memory queue with max size
const MAX_QUEUE_SIZE = 1000;
const messageQueue: IncomingMessage[] = [];
const subscribedChats: Set<string> = new Set(); // Empty = all chats

export function getMessageQueue(): IncomingMessage[] {
  return [...messageQueue];
}

export function clearMessageQueue(): IncomingMessage[] {
  const messages = [...messageQueue];
  messageQueue.length = 0;
  return messages;
}

export function getQueueSize(): number {
  return messageQueue.length;
}

export function subscribeToChat(chatId: string): void {
  subscribedChats.add(chatId);
}

export function unsubscribeFromChat(chatId: string): void {
  subscribedChats.delete(chatId);
}

export function getSubscribedChats(): string[] {
  return [...subscribedChats];
}

export function clearSubscriptions(): void {
  subscribedChats.clear();
}

// Event handler for new messages
export function createMessageHandler() {
  return async (event: NewMessageEvent) => {
    const message = event.message;
    if (!(message instanceof Api.Message)) return;

    const chatId = message.peerId ? getEntityId(message.peerId) : "";

    // Filter by subscription if any chats are subscribed
    if (subscribedChats.size > 0 && !subscribedChats.has(chatId)) {
      return;
    }

    const formatted = formatMessage(message, chatId);
    const incoming: IncomingMessage = {
      ...formatted,
      isOutgoing: message.out || false,
      receivedAt: new Date().toISOString(),
    };

    // Add to queue, remove oldest if full
    messageQueue.push(incoming);
    if (messageQueue.length > MAX_QUEUE_SIZE) {
      messageQueue.shift();
    }
  };
}

export function createNewMessageEvent(): NewMessage {
  return new NewMessage({});
}
