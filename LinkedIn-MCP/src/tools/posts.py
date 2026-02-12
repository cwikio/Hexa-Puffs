"""Post tools — get_feed_posts (Phase 1), create_post/react/comment (Phase 2)."""

import logging
from typing import Any

from fastmcp import FastMCP

from src import linkedin_client
from src.response import error_response, success_response

logger = logging.getLogger("linkedin")


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


def register_post_tools(mcp: FastMCP) -> None:
    @mcp.tool()
    def get_feed_posts(limit: int = 10) -> dict[str, Any]:
        """Read recent posts from the LinkedIn feed.

        Args:
            limit: Maximum number of posts to return (default: 10)
        """
        return handle_get_feed_posts(limit)
