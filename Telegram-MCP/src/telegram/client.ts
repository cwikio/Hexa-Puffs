import { TelegramClient } from "telegram";
import { Api } from "telegram";
import { createSession, validateSession } from "./session.js";
import {
  TelegramConfig,
  ChatInfo,
  MessageInfo,
  UserInfo,
  ContactInfo,
  getEntityId,
  getChatType,
  getChatTitle,
  formatMessage,
  formatUser,
  formatContact,
} from "./types.js";
import { createMessageHandler, createNewMessageEvent } from "./events.js";
import bigInt from "big-integer";

let clientInstance: TelegramClient | null = null;

export function isClientConnected(): boolean {
  return clientInstance?.connected ?? false;
}

function isValidEntity(entity: unknown): entity is Api.User | Api.Chat | Api.Channel {
  if (!entity || typeof entity !== "object") return false;
  const e = entity as { className?: string };
  return e.className === "User" || e.className === "Chat" || e.className === "Channel";
}

export async function getClient(): Promise<TelegramClient> {
  if (clientInstance?.connected) {
    return clientInstance;
  }

  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  const sessionString = process.env.TELEGRAM_SESSION;

  if (!apiId || !apiHash) {
    throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH are required");
  }

  if (!sessionString || !validateSession(sessionString)) {
    throw new Error(
      "TELEGRAM_SESSION is required. Run 'npm run setup' to generate it."
    );
  }

  const config: TelegramConfig = {
    apiId: parseInt(apiId, 10),
    apiHash,
    session: sessionString,
  };

  const session = createSession(config.session);

  clientInstance = new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 5,
  });

  await clientInstance.connect();

  // Register event handler for real-time messages
  clientInstance.addEventHandler(
    createMessageHandler(),
    createNewMessageEvent()
  );

  return clientInstance;
}

export async function disconnect(): Promise<void> {
  if (clientInstance) {
    await clientInstance.disconnect();
    clientInstance = null;
  }
}

export async function getMe(): Promise<UserInfo> {
  const client = await getClient();
  const me = await client.getMe();

  if (!me || !(me instanceof Api.User)) {
    throw new Error("Failed to get current user");
  }

  return formatUser(me);
}

export async function listChats(limit = 50): Promise<ChatInfo[]> {
  const client = await getClient();
  const dialogs = await client.getDialogs({ limit });

  return dialogs
    .filter((dialog) => dialog.entity && isValidEntity(dialog.entity))
    .map((dialog) => {
      const entity = dialog.entity as Api.User | Api.Chat | Api.Channel;

      const chatInfo: ChatInfo = {
        id: getEntityId(entity),
        type: getChatType(entity),
        title: getChatTitle(entity),
        username:
          entity.className === "User" || entity.className === "Channel"
            ? (entity as Api.User | Api.Channel).username
            : undefined,
        unreadCount: dialog.unreadCount,
        lastMessage: dialog.message
          ? formatMessage(dialog.message as Api.Message, getEntityId(entity))
          : undefined,
      };

      return chatInfo;
    });
}

export async function getChat(chatId: string): Promise<ChatInfo> {
  const client = await getClient();
  const entity = await client.getEntity(chatId);

  if (!entity || !isValidEntity(entity)) {
    throw new Error(`Chat not found: ${chatId}`);
  }

  const validEntity = entity as Api.User | Api.Chat | Api.Channel;
  const dialogs = await client.getDialogs({ limit: 100 });
  const dialog = dialogs.find(
    (d) => d.entity && isValidEntity(d.entity) && getEntityId(d.entity as Api.User | Api.Chat | Api.Channel) === getEntityId(validEntity)
  );

  return {
    id: getEntityId(validEntity),
    type: getChatType(validEntity),
    title: getChatTitle(validEntity),
    username:
      validEntity.className === "User" || validEntity.className === "Channel"
        ? (validEntity as Api.User | Api.Channel).username
        : undefined,
    unreadCount: dialog?.unreadCount || 0,
  };
}

export async function sendMessage(
  chatId: string,
  message: string,
  replyTo?: number
): Promise<MessageInfo> {
  const client = await getClient();
  const result = await client.sendMessage(chatId, {
    message,
    replyTo,
  });

  if (result instanceof Api.Message) {
    return formatMessage(result, chatId);
  }

  throw new Error("Failed to send message");
}

export async function getMessages(
  chatId: string,
  limit = 20,
  offsetId?: number
): Promise<MessageInfo[]> {
  const client = await getClient();
  const messages = await client.getMessages(chatId, {
    limit,
    offsetId,
  });

  return messages
    .filter((msg): msg is Api.Message => msg instanceof Api.Message)
    .map((msg) => formatMessage(msg, chatId));
}

