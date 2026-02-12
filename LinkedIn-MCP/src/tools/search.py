"""Search tools — search_people."""

import logging
from typing import Any

from fastmcp import FastMCP

from src import linkedin_client
from src.response import error_response, success_response

logger = logging.getLogger("linkedin")


def handle_search_people(
    keywords: str,
    limit: int = 10,
) -> dict[str, Any]:
    """Search for people on LinkedIn."""
    try:
        api = linkedin_client.get_client()
        results = api.search_people(
            keywords=keywords,
            limit=limit,
        )
        people = [
            {
                "publicId": p.get("public_id"),
                "name": p.get("name"),
                "headline": p.get("headline"),
                "location": p.get("location"),
                "urnId": p.get("urn_id"),
            }
            for p in results
        ]
        return success_response({"results": people, "count": len(people)})
    except Exception as e:
        logger.error("Error searching people: %s", e)
        return error_response(str(e), "LINKEDIN_ERROR")


def register_search_tools(mcp: FastMCP) -> None:
    @mcp.tool()
    def search_people(keywords: str, limit: int = 10) -> dict[str, Any]:
        """Search for people on LinkedIn by keywords.

        Args:
            keywords: Search query (name, title, company, etc.)
            limit: Maximum number of results to return (default: 10)
        """
        return handle_search_people(keywords, limit)
