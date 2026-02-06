import { StringSession } from "telegram/sessions/index.js";

export function createSession(sessionString?: string): StringSession {
  return new StringSession(sessionString || "");
}

export function validateSession(sessionString: string): boolean {
  if (!sessionString || sessionString.trim() === "") {
    return false;
  }

  try {
    new StringSession(sessionString);
    return true;
  } catch {
    return false;
  }
}
