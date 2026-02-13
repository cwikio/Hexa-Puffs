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


def _resolve_via_conversations(api: object, name: str) -> str | None:
    """Search recent conversations for a participant matching the name.

    Returns the URN ID extracted from the participant's miniProfile entityUrn.
    This bypasses the flaky search API entirely.
    """
    try:
        raw = api.get_conversations()  # type: ignore[attr-defined]
        conv_list: list = []
        if isinstance(raw, dict):
            conv_list = raw.get("elements", [])
        elif isinstance(raw, list):
            conv_list = raw

        name_lower = name.lower()
        for conv in conv_list:
            for p in conv.get("participants", []):
                member = p.get("com.linkedin.voyager.messaging.MessagingMember", {})
                mini = member.get("miniProfile", {})
                first = mini.get("firstName", "")
                last = mini.get("lastName", "")
                full_name = f"{first} {last}".strip().lower()
                if name_lower == full_name:
                    urn = mini.get("entityUrn", "")
                    if urn and ":" in urn:
                        urn_id = urn.split(":")[-1]
                        logger.info(
                            "Resolved '%s' via conversation participant (urn_id: %s)",
                            name, urn_id,
                        )
                        return urn_id
    except Exception as e:
        logger.warning("Conversation-based lookup failed: %s", e)
    return None


def _resolve_recipient(api: object, recipient: str) -> str | None:
    """Resolve a recipient to a URN ID. If it already looks like a URN ID, return as-is.
    If it looks like a name, try multiple strategies:
    1. keyword search (full name)
    2. first/last name split search
    3. broader search with include_private_profiles
    4. scan recent conversations for matching participant name
    """
    if _looks_like_urn_id(recipient):
        return recipient

    logger.info("Resolving recipient name '%s' to URN ID via search...", recipient)

    # Strategy 1: keyword search
    results = api.search_people(keywords=recipient, limit=5)  # type: ignore[attr-defined]
    if results:
        urn_id = results[0].get("urn_id")
        if urn_id:
            logger.info("Resolved '%s' → '%s' (urn_id: %s)", recipient, results[0].get("name"), urn_id)
            return urn_id

    # Strategy 2: split into first/last name — more precise LinkedIn filter
    parts = recipient.strip().split()
    if len(parts) >= 2:
        first_name = parts[0]
        last_name = " ".join(parts[1:])
        logger.info("Keyword search empty, trying first='%s' last='%s'...", first_name, last_name)
        results = api.search_people(  # type: ignore[attr-defined]
            keyword_first_name=first_name,
            keyword_last_name=last_name,
            include_private_profiles=True,
            network_depths=["F", "S", "O"],
            limit=5,
        )
        if results:
            urn_id = results[0].get("urn_id")
            if urn_id:
                logger.info("Resolved '%s' → '%s' (urn_id: %s) via name split", recipient, results[0].get("name"), urn_id)
                return urn_id

    # Strategy 3: broad keyword search including out-of-network
    logger.info("Name split empty, trying broad search for '%s'...", recipient)
    results = api.search_people(  # type: ignore[attr-defined]
        keywords=recipient,
        include_private_profiles=True,
        network_depths=["F", "S", "O"],
        limit=5,
    )
    if results:
        urn_id = results[0].get("urn_id")
        if urn_id:
            logger.info("Resolved '%s' → '%s' (urn_id: %s) via broad search", recipient, results[0].get("name"), urn_id)
            return urn_id

    # Strategy 4: scan conversations for matching participant (bypasses search API)
    logger.info("Search strategies exhausted, scanning conversations for '%s'...", recipient)
    conv_urn = _resolve_via_conversations(api, recipient)
    if conv_urn:
        return conv_urn

    logger.warning("All resolution strategies failed for recipient '%s'", recipient)
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

        # send_message returns True if an error occurred (status != 201)
        send_error = api.send_message(
            message_body=message_body,
            conversation_urn_id=conversation_urn_id,
            recipients=resolved_recipients,
        )
        if send_error:
            return error_response(
                "LinkedIn rejected the message (API returned non-201 status). "
                "The account may be restricted or rate-limited.",
                "LINKEDIN_SEND_FAILED",
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