export async function searchMessages(
  query: string,
  chatId?: string,
  limit = 20
): Promise<MessageInfo[]> {
  const client = await getClient();

  if (chatId) {
    const messages = await client.getMessages(chatId, {
      search: query,
      limit,
    });

    return messages
      .filter((msg): msg is Api.Message => msg instanceof Api.Message)
      .map((msg) => formatMessage(msg, chatId));
  }

  const result = await client.invoke(
    new Api.messages.SearchGlobal({
      q: query,
      filter: new Api.InputMessagesFilterEmpty(),
      minDate: 0,
      maxDate: 0,
      offsetRate: 0,
      offsetPeer: new Api.InputPeerEmpty(),
      offsetId: 0,
      limit,
    })
  );

  if (!("messages" in result)) {
    return [];
  }

  return result.messages
    .filter((msg): msg is Api.Message => msg instanceof Api.Message)
    .map((msg) => {
      const peerId = msg.peerId ? getEntityId(msg.peerId) : "";
      return formatMessage(msg, peerId);
    });
}

export async function deleteMessages(
  chatId: string,
  messageIds: number[]
): Promise<boolean> {
  const client = await getClient();
  const entity = await client.getEntity(chatId);

  if (entity.className === "Channel") {
    await client.invoke(
      new Api.channels.DeleteMessages({
        channel: entity as Api.Channel,
        id: messageIds,
      })
    );
  } else {
    await client.invoke(
      new Api.messages.DeleteMessages({
        revoke: true,
        id: messageIds,
      })
    );
  }

  return true;
}

export async function createGroup(
  title: string,
  userIds: string[]
): Promise<ChatInfo> {
  const client = await getClient();

  const users: Api.TypeInputUser[] = [];
  for (const userId of userIds) {
    const entity = await client.getEntity(userId);
    if (entity instanceof Api.User) {
      const accessHash = entity.accessHash;
      users.push(
        new Api.InputUser({
          userId: entity.id,
          accessHash: accessHash ? bigInt(accessHash.toString()) : bigInt(0),
        })
      );
    }
  }

  const result = await client.invoke(
    new Api.messages.CreateChat({
      title,
      users,
    })
  );

  if (!("chats" in result.updates) || !result.updates.chats.length) {
    throw new Error("Failed to create group");
  }

  const chat = result.updates.chats[0];
  if (!isValidEntity(chat)) {
    throw new Error("Failed to create group - invalid chat returned");
  }

  return {
    id: getEntityId(chat),
    type: "group",
    title: (chat as Api.Chat).title,
    unreadCount: 0,
  };
}

export async function listContacts(): Promise<ContactInfo[]> {
  const client = await getClient();
  const result = await client.invoke(new Api.contacts.GetContacts({ hash: bigInt(0) }));

  if (!("users" in result)) {
    return [];
  }

  return result.users
    .filter((user): user is Api.User => user instanceof Api.User)
    .map(formatContact);
}

export async function addContact(
  phone: string,
  firstName: string,
  lastName?: string
): Promise<ContactInfo> {
  const client = await getClient();
  const result = await client.invoke(
    new Api.contacts.ImportContacts({
      contacts: [
        new Api.InputPhoneContact({
          clientId: bigInt(Date.now()),
          phone,
          firstName,
          lastName: lastName || "",
        }),
      ],
    })
  );

  if (!result.users.length) {
    throw new Error("Failed to add contact. User may not exist on Telegram.");
  }

  const user = result.users[0];
  if (!(user instanceof Api.User)) {
    throw new Error("Failed to add contact");
  }

  return formatContact(user);
}

export async function searchUsers(query: string, limit = 10): Promise<UserInfo[]> {
  const client = await getClient();
  const result = await client.invoke(
    new Api.contacts.Search({
      q: query,
      limit,
    })
  );

  return result.users
    .filter((user): user is Api.User => user instanceof Api.User)
    .map(formatUser);
}

export async function sendMedia(
  chatId: string,
  filePath: string,
  caption?: string
): Promise<MessageInfo> {
  const client = await getClient();
  const result = await client.sendFile(chatId, {
    file: filePath,
    caption,
    forceDocument: false,
  });

  if (result instanceof Api.Message) {
    return formatMessage(result, chatId);
  }

  throw new Error("Failed to send media");
}

export async function downloadMedia(
  chatId: string,
  messageId: number,
  outputPath: string
): Promise<string> {
  const client = await getClient();
  const messages = await client.getMessages(chatId, { ids: [messageId] });

  if (!messages.length || !(messages[0] instanceof Api.Message)) {
    throw new Error("Message not found");
  }

  const message = messages[0];
  if (!message.media) {
    throw new Error("Message has no media");
  }

  const downloadedPath = await client.downloadMedia(message.media, {
    outputFile: outputPath,
  });

  if (!downloadedPath) {
    throw new Error("Failed to download media");
  }

  return typeof downloadedPath === "string" ? downloadedPath : outputPath;
}

export async function markRead(chatId: string, messageId?: number): Promise<boolean> {
  const client = await getClient();
  const entity = await client.getEntity(chatId);

  if (entity.className === "Channel") {
    await client.invoke(
      new Api.channels.ReadHistory({
        channel: entity as Api.Channel,
        maxId: messageId || 0,
      })
    );
  } else {
    await client.invoke(
      new Api.messages.ReadHistory({
        peer: entity,
        maxId: messageId || 0,
      })
    );
  }

  return true;
}
