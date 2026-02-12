"""Messaging tools — get_conversations (Phase 1), send_message (Phase 2)."""

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


def register_messaging_tools(mcp: FastMCP) -> None:
    @mcp.tool()
    def get_conversations(limit: int = 20) -> dict[str, Any]:
        """List recent conversations from the LinkedIn messaging inbox.

        Args:
            limit: Maximum number of conversations to return (default: 20)
        """
        return handle_get_conversations(limit)
