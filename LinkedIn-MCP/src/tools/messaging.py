"""Messaging tools — get_conversations, send_message, get_conversation."""

import logging
from typing import Any

from fastmcp import FastMCP

from src import linkedin_client
from src.response import error_response, success_response

logger = logging.getLogger("linkedin")


def handle_get_conversations(limit: int = 20) -> dict[str, Any]:
    """List recent conversations from the LinkedIn inbox."""
    try:
        api = linkedin_client.get_client()
        raw = api.get_conversations()

        # get_conversations returns res.json() — may be a dict with "elements" or a list
        if isinstance(raw, dict):
            conv_list = raw.get("elements", [])
        elif isinstance(raw, list):
            conv_list = raw
        else:
            conv_list = []

        conversations = []
        for conv in conv_list[:limit]:
            participants = []
            for p in conv.get("participants", []):
                mini = p.get("com.linkedin.voyager.messaging.MessagingMember", {})
                name_parts = mini.get("miniProfile", {})
                name = f"{name_parts.get('firstName', '')} {name_parts.get('lastName', '')}".strip()
                if name:
                    participants.append(name)

            last_msg = conv.get("lastMessage", {})
            conversations.append({
                "conversationId": conv.get("entityUrn", "").split(":")[-1],
                "participants": participants,
                "lastMessage": {
                    "text": last_msg.get("body", ""),
                    "createdAt": last_msg.get("createdAt"),
                },
                "unreadCount": conv.get("unreadCount", 0),
            })

        return success_response({
            "conversations": conversations,
            "count": len(conversations),
        })
    except Exception as e:
        logger.error("Error fetching conversations: %s", e)
        return error_response(str(e), "LINKEDIN_ERROR")


def _looks_like_urn_id(value: str) -> bool:
    """Check if a string looks like a LinkedIn URN ID (e.g. 'ACoAAB...')."""
    # URN IDs are alphanumeric, typically start with uppercase letters
    # Names contain spaces, commas, etc.
    return bool(value) and " " not in value and "," not in value


def _resolve_recipient(api: object, recipient: str) -> str | None:
    """Resolve a recipient to a URN ID. If it already looks like a URN ID, return as-is.
    If it looks like a name, search for the person and return the top match's URN ID.
    """
    if _looks_like_urn_id(recipient):
        return recipient

    # Looks like a name — search for the person
    logger.info("Resolving recipient name '%s' to URN ID via search...", recipient)
    results = api.search_people(keywords=recipient, limit=1)  # type: ignore[attr-defined]
    logger.debug("search_people returned %d result(s) for '%s'", len(results) if results else 0, recipient)
    if results:
        logger.debug("First result keys: %s", list(results[0].keys()) if results[0] else "empty")
        urn_id = results[0].get("urn_id")
        name = results[0].get("name", recipient)
        if urn_id:
            logger.info("Resolved '%s' → '%s' (urn_id: %s)", recipient, name, urn_id)
        else:
            logger.warning("Search found '%s' but urn_id is None/empty. Full result: %s", name, results[0])
        return urn_id
    logger.warning("No search results for recipient '%s'", recipient)
    return None


def handle_send_message(
    message_body: str,
    conversation_urn_id: str | None = None,
    recipients: list[str] | None = None,
) -> dict[str, Any]:
    """Send a direct message on LinkedIn.

    Either conversation_urn_id (reply to existing thread) or recipients
    (start new thread) must be provided. Recipients can be URN IDs or
    person names (will be resolved via search).
    """
    if not message_body.strip():
        return error_response("message_body cannot be empty", "VALIDATION_ERROR")
    if not conversation_urn_id and not recipients:
        return error_response(
            "Provide either conversation_urn_id or recipients",
            "VALIDATION_ERROR",
        )
    try:
        api = linkedin_client.get_client()

        # Resolve any name-based recipients to URN IDs
        resolved_recipients = None
        if recipients:
            resolved_recipients = []
            for r in recipients:
                urn_id = _resolve_recipient(api, r)
                if not urn_id:
                    return error_response(
                        f"Could not find LinkedIn user matching '{r}'",
                        "RECIPIENT_NOT_FOUND",
                    )
                resolved_recipients.append(urn_id)

        api.send_message(
            message_body=message_body,
            conversation_urn_id=conversation_urn_id,
            recipients=resolved_recipients,
        )
        return success_response({
            "sent": True,
            "resolvedRecipients": resolved_recipients,
        })
    except Exception as e:
        logger.error("Error sending message: %s", e)
        return error_response(str(e), "LINKEDIN_ERROR")


def handle_get_conversation(conversation_urn_id: str) -> dict[str, Any]:
    """Get messages from a specific conversation."""
    try:
        api = linkedin_client.get_client()
        raw = api.get_conversation(conversation_urn_id)

        messages = []
        for event in raw.get("events", []):
            msg = event.get("eventContent", {}).get(
                "com.linkedin.voyager.messaging.event.MessageEvent", {}
            )
            sender_profile = event.get("from", {}).get("com.linkedin.voyager.messaging.MessagingMember", {}).get("miniProfile", {})
            sender_name = f"{sender_profile.get('firstName', '')} {sender_profile.get('lastName', '')}".strip()
            messages.append({
                "text": msg.get("body", ""),
                "sender": sender_name or "Unknown",
                "createdAt": event.get("createdAt"),
            })

        return success_response({
            "conversationId": conversation_urn_id,
            "messages": messages,
            "count": len(messages),
        })
    except Exception as e:
        logger.error("Error fetching conversation %s: %s", conversation_urn_id, e)
        return error_response(str(e), "LINKEDIN_ERROR")


def register_messaging_tools(mcp: FastMCP) -> None:
    @mcp.tool()
    def get_conversations(limit: int = 20) -> dict[str, Any]:
        """List recent conversations from the LinkedIn messaging inbox.

        Args:
            limit: Maximum number of conversations to return (default: 20)
        """
        return handle_get_conversations(limit)

    @mcp.tool()
    def send_message(
        message_body: str,
        conversation_urn_id: str | None = None,
        recipients: list[str] | None = None,
    ) -> dict[str, Any]:
        """Send a direct message on LinkedIn.

        Provide conversation_urn_id to reply to an existing thread,
        or recipients to start a new conversation. Recipients can be
        URN IDs (e.g. "ACoAABxxxxxx") or person names (will be auto-resolved
        via search to find the best match).

        Args:
            message_body: The message text to send
            conversation_urn_id: URN ID of an existing conversation to reply to
            recipients: List of profile URN IDs or person names
        """
        return handle_send_message(message_body, conversation_urn_id, recipients)

    @mcp.tool()
    def get_conversation(conversation_urn_id: str) -> dict[str, Any]:
        """Get messages from a specific LinkedIn conversation.

        Args:
            conversation_urn_id: The URN ID of the conversation to retrieve
        """
        return handle_get_conversation(conversation_urn_id)
