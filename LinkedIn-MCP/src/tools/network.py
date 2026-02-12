"""Network tools — get_connections, send_connection_request."""

import logging
from typing import Any

from fastmcp import FastMCP

from src import linkedin_client
from src.response import error_response, success_response

logger = logging.getLogger("linkedin")


def handle_get_connections(limit: int = 50) -> dict[str, Any]:
    """List the authenticated user's connections."""
    try:
        api = linkedin_client.get_client()
        from src.tools.profile import _get_own_urn_id
        urn_id = _get_own_urn_id(api)
        if not urn_id:
            return error_response(
                "Could not determine own URN ID. Set LINKEDIN_PUBLIC_ID env var as fallback.",
                "LINKEDIN_ERROR",
            )

        raw = api.get_profile_connections(urn_id)
        connections = []
        for c in raw[:limit]:
            connections.append({
                "publicId": c.get("public_id"),
                "name": f"{c.get('firstName', '')} {c.get('lastName', '')}".strip(),
                "headline": c.get("headline", ""),
                "urnId": c.get("urn_id"),
            })
        return success_response({"connections": connections, "count": len(connections)})
    except Exception as e:
        logger.error("Error fetching connections: %s", e)
        return error_response(str(e), "LINKEDIN_ERROR")


def handle_send_connection_request(
    profile_public_id: str,
    message: str = "",
) -> dict[str, Any]:
    """Send a connection request to a LinkedIn user."""
    if len(message) > 300:
        return error_response(
            "Connection request message must be 300 characters or fewer",
            "VALIDATION_ERROR",
        )
    try:
        api = linkedin_client.get_client()
        api.add_connection(profile_public_id, message=message)
        return success_response({
            "sent": True,
            "profilePublicId": profile_public_id,
        })
    except Exception as e:
        logger.error("Error sending connection request to %s: %s", profile_public_id, e)
        return error_response(str(e), "LINKEDIN_ERROR")


def register_network_tools(mcp: FastMCP) -> None:
    @mcp.tool()
    def get_connections(limit: int = 50) -> dict[str, Any]:
        """List the authenticated user's LinkedIn connections.

        Args:
            limit: Maximum number of connections to return (default: 50)
        """
        return handle_get_connections(limit)

    @mcp.tool()
    def send_connection_request(
        profile_public_id: str,
        message: str = "",
    ) -> dict[str, Any]:
        """Send a connection request to a LinkedIn user.

        Args:
            profile_public_id: The public ID of the person to connect with
            message: Optional personalized note (max 300 characters)
        """
        return handle_send_connection_request(profile_public_id, message)
