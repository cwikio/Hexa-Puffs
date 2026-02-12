"""Post tools — get_feed_posts, react_to_post."""

import logging
from typing import Any

from fastmcp import FastMCP

from src import linkedin_client
from src.response import error_response, success_response

logger = logging.getLogger("linkedin")

VALID_REACTIONS = {"LIKE", "CELEBRATE", "EMPATHY", "INTEREST", "APPRECIATION"}


def handle_get_feed_posts(limit: int = 10) -> dict[str, Any]:
    """Fetch recent posts from the LinkedIn feed."""
    try:
        api = linkedin_client.get_client()
        raw_posts = api.get_feed_posts(limit=limit)
        posts = []
        for post in raw_posts:
            author = post.get("author_name") or post.get("actor_name", "Unknown")
            text = post.get("commentary") or post.get("text", "")
            posts.append({
                "author": author,
                "text": text[:500] if text else "",
                "numLikes": post.get("num_likes", 0),
                "numComments": post.get("num_comments", 0),
                "postUrn": post.get("urn") or post.get("activityUrn"),
            })
        return success_response({"posts": posts, "count": len(posts)})
    except Exception as e:
        logger.error("Error fetching feed: %s", e)
        return error_response(str(e), "LINKEDIN_ERROR")


def handle_react_to_post(post_urn_id: str, reaction_type: str = "LIKE") -> dict[str, Any]:
    """React to a LinkedIn post (like, celebrate, etc.)."""
    reaction_upper = reaction_type.upper()
    if reaction_upper not in VALID_REACTIONS:
        return error_response(
            f"Invalid reaction_type '{reaction_type}'. Must be one of: {', '.join(sorted(VALID_REACTIONS))}",
            "VALIDATION_ERROR",
        )
    try:
        api = linkedin_client.get_client()
        err = api.react_to_post(post_urn_id, reaction_type=reaction_upper)
        # react_to_post returns True on error, False/None on success
        if err:
            return error_response("LinkedIn rejected the reaction", "LINKEDIN_ERROR")
        return success_response({"reacted": True, "postUrnId": post_urn_id, "reactionType": reaction_upper})
    except Exception as e:
        logger.error("Error reacting to post %s: %s", post_urn_id, e)
        return error_response(str(e), "LINKEDIN_ERROR")


def register_post_tools(mcp: FastMCP) -> None:
    @mcp.tool()
    def get_feed_posts(limit: int = 10) -> dict[str, Any]:
        """Read recent posts from the LinkedIn feed.

        Args:
            limit: Maximum number of posts to return (default: 10)
        """
        return handle_get_feed_posts(limit)

    @mcp.tool()
    def react_to_post(post_urn_id: str, reaction_type: str = "LIKE") -> dict[str, Any]:
        """React to a LinkedIn post.

        Args:
            post_urn_id: The URN ID of the post to react to
            reaction_type: Type of reaction — LIKE, CELEBRATE, EMPATHY, INTEREST, or APPRECIATION (default: LIKE)
        """
        return handle_react_to_post(post_urn_id, reaction_type)
