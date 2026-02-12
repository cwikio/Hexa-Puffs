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

        conversations = []
        for conv in raw[:limit]:
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


def handle_send_message(
    message_body: str,
    conversation_urn_id: str | None = None,
    recipients: list[str] | None = None,
) -> dict[str, Any]:
    """Send a direct message on LinkedIn.

    Either conversation_urn_id (reply to existing thread) or recipients
    (start new thread) must be provided.
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
        api.send_message(
            message_body=message_body,
            conversation_urn_id=conversation_urn_id,
            recipients=recipients,
        )
        return success_response({"sent": True})
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
        or recipients (list of profile URN IDs) to start a new conversation.

        Args:
            message_body: The message text to send
            conversation_urn_id: URN ID of an existing conversation to reply to
            recipients: List of profile URN IDs to start a new conversation with
        """
        return handle_send_message(message_body, conversation_urn_id, recipients)

    @mcp.tool()
    def get_conversation(conversation_urn_id: str) -> dict[str, Any]:
        """Get messages from a specific LinkedIn conversation.

        Args:
            conversation_urn_id: The URN ID of the conversation to retrieve
        """
        return handle_get_conversation(conversation_urn_id)
